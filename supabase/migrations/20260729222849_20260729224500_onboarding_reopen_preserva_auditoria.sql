-- 20260729222849_20260729224500_onboarding_reopen_preserva_auditoria
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Reabrir o onboarding PRESERVANDO o que já foi auditado.
-- Faltava um caminho para o próprio cliente voltar à fila: o modal só abre enquanto
-- onboarding_completed_at é null, a pílula só conta ticket aberto na etapa Sincronização (que é 0
-- para os leads que já estavam no funil) e o "Refazer" mora em Organizações e APAGA a auditoria.
-- Resultado medido na Lorena: 123 contatos na fila e nenhuma forma de alcançá-los.
--
-- Diferença essencial em relação a onboarding_reset:
--   reopen  -> só limpa onboarding_completed_at. NÃO toca onboarding_reviewed_at, NÃO mexe no
--              período, NÃO desliga follow-ups, NÃO enfileira deep-sync. Continua de onde parou.
--   reset   -> recomeça do zero (zera reviewed_at, define período, desliga follow-ups, enfileira).
CREATE OR REPLACE FUNCTION public.onboarding_reopen(p_clinic_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_fila int;
BEGIN
  IF NOT fn_can_onboard(p_clinic_id) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;
  UPDATE clinics SET onboarding_completed_at = NULL WHERE id = p_clinic_id;
  SELECT count(*) INTO v_fila FROM onboarding_pending_leads(p_clinic_id);
  RETURN jsonb_build_object('success', true, 'fila', v_fila);
END; $function$;

REVOKE ALL ON FUNCTION public.onboarding_reopen(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.onboarding_reopen(uuid) TO authenticated, service_role;
