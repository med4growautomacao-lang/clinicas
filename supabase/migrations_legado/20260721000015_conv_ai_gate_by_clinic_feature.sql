-- =============================================================================
-- "Sugestões da IA" vira funcionalidade liberada por clínica no Super Admin
-- (clinics.features.feature_conv_ai), ao lado de Follow-up e Configurações IA.
--
-- O gate é REAL, não só visual: sem ele, uma clínica com a aba escondida
-- continuaria enfileirando e pagando análise de LLM sem ninguém ver o resultado.
-- Duas portas fechadas: o trigger que enfileira e o claim que entrega o lote.
--
-- Opt-in (só vale com === true), como feature_chat_send: é funcionalidade nova
-- e tem custo por conversa. As demais flags do produto são opt-out (!== false).
--
-- Ficam TRÊS níveis, do mais amplo ao mais específico:
--   1. system_settings.conv_ai_config.mode  (off | shadow | active) — global
--   2. clinics.features.feature_conv_ai     — a clínica tem a funcionalidade
--   3. conv_ai_clinic_config.enabled + stage_mode/sale_mode — o que ela faz
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_conv_ai_enqueue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ticket_id uuid;
  v_content   text;
BEGIN
  IF NEW.clinic_id IS NULL OR NEW.lead_id IS NULL THEN RETURN NEW; END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM conv_ai_clinic_config c
      JOIN clinics cl ON cl.id = c.clinic_id
     WHERE c.clinic_id = NEW.clinic_id
       AND c.enabled
       AND COALESCE((cl.features->>'feature_conv_ai')::boolean, false)
  ) THEN
    RETURN NEW;
  END IF;

  v_content := NEW.message->>'content';
  IF v_content IS NULL OR btrim(v_content) = '' THEN RETURN NEW; END IF;

  v_ticket_id := NEW.ticket_id;
  IF v_ticket_id IS NULL THEN
    SELECT id INTO v_ticket_id
      FROM tickets
     WHERE lead_id = NEW.lead_id AND status = 'open'
     ORDER BY opened_at DESC LIMIT 1;
  END IF;
  IF v_ticket_id IS NULL THEN RETURN NEW; END IF;

  INSERT INTO conv_ai_queue (ticket_id, clinic_id, lead_id, last_message_seq, last_message_at, status)
  VALUES (v_ticket_id, NEW.clinic_id, NEW.lead_id, NEW.seq, now(), 'pending')
  ON CONFLICT (ticket_id) DO UPDATE
    SET last_message_seq = GREATEST(conv_ai_queue.last_message_seq, EXCLUDED.last_message_seq),
        last_message_at  = now(),
        status           = 'pending',
        updated_at       = now();

  RETURN NEW;

EXCEPTION WHEN OTHERS THEN
  BEGIN
    PERFORM log_system_error('conv-ai', 'enqueue_error',
      'Falha ao enfileirar conversa para o analista de IA', 'warning', NEW.clinic_id,
      jsonb_build_object('message_id', NEW.id, 'lead_id', NEW.lead_id, 'error', SQLERRM), false);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.conv_ai_claim_batch(
  p_limit            int DEFAULT 25,
  p_debounce_minutes int DEFAULT 3,
  p_daily_cap        int DEFAULT 300
)
RETURNS TABLE (ticket_id uuid, clinic_id uuid, lead_id uuid, last_message_seq bigint, analyzed_seq bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH capped AS (
    SELECT i.clinic_id
      FROM conv_ai_insights i
     WHERE i.created_at >= date_trunc('day', now())
     GROUP BY i.clinic_id
    HAVING COUNT(*) >= p_daily_cap
  ),
  picked AS (
    SELECT q.ticket_id AS tid
      FROM conv_ai_queue q
      JOIN conv_ai_clinic_config c ON c.clinic_id = q.clinic_id AND c.enabled
      JOIN clinics cl ON cl.id = q.clinic_id
                     AND COALESCE((cl.features->>'feature_conv_ai')::boolean, false)
     WHERE q.status = 'pending'
       AND q.last_message_at < now() - make_interval(mins => p_debounce_minutes)
       AND q.last_message_seq > q.analyzed_seq
       AND NOT EXISTS (SELECT 1 FROM capped cp WHERE cp.clinic_id = q.clinic_id)
     ORDER BY q.last_message_at
     LIMIT p_limit
     FOR UPDATE OF q SKIP LOCKED
  )
  UPDATE conv_ai_queue q
     SET status = 'running', attempts = q.attempts + 1, updated_at = now()
    FROM picked p
   WHERE q.ticket_id = p.tid
  RETURNING q.ticket_id, q.clinic_id, q.lead_id, q.last_message_seq, q.analyzed_seq;
END;
$$;
REVOKE ALL ON FUNCTION public.conv_ai_claim_batch(int, int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.conv_ai_claim_batch(int, int, int) TO service_role;
