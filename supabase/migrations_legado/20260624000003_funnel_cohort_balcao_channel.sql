-- Marketing: o funil (marketing_funnel_cohort) passa a separar BALCÃO como canal
-- próprio. Antes capture_channel='balcao' caía no ELSE 'whatsapp'. Shape de retorno
-- inalterado (coluna channel agora com 3 valores: forms / whatsapp / balcao).
-- "Todos" continua somando igual.
CREATE OR REPLACE FUNCTION public.marketing_funnel_cohort(p_clinic_id uuid, p_start date, p_end date)
 RETURNS TABLE(stage_id uuid, platform text, channel text, entry_date date, leads bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH entries AS (
    SELECT h.ticket_id,
           h.new_stage_id AS stage_id,
           CASE
             WHEN l.source = 'meta_ads'   THEN 'meta_ads'
             WHEN l.source = 'google_ads' THEN 'google_ads'
             ELSE 'no_track'
           END AS platform,
           CASE
             WHEN l.capture_channel = 'forms'  THEN 'forms'
             WHEN l.capture_channel = 'balcao' THEN 'balcao'
             ELSE 'whatsapp'
           END AS channel,
           max(h.changed_at) AS last_entry
    FROM lead_stage_history h
    JOIN leads l ON l.id = h.lead_id
    WHERE h.clinic_id = p_clinic_id
      AND h.new_stage_id IS NOT NULL
      AND h.ticket_id IS NOT NULL
      AND COALESCE(l.is_not_lead, false) = false
    GROUP BY h.ticket_id, h.new_stage_id, 3, 4
  )
  SELECT stage_id, platform, channel, (last_entry)::date AS entry_date, count(*)::bigint AS leads
  FROM entries
  WHERE last_entry::date BETWEEN p_start AND p_end
  GROUP BY stage_id, platform, channel, (last_entry)::date;
$function$;
