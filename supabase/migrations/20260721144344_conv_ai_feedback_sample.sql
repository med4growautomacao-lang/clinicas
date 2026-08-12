-- 20260721144344_conv_ai_feedback_sample
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

CREATE OR REPLACE FUNCTION public.conv_ai_feedback_sample(
  p_clinic_id uuid,
  p_limit     int DEFAULT 40
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_since timestamptz;
  v_sales jsonb;
  v_corr  jsonb;
BEGIN
  SELECT COALESCE(c.last_learned_at, now() - interval '90 days')
    INTO v_since FROM conv_ai_clinic_config c WHERE c.clinic_id = p_clinic_id;

  SELECT jsonb_agg(jsonb_build_object(
           'decisao', CASE WHEN i.status = 'approved' THEN 'ERA VENDA' ELSE 'NAO ERA VENDA' END,
           'confianca_da_ia', i.confidence,
           'motivo_da_ia', i.rationale,
           'evidencia_da_ia', i.evidence,
           'observacao_humana', i.decision_note
         ))
    INTO v_sales
    FROM (
      SELECT * FROM conv_ai_insights
       WHERE clinic_id = p_clinic_id AND kind = 'sale'
         AND status IN ('approved','rejected') AND decided_at >= v_since
       ORDER BY decided_at DESC LIMIT p_limit
    ) i;

  SELECT jsonb_agg(jsonb_build_object(
           'etapa_da_ia', si.name,
           'etapa_corrigida_pelo_humano', sh.name,
           'conversa', conv.txt
         ))
    INTO v_corr
    FROM lead_stage_history h
    JOIN LATERAL (
      SELECT h2.new_stage_id, h2.changed_at
        FROM lead_stage_history h2
       WHERE h2.ticket_id = h.ticket_id
         AND h2.changed_at > h.changed_at
         AND h2.changed_at < h.changed_at + interval '48 hours'
         AND COALESCE(h2.source,'') NOT IN ('ia_analise','auto_open')
       ORDER BY h2.changed_at LIMIT 1
    ) hum ON true
    LEFT JOIN funnel_stages si ON si.id = h.new_stage_id
    LEFT JOIN funnel_stages sh ON sh.id = hum.new_stage_id
    CROSS JOIN LATERAL (
      SELECT string_agg(x.line, E'\n' ORDER BY x.seq) AS txt
        FROM (
          SELECT m.seq,
                 (CASE WHEN m.direction = 'inbound' THEN 'cliente: ' ELSE 'empresa: ' END
                   || left(m.message->>'content', 200)) AS line
            FROM chat_messages m
           WHERE m.lead_id = h.lead_id
             AND m.created_at <= h.changed_at
             AND COALESCE(btrim(m.message->>'content'), '') <> ''
             AND m.sender IS DISTINCT FROM 'system'
           ORDER BY m.seq DESC LIMIT 8
        ) x
    ) conv
   WHERE h.clinic_id = p_clinic_id
     AND h.source = 'ia_analise'
     AND h.changed_at >= (v_since AT TIME ZONE 'America/Sao_Paulo')
     AND hum.new_stage_id IS DISTINCT FROM h.new_stage_id;

  RETURN jsonb_build_object(
    'vendas', COALESCE(v_sales, '[]'::jsonb),
    'correcoes_de_etapa', COALESCE(v_corr, '[]'::jsonb)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.conv_ai_feedback_sample(uuid, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.conv_ai_feedback_sample(uuid, int) TO service_role;
