-- 20260312212847_add_handoff_logic_to_leads
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- 1. Adicionar coluna ai_enabled na tabela leads
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS ai_enabled boolean DEFAULT true;

-- 2. Criar função para o transbordo automático
CREATE OR REPLACE FUNCTION public.handle_handoff_on_message()
RETURNS TRIGGER AS $$
BEGIN
  -- Se for uma mensagem outbound enviada por um humano (sender = 'user')
  -- Desativa a IA para este lead
  IF NEW.direction = 'outbound' AND NEW.sender = 'user' AND NEW.lead_id IS NOT NULL THEN
    UPDATE public.leads
    SET ai_enabled = false
    WHERE id = NEW.lead_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Criar o trigger na tabela chat_messages
DROP TRIGGER IF EXISTS tr_handoff_on_message ON public.chat_messages;
CREATE TRIGGER tr_handoff_on_message
AFTER INSERT ON public.chat_messages
FOR EACH ROW
EXECUTE FUNCTION public.handle_handoff_on_message();
