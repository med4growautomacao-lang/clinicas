-- Visão Geral: get_dashboard_stats ganha os filtros de CANAL (p_channel) e
-- AGENTE (p_agent), além do de ORIGEM já existente. Ambos com DEFAULT 'todos'
-- => chamadas antigas (4 args) seguem funcionando.
--
--   - p_channel filtra métricas baseadas em lead por leads.capture_channel
--     (forms / whatsapp / balcao), igual ao painel Comercial (20260623000002).
--   - p_agent filtra por vw_lead_agent_class (IA / Humano).
--   - Investimento (marketing_data) NÃO tem canal/agente -> usa `platform`,
--     então não casa com a injeção e fica inalterado (ROAS herda isso).
--
-- Estratégia: pega a definição viva e injeta os dois predicados logo após CADA
-- bloco de origem baseado em lead (alias l.source). Os blocos de investimento
-- usam `platform` e por isso não são afetados.
DO $do$
DECLARE src text;
BEGIN
  src := pg_get_functiondef('public.get_dashboard_stats(uuid,date,date,text)'::regprocedure);

  -- 1) assinatura: adiciona p_channel e p_agent
  src := replace(src,
    $sig$p_origin text DEFAULT 'todos'::text)$sig$,
    $sig$p_origin text DEFAULT 'todos'::text, p_channel text DEFAULT 'todos'::text, p_agent text DEFAULT 'todos'::text)$sig$);

  -- 2) injeta canal + agente após cada bloco de origem baseado em lead
  src := replace(src,
    $blk$OR (p_origin = 'sem_origem' AND (l.source IS NULL OR l.source NOT IN ('meta_ads', 'google_ads', 'balcao'))))$blk$,
    $blk$OR (p_origin = 'sem_origem' AND (l.source IS NULL OR l.source NOT IN ('meta_ads', 'google_ads', 'balcao'))))
    AND (p_channel = 'todos' OR l.capture_channel = p_channel)
    AND (p_agent = 'todos' OR EXISTS (SELECT 1 FROM public.vw_lead_agent_class v WHERE v.lead_id = l.id AND v.clinic_id = p_clinic_id AND v.agent = p_agent))$blk$);

  EXECUTE src;
END $do$;

-- remove a sobrecarga antiga (4 args) p/ evitar ambiguidade com a nova (defaults)
DROP FUNCTION IF EXISTS public.get_dashboard_stats(uuid,date,date,text);
