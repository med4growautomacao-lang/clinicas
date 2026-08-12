-- 20260611044417_chat_messages_seq_for_memory_order
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS seq bigint;

CREATE SEQUENCE IF NOT EXISTS public.chat_messages_seq OWNED BY public.chat_messages.seq;
SELECT setval('public.chat_messages_seq', (SELECT count(*) FROM public.chat_messages));

ALTER TABLE public.chat_messages ALTER COLUMN seq SET DEFAULT nextval('public.chat_messages_seq');

WITH ordenado AS (
  SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn
  FROM public.chat_messages
  WHERE seq IS NULL
)
UPDATE public.chat_messages c
SET seq = o.rn
FROM ordenado o
WHERE o.id = c.id;

ALTER TABLE public.chat_messages ALTER COLUMN seq SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_chat_messages_session_seq
  ON public.chat_messages (session_id, seq);

CREATE OR REPLACE VIEW public.vw_n8n_chat_memory AS
SELECT seq AS id, session_id, message
FROM public.chat_messages;
