-- 20260717192015_chat_media_policy_fix_org_ambiguity
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Bug: no ramo org_users, `name` sem qualificar era resolvido para clinics.name
-- (shadow do JOIN clinics c) em vez do objeto → org users nunca teriam acesso.
-- Qualifica explicitamente objects.name.

DROP POLICY IF EXISTS "chat_media_read_clinic_members" ON storage.objects;
CREATE POLICY "chat_media_read_clinic_members" ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'chat-media'
  AND (
    public.is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.clinic_users cu
      WHERE cu.id = auth.uid()
        AND cu.clinic_id::text = (storage.foldername(objects.name))[1]
    )
    OR EXISTS (
      SELECT 1 FROM public.org_users ou
      JOIN public.clinics c ON c.organization_id = ou.organization_id
      WHERE ou.user_id = auth.uid()
        AND c.id::text = (storage.foldername(objects.name))[1]
    )
  )
);
