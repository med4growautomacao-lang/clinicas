-- =============================================================================
-- Fase B3 — Bucket PRIVADO para mídia de conversa (áudio/imagem/vídeo/doc)
--
-- Mídia recebida do paciente é PII — diferente do bucket 'quotes' (público, para
-- orçamentos). Fica em bucket privado; a UI (MediaBubble) resolve o path para uma
-- signed URL sob demanda. Convenção de path: <clinic_id>/<lead_id>/<arquivo>.
--
-- Leitura: membros da clínica (clinic_users) ou da organização dona (org_users).
-- Escrita: só service role (ingestão nativa, Fase C5-b) — bypassa RLS, sem policy.
-- =============================================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('chat-media', 'chat-media', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "chat_media_read_clinic_members" ON storage.objects;
CREATE POLICY "chat_media_read_clinic_members" ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'chat-media'
  AND (
    EXISTS (
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
