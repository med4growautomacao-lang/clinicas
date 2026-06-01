-- Corrige o "Funil de Vendas" da tela de Marketing aparecendo todo zerado.
--
-- CAUSA RAIZ:
-- O RPC marketing_funnel_cohort e SECURITY INVOKER (de proposito: confia na RLS
-- para escopar por clinica). Ele monta o coorte a partir de lead_stage_history.
-- Entre as 3 tabelas que o funil usa, a RLS de lead_stage_history era a UNICA sem
-- o bypass "OR is_admin()" e sem o caminho de org_users:
--   - leads          -> leads_all (OR is_admin) + leads_org_access
--   - funnel_stages  -> funnel_stages_all (OR is_admin) + funnel_stages_org_access
--   - lead_stage_history -> apenas clinic_users(self) AND is_clinic_active   <-- FALHA
--
-- Resultado: super-admins (clinic_users.clinic_id = 00000000-...) e org-managers
-- enxergavam os LEADS e as ETAPAS (por isso o funil renderizava as 6 caixas),
-- mas o coorte (lead_stage_history) retornava 0 linhas -> todas as etapas zeradas.
--
-- CORRECAO: alinhar lead_stage_history ao MESMO padrao de leads (policy _all com
-- "OR is_admin()" + policy _org_access para org-managers).

DROP POLICY IF EXISTS "Enable all access for clinic users on lead stage history" ON public.lead_stage_history;

CREATE POLICY "lead_stage_history_all" ON public.lead_stage_history
  FOR ALL
  USING (
    (
      clinic_id IN (SELECT clinic_users.clinic_id FROM public.clinic_users WHERE clinic_users.id = auth.uid())
      AND public.is_clinic_active(clinic_id)
    )
    OR public.is_admin()
  );

CREATE POLICY "lead_stage_history_org_access" ON public.lead_stage_history
  FOR ALL
  USING (
    (
      clinic_id IN (
        SELECT c.id FROM public.clinics c
        JOIN public.org_users ou ON ou.organization_id = c.organization_id
        WHERE ou.user_id = auth.uid()
      )
      AND public.is_clinic_active(clinic_id)
    )
    OR public.is_admin()
  );
