-- =============================================================================
-- IA Analista de Conversas — RPCs do worker + agendadores
--
-- A edge fica FINA de propósito: o banco entrega o contexto pronto (1 round-trip
-- por ticket em vez de 4) e faz o claim atômico do lote (duas execuções do cron
-- nunca analisam o mesmo ticket, padrão FOR UPDATE SKIP LOCKED).
--
-- ⚠ Fuso: chat_messages.created_at é timestamp SEM tz (já é São Paulo) e
-- tickets.opened_at é timestamptz. Converter os dois lados aqui, uma vez, evita
-- o deslocamento de 3h que ninguém percebe.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Claim atômico do lote (respeita debounce e teto diário por clínica)
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 2. Fecha o item da fila. Se chegou mensagem NOVA durante a análise, volta a
--    'pending' em vez de 'done' (senão o turno seguinte se perde em silêncio).
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 3. Contexto de análise pronto: ticket + etapas + manual da clínica + conversa
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.conv_ai_get_context(
  p_ticket_id    uuid,
  p_max_messages int DEFAULT 40
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_t        RECORD;
  v_messages jsonb;
  v_stages   jsonb;
  v_prompt   text;
  v_last_seq bigint;
BEGIN
  SELECT t.id, t.clinic_id, t.lead_id, t.stage_id, t.status, t.outcome, t.opened_at,
         s.name AS stage_name, s.slug AS stage_slug,
         l.name AS lead_name, c.name AS clinic_name, c.category AS clinic_category
    INTO v_t
    FROM tickets t
    LEFT JOIN funnel_stages s ON s.id = t.stage_id
    LEFT JOIN leads l ON l.id = t.lead_id
    LEFT JOIN clinics c ON c.id = t.clinic_id
   WHERE t.id = p_ticket_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
           'id', s.id, 'name', s.name, 'slug', s.slug,
           'position', s.position, 'is_conversion', s.is_conversion
         ) ORDER BY s.position)
    INTO v_stages
    FROM funnel_stages s
   WHERE s.clinic_id = v_t.clinic_id;

  SELECT v.content INTO v_prompt
    FROM conv_ai_prompt_versions v
   WHERE v.clinic_id = v_t.clinic_id AND v.is_current;

  -- Conversa do CICLO deste ticket. opened_at (timestamptz) convertido para SP,
  -- que é o fuso em que chat_messages.created_at já está gravado.
  WITH win AS (
    SELECT m.seq, m.direction, m.sender, m.created_at, m.message->>'content' AS content
      FROM chat_messages m
     WHERE m.lead_id = v_t.lead_id
       AND m.created_at >= (v_t.opened_at AT TIME ZONE 'America/Sao_Paulo') - interval '5 minutes'
       AND COALESCE(btrim(m.message->>'content'), '') <> ''
     ORDER BY m.seq DESC
     LIMIT p_max_messages
  )
  SELECT jsonb_agg(jsonb_build_object(
           'seq', w.seq,
           'who', CASE WHEN w.direction = 'inbound' THEN 'cliente'
                       WHEN w.sender = 'ai' THEN 'ia'
                       WHEN w.sender = 'system' THEN 'automacao'
                       ELSE 'empresa' END,
           'at', to_char(w.created_at, 'DD/MM HH24:MI'),
           'text', left(w.content, 1200)
         ) ORDER BY w.seq),
         MAX(w.seq)
    INTO v_messages, v_last_seq
    FROM win w;

  RETURN jsonb_build_object(
    'found', true,
    'ticket', jsonb_build_object(
      'id', v_t.id, 'stage_id', v_t.stage_id, 'stage_name', v_t.stage_name,
      'stage_slug', v_t.stage_slug, 'status', v_t.status, 'outcome', v_t.outcome),
    'lead', jsonb_build_object('id', v_t.lead_id, 'name', v_t.lead_name),
    'clinic', jsonb_build_object('id', v_t.clinic_id, 'name', v_t.clinic_name, 'category', v_t.clinic_category),
    'stages', COALESCE(v_stages, '[]'::jsonb),
    'clinic_prompt', v_prompt,
    'messages', COALESCE(v_messages, '[]'::jsonb),
    'last_seq', COALESCE(v_last_seq, 0)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.conv_ai_get_context(uuid, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.conv_ai_get_context(uuid, int) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. Quem precisa de prompt: sem versão vigente (bootstrap) ou com decisões
--    acumuladas (aprendizado).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.conv_ai_learn_targets(p_every_n int DEFAULT 15)
RETURNS TABLE (clinic_id uuid, mode text, decisions int)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.clinic_id,
         CASE WHEN v.id IS NULL THEN 'bootstrap' ELSE 'learn' END AS mode,
         c.decisions_since_learn
    FROM public.conv_ai_clinic_config c
    LEFT JOIN public.conv_ai_prompt_versions v
           ON v.clinic_id = c.clinic_id AND v.is_current
   WHERE c.enabled
     AND (v.id IS NULL OR c.decisions_since_learn >= p_every_n);
$$;
REVOKE ALL ON FUNCTION public.conv_ai_learn_targets(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.conv_ai_learn_targets(int) TO service_role;

-- ---------------------------------------------------------------------------
-- 5. Amostra histórica para o bootstrap: atendimentos JÁ rotulados por humanos
--    (a etapa em que o humano deixou o card e o desfecho do ticket).
-- ---------------------------------------------------------------------------
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
    (SELECT t.id, t.lead_id, t.opened_at, t.outcome, s.name AS stage_name, 1 AS grp
       FROM tickets t LEFT JOIN funnel_stages s ON s.id = t.stage_id
      WHERE t.clinic_id = p_clinic_id AND t.outcome = 'ganho'
        AND t.opened_at > now() - interval '120 days'
      ORDER BY t.opened_at DESC LIMIT GREATEST(p_limit / 3, 5))
    UNION ALL
    (SELECT t.id, t.lead_id, t.opened_at, t.outcome, s.name, 2
       FROM tickets t LEFT JOIN funnel_stages s ON s.id = t.stage_id
      WHERE t.clinic_id = p_clinic_id AND t.outcome = 'perdido'
        AND t.opened_at > now() - interval '120 days'
      ORDER BY t.opened_at DESC LIMIT GREATEST(p_limit / 3, 5))
    UNION ALL
    (SELECT t.id, t.lead_id, t.opened_at, t.outcome, s.name, 3
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

-- ---------------------------------------------------------------------------
-- 6. Sinal de aprendizado. Duas fontes:
--    (a) decisões explícitas na fila de venda (aprovou / recusou);
--    (b) correção IMPLÍCITA de etapa: humano moveu o card em até 48h depois de
--        um movimento com source='ia_analise'. Contra-exemplo de graça.
-- ---------------------------------------------------------------------------
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
  v_since    timestamptz;
  v_sales    jsonb;
  v_corr     jsonb;
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

  -- (b) correções de etapa
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

-- ---------------------------------------------------------------------------
-- 7. Salva a nova versão do prompt e a torna vigente (zera o contador)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.conv_ai_save_prompt_version(
  p_clinic_id uuid,
  p_content   text,
  p_source    text DEFAULT 'learn',
  p_based_on  int DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next int;
BEGIN
  IF COALESCE(btrim(p_content), '') = '' THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'empty_content');
  END IF;

  SELECT COALESCE(MAX(version), 0) + 1 INTO v_next
    FROM conv_ai_prompt_versions WHERE clinic_id = p_clinic_id;

  UPDATE conv_ai_prompt_versions SET is_current = false
   WHERE clinic_id = p_clinic_id AND is_current;

  INSERT INTO conv_ai_prompt_versions (clinic_id, version, content, source, based_on_decisions, is_current)
  VALUES (p_clinic_id, v_next, btrim(p_content), p_source, COALESCE(p_based_on, 0), true);

  INSERT INTO conv_ai_clinic_config (clinic_id, prompt_version, decisions_since_learn, last_learned_at)
  VALUES (p_clinic_id, v_next, 0, now())
  ON CONFLICT (clinic_id) DO UPDATE
    SET prompt_version = v_next, decisions_since_learn = 0, last_learned_at = now(), updated_at = now();

  RETURN jsonb_build_object('success', true, 'version', v_next);
END;
$$;
REVOKE ALL ON FUNCTION public.conv_ai_save_prompt_version(uuid, text, text, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.conv_ai_save_prompt_version(uuid, text, text, int) TO service_role;

-- ---------------------------------------------------------------------------
-- 8. Agendadores (system_http_post, nunca net.http_post cru)
-- ---------------------------------------------------------------------------
SELECT cron.unschedule('conv_ai_analyst') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'conv_ai_analyst');
SELECT cron.schedule('conv_ai_analyst', '*/5 * * * *', $cron$
  select public.system_http_post('https://yzpclhuifquhfqpiwysh.supabase.co/functions/v1/conv-ai-analyst');
$cron$);

SELECT cron.unschedule('conv_ai_learn') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'conv_ai_learn');
SELECT cron.schedule('conv_ai_learn', '20 4 * * *', $cron$
  select public.system_http_post('https://yzpclhuifquhfqpiwysh.supabase.co/functions/v1/conv-ai-learn');
$cron$);
