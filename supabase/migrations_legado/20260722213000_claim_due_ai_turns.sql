-- =============================================================================
-- claim_due_ai_turns() — claim atomico dos turnos de IA "vencidos" (edge ai-agent-worker)
--
-- Rework do Agente IA: o debounce vive em ai_turn_buffer (1 linha por sessao, PK session_id;
-- cada mensagem faz upsert e bumpa updated_at). Um turno esta "vencido" quando ficou quieto
-- por wait_seconds. Esta RPC pega os vencidos de forma atomica (DELETE ... RETURNING com
-- FOR UPDATE SKIP LOCKED, para varios workers em paralelo nao pegarem o mesmo), e passa cada
-- um por fn_ai_loop_guard (fail-open). Substitui o par wait+getBufferFinal do n8n.
--
-- Coalescing: mensagem nova bumpa updated_at e adia o vencimento; so o ultimo turno roda.
-- Chamada pelo worker (service_role): claim de UMA sessao (kick) ou de TODAS (sweep do cron).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.claim_due_ai_turns(
  p_session_id text DEFAULT NULL,
  p_limit int DEFAULT 50
)
RETURNS TABLE(session_id text, clinic_id text, buffer text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT b.session_id
    FROM public.ai_turn_buffer b
    WHERE (p_session_id IS NULL OR b.session_id = p_session_id)
      AND now() - b.updated_at >= make_interval(secs => GREATEST(COALESCE(b.wait_seconds, 30), 1))
    ORDER BY b.updated_at
    LIMIT GREATEST(p_limit, 1)
    FOR UPDATE SKIP LOCKED
  ),
  due AS (
    DELETE FROM public.ai_turn_buffer b
    USING picked p
    WHERE b.session_id = p.session_id
    RETURNING b.session_id, b.clinic_id, b.buffer
  )
  SELECT d.session_id, d.clinic_id, d.buffer
  FROM due d
  WHERE public.fn_ai_loop_guard(d.session_id, d.clinic_id);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_due_ai_turns(text, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_ai_turns(text, int) TO service_role;
