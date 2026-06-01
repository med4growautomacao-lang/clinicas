-- Auditoria de coerencia de RLS por modulo (continuacao de 20260601000004/05).
--
-- Mesma classe de bug do funil: tabelas escopadas por clinica cujas policies NAO
-- incluiam "OR is_admin()", fazendo super-admins (e, no caso de automation_logs,
-- tambem org-managers) verem 0 linhas ao abrir o modulo correspondente.
--
-- Tabelas corrigidas e onde aparecem:
--   automation_logs -> Comercial (ServiceDashboard): KPIs de handoff/follow-up/confirm.
--                      Era a unica SEM is_admin E SEM caminho org -> quebrava as DUAS personas.
--   protocols       -> Configuracoes / Agendamentos / Comercial (catalogo de procedimentos).
--   exam_requests   -> Prontuarios (latente: tabela vazia hoje).
--   prescriptions   -> Prontuarios (latente: tabela vazia hoje).
--
-- Padrao aplicado (igual a conversions/leads): clinic_users(self)+active OR org_users OR is_admin().
-- Coerente com medical_records/patients, que ja liberavam para is_admin().

-- automation_logs (nao tinha caminho org; adiciona org + is_admin)
DROP POLICY IF EXISTS "automation_logs_all" ON public.automation_logs;
CREATE POLICY "automation_logs_all" ON public.automation_logs
  FOR ALL
  USING (
    (
      clinic_id IN (SELECT clinic_users.clinic_id FROM public.clinic_users WHERE clinic_users.id = auth.uid())
      AND public.is_clinic_active(clinic_id)
    )
    OR clinic_id IN (
      SELECT c.id FROM public.clinics c
      JOIN public.org_users ou ON ou.organization_id = c.organization_id
      WHERE ou.user_id = auth.uid()
    )
    OR public.is_admin()
  );

-- protocols (ja tinha clinic + org; adiciona is_admin)
DROP POLICY IF EXISTS "protocols_access" ON public.protocols;
CREATE POLICY "protocols_access" ON public.protocols
  FOR ALL
  USING (
    (
      clinic_id IN (SELECT clinic_users.clinic_id FROM public.clinic_users WHERE clinic_users.id = auth.uid())
      AND public.is_clinic_active(clinic_id)
    )
    OR clinic_id IN (
      SELECT c.id FROM public.clinics c
      JOIN public.org_users ou ON ou.organization_id = c.organization_id
      WHERE ou.user_id = auth.uid()
    )
    OR public.is_admin()
  );

-- exam_requests (ja tinha clinic + org; adiciona is_admin)
DROP POLICY IF EXISTS "exam_requests_access" ON public.exam_requests;
CREATE POLICY "exam_requests_access" ON public.exam_requests
  FOR ALL
  USING (
    (
      clinic_id IN (SELECT clinic_users.clinic_id FROM public.clinic_users WHERE clinic_users.id = auth.uid())
      AND public.is_clinic_active(clinic_id)
    )
    OR clinic_id IN (
      SELECT c.id FROM public.clinics c
      JOIN public.org_users ou ON ou.organization_id = c.organization_id
      WHERE ou.user_id = auth.uid()
    )
    OR public.is_admin()
  );

-- prescriptions (ja tinha clinic + org; adiciona is_admin)
DROP POLICY IF EXISTS "prescriptions_access" ON public.prescriptions;
CREATE POLICY "prescriptions_access" ON public.prescriptions
  FOR ALL
  USING (
    (
      clinic_id IN (SELECT clinic_users.clinic_id FROM public.clinic_users WHERE clinic_users.id = auth.uid())
      AND public.is_clinic_active(clinic_id)
    )
    OR clinic_id IN (
      SELECT c.id FROM public.clinics c
      JOIN public.org_users ou ON ou.organization_id = c.organization_id
      WHERE ou.user_id = auth.uid()
    )
    OR public.is_admin()
  );
