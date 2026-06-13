-- Painel Comercial por agente (IA / Humano / Sistema) + filtro de origem (Marketing-style).
-- Uma RPC agrega tudo server-side (substitui as ~20 queries de cliente do antigo ServiceDashboard).
--
-- DOIS filtros globais (como o Marketing):
--   p_agent  ('todos'|'ia'|'humano')  -> escopo do AGENTE (appointments.source / chat_messages.sender).
--   p_origin ('todos'|'meta'|'google'|'sem_origem') -> escopo da ORIGEM do lead (leads.source),
--            mesmo mapeamento do marketing_funnel_cohort (meta_ads / google_ads / no_track).
--
-- Atribuibilidade:
--   * Origem (dimensao do lead) escopa: leads, conversao, consultas (via ticket->lead), funil,
--     tempo de resposta, SLA, no-show, automacoes, ciclo de vendas e investimento (marketing_data.platform).
--   * Agente escopa: consultas (source), no-show dessas, tempo de 1a resposta (sender).
--   * Faturamento / Ticket medio / ROAS NAO sao atribuiveis (a receita nao carrega agente nem origem):
--     ficam GERAIS e o front marca com selo "geral" quando ha filtro ativo que nao os escopa.
DROP FUNCTION IF EXISTS public.get_commercial_dashboard(uuid, date, date);
DROP FUNCTION IF EXISTS public.get_commercial_dashboard(uuid, date, date, text);

