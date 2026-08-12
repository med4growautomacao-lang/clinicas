-- 20260608175445_funnel_cohort_by_channel
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

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
  SELECT h.new_stage_id,
         CASE
           WHEN l.source = 'meta_ads'   THEN 'meta_ads'
           WHEN l.source = 'google_ads' THEN 'google_ads'
           ELSE 'no_track'
         END AS platform,
         CASE
           WHEN l.capture_channel = 'forms' THEN 'forms'
           ELSE 'whatsapp'
         END AS channel,
         count(DISTINCT h.lead_id)
  FROM lead_stage_history h
  JOIN leads l ON l.id = h.lead_id
  WHERE h.clinic_id = p_clinic_id
    AND l.clinic_id = p_clinic_id
    AND h.new_stage_id IS NOT NULL
    AND l.created_at::date BETWEEN p_start AND p_end
  GROUP BY h.new_stage_id, 2, 3;
$$;

GRANT EXECUTE ON FUNCTION public.marketing_funnel_cohort(uuid, date, date) TO authenticated;
