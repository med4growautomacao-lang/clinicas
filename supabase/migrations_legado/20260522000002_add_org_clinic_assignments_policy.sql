-- Add RLS policy to allow org_owner and org_admin roles to manage clinic assignments
-- This resolves the 403 (Forbidden) error when org managers try to assign responsible roles to clinic members

CREATE POLICY "Allow all access to organization managers" 
ON public.org_clinic_assignments 
FOR ALL 
USING (
  EXISTS (
    SELECT 1 FROM public.org_users ou
    JOIN public.clinics c ON c.organization_id = ou.organization_id
    WHERE ou.user_id = auth.uid()
      AND ou.role IN ('org_owner', 'org_admin')
      AND c.id = org_clinic_assignments.clinic_id
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.org_users ou
    JOIN public.clinics c ON c.organization_id = ou.organization_id
    WHERE ou.user_id = auth.uid()
      AND ou.role IN ('org_owner', 'org_admin')
      AND c.id = org_clinic_assignments.clinic_id
  )
);
