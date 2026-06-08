-- O "Funil de Vendas" da tela de Marketing passou a ter filtro de CANAL
-- (Todos/Forms/WhatsApp), além do filtro de origem/plataforma já existente.
--
-- O RPC marketing_funnel_cohort agora retorna também a coluna `channel`
-- (forms vs whatsapp; manual/null caem em whatsapp, igual ao bucketing do
-- frontend). O filtro continua acontecendo no cliente (sem refetch ao trocar
-- Todos/Forms/WhatsApp). Somar os canais de uma etapa reproduz exatamente o
-- count anterior -> "Todos" continua igual.
--
-- ATENCAO: muda o shape de retorno (adiciona coluna channel). Requer o frontend
-- atualizado (useFunnelCohort + funnelData). Aplicar junto com o deploy do front.
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
