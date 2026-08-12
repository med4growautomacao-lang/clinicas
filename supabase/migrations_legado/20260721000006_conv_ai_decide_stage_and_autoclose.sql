-- =============================================================================
-- IA Analista de Conversas — decisão humana nos DOIS eixos + venda automática
--
-- 1) decide_conv_ai_insight passa a atender kind='stage' também: aprovar uma
--    sugestão de etapa move o card aqui mesmo, pelo dono único do stage_id.
--    Venda continua devolvendo needs_ganho_modal (o front abre o fluxo de
--    sempre: conversão + receita + finalize_ticket + CAPI).
--
-- 2) conv_ai_auto_close_sale: o caminho do sale_mode='auto'. Faz o mesmo que o
--    GanhoModal e NA MESMA ORDEM, porque a edge do CAPI lê o valor de
--    `conversions` — conversão primeiro, depois a etapa de conversão (o trigger
--    em lead_stage_history enfileira o evento da Meta), depois o desfecho.
--
--    ⚠️ Sem valor a RPC RECUSA fechar (usa ai_config.default_ticket_value como
--    segunda opção): lançar faturamento zerado mentiria em todos os painéis e
--    mandaria um evento sem valor para a Meta. Nesse caso a sugestão fica
--    pendente para um humano decidir.
--
--    Reversível pelo caminho de sempre ("Cancelar venda" no Kanban apaga a
--    conversão). O evento JÁ ENVIADO à Meta não tem desfazer.
-- =============================================================================

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

  UPDATE conv_ai_clinic_config
     SET decisions_since_learn = decisions_since_learn + 1, updated_at = now()
   WHERE clinic_id = v_ins.clinic_id;

  IF p_decision <> 'approve' THEN
    RETURN jsonb_build_object('success', true, 'needs_ganho_modal', false, 'ticket_id', v_ins.ticket_id);
  END IF;

  IF v_ins.kind = 'stage' THEN
    IF v_ins.suggested_stage_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error_code', 'no_stage');
    END IF;
    v_mv := set_ticket_stage(v_ins.ticket_id, v_ins.suggested_stage_id, 'ia_analise', auth.uid()::text, 'block');
    RETURN jsonb_build_object('success', true, 'needs_ganho_modal', false,
                              'ticket_id', v_ins.ticket_id, 'moved', v_mv);
  END IF;

  RETURN jsonb_build_object(
    'success', true, 'needs_ganho_modal', true,
    'ticket_id', v_ins.ticket_id, 'lead_id', v_ins.lead_id,
    'suggested_value', v_ins.sale_value);
END;
$$;
REVOKE ALL ON FUNCTION public.decide_conv_ai_insight(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decide_conv_ai_insight(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.conv_ai_auto_close_sale(p_insight_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ins      RECORD;
  v_stage_id uuid;
  v_value    numeric;
  v_ticket   RECORD;
BEGIN
  SELECT * INTO v_ins FROM conv_ai_insights WHERE id = p_insight_id;
  IF NOT FOUND OR v_ins.kind <> 'sale' THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'insight_not_found');
  END IF;

  SELECT id, lead_id, clinic_id, outcome, status INTO v_ticket FROM tickets WHERE id = v_ins.ticket_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'ticket_not_found');
  END IF;
  IF v_ticket.outcome IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'already_resolved');
  END IF;

  SELECT COALESCE(v_ins.suggested_stage_id,
                  (SELECT s.id FROM funnel_stages s WHERE s.clinic_id = v_ins.clinic_id AND s.is_conversion LIMIT 1))
    INTO v_stage_id;
  IF v_stage_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'no_conversion_stage');
  END IF;

  v_value := NULLIF(v_ins.sale_value, 0);
  IF v_value IS NULL THEN
    SELECT NULLIF(default_ticket_value, 0) INTO v_value FROM ai_config WHERE clinic_id = v_ins.clinic_id;
  END IF;
  IF v_value IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'no_value');
  END IF;

  INSERT INTO conversions (clinic_id, lead_id, ticket_id, value, description, converted_at)
  VALUES (v_ins.clinic_id, v_ticket.lead_id, v_ins.ticket_id, v_value,
          'Venda detectada automaticamente pela IA', now());

  PERFORM set_ticket_stage(v_ins.ticket_id, v_stage_id, 'ia_analise', 'conv-ai-analyst', 'block');
  PERFORM finalize_ticket(v_ins.ticket_id, 'ganho', NULL, 'Venda fechada automaticamente pela IA', true);

  UPDATE conv_ai_insights
     SET status = 'auto_applied', decided_at = now(), sale_value = v_value
   WHERE id = p_insight_id;

  -- Uma venda fechada por máquina precisa aparecer para alguém.
  BEGIN
    PERFORM notify_ops(v_ins.clinic_id, 'venda_ia',
      'Venda fechada pela IA',
      'A IA identificou uma venda e fechou o atendimento automaticamente. Valor: R$ ' || to_char(v_value, 'FM999G999D00'),
      'info', v_ticket.lead_id, v_ins.ticket_id, NULL, NULL,
      jsonb_build_object('insight_id', p_insight_id, 'confidence', v_ins.confidence), true, NULL);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('success', true, 'ticket_id', v_ins.ticket_id, 'value', v_value);
END;
$$;
REVOKE ALL ON FUNCTION public.conv_ai_auto_close_sale(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.conv_ai_auto_close_sale(uuid) TO service_role;
