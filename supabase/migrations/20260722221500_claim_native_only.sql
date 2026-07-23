-- =============================================================================
-- claim_due_ai_turns: reivindicar SO turnos NATIVOS (context IS NOT NULL)
--
-- ⚠️ COEXISTENCIA: ate o flip, o ai_turn_buffer e COMPARTILHADO com o Agente IA do n8n, que grava
-- linhas SEM context (messageInsert nao seta context) e as reivindica pelo turn_marker no
-- getBufferFinal. O claim nativo, por tempo vencido, roubaria essas linhas e quebraria o agente
-- que esta no ar (o worker nativo nem teria token/numero — context NULL). Filtrando context IS NOT
-- NULL, o claim nativo enxerga APENAS o que o ingest nativo enfileirou (enqueue_ai_turn sempre grava
-- context). As duas maquinas passam a conviver no mesmo buffer sem colisao, e o cron/worker fica
-- inofensivo antes do flip.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.claim_due_ai_turns(
  p_session_id text DEFAULT NULL,
  p_limit int DEFAULT 50
)
RETURNS TABLE(session_id text, clinic_id text, buffer text, context jsonb)
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
      AND b.context IS NOT NULL   -- so turnos NATIVOS; n8n grava sem context
      AND now() - b.updated_at >= make_interval(secs => GREATEST(COALESCE(b.wait_seconds, 30), 1))
    ORDER BY b.updated_at
    LIMIT GREATEST(p_limit, 1)
    FOR UPDATE SKIP LOCKED
  ),
  due AS (
    DELETE FROM public.ai_turn_buffer b
    USING picked p
    WHERE b.session_id = p.session_id
    RETURNING b.session_id, b.clinic_id, b.buffer, b.context
  )
  SELECT d.session_id, d.clinic_id, d.buffer, d.context
  FROM due d
  WHERE public.fn_ai_loop_guard(d.session_id, d.clinic_id);
END;
$$;
REVOKE ALL ON FUNCTION public.claim_due_ai_turns(text, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_ai_turns(text, int) TO service_role;
