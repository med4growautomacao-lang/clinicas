-- 20260720045029_c7_stage_guard_observe_and_birth_source
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- (1) Nascimento de ticket (INSERT) loga source='auto_open' em vez de 'unknown'.
-- Assim 'unknown' passa a significar EXCLUSIVAMENTE "UPDATE de etapa fora das RPCs sancionadas"
-- (o tripwire real do C7). Os 418 'unknown' históricos eram nascimentos; a partir daqui, limpo.
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
            COALESCE(NULLIF(current_setting('app.stage_source', true), ''),
                     CASE WHEN TG_OP = 'INSERT' THEN 'auto_open' ELSE 'unknown' END),
            NULLIF(current_setting('app.stage_actor', true), ''));
  END IF;
  RETURN NEW;
END;
$function$;

-- (2) C7 — guard em modo OBSERVAÇÃO: detecta UPDATE de stage_id sem autoria e registra na Central.
-- NÃO bloqueia (RETURN NEW). Vira bloqueio trocando o bloco comentado por RAISE, após janela limpa.
create or replace function public.fn_guard_stage_source()
 returns trigger
 language plpgsql
as $function$
declare v_src text := nullif(current_setting('app.stage_source', true), '');
begin
  if OLD.stage_id is distinct from NEW.stage_id and v_src is null then
    perform log_system_error(
      'stage-guard','rogue_stage_update',
      'Etapa movida SEM autoria (app.stage_source ausente) — escritor fora das RPCs sancionadas',
      'warning', NEW.clinic_id,
      jsonb_build_object('ticket_id', NEW.id, 'old_stage_id', OLD.stage_id, 'new_stage_id', NEW.stage_id),
      false);
    -- C7 HARD (ligar após >=7 dias sem 'rogue_stage_update'):
    --   raise exception 'stage_id só muda via RPC sancionada (app.stage_source ausente) [ticket %]', NEW.id;
  end if;
  return NEW;
end;
$function$;

drop trigger if exists trg_guard_stage_source on public.tickets;
create trigger trg_guard_stage_source
  before update of stage_id on public.tickets
  for each row execute function public.fn_guard_stage_source();
