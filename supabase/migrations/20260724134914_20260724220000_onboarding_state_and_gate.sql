-- 20260724134914_20260724220000_onboarding_state_and_gate
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Estado do onboarding por clínica. Clínicas EXISTENTES nascem "já feito" (não incomodar);
-- clínica nova (default null) faz o onboarding ao conectar. Redo = onboarding_reset.
ALTER TABLE public.clinics ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamptz;
UPDATE public.clinics SET onboarding_completed_at = now() WHERE onboarding_completed_at IS NULL;

-- Deve mostrar o onboarding? Sim se há trabalho (tickets abertos na Sincronização) OU se é uma
-- clínica conectada que ainda não concluiu. Não mostra depois de concluído e sem pendências.
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
    'should_onboard', (v_pending > 0) OR (v_connected AND NOT coalesce(v_completed, false)),
    'pending', v_pending, 'connected', v_connected, 'completed', coalesce(v_completed, false));
END; $function$;

CREATE OR REPLACE FUNCTION public.onboarding_mark_done(p_clinic_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT fn_can_onboard(p_clinic_id) THEN RETURN jsonb_build_object('success', false, 'error_code', 'forbidden'); END IF;
  UPDATE clinics SET onboarding_completed_at = now() WHERE id = p_clinic_id;
  RETURN jsonb_build_object('success', true);
END; $function$;

-- Refazer o onboarding (ex.: Lorena): zera o estado, aí o modal volta a aparecer.
CREATE OR REPLACE FUNCTION public.onboarding_reset(p_clinic_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT fn_can_onboard(p_clinic_id) THEN RETURN jsonb_build_object('success', false, 'error_code', 'forbidden'); END IF;
  UPDATE clinics SET onboarding_completed_at = NULL WHERE id = p_clinic_id;
  RETURN jsonb_build_object('success', true);
END; $function$;

REVOKE ALL ON FUNCTION public.onboarding_gate_status(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.onboarding_mark_done(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.onboarding_reset(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.onboarding_gate_status(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.onboarding_mark_done(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.onboarding_reset(uuid) TO authenticated;
