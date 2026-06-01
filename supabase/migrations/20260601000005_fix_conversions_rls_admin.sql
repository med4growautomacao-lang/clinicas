-- Mesma classe de bug do funil (20260601000004), agora na metrica de "Conversoes"
-- da tela de Marketing.
--
-- A policy de conversions (clinic_conversions_access) cobre clinic_users(self) e
-- org_users(self), mas NAO tem "OR is_admin()". Logo, super-admins (cujo
-- clinic_users.clinic_id = 00000000-...) viam 0 conversoes ao abrir qualquer
-- clinica real -> card "Conversoes" zerado.
--
-- CORRECAO: adicionar "OR public.is_admin()", alinhando ao padrao de leads/
-- funnel_stages/appointments. Mantem os caminhos clinic_users e org_users.

DROP POLICY IF EXISTS "clinic_conversions_access" ON public.conversions;

CREATE POLICY "clinic_conversions_access" ON public.conversions
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
