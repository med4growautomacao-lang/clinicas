-- 20260721172741_conv_ai_decide_stage_and_autoclose
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- decide_conv_ai_insight agora atende os DOIS eixos:
--   kind='stage' -> aprovar move o card (set_ticket_stage, source='ia_analise')
--   kind='sale'  -> aprovar devolve needs_ganho_modal (o front abre o fluxo de sempre)
CREATE OR REPLACE FUNCTION public.decide_conv_ai_insight(
  p_insight_id uuid,
  p_decision   text,
  p_note       text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ins RECORD;
  v_mv  jsonb;
BEGIN
  IF p_decision NOT IN ('approve','reject') THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'invalid_decision');
  END IF;

  SELECT * INTO v_ins FROM conv_ai_insights WHERE id = p_insight_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'insight_not_found');
  END IF;

  IF NOT (
    ((v_ins.clinic_id IN (SELECT cu.clinic_id FROM clinic_users cu WHERE cu.id = auth.uid()))
      AND is_clinic_active(v_ins.clinic_id))
    OR is_clinic_admin(v_ins.clinic_id)
  ) THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  IF v_ins.status <> 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'already_decided', 'status', v_ins.status);
  END IF;

  UPDATE conv_ai_insights
     SET status        = CASE WHEN p_decision = 'approve' THEN 'approved' ELSE 'rejected' END,
         decided_by    = auth.uid(),
         decided_at    = now(),
         decision_note = p_note
   WHERE id = p_insight_id;

  -- Toda decisão humana é combustível do aprendizado.
  UPDATE conv_ai_clinic_config
     SET decisions_since_learn = decisions_since_learn + 1, updated_at = now()
   WHERE clinic_id = v_ins.clinic_id;

  IF p_decision <> 'approve' THEN
    RETURN jsonb_build_object('success', true, 'needs_ganho_modal', false, 'ticket_id', v_ins.ticket_id);
  END IF;

  -- Aprovar ETAPA: move aqui mesmo, pelo dono único do stage_id.
  IF v_ins.kind = 'stage' THEN
    IF v_ins.suggested_stage_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error_code', 'no_stage');
    END IF;
    v_mv := set_ticket_stage(v_ins.ticket_id, v_ins.suggested_stage_id, 'ia_analise', auth.uid()::text, 'block');
    RETURN jsonb_build_object('success', true, 'needs_ganho_modal', false,
                              'ticket_id', v_ins.ticket_id, 'moved', v_mv);
  END IF;

  -- Aprovar VENDA: não fecha nada aqui. O front abre o GanhoModal de sempre.
  RETURN jsonb_build_object(
    'success', true, 'needs_ganho_modal', true,
    'ticket_id', v_ins.ticket_id, 'lead_id', v_ins.lead_id,
    'suggested_value', v_ins.sale_value);
END;
$$;
REVOKE ALL ON FUNCTION public.decide_conv_ai_insight(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decide_conv_ai_insight(uuid, text, text) TO authenticated;
