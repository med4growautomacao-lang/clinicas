-- 20260706175610_fix_purge_trigger_perdido_only
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

CREATE OR REPLACE FUNCTION public.fn_ticket_left_ganho()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.outcome = 'ganho' AND NEW.outcome = 'perdido' THEN
    PERFORM public.fn_purge_ticket_sale(OLD.id);
  END IF;
  RETURN NEW;
END;
$function$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_conversions_financial_transaction_id
  ON public.conversions (financial_transaction_id)
  WHERE financial_transaction_id IS NOT NULL;
