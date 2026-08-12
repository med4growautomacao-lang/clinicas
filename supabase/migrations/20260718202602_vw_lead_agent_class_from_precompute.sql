-- 20260718202602_vw_lead_agent_class_from_precompute
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- vw_lead_agent_class passa a ler a tabela PRÉ-CALCULADA (lead_kpi_attribution) em vez
-- de agregar chat_messages on-the-fly a cada chamada. Ganhos: (1) regra canônica nova
-- (1º agendamento → maioria de mensagens → não-atendido) em vez da regra antiga só-mensagens;
-- (2) get_dashboard_stats (que referencia esta view em CADA métrica) fica rápido.
-- Colunas idênticas (clinic_id, lead_id, agent) → consumidores não mudam.
create or replace view public.vw_lead_agent_class
with (security_invoker = true) as
select clinic_id, lead_id, agent
from public.lead_kpi_attribution;
