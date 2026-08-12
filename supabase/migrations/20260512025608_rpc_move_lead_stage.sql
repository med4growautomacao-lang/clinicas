-- 20260512025608_rpc_move_lead_stage
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Move um ticket de stage E sincroniza o lead na mesma transação
CREATE OR REPLACE FUNCTION public.move_lead_stage(
  p_ticket_id uuid,
  p_new_stage_id uuid
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_ticket RECORD;
  v_old_stage_id uuid;
BEGIN
  SELECT id, lead_id, stage_id, clinic_id INTO v_ticket
  FROM tickets WHERE id = p_ticket_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'ticket_not_found');
  END IF;

  v_old_stage_id := v_ticket.stage_id;

  IF v_old_stage_id = p_new_stage_id THEN
    RETURN jsonb_build_object('success', true, 'idempotent', true);
  END IF;

  -- Atualiza ticket
  UPDATE tickets SET stage_id = p_new_stage_id WHERE id = p_ticket_id;

  -- Sincroniza lead
  IF v_ticket.lead_id IS NOT NULL THEN
    UPDATE leads SET stage_id = p_new_stage_id WHERE id = v_ticket.lead_id;

    -- Audita histórico (se a tabela existir e o campo existir)
    BEGIN
      INSERT INTO lead_stage_history (clinic_id, lead_id, old_stage_id, new_stage_id, changed_at)
      VALUES (v_ticket.clinic_id, v_ticket.lead_id, v_old_stage_id, p_new_stage_id, now());
    EXCEPTION WHEN OTHERS THEN
      -- Se a tabela não existir, ignora (audit é nice-to-have)
      NULL;
    END;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'ticket_id', p_ticket_id,
    'lead_id', v_ticket.lead_id,
    'old_stage_id', v_old_stage_id,
    'new_stage_id', p_new_stage_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.move_lead_stage(uuid, uuid) TO anon, authenticated, service_role;
