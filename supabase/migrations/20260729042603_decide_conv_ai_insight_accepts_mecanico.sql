-- 20260729042603_decide_conv_ai_insight_accepts_mecanico
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Libera aprovar/recusar sugestão mecânica (status 'mec_pending') pelo mesmo botão da fila.
-- Muda SÓ o comportamento das linhas mecânicas: para IA (origin='ia') tudo segue idêntico.
create or replace function public.decide_conv_ai_insight(p_insight_id uuid, p_decision text, p_note text default null::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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

  IF v_ins.status NOT IN ('pending','mec_pending') THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'already_decided', 'status', v_ins.status);
  END IF;

  UPDATE conv_ai_insights
     SET status        = CASE WHEN p_decision = 'approve' THEN 'approved' ELSE 'rejected' END,
         decided_by    = auth.uid(),
         decided_at    = now(),
         decision_note = p_note
   WHERE id = p_insight_id;

  -- Feedback mecânico recalibra o PADRÃO (futuro), não o manual da IA: não conta como decisão de IA.
  IF v_ins.origin <> 'mecanico' THEN
    UPDATE conv_ai_clinic_config
       SET decisions_since_learn = decisions_since_learn + 1, updated_at = now()
     WHERE clinic_id = v_ins.clinic_id;
  END IF;

  IF p_decision <> 'approve' THEN
    RETURN jsonb_build_object('success', true, 'needs_ganho_modal', false, 'ticket_id', v_ins.ticket_id);
  END IF;

  IF v_ins.kind = 'stage' THEN
    IF v_ins.suggested_stage_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error_code', 'no_stage');
    END IF;
    v_mv := set_ticket_stage(v_ins.ticket_id, v_ins.suggested_stage_id,
              CASE WHEN v_ins.origin = 'mecanico' THEN 'mecanica' ELSE 'ia_analise' END,
              auth.uid()::text, 'block');
    RETURN jsonb_build_object('success', true, 'needs_ganho_modal', false,
                              'ticket_id', v_ins.ticket_id, 'moved', v_mv);
  END IF;

  RETURN jsonb_build_object(
    'success', true, 'needs_ganho_modal', true,
    'ticket_id', v_ins.ticket_id, 'lead_id', v_ins.lead_id,
    'suggested_value', v_ins.sale_value);
END;
$function$;
