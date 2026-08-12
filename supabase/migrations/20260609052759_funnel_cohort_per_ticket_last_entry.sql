-- 20260609052759_funnel_cohort_per_ticket_last_entry
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Funil de Vendas passa a contar POR TICKET (ciclo), não por lead.
-- Regra: cada ticket conta 1 vez por etapa; a data que vale é a ÚLTIMA entrada
-- naquela etapa (dentro do ciclo). Ticket novo (após fechar) conta de novo.
-- Mantém platform + channel (filtros no cliente). Shape de retorno inalterado.
DROP FUNCTION IF EXISTS public.marketing_funnel_cohort(uuid, date, date);

CREATE FUNCTION public.marketing_funnel_cohort(
  p_clinic_id uuid,
  p_start date,
  p_end date
)
RETURNS TABLE(stage_id uuid, platform text, channel text, leads bigint)
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
           max(h.changed_at) AS last_entry   -- última vez que ESTE ticket entrou nesta etapa
    FROM lead_stage_history h
    JOIN leads l ON l.id = h.lead_id
    WHERE h.clinic_id = p_clinic_id
      AND h.new_stage_id IS NOT NULL
      AND h.ticket_id IS NOT NULL
    GROUP BY h.ticket_id, h.new_stage_id, 3, 4
  )
  SELECT stage_id, platform, channel, count(*)::bigint AS leads   -- 1 por (ticket, etapa)
  FROM entries
  WHERE last_entry::date BETWEEN p_start AND p_end                 -- período pela última entrada
  GROUP BY stage_id, platform, channel;
$$;

GRANT EXECUTE ON FUNCTION public.marketing_funnel_cohort(uuid, date, date) TO authenticated;
