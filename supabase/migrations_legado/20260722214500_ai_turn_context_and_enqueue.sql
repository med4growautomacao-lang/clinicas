-- =============================================================================
-- ai_turn_buffer.context + enqueue_ai_turn() + claim_due_ai_turns() (com context)
--
-- O worker (ai-agent-worker) precisa, alem do buffer, do contexto do turno: token uazapi,
-- contact_identifier, telefones, handoff/transition rules, midia_type (p/ decidir audio no
-- fast-follow). Guardamos esse contexto na propria linha do buffer (jsonb), sobrescrito a cada
-- mensagem (estavel na conversa). Assim o worker fica self-contained e escala sem re-derivar
-- de varias tabelas no hot path.
-- =============================================================================

ALTER TABLE public.ai_turn_buffer ADD COLUMN IF NOT EXISTS context jsonb;

-- Ingest: append no buffer + bump updated_at + grava contexto do turno (edge ai-agent).
CREATE OR REPLACE FUNCTION public.enqueue_ai_turn(
  p_session_id text, p_clinic_id text, p_text text, p_wait_seconds int, p_context jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.ai_turn_buffer (session_id, clinic_id, buffer, turn_marker, wait_seconds, context, updated_at)
  VALUES (p_session_id, p_clinic_id, COALESCE(p_text, ''), gen_random_uuid()::text, COALESCE(p_wait_seconds, 30), p_context, now())
  ON CONFLICT (session_id) DO UPDATE
    SET buffer       = ai_turn_buffer.buffer || E'\n' || EXCLUDED.buffer,
        turn_marker  = EXCLUDED.turn_marker,
        wait_seconds = EXCLUDED.wait_seconds,
        clinic_id    = EXCLUDED.clinic_id,
        context      = EXCLUDED.context,
        updated_at   = now();
END;
$$;
REVOKE ALL ON FUNCTION public.enqueue_ai_turn(text, text, text, int, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_ai_turn(text, text, text, int, jsonb) TO service_role;

-- Claim atomico dos turnos vencidos, agora devolvendo o contexto.
DROP FUNCTION IF EXISTS public.claim_due_ai_turns(text, int);
CREATE FUNCTION public.claim_due_ai_turns(
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
