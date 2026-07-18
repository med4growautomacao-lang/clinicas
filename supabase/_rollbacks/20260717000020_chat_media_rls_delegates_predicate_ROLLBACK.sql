-- Rollback da 20260717000020 — restaura a policy INLINE da ...016 e dropa o wrapper.
-- Volta a duplicar a lógica de acesso, mas é o estado conhecido-bom anterior.
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
        AND cu.clinic_id::text = (storage.foldername(name))[1]
    )
    OR EXISTS (
      SELECT 1 FROM public.org_users ou
      JOIN public.clinics c ON c.organization_id = ou.organization_id
      WHERE ou.user_id = auth.uid()
        AND c.id::text = (storage.foldername(name))[1]
    )
  )
);

DROP FUNCTION IF EXISTS public.can_access_clinic_media_text(text);
