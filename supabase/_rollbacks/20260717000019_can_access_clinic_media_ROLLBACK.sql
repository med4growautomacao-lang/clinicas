-- Rollback da 20260717000019 — remove o predicado de acesso à mídia.
-- ATENÇÃO: só reverter DEPOIS de reverter a edge chat-media-sign para o caminho
-- antigo (frontend createSignedUrl direto). Enquanto a edge estiver assinando via
-- este predicado, removê-lo faz TODA a mídia parar de carregar (a edge nega tudo).
DROP FUNCTION IF EXISTS public.can_access_clinic_media(uuid);
