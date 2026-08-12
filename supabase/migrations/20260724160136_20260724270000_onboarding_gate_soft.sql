-- 20260724160136_20260724270000_onboarding_gate_soft
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Trava macia: o gate abre sozinho só no ciclo ainda não concluído (connected AND NOT completed).
-- Depois de liberar/concluir (onboarding_completed_at setado), NÃO bloqueia mais mesmo com pendentes:
-- os leads que ficaram na Sincronização viram cards piscando em vermelho no Kanban + pílula "Organizar N".
-- 'pending' continua no retorno para alimentar essa pílula.
CREATE OR REPLACE FUNCTION public.onboarding_gate_status(p_clinic_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_connected boolean; v_completed boolean; v_pending int; v_stage uuid;
BEGIN
  IF NOT fn_can_onboard(p_clinic_id) THEN RETURN jsonb_build_object('should_onboard', false, 'pending', 0); END IF;
  v_connected := EXISTS (SELECT 1 FROM whatsapp_instances WHERE clinic_id = p_clinic_id AND status = 'connected');
  SELECT onboarding_completed_at IS NOT NULL INTO v_completed FROM clinics WHERE id = p_clinic_id;
  SELECT id INTO v_stage FROM funnel_stages WHERE clinic_id = p_clinic_id AND slug = 'sincronizacao' LIMIT 1;
  v_pending := coalesce((SELECT count(*) FROM tickets WHERE clinic_id = p_clinic_id AND stage_id = v_stage AND status = 'open'), 0);
  RETURN jsonb_build_object(
    'should_onboard', (v_connected AND NOT coalesce(v_completed, false)),
    'pending', v_pending, 'connected', v_connected, 'completed', coalesce(v_completed, false));
END; $function$;
