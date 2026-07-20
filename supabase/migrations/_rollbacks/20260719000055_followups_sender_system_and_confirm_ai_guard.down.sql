-- Rollback de 20260719000055 (sender system + guard anti-dupla-resposta).
-- Restaura as versões anteriores reaplicando as migrations de origem:
--   fn_handle_confirmation_reply  -> 20260719000037_granular_events.sql (sender 'ai', sem GUC)
--   fn_ticket_finish_message      -> 20260719000054_encerramento_message_variables.sql (sender 'ai')
--   process_pos_followup          -> 20260719000052_confirmation_reminder_and_pos_followup_native.sql
--   process_confirmation_reminders-> 20260719000053_confirm_send_window.sql (sem registro na conversa)
--   process_sla_unanswered        -> 20260719000049_notify_backfill_guard_and_sla_fallback.sql
--   ingest_wa_message             -> 20260719000039_ingest_wa_message_name_backfill_avatar.sql (sem GUC)
-- (Reaplicar os blocos CREATE OR REPLACE desses arquivos.)
-- E os edges: forms-welcome-followup / reengagement-followup voltam a sender/type 'ai' (redeploy).

-- Trigger de gatilhos: volta a excluir só 'ai'.
drop trigger if exists trg_zz_apply_stage_rules on public.chat_messages;
create trigger trg_zz_apply_stage_rules
  after insert on public.chat_messages
  for each row
  when (new.direction = 'outbound' and new.sender is distinct from 'ai' and new.lead_id is not null)
  execute function public.fn_apply_stage_rules();

-- last_fields: system volta a contar como outbound.
create or replace function public.fn_update_lead_last_fields()
returns trigger language plpgsql as $$
begin
  if NEW.lead_id is not null then
    update public.leads
      set last_activity_at = NEW.created_at,
          last_message_at  = case when NEW.direction = 'inbound'  then NEW.created_at else last_message_at  end,
          last_outbound_at = case when NEW.direction = 'outbound' then NEW.created_at else last_outbound_at end
      where id = NEW.lead_id;
  end if;
  return NEW;
end; $$;

-- Dashboards: reverter os patches cirúrgicos (replace inverso).
do $$
declare r record; src text;
begin
  for r in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='public' and p.proname='get_dashboard_stats' loop
    src := pg_get_functiondef(r.oid);
    if position('AND cm.sender <> ''system'' THEN ''out''' in src) > 0 then
      execute replace(src, 'WHEN cm.direction = ''outbound'' AND cm.sender <> ''system'' THEN ''out''',
                           'WHEN cm.direction = ''outbound'' THEN ''out''');
    end if;
  end loop;
  for r in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='public' and p.proname='get_commercial_dashboard' loop
    src := pg_get_functiondef(r.oid);
    if position('cm.direction = ''outbound'' AND cm.sender <> ''system'')' in src) > 0 then
      execute replace(src, 'WHEN (p_agent = ''todos'' AND cm.direction = ''outbound'' AND cm.sender <> ''system'')',
                           'WHEN (p_agent = ''todos'' AND cm.direction = ''outbound'')');
    end if;
  end loop;
end $$;
