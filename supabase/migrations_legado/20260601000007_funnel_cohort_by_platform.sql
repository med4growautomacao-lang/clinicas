-- O "Funil de Vendas" da tela de Marketing nao acompanhava o filtro de origem
-- (Todos/Meta/Google/Sem Origem): o RPC marketing_funnel_cohort agregava sem
-- distinguir a plataforma do lead.
--
-- Correcao: o RPC passa a retornar a contagem por etapa E por plataforma
-- (origem normalizada igual ao getPlatformForLead do frontend). O filtro acontece
-- no cliente (sem refetch ao trocar Todos/Meta/Google/Sem Origem).
--
-- Como cada lead tem uma unica source, somar as plataformas de uma etapa reproduz
-- exatamente o count(DISTINCT lead_id) anterior -> "Todos" continua igual.
--
-- ATENCAO: muda o shape de retorno (adiciona coluna platform). Requer o frontend
-- atualizado (useFunnelCohort + funnelData). Aplicar junto com o deploy do front.
DROP FUNCTION IF EXISTS public.marketing_funnel_cohort(uuid, date, date);

CREATE FUNCTION public.marketing_funnel_cohort(
  p_clinic_id uuid,
  p_start date,
  p_end date
)
RETURNS TABLE(stage_id uuid, platform text, leads bigint)
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
         count(DISTINCT h.lead_id)
  FROM lead_stage_history h
  JOIN leads l ON l.id = h.lead_id
  WHERE h.clinic_id = p_clinic_id
    AND l.clinic_id = p_clinic_id
    AND h.new_stage_id IS NOT NULL
    AND l.created_at::date BETWEEN p_start AND p_end
  GROUP BY h.new_stage_id, 2;
$$;

GRANT EXECUTE ON FUNCTION public.marketing_funnel_cohort(uuid, date, date) TO authenticated;
