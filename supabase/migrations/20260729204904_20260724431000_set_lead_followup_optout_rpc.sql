-- 20260729204904_20260724431000_set_lead_followup_optout_rpc
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Escrita do opt-out. Guard IGUAL ao de preview_followup_activation (é o mesmo público que opera o
-- mesmo modal): super admin, admin da clínica, membro de clinic_users ou usuário da organização.
CREATE OR REPLACE FUNCTION public.set_lead_followup_optout(
  p_lead_id uuid, p_kind text, p_off boolean, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_clinic uuid;
BEGIN
  SELECT clinic_id INTO v_clinic FROM leads WHERE id = p_lead_id;
  IF v_clinic IS NULL THEN RETURN jsonb_build_object('success', false, 'error_code', 'lead_not_found'); END IF;

  IF NOT (
      is_super_admin()
      OR is_clinic_admin(v_clinic)
      OR EXISTS (SELECT 1 FROM clinic_users cu WHERE cu.id = auth.uid() AND cu.clinic_id = v_clinic)
      OR EXISTS (SELECT 1 FROM clinics c JOIN org_users ou ON ou.organization_id = c.organization_id
                 WHERE c.id = v_clinic AND ou.user_id = auth.uid())
  ) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;

  IF p_off THEN
    INSERT INTO lead_followup_optout (clinic_id, lead_id, kind, created_by, reason)
    VALUES (v_clinic, p_lead_id, p_kind, auth.uid(), p_reason)
    ON CONFLICT (lead_id, kind) DO NOTHING;
  ELSE
    DELETE FROM lead_followup_optout WHERE lead_id = p_lead_id AND kind = p_kind;
  END IF;

  RETURN jsonb_build_object('success', true, 'lead_id', p_lead_id, 'kind', p_kind, 'off', p_off);
EXCEPTION WHEN OTHERS THEN
  -- CHECK violado (kind inválido) cai aqui: precisa aparecer na Central, senão o opt-out
  -- "não funciona" sem ninguém saber por quê.
  PERFORM log_system_error('followup-optout', 'set_optout_failed',
    'Falha ao gravar opt-out de follow-up do lead', 'error', v_clinic,
    jsonb_build_object('lead_id', p_lead_id, 'kind', p_kind, 'off', p_off, 'detail', sqlerrm), false);
  RETURN jsonb_build_object('success', false, 'error_code', 'exception', 'detail', sqlerrm);
END; $function$;

REVOKE ALL ON FUNCTION public.set_lead_followup_optout(uuid, text, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_lead_followup_optout(uuid, text, boolean, text) TO authenticated, service_role;
