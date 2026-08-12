-- =============================================================================
-- Blindagem da memória da IA contra turno humano duplicado (pré-canário do hub)
--
-- A memória LangChain do Agente IA grava o turno inteiro (human + ai) via
-- vw_n8n_chat_memory (view auto-atualizável de chat_messages). Com o hub
-- wa-inbound, a mensagem humana JÁ está persistida (com wa_message_id) — a
-- cópia da memória duplicaria a conversa (e no turno de rajada viria
-- CONCATENADA, por isso a regra não compara conteúdo).
--
-- Regra: sessão com linha recente de wa_message_id (15 min) = gerida pelo hub →
-- INSERT de turno HUMANO da memória é pulado (a leitura da memória enxerga as
-- linhas do hub na mesma tabela — nada se perde). Turno de IA sempre entra
-- (única cópia da resposta). Sessões do caminho n8n não têm wa_message_id →
-- comportamento idêntico ao anterior. Validado: SQL (A/B) + E2E rajada T5.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_memory_insert_shield()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.message->>'type' = 'human' AND EXISTS (
    SELECT 1 FROM chat_messages cm
    WHERE cm.session_id = NEW.session_id
      AND cm.wa_message_id IS NOT NULL
      AND cm.created_at > (now() AT TIME ZONE 'America/Sao_Paulo') - interval '15 minutes'
  ) THEN
    RETURN NEW;  -- sessão gerida pelo hub: turno humano já persistido, pula
  END IF;

  INSERT INTO chat_messages (session_id, message)
  VALUES (NEW.session_id, NEW.message);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_vw_n8n_chat_memory_insert ON public.vw_n8n_chat_memory;
CREATE TRIGGER trg_vw_n8n_chat_memory_insert
  INSTEAD OF INSERT ON public.vw_n8n_chat_memory
  FOR EACH ROW EXECUTE FUNCTION public.fn_memory_insert_shield();
