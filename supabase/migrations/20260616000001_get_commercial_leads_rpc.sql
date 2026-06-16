-- Lista de leads por trás dos números do Painel Comercial (drill-down).
-- Mesma POPULAÇÃO do KPI "Leads" (get_commercial_dashboard, Opção 1):
--   coorte por ENTRADA (leads.created_at) + ORIGEM (source);
--   quando p_agent = 'ia'/'humano', exige mensagem daquele agente na janela de
--   CONVERSÃO (mesma definição de leadsTouched) — então a contagem bate com o card.
-- Paginação via p_limit/p_offset; retorna { total, rows[] }.
DROP FUNCTION IF EXISTS public.get_commercial_leads(uuid, date, date, date, date, text, text, int, int);

CREATE OR REPLACE FUNCTION public.get_commercial_leads(
  p_clinic_id uuid,
  p_entry_from date, p_entry_to date,
  p_conv_from date, p_conv_to date,
  p_agent text DEFAULT 'todos', p_origin text DEFAULT 'todos',
  p_limit int DEFAULT 20, p_offset int DEFAULT 0
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
      AND (p_origin = 'todos'
        OR (p_origin = 'meta'   AND l.source = 'meta_ads')
        OR (p_origin = 'google' AND l.source = 'google_ads')
        OR (p_origin = 'sem_origem' AND (l.source IS NULL OR l.source NOT IN ('meta_ads', 'google_ads'))))
      AND (p_agent = 'todos' OR EXISTS (
        SELECT 1 FROM chat_messages cm
        WHERE cm.lead_id = l.id AND cm.clinic_id = p_clinic_id
          AND (p_conv_from IS NULL OR cm.created_at::date >= p_conv_from)
          AND (p_conv_to   IS NULL OR cm.created_at::date <= p_conv_to)
          AND ((p_agent = 'ia'     AND cm.sender = 'ai')
            OR (p_agent = 'humano' AND cm.sender = 'human' AND cm.direction = 'outbound'))
      ))
  ),
  -- COUNT(*) OVER() roda antes do LIMIT → total da coorte inteira em cada linha da página
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
      'outcome', tk.outcome
    ) ORDER BY p.created_at DESC NULLS LAST), '[]'::jsonb)
  INTO v_total, v_rows
  FROM page p
  LEFT JOIN funnel_stages fs ON fs.id = p.stage_id
  LEFT JOIN LATERAL (
    SELECT t.outcome FROM tickets t
    WHERE t.lead_id = p.id
    ORDER BY COALESCE(t.outcome_at, t.closed_at, t.created_at) DESC
    LIMIT 1
  ) tk ON true;

  RETURN jsonb_build_object('total', COALESCE(v_total, 0), 'rows', COALESCE(v_rows, '[]'::jsonb));
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_commercial_leads(uuid, date, date, date, date, text, text, int, int) TO authenticated;
