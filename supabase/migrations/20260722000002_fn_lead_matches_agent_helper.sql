-- Achado de altitude do code-review: o filtro "essa lead pertence a este
-- agente" (EXISTS ... vw_lead_agent_class) estava copiado à mão em 7+ blocos
-- de get_commercial_dashboard e mais 2 em get_commercial_leads. Já divergiu
-- 2 vezes (19/07, 21/07) porque não existia um único lugar pra editar.
CREATE OR REPLACE FUNCTION public.fn_lead_matches_agent(p_lead_id uuid, p_clinic_id uuid, p_agent text)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT p_agent = 'todos' OR EXISTS (
    SELECT 1 FROM public.vw_lead_agent_class v
    WHERE v.lead_id = p_lead_id AND v.clinic_id = p_clinic_id AND v.agent = p_agent
  )
$$;
