-- 20260720045658_ai_loop_guard_review_hardening
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Revisão 20/07: correções dos 6 achados do code-review.

-- #2/#5/#6 — reescrita da guarda:
--   #2 handoff_triggered_at sempre renova (era coalesce → auto-return religava);
--   #5 pausa só leads ATIVOS nesta sessão dentro da janela (não todo lead que compartilha session_id);
--   #6 clinic p/ notify/log vem do lead quando p_clinic_id vier nulo ('').
create or replace function public.fn_ai_loop_guard(
  p_session_id text,
  p_clinic_id  uuid,
  p_max_turns  int default 20,
  p_window_min int default 30
) returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_now_sp   timestamp := now() at time zone 'America/Sao_Paulo';
  v_since    timestamp := (now() at time zone 'America/Sao_Paulo') - make_interval(mins => p_window_min);
  v_ai_turns int;
  v_lead     record;
  v_paused   int := 0;
  v_clinic   uuid;
begin
  select count(*) into v_ai_turns
  from chat_messages
  where session_id = p_session_id
    and message->>'type' = 'ai'
    and created_at > v_since;

  if v_ai_turns < p_max_turns then
    return true;
  end if;

  -- só os leads que participaram DESTA sessão na janela e ainda estão com IA ligada
  for v_lead in
    select distinct cm.lead_id as id, l.clinic_id
    from chat_messages cm
    join leads l on l.id = cm.lead_id
    where cm.session_id = p_session_id
      and cm.created_at > v_since
      and l.ai_enabled is distinct from false
  loop
    update leads
       set ai_enabled = false,
           handoff_triggered_at = v_now_sp          -- sempre renova a pausa (#2)
     where id = v_lead.id;
    v_paused := v_paused + 1;
    v_clinic := coalesce(p_clinic_id, v_lead.clinic_id);  -- fallback de clínica (#6)
    begin
      perform notify_ops(
        p_clinic_id    => v_clinic,
        p_event        => 'ai_loop_guard',
        p_title        => 'IA pausada: possível loop com atendimento automático',
        p_body         => format('A IA respondeu %s vezes em %s min nesta conversa (provável bot do outro lado). Assuma o atendimento.', v_ai_turns, p_window_min),
        p_level        => 'warning',
        p_lead_id      => v_lead.id,
        p_notify_group => true
      );
    exception when others then null;
    end;
  end loop;

  begin
    perform log_system_error(
      p_scope      => 'ai-loop-guard',
      p_code       => 'loop_detected',
      p_title      => format('Loop de IA barrado (%s turnos em %smin)', v_ai_turns, p_window_min),
      p_level      => 'warning',
      p_clinic_id  => coalesce(p_clinic_id, v_clinic),
      p_context    => jsonb_build_object('session_id', p_session_id, 'ai_turns', v_ai_turns,
                                         'window_min', p_window_min, 'leads_pausados', v_paused),
      p_is_monitor => true
    );
  exception when others then null;
  end;

  return false;

exception when others then
  begin
    perform log_system_error('ai-loop-guard','guard_error','Falha na guarda anti-loop (fail-open)',
      'error', p_clinic_id, jsonb_build_object('session_id', p_session_id, 'sqlerrm', sqlerrm), true);
  exception when others then null;
  end;
  return true;
end;
$$;

-- #1 — fecha a exposição: SECURITY DEFINER não pode ser chamável por anon/PUBLIC
--     (mesma postura de log_system_error/get_hub_migration_status). n8n usa conexão
--     postgres direta (dono/service_role), então segue funcionando.
revoke all on function public.fn_ai_loop_guard(text, uuid, integer, integer) from public, anon;
revoke all on function public.fn_ai_loop_guard(text, text, integer, integer) from public, anon;

-- #3 — shield: desambigua a clínica (ignora phone_number vazio, prefere o prefixo mais longo)
create or replace function public.fn_memory_insert_shield()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_clinic_id    uuid;
  v_clinic_phone text;
  v_lead_phone   text;
begin
  if NEW.message->>'type' = 'human' then
    select clinic_id, phone_number
      into v_clinic_id, v_clinic_phone
    from whatsapp_instances
    where phone_number is not null and phone_number <> ''
      and starts_with(NEW.session_id, phone_number)
    order by length(phone_number) desc   -- prefixo mais específico (#3)
    limit 1;

    v_lead_phone := case
      when v_clinic_phone is not null and starts_with(NEW.session_id, v_clinic_phone)
        then substr(NEW.session_id, length(v_clinic_phone) + 1)
      else NEW.session_id
    end;

    if exists (
      select 1 from chat_messages cm
      where cm.wa_message_id is not null
        and cm.direction = 'inbound'
        and cm.created_at > (now() at time zone 'America/Sao_Paulo') - interval '15 minutes'
        and (
          cm.session_id = NEW.session_id
          or (
            v_clinic_id is not null
            and cm.clinic_id = v_clinic_id
            and normalize_br_phone(cm.phone) = normalize_br_phone(v_lead_phone)
          )
        )
    ) then
      return NEW;
    end if;
  end if;

  insert into chat_messages (session_id, message)
  values (NEW.session_id, NEW.message);
  return NEW;
end;
$function$;

-- #4 — materializa o índice da guarda na migration (já existe no banco → IF NOT EXISTS
--     vira no-op sem lock; em rebuild, recria). Não-concorrente pois roda dentro da migration.
create index if not exists idx_chat_messages_ai_guard
  on public.chat_messages (session_id, created_at)
  where (message->>'type') = 'ai';
