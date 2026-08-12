-- 20260311205335_add_human_sender_to_chat_messages
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- 1. Remover a constraint de check antiga do sender
ALTER TABLE public.chat_messages DROP CONSTRAINT IF EXISTS chat_messages_sender_check;

-- 2. Adicionar a nova constraint de check incluindo 'human'
ALTER TABLE public.chat_messages ADD CONSTRAINT chat_messages_sender_check 
CHECK (sender IN ('user', 'ai', 'human', 'system'));

-- 3. Adicionar coluna user_id para rastrear qual funcionário enviou a mensagem
ALTER TABLE public.chat_messages ADD COLUMN user_id uuid REFERENCES public.users(id) ON DELETE SET NULL;

-- 4. Criar índice para o novo campo user_id
CREATE INDEX idx_chat_messages_user_id ON public.chat_messages(user_id);

COMMENT ON COLUMN public.chat_messages.sender IS 'Remetente: user (cliente), ai (robô), human (atendente), system (sistema)';
COMMENT ON COLUMN public.chat_messages.user_id IS 'ID do funcionário que enviou a mensagem (se sender for human)';
