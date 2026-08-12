-- 20260618160710_reconcile_pending_tracking_sweep
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Fecha a brecha de concorrência da reconciliação de atribuição: quando o INSERT do lead
-- e o INSERT na lead_tracking_inbox acontecem em transações sobrepostas, cada trigger
-- (AFTER INSERT) não enxerga o outro registro ainda não-commitado, e o registro fica preso
-- (consumed_at NULL) para sempre. Este sweep periódico reconcilia os pendentes.
CREATE OR REPLACE FUNCTION public.fn_reconcile_pending_tracking()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE r record; n int := 0;
BEGIN
  FOR r IN
    SELECT i.id AS inbox_id,
      (SELECT l.id FROM leads l
        WHERE l.clinic_id = i.clinic_id AND normalize_br_phone(l.phone) = i.phone_norm
        ORDER BY l.created_at DESC LIMIT 1) AS lead_id
    FROM lead_tracking_inbox i
    WHERE i.consumed_at IS NULL AND i.phone_norm IS NOT NULL
  LOOP
    IF r.lead_id IS NOT NULL THEN
      PERFORM public.fn_apply_inbox_to_lead(r.lead_id, r.inbox_id);
      n := n + 1;
    END IF;
  END LOOP;
  RETURN n;
END;
$function$;

-- Agenda o sweep a cada 1 minuto (idempotente)
DO $do$
BEGIN
  PERFORM cron.unschedule('reconcile_pending_tracking');
EXCEPTION WHEN OTHERS THEN NULL;
END $do$;
SELECT cron.schedule('reconcile_pending_tracking', '* * * * *', $$SELECT public.fn_reconcile_pending_tracking();$$);
