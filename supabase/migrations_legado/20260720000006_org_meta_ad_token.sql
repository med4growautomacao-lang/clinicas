-- Token Meta de nivel-ORG (app da agencia; hoje o provisorio Med4grow, acesso de parceiro p/ metricas).
-- Fica na organizacao para as clinicas puxarem dele em vez de duplicar o mesmo token em cada uma.
-- Mesmo padrao (coluna) do google_ad_mcc_token, gerenciado pelo admin da org em Gestao Org > Config.
-- Consumido por meta-spend-sync e spend-sync-cron: resolucao do token = clinica (override) -> org.
alter table public.organizations add column if not exists meta_ad_token text;
