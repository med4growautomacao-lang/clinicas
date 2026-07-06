-- Rollback de 20260706000004_fix_purge_trigger_perdido_only.sql
-- ATENÇÃO: reverter reintroduz o bug de perda de venda no fluxo de agendamento. Só reverta
-- junto com o rollback de 20260706000003 (que remove o gatilho por completo).
DROP INDEX IF EXISTS public.uq_conversions_financial_transaction_id;

-- Restaura o predicado anterior (amplo) do gatilho
CREATE OR REPLACE FUNCTION public.fn_ticket_left_ganho()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.outcome = 'ganho' AND NEW.outcome IS DISTINCT FROM 'ganho' THEN
    PERFORM public.fn_purge_ticket_sale(OLD.id);
  END IF;
  RETURN NEW;
END;
$function$;
