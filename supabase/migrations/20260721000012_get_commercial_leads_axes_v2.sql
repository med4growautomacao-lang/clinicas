CREATE OR REPLACE FUNCTION public.get_commercial_leads(
  p_clinic_id uuid,
  p_entry_from date,
  p_entry_to date,
  p_conv_from date,
  p_conv_to date,
  p_agent text DEFAULT 'todos'::text,
  p_origin text DEFAULT 'todos'::text,
  p_limit integer DEFAULT 20,
  p_offset integer DEFAULT 0,
  p_channel text DEFAULT 'todos'::text,
  p_metric text DEFAULT 'todos'::text,
  p_agenda_from date DEFAULT NULL::date,
  p_agenda_to date DEFAULT NULL::date,
  p_sort text DEFAULT 'entrada'::text,
  p_sort_dir text DEFAULT 'desc'::text,
  p_outcome text DEFAULT 'ambos'::text,
  p_loss_reasons text DEFAULT NULL::text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_total int;
  v_rows jsonb;
  v_metric_count int;
BEGIN
  WITH base AS (
    SELECT l.id, l.name, l.phone, l.source, l.estimated_value,
           l.created_at, l.last_message_at, l.ai_enabled, l.stage_id,
           ap.status AS appt_status, ap.date AS appt_date
    FROM leads l
    LEFT JOIN LATERAL (
      -- Consulta mais recente do lead dentro das janelas ativas (badge + ordenação)
      SELECT a.status, a.date
      FROM appointments a JOIN tickets t2 ON t2.id = a.ticket_id
      WHERE t2.lead_id = l.id AND a.clinic_id = p_clinic_id
        AND (p_conv_from   IS NULL OR a.date >= p_conv_from)
        AND (p_conv_to     IS NULL OR a.date <= p_conv_to)
        AND (p_agenda_from IS NULL OR a.created_at::date >= p_agenda_from)
        AND (p_agenda_to   IS NULL OR a.created_at::date <= p_agenda_to)
        AND (p_agent = 'todos' OR (p_agent = 'ia' AND a.source = 'ia') OR (p_agent = 'humano' AND a.source = 'manual'))
      ORDER BY a.date DESC
      LIMIT 1
    ) ap ON true
    WHERE l.clinic_id = p_clinic_id
      AND (p_entry_from IS NULL OR l.created_at::date >= p_entry_from)
      AND (p_entry_to   IS NULL OR l.created_at::date <= p_entry_to)
      AND COALESCE(l.is_not_lead, false) = false
      AND (p_origin = 'todos'
        OR (CASE WHEN l.source = 'meta_ads' THEN 'meta' WHEN l.source = 'google_ads' THEN 'google' WHEN l.source = 'balcao' THEN 'balcao' ELSE 'sem_origem' END) = ANY(string_to_array(p_origin, ',')))
      AND (p_channel = 'todos' OR l.capture_channel = ANY(string_to_array(p_channel, ',')))
      -- Agente: mensagens são atividade operacional — eixo Agendado (mesmo eixo
      -- de get_commercial_dashboard), não Conversão.
      AND (p_agent = 'todos' OR EXISTS (
        SELECT 1 FROM chat_messages cm
        WHERE cm.lead_id = l.id AND cm.clinic_id = p_clinic_id
          AND (p_agenda_from IS NULL OR cm.created_at::date >= p_agenda_from)
          AND (p_agenda_to   IS NULL OR cm.created_at::date <= p_agenda_to)
          AND ((p_agent = 'ia'     AND cm.sender = 'ai')
            OR (p_agent = 'humano' AND cm.sender = 'human' AND cm.direction = 'outbound'))
      ))
      -- Toggle Ganho/Perdido/Ambos — eixo Conversão (outcome_at). Seletor de
      -- motivo (só ativo com p_outcome='perdido') recorta ainda mais.
      AND (p_outcome = 'ambos' OR EXISTS (
        SELECT 1 FROM tickets t3
        WHERE t3.lead_id = l.id AND t3.clinic_id = p_clinic_id AND t3.outcome = p_outcome
          AND (p_conv_from IS NULL OR COALESCE(t3.outcome_at, t3.closed_at)::date >= p_conv_from)
          AND (p_conv_to   IS NULL OR COALESCE(t3.outcome_at, t3.closed_at)::date <= p_conv_to)
          AND (p_loss_reasons IS NULL OR btrim(p_loss_reasons) = '' OR p_outcome <> 'perdido'
            OR COALESCE(NULLIF(t3.loss_reason, ''), '(sem motivo registrado)') = ANY(string_to_array(p_loss_reasons, ',')))
      ))
      -- Recorte por métrica de agendamento OU por perdido (drill-down das métricas do topo)
      AND (
        p_metric = 'todos'
        OR (p_metric = 'perdidos' AND EXISTS (
          SELECT 1 FROM tickets t4
          WHERE t4.lead_id = l.id AND t4.clinic_id = p_clinic_id AND t4.outcome = 'perdido'
            AND (p_conv_from IS NULL OR COALESCE(t4.outcome_at, t4.closed_at)::date >= p_conv_from)
            AND (p_conv_to   IS NULL OR COALESCE(t4.outcome_at, t4.closed_at)::date <= p_conv_to)
            AND (p_loss_reasons IS NULL OR btrim(p_loss_reasons) = ''
              OR COALESCE(NULLIF(t4.loss_reason, ''), '(sem motivo registrado)') = ANY(string_to_array(p_loss_reasons, ',')))
        ))
        OR (p_metric IN ('gerados', 'realizadas', 'marcados') AND EXISTS (
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
      )
  ),
  ranked AS (
    SELECT b.*, COUNT(*) OVER() AS total_count,
      ROW_NUMBER() OVER (ORDER BY
        CASE WHEN p_sort = 'entrada'    AND p_sort_dir = 'asc'  THEN b.created_at      END ASC  NULLS LAST,
        CASE WHEN p_sort = 'entrada'    AND p_sort_dir = 'desc' THEN b.created_at      END DESC NULLS LAST,
        CASE WHEN p_sort = 'ultima_msg' AND p_sort_dir = 'asc'  THEN b.last_message_at END ASC  NULLS LAST,
        CASE WHEN p_sort = 'ultima_msg' AND p_sort_dir = 'desc' THEN b.last_message_at END DESC NULLS LAST,
        CASE WHEN p_sort = 'consulta'   AND p_sort_dir = 'asc'  THEN b.appt_date       END ASC  NULLS LAST,
        CASE WHEN p_sort = 'consulta'   AND p_sort_dir = 'desc' THEN b.appt_date       END DESC NULLS LAST,
        CASE WHEN p_sort = 'valor'      AND p_sort_dir = 'asc'  THEN b.estimated_value END ASC  NULLS LAST,
        CASE WHEN p_sort = 'valor'      AND p_sort_dir = 'desc' THEN b.estimated_value END DESC NULLS LAST,
        CASE WHEN p_sort = 'nome'       AND p_sort_dir = 'asc'  THEN lower(b.name)      END ASC  NULLS LAST,
        CASE WHEN p_sort = 'nome'       AND p_sort_dir = 'desc' THEN lower(b.name)      END DESC NULLS LAST,
        b.created_at DESC NULLS LAST
      ) AS rn
    FROM base b
  ),
  page AS (
    SELECT * FROM ranked ORDER BY rn LIMIT p_limit OFFSET p_offset
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
      'apptStatus', p.appt_status,
      'apptDate', p.appt_date
    ) ORDER BY p.rn), '[]'::jsonb)
  INTO v_total, v_rows
  FROM page p
  LEFT JOIN funnel_stages fs ON fs.id = p.stage_id
  LEFT JOIN LATERAL (
    SELECT t.outcome FROM tickets t
    WHERE t.lead_id = p.id
    ORDER BY COALESCE(t.outcome_at, t.closed_at, t.created_at) DESC
    LIMIT 1
  ) tk ON true;

  -- Total por trás do recorte (reconcilia com o card clicado no dashboard).
  IF p_metric = 'todos' THEN
    v_metric_count := 0;
  ELSIF p_metric = 'perdidos' THEN
    -- COUNT(DISTINCT l.id): lead pode ter mais de 1 ticket perdido (reaberto e
    -- perdido de novo) — sem DISTINCT o JOIN duplica a contagem desse lead.
    SELECT COUNT(DISTINCT l.id) INTO v_metric_count
    FROM leads l
    JOIN tickets t4 ON t4.lead_id = l.id AND t4.clinic_id = p_clinic_id AND t4.outcome = 'perdido'
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
          AND (p_agenda_from IS NULL OR cm.created_at::date >= p_agenda_from)
          AND (p_agenda_to   IS NULL OR cm.created_at::date <= p_agenda_to)
          AND ((p_agent = 'ia'     AND cm.sender = 'ai')
            OR (p_agent = 'humano' AND cm.sender = 'human' AND cm.direction = 'outbound'))
      ))
      AND (p_conv_from IS NULL OR COALESCE(t4.outcome_at, t4.closed_at)::date >= p_conv_from)
      AND (p_conv_to   IS NULL OR COALESCE(t4.outcome_at, t4.closed_at)::date <= p_conv_to)
      AND (p_loss_reasons IS NULL OR btrim(p_loss_reasons) = ''
        OR COALESCE(NULLIF(t4.loss_reason, ''), '(sem motivo registrado)') = ANY(string_to_array(p_loss_reasons, ',')));
  ELSE
    -- COUNT(DISTINCT l.id): lead pode ter mais de 1 agendamento na janela (ex:
    -- reagendado) — sem DISTINCT o JOIN duplica a contagem desse lead.
    SELECT COUNT(DISTINCT l.id) INTO v_metric_count
    FROM leads l
    JOIN tickets t ON t.lead_id = l.id
    JOIN appointments a ON a.ticket_id = t.id AND a.clinic_id = p_clinic_id
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
          AND (p_agenda_from IS NULL OR cm.created_at::date >= p_agenda_from)
          AND (p_agenda_to   IS NULL OR cm.created_at::date <= p_agenda_to)
          AND ((p_agent = 'ia'     AND cm.sender = 'ai')
            OR (p_agent = 'humano' AND cm.sender = 'human' AND cm.direction = 'outbound'))
      ))
      AND (p_conv_from   IS NULL OR a.date >= p_conv_from)
      AND (p_conv_to     IS NULL OR a.date <= p_conv_to)
      AND (p_agenda_from IS NULL OR a.created_at::date >= p_agenda_from)
      AND (p_agenda_to   IS NULL OR a.created_at::date <= p_agenda_to)
      AND (p_agent = 'todos' OR (p_agent = 'ia' AND a.source = 'ia') OR (p_agent = 'humano' AND a.source = 'manual'))
      AND (p_metric = 'gerados'
        OR (p_metric = 'realizadas' AND a.status IN ('realizado','compareceu'))
        OR (p_metric = 'marcados'   AND a.status IN ('pendente','confirmado')));
  END IF;

  RETURN jsonb_build_object('total', COALESCE(v_total, 0), 'rows', COALESCE(v_rows, '[]'::jsonb), 'metricCount', COALESCE(v_metric_count, 0));
END;
$function$;

-- Assinatura ganhou p_outcome no final — muda a contagem de tipos posicionais
-- (15 -> 16), então precisa dropar o overload antigo pra não ficar ambíguo.
DROP FUNCTION IF EXISTS public.get_commercial_leads(uuid, date, date, date, date, text, text, integer, integer, text, text, date, date, text, text);
-- p_loss_reasons entrou depois (16 -> 17) — dropa esse overload intermediário também.
DROP FUNCTION IF EXISTS public.get_commercial_leads(uuid, date, date, date, date, text, text, integer, integer, text, text, date, date, text, text, text);
