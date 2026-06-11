-- Corrige a ordenação da memória do agente (n8n).
-- Problema: o nó de memória lê chat_messages ORDER BY id, mas id é UUIDv4 (aleatório),
-- então o histórico chega embaralhado e o agente perde o fio da conversa.
--
-- Solução (Opção B): coluna sequencial `seq` (ordem de inserção) + view `vw_n8n_chat_memory`
-- que expõe seq COMO id. No n8n basta apontar o Table Name do nó de memória para a view,
-- que o ORDER BY id passa a ser cronológico. App e automações ficam intactos
-- (chat_messages continua sendo ordenado por created_at na UI; as 8 triggers continuam).
--
-- Ordem dos passos pensada para tabela "quente": ADD COLUMN é instantâneo; o default é
-- definido ANTES do backfill (inserts concorrentes já recebem seq, sem NULL); a sequence
-- é posicionada acima do total de linhas para não colidir com a numeração do backfill.

-- 1) Coluna de ordenação (instantâneo: metadado, sem reescrever a tabela)
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS seq bigint;

-- 2) Sequence própria, posicionada acima do total atual (evita colisão com o backfill 1..N)
CREATE SEQUENCE IF NOT EXISTS public.chat_messages_seq OWNED BY public.chat_messages.seq;
SELECT setval('public.chat_messages_seq', (SELECT count(*) FROM public.chat_messages));

-- 3) Default ANTES do backfill: a partir daqui todo insert novo já recebe seq (sem NULL)
ALTER TABLE public.chat_messages ALTER COLUMN seq SET DEFAULT nextval('public.chat_messages_seq');

-- 4) Backfill cronológico das linhas antigas (created_at; id como desempate)
WITH ordenado AS (
  SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn
  FROM public.chat_messages
  WHERE seq IS NULL
)
UPDATE public.chat_messages c
SET seq = o.rn
FROM ordenado o
WHERE o.id = c.id;

-- 5) Agora não há mais NULL
ALTER TABLE public.chat_messages ALTER COLUMN seq SET NOT NULL;

-- 6) Índice para leitura da memória por sessão, já em ordem
CREATE INDEX IF NOT EXISTS idx_chat_messages_session_seq
  ON public.chat_messages (session_id, seq);

-- 7) View drop-in para o nó de memória do n8n (seq aparece como id)
CREATE OR REPLACE VIEW public.vw_n8n_chat_memory AS
SELECT seq AS id, session_id, message
FROM public.chat_messages;
