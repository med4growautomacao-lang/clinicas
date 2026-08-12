-- Filtro por métrica de agendamento na lista "Leads do filtro" do Painel Comercial
-- (get_commercial_leads). Permite recortar a lista pelas principais métricas do topo:
--   'gerados'    = leads que geraram algum agendamento na janela
--   'realizadas' = leads com consulta realizada (status realizado/compareceu)
--   'marcados'   = leads com consulta marcada/futura (status pendente/confirmado)
-- Espelha as janelas do dashboard: a.date ∈ Conversão (p_conv_*) e
-- a.created_at ∈ Agenda (p_agenda_*); escopo por agente via appointments.source.
-- Também devolve por linha o status/data da consulta mais recente na janela (apptStatus/apptDate).
DROP FUNCTION IF EXISTS public.get_commercial_leads(uuid,date,date,date,date,text,text,integer,integer,text);

CREATE OR REPLACE FUNCTION public.get_commercial_leads(
  p_clinic_id uuid,
  p_entry_from date, p_entry_to date,
  p_conv_from date, p_conv_to date,
  p_agent text DEFAULT 'todos', p_origin text DEFAULT 'todos',
  p_limit int DEFAULT 20, p_offset int DEFAULT 0,
  p_channel text DEFAULT 'todos',
  p_metric text DEFAULT 'todos',
  p_agenda_from date DEFAULT NULL, p_agenda_to date DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_total int;
  v_rows jsonb;
BEGIN
  WITH base AS (
    SELECT l.id, l.name, l.phone, l.source, l.estimated_value,
           l.created_at, l.last_message_at, l.ai_enabled, l.stage_id
    FROM leads l
    WHERE l.clinic_id = p_clinic_id
      AND (p_entry_from IS NULL OR l.created_at::date >= p_entry_from)
      AND (p_entry_to   IS NULL OR l.created_at::date <= p_entry_to)
      AND COALESCE(l.is_not_lead, false) = false
      AND (p_origin = 'todos'
        OR (CASE WHEN l.source = 'meta_ads' THEN 'meta' WHEN l.source = 'google_ads' THEN 'google' WHEN l.source = 'balcao' THEN 'balcao' ELSE 'sem_origem' END) = ANY(string_to_array(p_origin, ',')))
      AND (p_channel = 'todos' OR l.capture_channel = ANY(string_to_array(p_channel, ',')))
      AND (p_agent = 'todos' OR EXISTS (
        SELECT 1 FROM chat_messages cm
        WHERE cm.lead_id = l.id AND cm.clinic_id = p_clinic_id
          AND (p_conv_from IS NULL OR cm.created_at::date >= p_conv_from)
          AND (p_conv_to   IS NULL OR cm.created_at::date <= p_conv_to)
          AND ((p_agent = 'ia'     AND cm.sender = 'ai')
            OR (p_agent = 'humano' AND cm.sender = 'human' AND cm.direction = 'outbound'))
      ))
      -- Recorte por métrica de agendamento (drill-down das métricas do topo)
      AND (p_metric = 'todos' OR EXISTS (
        SELECT 1 FROM appointments a
        JOIN tickets t ON t.id = a.ticket_id
        WHERE t.lead_id = l.id AND a.clinic_id = p_clinic_id
          AND (p_conv_from   IS NULL OR a.date >= p_conv_from)
          AND (p_conv_to     IS NULL OR a.date <= p_conv_to)
          AND (p_agenda_from IS NULL OR a.created_at::date >= p_agenda_from)
          AND (p_agenda_to   IS NULL OR a.created_at::date <= p_agenda_to)
          AND (p_agent = 'todos' OR (p_agent = 'ia' AND a.source = 'ia') OR (p_agent = 'humano' AND a.source = 'manual'))
          AND (p_metric = 'gerados'
            OR (p_metric = 'realizadas' AND a.status IN ('realizado','compareceu'))
            OR (p_metric = 'marcados'   AND a.status IN ('pendente','confirmado')))
      ))
  ),
  page AS (
    SELECT b.*, COUNT(*) OVER() AS total_count
    FROM base b
    ORDER BY b.created_at DESC NULLS LAST
    LIMIT p_limit OFFSET p_offset
  )
  SELECT
    COALESCE(MAX(p.total_count), 0),
    COALESCE(jsonb_agg(jsonb_build_object(
      'id', p.id,
      'name', p.name,
      'phone', p.phone,
      'source', p.source,
      'estimatedValue', p.estimated_value,
      'createdAt', p.created_at,
      'lastMessageAt', p.last_message_at,
      'aiEnabled', p.ai_enabled,
      'stageName', fs.name,
      'stageColor', fs.color,
      'isConversion', fs.is_conversion,
      'outcome', tk.outcome,
      'apptStatus', ap.status,
      'apptDate', ap.date
    ) ORDER BY p.created_at DESC NULLS LAST), '[]'::jsonb)
  INTO v_total, v_rows
  FROM page p
  LEFT JOIN funnel_stages fs ON fs.id = p.stage_id
  LEFT JOIN LATERAL (
    SELECT t.outcome FROM tickets t
    WHERE t.lead_id = p.id
    ORDER BY COALESCE(t.outcome_at, t.closed_at, t.created_at) DESC
    LIMIT 1
  ) tk ON true
  LEFT JOIN LATERAL (
    -- Consulta mais recente do lead dentro das janelas ativas (para o badge da linha)
    SELECT a.status, a.date
    FROM appointments a JOIN tickets t2 ON t2.id = a.ticket_id
    WHERE t2.lead_id = p.id AND a.clinic_id = p_clinic_id
      AND (p_conv_from   IS NULL OR a.date >= p_conv_from)
      AND (p_conv_to     IS NULL OR a.date <= p_conv_to)
      AND (p_agenda_from IS NULL OR a.created_at::date >= p_agenda_from)
      AND (p_agenda_to   IS NULL OR a.created_at::date <= p_agenda_to)
      AND (p_agent = 'todos' OR (p_agent = 'ia' AND a.source = 'ia') OR (p_agent = 'humano' AND a.source = 'manual'))
    ORDER BY a.date DESC
    LIMIT 1
  ) ap ON true;

  RETURN jsonb_build_object('total', COALESCE(v_total, 0), 'rows', COALESCE(v_rows, '[]'::jsonb));
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_commercial_leads(uuid,date,date,date,date,text,text,integer,integer,text,text,date,date) TO authenticated;
