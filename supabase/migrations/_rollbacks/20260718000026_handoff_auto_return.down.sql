-- Rollback de 20260718000026_handoff_auto_return.sql
do $$ begin perform cron.unschedule('handoff_auto_return_job'); exception when others then null; end $$;
drop function if exists public.process_handoff_auto_return();
-- Restaura o trigger SEM o keep-alive (versão de 20260718000025)
create or replace function public.fn_handoff_on_human_reply()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_lead record; v_uses_ai boolean;
begin
  if NEW.lead_id is null then return NEW; end if;
  select id, name, phone, ai_enabled into v_lead from leads where id = NEW.lead_id;
  if v_lead.id is null or v_lead.ai_enabled is not true then return NEW; end if;
  select coalesce(auto_schedule, false) into v_uses_ai from ai_config where clinic_id = NEW.clinic_id;
  if not coalesce(v_uses_ai, false) then return NEW; end if;
  update leads set ai_enabled = false, handoff_triggered_at = (now() at time zone 'America/Sao_Paulo') where id = v_lead.id;
  perform notify_ops(NEW.clinic_id, 'handoff', 'Atendimento assumido por humano',
    coalesce(nullif(btrim(v_lead.name), ''), v_lead.phone) || ' — a IA foi pausada para este lead.',
    'warning', v_lead.id, null, null, null, jsonb_build_object('reason', 'manual_reply'), true, null);
  return NEW;
exception when others then
  perform log_system_error('handoff-trigger','handoff_write_failed','Falha ao pausar IA / notificar no handoff manual','error', NEW.clinic_id, jsonb_build_object('lead_id', NEW.lead_id, 'detail', sqlerrm), false);
  return NEW;
end $$;
alter table public.ai_config drop column if exists handoff_auto_return_enabled;
alter table public.ai_config drop column if exists handoff_auto_return_minutes;
