-- 20260513200305_cascade_delete_ticket_ganho_to_conversion_and_tx
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

CREATE OR REPLACE FUNCTION public.fn_cascade_delete_ticket_ganho()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tx_ids uuid[];
BEGIN
  -- Só age se o ticket era ganho (open ou closed)
  IF OLD.outcome <> 'ganho' THEN
    RETURN OLD;
  END IF;

  -- Pega ids das transações vinculadas via conversion.financial_transaction_id
  SELECT array_agg(c.financial_transaction_id) INTO v_tx_ids
  FROM conversions c
  WHERE c.ticket_id = OLD.id AND c.financial_transaction_id IS NOT NULL;

  -- Tambem via appointment.ticket_id (caso o vinculo seja via appointment)
  SELECT array_cat(v_tx_ids, array_agg(ft.id)) INTO v_tx_ids
  FROM financial_transactions ft
  JOIN appointments a ON a.id = ft.appointment_id
  WHERE a.ticket_id = OLD.id AND ft.type = 'receita';

  -- Apaga conversions do ticket (vai apagar via FK CASCADE se houver, mas explicito por seguranca)
  DELETE FROM conversions WHERE ticket_id = OLD.id;

  -- Apaga as transacoes coletadas
  IF v_tx_ids IS NOT NULL AND array_length(v_tx_ids, 1) > 0 THEN
    DELETE FROM financial_transactions WHERE id = ANY(v_tx_ids);
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_cascade_delete_ticket_ganho ON public.tickets;
CREATE TRIGGER trg_cascade_delete_ticket_ganho
  BEFORE DELETE ON public.tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_cascade_delete_ticket_ganho();
