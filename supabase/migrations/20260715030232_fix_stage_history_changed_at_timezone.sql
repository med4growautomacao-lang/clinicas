-- 20260715030232_fix_stage_history_changed_at_timezone
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- BUG (sistêmico): fn_log_ticket_stage_change gravava changed_at = now(). Como now() é timestamptz
-- (UTC) e a coluna é 'timestamp without time zone', o Postgres grava o relógio de parede UTC — 3h à
-- frente do SP. Mas TODO o sistema lê changed_at como SP (contrato do CLAUDE.md; leads.created_at usa
-- (now() AT TIME ZONE 'America/Sao_Paulo')). Resultado: eventos de etapa após 21h SP caíam no dia
-- seguinte e sumiam do período "hoje" nos painéis de Marketing (marketing_*_funnel_cohort).
-- Fix: gravar o relógio SP, igual ao resto do sistema.
CREATE OR REPLACE FUNCTION public.fn_log_ticket_stage_change()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.lead_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' OR OLD.stage_id IS DISTINCT FROM NEW.stage_id THEN
    INSERT INTO lead_stage_history (clinic_id, lead_id, ticket_id, old_stage_id, new_stage_id, changed_at)
    VALUES (NEW.clinic_id, NEW.lead_id, NEW.id,
            CASE WHEN TG_OP = 'UPDATE' THEN OLD.stage_id ELSE NULL END,
            NEW.stage_id, (now() AT TIME ZONE 'America/Sao_Paulo'));
  END IF;
  RETURN NEW;
END;
$function$;
