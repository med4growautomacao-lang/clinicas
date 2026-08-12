-- 20260717173308_memory_view_shield_hub_dedup
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- =============================================================================
-- Blindagem da memória da IA contra turno humano duplicado (pré-canário do hub)
--
-- A memória LangChain do Agente IA grava o turno inteiro (human + ai) via
-- vw_n8n_chat_memory. Com o hub wa-inbound, a mensagem humana JÁ está persistida
-- (com wa_message_id) — a cópia da memória duplicaria a conversa na tela.
--
-- Regra: se a SESSÃO tem linha recente com wa_message_id (últimos 15 min), o hub
-- é o escritor canônico → INSERT de turno HUMANO da memória é pulado (a leitura
-- da memória vê as linhas do hub na mesma tabela — nada se perde). Turnos de IA
-- sempre entram (são a única cópia da resposta). Sessões do caminho n8n não têm
-- wa_message_id → comportamento idêntico ao atual.
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
