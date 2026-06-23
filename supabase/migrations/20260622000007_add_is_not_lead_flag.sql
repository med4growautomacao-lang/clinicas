-- "Não Lead": marca um registro como NÃO sendo uma oportunidade real.
-- Efeito: sai do funil (Kanban) e da lista de Conversas, não conta em métrica
-- (ver 20260622000008_metrics_exclude_not_lead.sql) e a IA/follow-up são
-- desligados para o lead (ai_enabled/followup_enabled = false, feito no frontend).
-- Totalmente reversível ("Tornar Lead" religa as chaves e zera o not_lead_at).
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS is_not_lead boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS not_lead_at timestamptz;

-- O painel "Não Leads" busca poucos registros por clínica, ordenados por quando
-- foram marcados; índice parcial cobre exatamente essa query.
CREATE INDEX IF NOT EXISTS idx_leads_not_lead
  ON public.leads (clinic_id, not_lead_at DESC) WHERE is_not_lead;
