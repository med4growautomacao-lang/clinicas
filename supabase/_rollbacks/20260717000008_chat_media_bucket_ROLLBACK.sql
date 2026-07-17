-- Rollback da 20260717000008_chat_media_bucket
-- Só remove a policy e o bucket se estiver vazio (não apaga mídia real por engano).
DROP POLICY IF EXISTS "chat_media_read_clinic_members" ON storage.objects;
DELETE FROM storage.buckets WHERE id = 'chat-media'
  AND NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'chat-media');
