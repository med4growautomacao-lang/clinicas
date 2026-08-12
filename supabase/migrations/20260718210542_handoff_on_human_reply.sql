-- 20260718210542_handoff_on_human_reply
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

create or replace function public.fn_handoff_on_human_reply()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_lead record;
  v_uses_ai boolean;
begin
  if NEW.lead_id is null then
    return NEW;
  end if;

  select id, name, phone, ai_enabled into v_lead from leads where id = NEW.lead_id;
  if v_lead.id is null or v_lead.ai_enabled is not true then
    return NEW;
  end if;

  select coalesce(auto_schedule, false) into v_uses_ai from ai_config where clinic_id = NEW.clinic_id;
  if not coalesce(v_uses_ai, false) then
    return NEW;
  end if;

  update leads
     set ai_enabled = false,
         handoff_triggered_at = (now() at time zone 'America/Sao_Paulo')
   where id = v_lead.id;

  perform notify_ops(
    NEW.clinic_id,
    'handoff',
    'Atendimento assumido por humano',
    coalesce(nullif(btrim(v_lead.name), ''), v_lead.phone) || ' — a IA foi pausada para este lead.',
    'warning',
    v_lead.id, null, null, null,
    jsonb_build_object('reason', 'manual_reply'),
    true, null
  );

  return NEW;
exception when others then
  perform log_system_error(
    'handoff-trigger', 'handoff_write_failed',
    'Falha ao pausar IA / notificar no handoff manual', 'error',
    NEW.clinic_id, jsonb_build_object('lead_id', NEW.lead_id, 'detail', sqlerrm), false
  );
  return NEW;
end;
$$;

drop trigger if exists trg_handoff_on_human_reply on public.chat_messages;
create trigger trg_handoff_on_human_reply
  after insert on public.chat_messages
  for each row
  when (NEW.direction = 'outbound' and NEW.sender = 'human')
  execute function public.fn_handoff_on_human_reply();
