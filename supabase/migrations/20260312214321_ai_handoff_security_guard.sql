-- 20260312214321_ai_handoff_security_guard
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Função para bloquear inserção de mensagens da IA se o lead estiver pausado
CREATE OR REPLACE FUNCTION public.block_ai_when_disabled()
RETURNS TRIGGER AS $$
DECLARE
  v_ai_enabled boolean;
BEGIN
  -- Se as mensagens forem enviadas pela IA (sender = 'ai')
  IF NEW.sender = 'ai' AND NEW.lead_id IS NOT NULL THEN
    SELECT ai_enabled INTO v_ai_enabled FROM public.leads WHERE id = NEW.lead_id;
    -- Se v_ai_enabled for nulo (lead novo) ou false, bloqueia
    IF v_ai_enabled = false THEN
      RAISE EXCEPTION 'Atendimento por IA está desativado para este lead (Handoff ativo).';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Criar o trigger de bloqueio (BEFORE INSERT)
DROP TRIGGER IF EXISTS tr_block_ai_when_disabled ON public.chat_messages;
CREATE TRIGGER tr_block_ai_when_disabled
BEFORE INSERT ON public.chat_messages
FOR EACH ROW
EXECUTE FUNCTION public.block_ai_when_disabled();
