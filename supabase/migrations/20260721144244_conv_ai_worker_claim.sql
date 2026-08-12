-- 20260721144244_conv_ai_worker_claim
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

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

CREATE OR REPLACE FUNCTION public.conv_ai_finish_ticket(
  p_ticket_id    uuid,
  p_analyzed_seq bigint,
  p_error        text DEFAULT NULL
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.conv_ai_queue q
     SET analyzed_seq = GREATEST(q.analyzed_seq, COALESCE(p_analyzed_seq, 0)),
         status = CASE
                    WHEN p_error IS NOT NULL THEN 'error'
                    WHEN q.last_message_seq > GREATEST(q.analyzed_seq, COALESCE(p_analyzed_seq, 0)) THEN 'pending'
                    ELSE 'done'
                  END,
         last_error = p_error,
         updated_at = now()
   WHERE q.ticket_id = p_ticket_id;
$$;
REVOKE ALL ON FUNCTION public.conv_ai_finish_ticket(uuid, bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.conv_ai_finish_ticket(uuid, bigint, text) TO service_role;
