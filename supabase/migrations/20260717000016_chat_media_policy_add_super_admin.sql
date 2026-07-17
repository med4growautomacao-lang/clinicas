-- =============================================================================
-- Fix (C5-b): policy de leitura do bucket chat-media inclui SUPER-ADMIN
--
-- A policy chat_media_read_clinic_members cobria clinic_users/org_users mas
-- deixava o super-admin de fora (clinic_users com clinic_id sentinela
-- 00000000-..., role='super-admin', sem org_users) → createSignedUrl negado →
-- UI "Carregando áudio/vídeo/imagem…" eterno. Adiciona public.is_super_admin().
-- =============================================================================

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
