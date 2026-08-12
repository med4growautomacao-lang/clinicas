-- =============================================================================
-- Fase C1 — Idempotência de mensagem (fundação p/ o hub wa-inbound)
--
-- Hoje uma mensagem pode entrar em duplicidade (o Receptor n8n insere 2x e
-- descarta o messageid da uazapi). Sem uma chave estável não há como deduplicar.
--
-- Adiciona wa_message_id + índice único parcial + trigger que torna a 2ª inserção
-- da MESMA mensagem um no-op silencioso (RETURN NULL) — em vez de erro de unique.
--
-- Efeito imediato: NENHUM (nada popula wa_message_id ainda). Passa a agir sozinho
-- quando o hub (C2) gravar o messageid. Para matar a duplicação do n8n ANTES do
-- hub, o Receptor precisa passar a gravar message.messageid aqui (edição à parte).
-- =============================================================================

ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS wa_message_id text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_messages_wa_message_id
  ON public.chat_messages (clinic_id, wa_message_id)
  WHERE wa_message_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.fn_dedup_chat_message()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.wa_message_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.chat_messages
    WHERE clinic_id = NEW.clinic_id
      AND wa_message_id = NEW.wa_message_id
  ) THEN
    RETURN NULL;  -- duplicata da mesma mensagem: descarta em silêncio
  END IF;
  RETURN NEW;
END;
$function$;

-- Roda cedo, antes dos triggers que abrem ticket/preenchem campos, para que uma
-- duplicata nem chegue a criar efeitos colaterais.
DROP TRIGGER IF EXISTS tr_chat_message_aa_dedup ON public.chat_messages;
CREATE TRIGGER tr_chat_message_aa_dedup
  BEFORE INSERT ON public.chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_dedup_chat_message();
