-- 20260718012458_chat_media_rls_delegates_predicate
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

CREATE OR REPLACE FUNCTION public.can_access_clinic_media_text(p_clinic_text text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_clinic_text ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      THEN public.can_access_clinic_media(p_clinic_text::uuid)
    ELSE false
  END;
$$;

REVOKE ALL ON FUNCTION public.can_access_clinic_media_text(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_clinic_media_text(text) TO authenticated, service_role;

COMMENT ON FUNCTION public.can_access_clinic_media_text(text) IS
  'Wrapper text-safe de can_access_clinic_media: cast p/ uuid guardado por regex (nunca erra em bucket cujo 1º segmento não é uuid). Usado pela RLS de storage.objects.';

DROP POLICY IF EXISTS "chat_media_read_clinic_members" ON storage.objects;
CREATE POLICY "chat_media_read_clinic_members" ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'chat-media'
  AND public.can_access_clinic_media_text((storage.foldername(name))[1])
);