CREATE OR REPLACE FUNCTION public.get_commercial_dashboard(
  p_clinic_id uuid, p_date_from date, p_date_to date,
  p_agent text DEFAULT 'todos', p_origin text DEFAULT 'todos'
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ganho_stage_id uuid;
  v_ia_msgs int; v_human_msgs int; v_inbound_msgs int; v_total_msgs int;
  v_ia_leads_touched int; v_human_leads_touched int;
  v_appt_ia int; v_appt_manual int; v_appt_total int; v_appt_status jsonb;
  v_ia_enabled int; v_ia_autonomous int; v_handoffs int;
  v_auto jsonb;
  v_sla_breaches int; v_pending int;
  v_avg_first_response numeric; v_median_first_response numeric; v_sla_minutes int;
  v_won int; v_lost int;
  v_revenue numeric; v_investment numeric; v_investment_total numeric;
  v_sales_cycle numeric; v_attended_consults int; v_converted_value numeric;
  v_csat_type text; v_csat_answered int; v_csat_avg numeric; v_csat_dist jsonb;
  v_funnel jsonb; v_daily jsonb;
  v_total_leads int; v_new_leads int;
BEGIN
  SELECT id INTO v_ganho_stage_id FROM funnel_stages
  WHERE clinic_id = p_clinic_id AND slug = 'ganho' LIMIT 1;

  -- ===== MESSAGES (escopo ORIGEM via lead; breakdown por sender sempre completo) =====
  SELECT
    COUNT(*) FILTER (WHERE cm.sender = 'ai'),
    COUNT(*) FILTER (WHERE cm.sender = 'human' AND cm.direction = 'outbound'),
    COUNT(*) FILTER (WHERE cm.direction = 'inbound'),
    COUNT(*)
  INTO v_ia_msgs, v_human_msgs, v_inbound_msgs, v_total_msgs
  FROM chat_messages cm
  LEFT JOIN leads l ON l.id = cm.lead_id
  WHERE cm.clinic_id = p_clinic_id
    AND cm.created_at::date BETWEEN p_date_from AND p_date_to
    AND (p_origin = 'todos'
      OR (p_origin = 'meta' AND l.source = 'meta_ads')
      OR (p_origin = 'google' AND l.source = 'google_ads')
      OR (p_origin = 'sem_origem' AND (l.source IS NULL OR l.source NOT IN ('meta_ads', 'google_ads'))));

  -- Leads ATENDIDOS por agente = subconjunto dos leads CRIADOS no periodo (mesma coorte de newLeads)
  -- que receberam mensagem do agente no periodo. Garante IA/Humano <= total de leads.
  SELECT
    COUNT(DISTINCT cm.lead_id) FILTER (WHERE cm.sender = 'ai'),
    COUNT(DISTINCT cm.lead_id) FILTER (WHERE cm.sender = 'human' AND cm.direction = 'outbound')
  INTO v_ia_leads_touched, v_human_leads_touched
  FROM chat_messages cm
  JOIN leads l ON l.id = cm.lead_id
  WHERE cm.clinic_id = p_clinic_id
    AND cm.created_at::date BETWEEN p_date_from AND p_date_to
    AND l.created_at::date BETWEEN p_date_from AND p_date_to
    AND (p_origin = 'todos'
      OR (p_origin = 'meta' AND l.source = 'meta_ads')
      OR (p_origin = 'google' AND l.source = 'google_ads')
      OR (p_origin = 'sem_origem' AND (l.source IS NULL OR l.source NOT IN ('meta_ads', 'google_ads'))));

  -- ===== APPOINTMENTS (escopo AGENTE via source + ORIGEM via ticket->lead) =====
  SELECT
    COUNT(*) FILTER (WHERE a.source = 'ia'),
    COUNT(*) FILTER (WHERE a.source = 'manual'),
    COUNT(*) FILTER (WHERE p_agent = 'todos' OR (p_agent = 'ia' AND a.source = 'ia') OR (p_agent = 'humano' AND a.source = 'manual'))
  INTO v_appt_ia, v_appt_manual, v_appt_total
  FROM appointments a
  LEFT JOIN tickets t ON t.id = a.ticket_id
  LEFT JOIN leads l ON l.id = t.lead_id
  WHERE a.clinic_id = p_clinic_id
    AND a.created_at::date BETWEEN p_date_from AND p_date_to
    AND (p_origin = 'todos'
      OR (p_origin = 'meta' AND l.source = 'meta_ads')
      OR (p_origin = 'google' AND l.source = 'google_ads')
      OR (p_origin = 'sem_origem' AND (l.source IS NULL OR l.source NOT IN ('meta_ads', 'google_ads'))));

  SELECT COALESCE(jsonb_object_agg(status, cnt), '{}'::jsonb) INTO v_appt_status
  FROM (
    SELECT COALESCE(a.status, 'indefinido') AS status, COUNT(*) AS cnt
    FROM appointments a
    LEFT JOIN tickets t ON t.id = a.ticket_id
    LEFT JOIN leads l ON l.id = t.lead_id
    WHERE a.clinic_id = p_clinic_id
      AND a.created_at::date BETWEEN p_date_from AND p_date_to
      AND (p_agent = 'todos' OR (p_agent = 'ia' AND a.source = 'ia') OR (p_agent = 'humano' AND a.source = 'manual'))
      AND (p_origin = 'todos'
        OR (p_origin = 'meta' AND l.source = 'meta_ads')
        OR (p_origin = 'google' AND l.source = 'google_ads')
        OR (p_origin = 'sem_origem' AND (l.source IS NULL OR l.source NOT IN ('meta_ads', 'google_ads'))))
    GROUP BY 1
  ) s;

  -- ===== LEADS / IA lifecycle (escopo ORIGEM via leads.source) =====
  SELECT COUNT(*) INTO v_total_leads FROM leads WHERE clinic_id = p_clinic_id;

  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE ai_enabled),
    COUNT(*) FILTER (WHERE ai_enabled AND handoff_triggered_at IS NULL),
    COALESCE(SUM(sla_breach_count), 0)
  INTO v_new_leads, v_ia_enabled, v_ia_autonomous, v_sla_breaches
  FROM leads
  WHERE clinic_id = p_clinic_id
    AND created_at::date BETWEEN p_date_from AND p_date_to
    AND (p_origin = 'todos'
      OR (p_origin = 'meta' AND source = 'meta_ads')
      OR (p_origin = 'google' AND source = 'google_ads')
      OR (p_origin = 'sem_origem' AND (source IS NULL OR source NOT IN ('meta_ads', 'google_ads'))));

  SELECT COUNT(*) INTO v_handoffs FROM leads
  WHERE clinic_id = p_clinic_id AND handoff_triggered_at IS NOT NULL
    AND handoff_triggered_at::date BETWEEN p_date_from AND p_date_to
    AND (p_origin = 'todos'
      OR (p_origin = 'meta' AND source = 'meta_ads')
      OR (p_origin = 'google' AND source = 'google_ads')
      OR (p_origin = 'sem_origem' AND (source IS NULL OR source NOT IN ('meta_ads', 'google_ads'))));

  SELECT COUNT(*) INTO v_pending FROM leads
  WHERE clinic_id = p_clinic_id AND last_message_at IS NOT NULL
    AND (last_outbound_at IS NULL OR last_message_at > last_outbound_at)
    AND (p_origin = 'todos'
      OR (p_origin = 'meta' AND source = 'meta_ads')
      OR (p_origin = 'google' AND source = 'google_ads')
      OR (p_origin = 'sem_origem' AND (source IS NULL OR source NOT IN ('meta_ads', 'google_ads'))));

  -- 1a resposta (min): escopo AGENTE (sender) + ORIGEM (lead criado no periodo)
  WITH resp AS (
    SELECT EXTRACT(EPOCH FROM (fo.first_out - nl.created_at)) / 60.0 AS mins
    FROM (
      SELECT id, created_at FROM leads
      WHERE clinic_id = p_clinic_id
        AND created_at::date BETWEEN p_date_from AND p_date_to
        AND (p_origin = 'todos'
          OR (p_origin = 'meta' AND source = 'meta_ads')
          OR (p_origin = 'google' AND source = 'google_ads')
          OR (p_origin = 'sem_origem' AND (source IS NULL OR source NOT IN ('meta_ads', 'google_ads'))))
    ) nl
    JOIN (
      SELECT lead_id, MIN(created_at) AS first_out
      FROM chat_messages
      WHERE clinic_id = p_clinic_id
        AND created_at::date BETWEEN p_date_from AND p_date_to
        AND (
          (p_agent = 'todos'  AND direction = 'outbound')
          OR (p_agent = 'ia'     AND sender = 'ai')
          OR (p_agent = 'humano' AND sender = 'human' AND direction = 'outbound')
        )
      GROUP BY lead_id
    ) fo ON fo.lead_id = nl.id
    WHERE fo.first_out >= nl.created_at
  )
  SELECT COALESCE(AVG(mins), 0),
         COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY mins), 0)
  INTO v_avg_first_response, v_median_first_response
  FROM resp;

  SELECT sla_minutes, csat_type INTO v_sla_minutes, v_csat_type
  FROM ai_config WHERE clinic_id = p_clinic_id LIMIT 1;

  -- ===== FINANCE =====
  -- revenue + investment_total: GERAIS (nao atribuiveis). investment: escopado por ORIGEM (platform).
  SELECT COALESCE(SUM(amount), 0) INTO v_revenue FROM financial_transactions
  WHERE clinic_id = p_clinic_id AND type = 'receita' AND status = 'pago'
    AND date BETWEEN p_date_from AND p_date_to;

  SELECT COALESCE(SUM(investment), 0) INTO v_investment_total FROM marketing_data
  WHERE clinic_id = p_clinic_id AND date BETWEEN p_date_from AND p_date_to;

  SELECT COALESCE(SUM(investment), 0) INTO v_investment FROM marketing_data
  WHERE clinic_id = p_clinic_id AND date BETWEEN p_date_from AND p_date_to
    AND (p_origin = 'todos'
      OR (p_origin = 'meta' AND platform = 'meta_ads')
      OR (p_origin = 'google' AND platform = 'google_ads')
      OR (p_origin = 'sem_origem' AND (platform IS NULL OR platform NOT IN ('meta_ads', 'google_ads'))));

  -- ciclo de vendas: escopo ORIGEM (lead). attended (ticket medio): GERAL.
  SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (h.changed_at - l.created_at)) / 86400.0), 0)
    INTO v_sales_cycle
  FROM lead_stage_history h
  JOIN leads l ON l.id = h.lead_id
  WHERE h.clinic_id = p_clinic_id AND h.new_stage_id = v_ganho_stage_id
    AND h.changed_at::date BETWEEN p_date_from AND p_date_to
    AND (p_origin = 'todos'
      OR (p_origin = 'meta' AND l.source = 'meta_ads')
      OR (p_origin = 'google' AND l.source = 'google_ads')
      OR (p_origin = 'sem_origem' AND (l.source IS NULL OR l.source NOT IN ('meta_ads', 'google_ads'))));

  SELECT COUNT(*) INTO v_attended_consults FROM appointments
  WHERE clinic_id = p_clinic_id
    AND created_at::date BETWEEN p_date_from AND p_date_to
    AND status IN ('realizado', 'compareceu');

  -- valor convertido (conversions): GERAL, base do ticket medio
  SELECT COALESCE(SUM(value::numeric), 0) INTO v_converted_value FROM conversions
  WHERE clinic_id = p_clinic_id AND converted_at::date BETWEEN p_date_from AND p_date_to;

  -- ===== SYSTEM AUTOMATIONS (escopo ORIGEM via lead) =====
  SELECT COALESCE(jsonb_object_agg(type, cnt), '{}'::jsonb) INTO v_auto
  FROM (
    SELECT al.type, COUNT(*) AS cnt FROM automation_logs al
    LEFT JOIN leads l ON l.id = al.lead_id
    WHERE al.clinic_id = p_clinic_id AND al.status = 'sent'
      AND al.triggered_at::date BETWEEN p_date_from AND p_date_to
      AND (p_origin = 'todos'
        OR (p_origin = 'meta' AND l.source = 'meta_ads')
        OR (p_origin = 'google' AND l.source = 'google_ads')
        OR (p_origin = 'sem_origem' AND (l.source IS NULL OR l.source NOT IN ('meta_ads', 'google_ads'))))
    GROUP BY al.type
  ) a;

  -- ===== OUTCOMES (escopo ORIGEM via lead) =====
  SELECT
    COUNT(*) FILTER (WHERE t.outcome = 'ganho'),
    COUNT(*) FILTER (WHERE t.outcome = 'perdido')
  INTO v_won, v_lost
  FROM tickets t
  JOIN leads l ON l.id = t.lead_id
  WHERE t.clinic_id = p_clinic_id AND t.outcome IS NOT NULL
    AND t.outcome_at::date BETWEEN p_date_from AND p_date_to
    AND (p_origin = 'todos'
      OR (p_origin = 'meta' AND l.source = 'meta_ads')
      OR (p_origin = 'google' AND l.source = 'google_ads')
      OR (p_origin = 'sem_origem' AND (l.source IS NULL OR l.source NOT IN ('meta_ads', 'google_ads'))));

  -- ===== CSAT (escopo ORIGEM) =====
  SELECT COUNT(*), AVG(csat_score) INTO v_csat_answered, v_csat_avg
  FROM leads
  WHERE clinic_id = p_clinic_id AND csat_score IS NOT NULL
    AND csat_answered_at::date BETWEEN p_date_from AND p_date_to
    AND (p_origin = 'todos'
      OR (p_origin = 'meta' AND source = 'meta_ads')
      OR (p_origin = 'google' AND source = 'google_ads')
      OR (p_origin = 'sem_origem' AND (source IS NULL OR source NOT IN ('meta_ads', 'google_ads'))));

  SELECT COALESCE(jsonb_agg(jsonb_build_object('score', score, 'count', cnt) ORDER BY score DESC), '[]'::jsonb)
  INTO v_csat_dist
  FROM (
    SELECT csat_score AS score, COUNT(*) AS cnt FROM leads
    WHERE clinic_id = p_clinic_id AND csat_score IS NOT NULL
      AND csat_answered_at::date BETWEEN p_date_from AND p_date_to
      AND (p_origin = 'todos'
        OR (p_origin = 'meta' AND source = 'meta_ads')
        OR (p_origin = 'google' AND source = 'google_ads')
        OR (p_origin = 'sem_origem' AND (source IS NULL OR source NOT IN ('meta_ads', 'google_ads'))))
    GROUP BY csat_score
  ) d;

  -- ===== FUNNEL (por ticket / ultima entrada; escopo ORIGEM via lead) =====
  WITH entries AS (
    SELECT h.ticket_id, h.new_stage_id AS stage_id, MAX(h.changed_at) AS last_entry
    FROM lead_stage_history h
    JOIN leads l ON l.id = h.lead_id
    WHERE h.clinic_id = p_clinic_id AND h.new_stage_id IS NOT NULL AND h.ticket_id IS NOT NULL
      AND (p_origin = 'todos'
        OR (p_origin = 'meta' AND l.source = 'meta_ads')
        OR (p_origin = 'google' AND l.source = 'google_ads')
        OR (p_origin = 'sem_origem' AND (l.source IS NULL OR l.source NOT IN ('meta_ads', 'google_ads'))))
    GROUP BY h.ticket_id, h.new_stage_id
  ),
  counts AS (
    SELECT stage_id, COUNT(*)::int AS leads
    FROM entries
    WHERE last_entry::date BETWEEN p_date_from AND p_date_to
    GROUP BY stage_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'stage_id', fs.id, 'name', fs.name, 'slug', fs.slug,
    'position', fs.position, 'is_conversion', fs.is_conversion,
    'color', fs.color, 'leads', COALESCE(c.leads, 0)) ORDER BY fs.position), '[]'::jsonb)
  INTO v_funnel
  FROM funnel_stages fs
  LEFT JOIN counts c ON c.stage_id = fs.id
  WHERE fs.clinic_id = p_clinic_id;

  -- ===== DAILY SERIES (escopo ORIGEM; appointments tambem por AGENTE) =====
  WITH dates AS (SELECT generate_series(p_date_from, p_date_to, interval '1 day')::date AS d),
  msgs AS (
    SELECT cm.created_at::date AS d,
      COUNT(*) FILTER (WHERE cm.sender = 'ai') AS ai_msgs,
      COUNT(*) FILTER (WHERE cm.sender = 'human' AND cm.direction = 'outbound') AS human_msgs
    FROM chat_messages cm
    LEFT JOIN leads l ON l.id = cm.lead_id
    WHERE cm.clinic_id = p_clinic_id AND cm.created_at::date BETWEEN p_date_from AND p_date_to
      AND (p_origin = 'todos'
        OR (p_origin = 'meta' AND l.source = 'meta_ads')
        OR (p_origin = 'google' AND l.source = 'google_ads')
        OR (p_origin = 'sem_origem' AND (l.source IS NULL OR l.source NOT IN ('meta_ads', 'google_ads'))))
    GROUP BY 1
  ),
  ld AS (
    SELECT created_at::date AS d, COUNT(*) AS leads FROM leads
    WHERE clinic_id = p_clinic_id AND created_at::date BETWEEN p_date_from AND p_date_to
      AND (p_origin = 'todos'
        OR (p_origin = 'meta' AND source = 'meta_ads')
        OR (p_origin = 'google' AND source = 'google_ads')
        OR (p_origin = 'sem_origem' AND (source IS NULL OR source NOT IN ('meta_ads', 'google_ads'))))
    GROUP BY 1
  ),
  ap AS (
    SELECT a.created_at::date AS d, COUNT(*) AS appts FROM appointments a
    LEFT JOIN tickets t ON t.id = a.ticket_id
    LEFT JOIN leads l ON l.id = t.lead_id
    WHERE a.clinic_id = p_clinic_id AND a.created_at::date BETWEEN p_date_from AND p_date_to
      AND (p_agent = 'todos' OR (p_agent = 'ia' AND a.source = 'ia') OR (p_agent = 'humano' AND a.source = 'manual'))
      AND (p_origin = 'todos'
        OR (p_origin = 'meta' AND l.source = 'meta_ads')
        OR (p_origin = 'google' AND l.source = 'google_ads')
        OR (p_origin = 'sem_origem' AND (l.source IS NULL OR l.source NOT IN ('meta_ads', 'google_ads'))))
    GROUP BY 1
  ),
  hd AS (
    SELECT handoff_triggered_at::date AS d, COUNT(*) AS handoffs FROM leads
    WHERE clinic_id = p_clinic_id AND handoff_triggered_at IS NOT NULL
      AND handoff_triggered_at::date BETWEEN p_date_from AND p_date_to
      AND (p_origin = 'todos'
        OR (p_origin = 'meta' AND source = 'meta_ads')
        OR (p_origin = 'google' AND source = 'google_ads')
        OR (p_origin = 'sem_origem' AND (source IS NULL OR source NOT IN ('meta_ads', 'google_ads'))))
    GROUP BY 1
  ),
  fu AS (
    SELECT al.triggered_at::date AS d, COUNT(*) AS followups FROM automation_logs al
    LEFT JOIN leads l ON l.id = al.lead_id
    WHERE al.clinic_id = p_clinic_id AND al.type = 'followup' AND al.status = 'sent'
      AND al.triggered_at::date BETWEEN p_date_from AND p_date_to
      AND (p_origin = 'todos'
        OR (p_origin = 'meta' AND l.source = 'meta_ads')
        OR (p_origin = 'google' AND l.source = 'google_ads')
        OR (p_origin = 'sem_origem' AND (l.source IS NULL OR l.source NOT IN ('meta_ads', 'google_ads'))))
    GROUP BY 1
  )
  SELECT jsonb_agg(jsonb_build_object(
    'date', to_char(dates.d, 'YYYY-MM-DD'),
    'aiMessages', COALESCE(m.ai_msgs, 0),
    'humanMessages', COALESCE(m.human_msgs, 0),
    'leads', COALESCE(l.leads, 0),
    'appointments', COALESCE(a.appts, 0),
    'handoffs', COALESCE(h.handoffs, 0),
    'followups', COALESCE(f.followups, 0)) ORDER BY dates.d)
  INTO v_daily
  FROM dates
  LEFT JOIN msgs m ON m.d = dates.d
  LEFT JOIN ld l ON l.d = dates.d
  LEFT JOIN ap a ON a.d = dates.d
  LEFT JOIN hd h ON h.d = dates.d
  LEFT JOIN fu f ON f.d = dates.d;

  RETURN jsonb_build_object(
    'agent', p_agent,
    'origin', p_origin,
    'agents', jsonb_build_object(
      'ia', jsonb_build_object(
        'messagesOut', COALESCE(v_ia_msgs, 0),
        'leadsTouched', COALESCE(v_ia_leads_touched, 0),
        'appointments', COALESCE(v_appt_ia, 0),
        'leadsEnabled', COALESCE(v_ia_enabled, 0),
        'autonomous', COALESCE(v_ia_autonomous, 0),
        'handoffs', COALESCE(v_handoffs, 0)
      ),
      'humano', jsonb_build_object(
        'messagesOut', COALESCE(v_human_msgs, 0),
        'leadsTouched', COALESCE(v_human_leads_touched, 0),
        'appointments', COALESCE(v_appt_manual, 0),
        'handoffsReceived', COALESCE(v_handoffs, 0)
      ),
      'sistema', jsonb_build_object(
        'automations', COALESCE(v_auto, '{}'::jsonb)
      )
    ),
    'messages', jsonb_build_object(
      'inbound', COALESCE(v_inbound_msgs, 0),
      'total', COALESCE(v_total_msgs, 0)
    ),
    'appointments', jsonb_build_object(
      'total', COALESCE(v_appt_total, 0),
      'ia', COALESCE(v_appt_ia, 0),
      'manual', COALESCE(v_appt_manual, 0),
      'byStatus', COALESCE(v_appt_status, '{}'::jsonb)
    ),
    'sla', jsonb_build_object(
      'breaches', COALESCE(v_sla_breaches, 0),
      'pending', COALESCE(v_pending, 0),
      'avgFirstResponseMin', ROUND(COALESCE(v_avg_first_response, 0), 1),
      'medianFirstResponseMin', ROUND(COALESCE(v_median_first_response, 0), 1),
      'slaMinutes', COALESCE(v_sla_minutes, 0)
    ),
    'finance', jsonb_build_object(
      'revenue', COALESCE(v_revenue, 0),
      'investment', COALESCE(v_investment, 0),
      'investmentTotal', COALESCE(v_investment_total, 0),
      'convertedValue', COALESCE(v_converted_value, 0),
      'salesCycleDays', ROUND(COALESCE(v_sales_cycle, 0), 1),
      'attendedConsults', COALESCE(v_attended_consults, 0)
    ),
    'outcomes', jsonb_build_object('won', COALESCE(v_won, 0), 'lost', COALESCE(v_lost, 0)),
    'csat', jsonb_build_object(
      'type', COALESCE(v_csat_type, 'csat'),
      'answered', COALESCE(v_csat_answered, 0),
      'avg', v_csat_avg,
      'distribution', COALESCE(v_csat_dist, '[]'::jsonb)
    ),
    'funnel', COALESCE(v_funnel, '[]'::jsonb),
    'daily', COALESCE(v_daily, '[]'::jsonb),
    'totalLeads', COALESCE(v_total_leads, 0),
    'newLeads', COALESCE(v_new_leads, 0)
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_commercial_dashboard(uuid, date, date, text, text) TO authenticated;
