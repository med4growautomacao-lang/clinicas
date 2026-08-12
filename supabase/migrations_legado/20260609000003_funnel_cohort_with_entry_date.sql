-- Adiciona entry_date (data da última entrada na etapa, por ticket) ao retorno do RPC.
-- Permite que TODA a aba Marketing (cards, gráfico, tabela, funil) derive de UMA fonte só:
-- somar = cards/funil; bucketizar por período = gráfico/tabela. Mantém a regra por ticket /
-- última entrada / platform / channel.
DROP FUNCTION IF EXISTS public.marketing_funnel_cohort(uuid, date, date);

CREATE FUNCTION public.marketing_funnel_cohort(
  p_clinic_id uuid,
  p_start date,
  p_end date
)
RETURNS TABLE(stage_id uuid, platform text, channel text, entry_date date, leads bigint)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH entries AS (
    SELECT h.ticket_id,
           h.new_stage_id AS stage_id,
           CASE
             WHEN l.source = 'meta_ads'   THEN 'meta_ads'
             WHEN l.source = 'google_ads' THEN 'google_ads'
             ELSE 'no_track'
           END AS platform,
           CASE
             WHEN l.capture_channel = 'forms' THEN 'forms'
             ELSE 'whatsapp'
           END AS channel,
           max(h.changed_at) AS last_entry
    FROM lead_stage_history h
    JOIN leads l ON l.id = h.lead_id
    WHERE h.clinic_id = p_clinic_id
      AND h.new_stage_id IS NOT NULL
      AND h.ticket_id IS NOT NULL
    GROUP BY h.ticket_id, h.new_stage_id, 3, 4
  )
  SELECT stage_id, platform, channel, (last_entry)::date AS entry_date, count(*)::bigint AS leads
  FROM entries
  WHERE last_entry::date BETWEEN p_start AND p_end
  GROUP BY stage_id, platform, channel, (last_entry)::date;
$$;

GRANT EXECUTE ON FUNCTION public.marketing_funnel_cohort(uuid, date, date) TO authenticated;
