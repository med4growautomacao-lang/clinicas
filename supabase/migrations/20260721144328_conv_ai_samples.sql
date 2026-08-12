-- 20260721144328_conv_ai_samples
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

CREATE OR REPLACE FUNCTION public.conv_ai_bootstrap_sample(
  p_clinic_id uuid,
  p_limit     int DEFAULT 60
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows jsonb;
BEGIN
  WITH base AS (
    (SELECT t.id, t.lead_id, t.opened_at, t.outcome, s.name AS stage_name
       FROM tickets t LEFT JOIN funnel_stages s ON s.id = t.stage_id
      WHERE t.clinic_id = p_clinic_id AND t.outcome = 'ganho'
        AND t.opened_at > now() - interval '120 days'
      ORDER BY t.opened_at DESC LIMIT GREATEST(p_limit / 3, 5))
    UNION ALL
    (SELECT t.id, t.lead_id, t.opened_at, t.outcome, s.name
       FROM tickets t LEFT JOIN funnel_stages s ON s.id = t.stage_id
      WHERE t.clinic_id = p_clinic_id AND t.outcome = 'perdido'
        AND t.opened_at > now() - interval '120 days'
      ORDER BY t.opened_at DESC LIMIT GREATEST(p_limit / 3, 5))
    UNION ALL
    (SELECT t.id, t.lead_id, t.opened_at, t.outcome, s.name
       FROM tickets t
       JOIN funnel_stages s ON s.id = t.stage_id
      WHERE t.clinic_id = p_clinic_id AND t.outcome IS NULL AND s.position > 1
        AND t.opened_at > now() - interval '120 days'
      ORDER BY t.opened_at DESC LIMIT GREATEST(p_limit / 3, 5))
  )
  SELECT jsonb_agg(jsonb_build_object(
           'stage', b.stage_name,
           'outcome', COALESCE(b.outcome, 'em aberto'),
           'conversa', conv.txt
         ))
    INTO v_rows
    FROM base b
    CROSS JOIN LATERAL (
      SELECT string_agg(x.line, E'\n' ORDER BY x.seq) AS txt
        FROM (
          SELECT m.seq,
                 (CASE WHEN m.direction = 'inbound' THEN 'cliente: ' ELSE 'empresa: ' END
                   || left(m.message->>'content', 240)) AS line
            FROM chat_messages m
           WHERE m.lead_id = b.lead_id
             AND m.created_at >= (b.opened_at AT TIME ZONE 'America/Sao_Paulo') - interval '5 minutes'
             AND COALESCE(btrim(m.message->>'content'), '') <> ''
             AND m.sender IS DISTINCT FROM 'system'
           ORDER BY m.seq DESC
           LIMIT 14
        ) x
    ) conv
   WHERE conv.txt IS NOT NULL;

  RETURN COALESCE(v_rows, '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.conv_ai_bootstrap_sample(uuid, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.conv_ai_bootstrap_sample(uuid, int) TO service_role;
