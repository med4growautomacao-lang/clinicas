-- Rollback de 20260719000060.
drop trigger if exists trg_guard_stage_source on public.tickets;
drop function if exists public.fn_guard_stage_source();

-- fn_log_ticket_stage_change volta a marcar 'unknown' também no nascimento (INSERT).
create or replace function public.fn_log_ticket_stage_change()
 returns trigger
 language plpgsql
as $function$
BEGIN
  IF NEW.lead_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' OR OLD.stage_id IS DISTINCT FROM NEW.stage_id THEN
    INSERT INTO lead_stage_history (clinic_id, lead_id, ticket_id, old_stage_id, new_stage_id, changed_at, source, actor)
    VALUES (NEW.clinic_id, NEW.lead_id, NEW.id,
            CASE WHEN TG_OP = 'UPDATE' THEN OLD.stage_id ELSE NULL END,
            NEW.stage_id, (now() AT TIME ZONE 'America/Sao_Paulo'),
            COALESCE(NULLIF(current_setting('app.stage_source', true), ''), 'unknown'),
            NULLIF(current_setting('app.stage_actor', true), ''));
  END IF;
  RETURN NEW;
END;
$function$;
