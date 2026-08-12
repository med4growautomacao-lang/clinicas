-- 20260502154730_enforce_is_active_in_rls_v2
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Helper to check if a clinic and its parent org are active
CREATE OR REPLACE FUNCTION public.is_clinic_active(p_clinic_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.clinics c
    LEFT JOIN public.organizations o ON c.organization_id = o.id
    WHERE c.id = p_clinic_id
    AND c.is_active = true
    AND (o.id IS NULL OR o.is_active = true)
  );
END;
$$;

-- Update leads policies
DROP POLICY IF EXISTS "leads_all" ON public.leads;
CREATE POLICY "leads_all" ON public.leads
FOR ALL USING (
  (
    (clinic_id IN (SELECT clinic_id FROM public.clinic_users WHERE id = auth.uid()))
    AND public.is_clinic_active(clinic_id)
  )
  OR public.is_admin()
);

DROP POLICY IF EXISTS "leads_org_access" ON public.leads;
CREATE POLICY "leads_org_access" ON public.leads
FOR ALL USING (
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

-- Do the same for chat_messages
DROP POLICY IF EXISTS "chat_messages_all" ON public.chat_messages;
CREATE POLICY "chat_messages_all" ON public.chat_messages
FOR ALL USING (
  (
    (clinic_id IN (SELECT clinic_id FROM public.clinic_users WHERE id = auth.uid()))
    AND public.is_clinic_active(clinic_id)
  )
  OR public.is_admin()
);

DROP POLICY IF EXISTS "chat_messages_org_access" ON public.chat_messages;
CREATE POLICY "chat_messages_org_access" ON public.chat_messages
FOR ALL USING (
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
