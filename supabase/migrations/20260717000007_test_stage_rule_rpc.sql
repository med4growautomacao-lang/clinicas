-- =============================================================================
-- Fase A2 (prep p/ o corte) — RPC de teste dry-run do gatilho
--
-- Substituirá o teste do botão "testar regra" no momento em que os nós
-- Call Gatilhos do Receptor forem desligados (hoje o teste depende do n8n).
-- Dado um texto, diz qual regra/etapa o matcher escolheria — SEM enviar
-- mensagem nem mover ticket. Roda o MESMO match_stage_rule do trigger.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.test_stage_rule(p_clinic_id uuid, p_message text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_msg     text;
  v_rule_id uuid;
  v_target  uuid;
  v_kw      text;
  v_name    text;
BEGIN
  v_msg := public.normalize_stage_text(p_message);
  IF v_msg = '' THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'empty_message');
  END IF;

  SELECT r.id, r.target_stage_id, r.keywords
    INTO v_rule_id, v_target, v_kw
  FROM stage_transition_rules r
  WHERE r.clinic_id = p_clinic_id
    AND r.target_stage_id IS NOT NULL
    AND public.normalize_stage_text(r.keywords) <> ''
    AND position(public.normalize_stage_text(r.keywords) IN v_msg) > 0
  ORDER BY r.order_index NULLS LAST, r.created_at
  LIMIT 1;

  IF v_rule_id IS NULL THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'no_rule_matched');
  END IF;

  SELECT name INTO v_name FROM funnel_stages WHERE id = v_target;

  RETURN jsonb_build_object(
    'matched', true,
    'rule_id', v_rule_id,
    'keywords', v_kw,
    'target_stage_id', v_target,
    'target_stage_name', v_name
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.test_stage_rule(uuid, text) TO authenticated;
