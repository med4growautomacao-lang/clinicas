-- 20260724155535_20260724260000_onboarding_disable_followups_on_reset
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Ao refazer/iniciar onboarding, desliga as chaves GERAIS de follow-up (as que disparam mensagem),
-- pra não sair confirmação/lembrete/reengajamento em massa. A IA (auto_schedule/handoff) NÃO é tocada.
-- Reativação é manual depois (o modal de preview já mostra os afetados antes de ligar).
CREATE OR REPLACE FUNCTION public.fn_onboarding_disable_followups(p_clinic_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $function$
  UPDATE ai_config SET
    welcome_message_enabled     = false,
    followup_enabled            = false,
    confirm_native_enabled      = false,
    confirm_enabled             = false,
    confirm_post_enabled        = false,
    appt_reminder_enabled       = false,
    pos_followup_ganho_enabled  = false,
    pos_followup_perdido_enabled= false,
    finish_ganho_enabled        = false,
    finish_perdido_enabled      = false,
    finish_service_enabled      = false,
    csat_enabled                = false
  WHERE clinic_id = p_clinic_id;
$function$;

CREATE OR REPLACE FUNCTION public.onboarding_reset(p_clinic_id uuid, p_months integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT fn_can_onboard(p_clinic_id) THEN RETURN jsonb_build_object('success', false, 'error_code', 'forbidden'); END IF;
  UPDATE clinics SET onboarding_completed_at = NULL, onboarding_period_months = p_months WHERE id = p_clinic_id;
  UPDATE leads SET onboarding_reviewed_at = NULL WHERE clinic_id = p_clinic_id;
  PERFORM fn_onboarding_disable_followups(p_clinic_id);  -- desliga follow-ups (reativação manual depois)
  RETURN jsonb_build_object('success', true, 'months', p_months);
END; $function$;
