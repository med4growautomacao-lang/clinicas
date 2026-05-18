-- Funil de coorte para a tela de marketing: dos leads CRIADOS no periodo,
-- conta quantos ENTRARAM em cada etapa (via lead_stage_history) = "alcancou a etapa X".
-- Modelo padrao de mercado (HubSpot/Salesforce/Pipedrive): coorte por data de entrada + historico.
-- SECURITY INVOKER (padrao): a RLS de lead_stage_history/leads ja escopa por clinica.
CREATE OR REPLACE FUNCTION public.marketing_funnel_cohort(
  p_clinic_id uuid,
  p_start date,
  p_end date
)
RETURNS TABLE(stage_id uuid, leads bigint)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT h.new_stage_id, count(DISTINCT h.lead_id)
  FROM lead_stage_history h
  JOIN leads l ON l.id = h.lead_id
  WHERE h.clinic_id = p_clinic_id
    AND l.clinic_id = p_clinic_id
    AND h.new_stage_id IS NOT NULL
    AND l.created_at::date BETWEEN p_start AND p_end
  GROUP BY h.new_stage_id;
$$;

GRANT EXECUTE ON FUNCTION public.marketing_funnel_cohort(uuid, date, date) TO authenticated;
