-- Migration: Add session_id to chat_messages
-- Description: Adds a session_id column to group messages in AI threads/sessions.

ALTER TABLE public.chat_messages ADD COLUMN session_id text;

-- Create index for performance
CREATE INDEX idx_chat_messages_session_id ON public.chat_messages(session_id);

COMMENT ON COLUMN public.chat_messages.session_id IS 'ID da sessão/thread usado para agrupar mensagens na memória da IA (ex: no n8n)';
