-- C7 (fechar a porta do motor de etapas) — investigação + preparação.
--
-- Diagnóstico (20/07): dos 440 movimentos 'unknown' em 10 dias, 418 eram NASCIMENTO de ticket
-- (INSERT, old_stage_id nulo — o log dispara em INSERT OR UPDATE) e só 22 eram MOVIMENTO real.
-- Os 22 são todos de 17-18/07, padrão de gatilho de etapa por UPDATE cru = o n8n "Gatilhos"
-- durante o cutover, JÁ DESATIVADO. Zero movimentos 'unknown' desde 18/07 11:20.
-- fn_auto_move_lead_to_agendado está limpo (seta app.stage_source='agenda' + ciclo-novo).
--
-- (1) Nascimento passa a logar source='auto_open' → 'unknown' vira sinal PURO de UPDATE fora
--     das RPCs sancionadas (o tripwire real do C7). Sem isso, os nascimentos poluiriam para sempre.
-- (2) Guard em modo OBSERVAÇÃO: registra na Central todo UPDATE de stage_id sem app.stage_source,
--     mas NÃO bloqueia. Vira bloqueio (RAISE) numa migration de 1 linha após >=7 dias sem
--     'rogue_stage_update' na Central (respeita a cautela do plano-mestre).

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
