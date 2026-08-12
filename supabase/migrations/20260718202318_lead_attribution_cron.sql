-- 20260718202318_lead_attribution_cron
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Refresh da atribuição a cada 10min (refresh completo mede ~1,6s, off-path).
select cron.schedule('refresh_lead_attribution', '*/10 * * * *', 'select public.refresh_lead_attribution();');
