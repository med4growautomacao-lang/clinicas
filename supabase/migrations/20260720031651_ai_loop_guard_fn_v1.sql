-- 20260720031651_ai_loop_guard_fn_v1
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Trava anti-loop da IA (sinal primário: taxa de respostas da IA por sessão numa janela).
-- Calibrada em dados reais: conversas normais topam ~20 turnos na vida inteira (horas);
-- loops observados fazem ~30/30min. Fail-open: erro na guarda NUNCA bloqueia o atendimento.
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
  v_ai_turns int;
  v_lead_id  uuid;
  v_paused   int := 0;
begin
  select count(*) into v_ai_turns
  from chat_messages
  where session_id = p_session_id
    and message->>'type' = 'ai'
    and created_at > v_now_sp - make_interval(mins => p_window_min);

  if v_ai_turns < p_max_turns then
    return true;
  end if;

  for v_lead_id in
    select distinct lead_id from chat_messages
    where session_id = p_session_id and lead_id is not null
  loop
    update leads
       set ai_enabled = false,
           handoff_triggered_at = coalesce(handoff_triggered_at, v_now_sp)
     where id = v_lead_id and ai_enabled is distinct from false;
    if found then
      v_paused := v_paused + 1;
      begin
        perform notify_ops(
          p_clinic_id    => p_clinic_id,
          p_event        => 'ai_loop_guard',
          p_title        => 'IA pausada: possível loop com atendimento automático',
          p_body         => format('A IA respondeu %s vezes em %s min nesta conversa (provável bot do outro lado). Assuma o atendimento.', v_ai_turns, p_window_min),
          p_level        => 'warning',
          p_lead_id      => v_lead_id,
          p_notify_group => true
        );
      exception when others then null;
      end;
    end if;
  end loop;

  begin
    perform log_system_error(
      p_scope      => 'ai-loop-guard',
      p_code       => 'loop_detected',
      p_title      => format('Loop de IA barrado (%s turnos em %smin)', v_ai_turns, p_window_min),
      p_level      => 'warning',
      p_clinic_id  => p_clinic_id,
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
      'error', p_clinic_id,
      jsonb_build_object('session_id', p_session_id, 'sqlerrm', sqlerrm), true);
  exception when others then null;
  end;
  return true;
end;
$$;

comment on function public.fn_ai_loop_guard(text,uuid,int,int) is
  'Trava anti-loop da IA. Retorna false (abortar turno) se a IA respondeu >= p_max_turns na sessao dentro de p_window_min; nesse caso pausa ai_enabled, dispara handoff e loga na Central. Fail-open.';
