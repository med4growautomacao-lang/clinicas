-- Fase -1 da Central de Orçamentos: sincroniza no repo 2 colunas que já existem no banco
-- remoto (aplicadas fora de banda via MCP, sem .sql local — confirmado no ledger remoto:
-- versões 20260707151049_product_quote_image_ids e 20260707172501_clinic_quote_show_total
-- não têm arquivo correspondente em supabase/migrations). Puramente idempotente: em produção
-- não altera nada (colunas já existem); garante que um ambiente novo/replay local termine
-- com o mesmo schema.
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS quote_image_ids uuid[];
ALTER TABLE public.clinics  ADD COLUMN IF NOT EXISTS quote_show_total boolean NOT NULL DEFAULT true;

-- Observação: também há drift remoto fora do domínio de orçamento (product_color_and_position,
-- production_pcp_module_search_path) — fora do escopo desta feature, não tratado aqui.
