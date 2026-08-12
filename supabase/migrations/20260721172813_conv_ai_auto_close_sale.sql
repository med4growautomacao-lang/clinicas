-- 20260721172813_conv_ai_auto_close_sale
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Fechamento AUTOMÁTICO de venda pela IA (sale_mode='auto').
--
-- Faz o mesmo que o GanhoModal do Kanban, na mesma ordem, para que o resto do
-- sistema não perceba diferença: conversão PRIMEIRO (é dela que a edge do CAPI
-- lê o valor), depois a etapa de conversão (o trigger em lead_stage_history
-- enfileira o evento da Meta), depois o desfecho do ticket.
--
-- Valor: o que a IA extraiu; se vier vazio, cai para ai_config.default_ticket_value.
-- Sem nenhum dos dois NÃO fecha e devolve 'no_value' — a edge então deixa a
-- sugestão pendente para um humano. Lançar faturamento com valor zero mentiria
-- em todos os painéis e mandaria um evento sem valor para a Meta.
--
-- Reversível pelo caminho de sempre: "Cancelar venda" no Kanban (reopen_ticket)
-- apaga a conversão. ⚠️ O evento já ENVIADO à Meta não tem desfazer.
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

  -- Fila e painéis são a fonte de verdade, mas uma venda fechada por máquina
  -- precisa aparecer para alguém: sino in-app + grupo de WhatsApp da clínica.
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
