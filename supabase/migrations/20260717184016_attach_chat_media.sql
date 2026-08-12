-- 20260717184016_attach_chat_media
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- =============================================================================
-- Fase C5-b — anexa mídia a uma mensagem já persistida (hub wa-inbound)
--
-- O hub persiste a mensagem primeiro (texto/placeholder), baixa a mídia da uazapi,
-- sobe no bucket privado chat-media e chama esta RPC para MERGE dos campos que a
-- UI (detectMedia/MediaBubble, B3) lê: no message JSONB fileURL=<path storage>,
-- mimetype, kind, filename?, duration?. Espelha em metadata p/ consulta SQL.
-- Merge (||) preserva type/content — o content vira fallback textual do player.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.attach_chat_media(
  p_message_id uuid,
  p_kind text,
  p_mime text,
  p_path text,
  p_filename text DEFAULT NULL,
  p_duration numeric DEFAULT NULL
)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  UPDATE chat_messages
  SET message = message || jsonb_strip_nulls(jsonb_build_object(
        'kind', p_kind, 'mimetype', p_mime, 'fileURL', p_path,
        'filename', p_filename, 'duration', p_duration
      )),
      metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
        'kind', p_kind, 'mime', p_mime, 'storagePath', p_path, 'filename', p_filename
      ))
  WHERE id = p_message_id;
$function$;

REVOKE ALL ON FUNCTION public.attach_chat_media(uuid,text,text,text,text,numeric) FROM anon, authenticated;
