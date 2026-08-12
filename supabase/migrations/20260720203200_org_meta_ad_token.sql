-- 20260720203200_org_meta_ad_token
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Token Meta de nivel-ORG (app da agencia; hoje o provisorio Med4grow, acesso de parceiro p/ metricas).
-- Fica na organizacao para as clinicas puxarem dele em vez de duplicar o mesmo token em cada uma.
-- Mesmo padrao (coluna) do google_ad_mcc_token, gerenciado pelo admin da org em Gestao Org > Config.
alter table public.organizations add column if not exists meta_ad_token text;
