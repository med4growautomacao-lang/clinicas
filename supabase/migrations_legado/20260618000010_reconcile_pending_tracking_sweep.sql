-- Fecha a brecha de CONCORRÊNCIA da reconciliação de atribuição.
-- Os triggers trg_inbox_reconcile (AFTER INSERT em lead_tracking_inbox) e
-- trg_lead_pull_tracking (AFTER INSERT em leads) só reconciliam no instante do insert.
-- Quando o INSERT do lead e o INSERT na inbox ocorrem em transações sobrepostas (~mesmo
-- instante), cada trigger não enxerga o registro do outro (ainda não-commitado) e o
-- tracking fica preso (consumed_at NULL / matched_lead_id NULL) permanentemente — mesmo
-- com lead e inbox existindo e batendo por clinic_id + telefone normalizado.
--
-- Sweep periódico (pg_cron, 1/min) reconcilia qualquer inbox pendente com lead correspondente.
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

DO $do$
BEGIN
  PERFORM cron.unschedule('reconcile_pending_tracking');
EXCEPTION WHEN OTHERS THEN NULL;
END $do$;
SELECT cron.schedule('reconcile_pending_tracking', '* * * * *', $$SELECT public.fn_reconcile_pending_tracking();$$);
