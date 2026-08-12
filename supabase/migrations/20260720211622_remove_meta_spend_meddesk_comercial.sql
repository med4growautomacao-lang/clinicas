-- 20260720211622_remove_meta_spend_meddesk_comercial
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Remove dados de investimento Meta da clínica "MedDesk Comercial" e desconecta a conta de anúncios
-- para o cron de spend-sync parar de recadastrar.
delete from marketing_data
where clinic_id = '389e2eef-2bf5-4f2c-a260-56fdbf443291'
  and platform = 'meta_ads';

update clinics
set meta_ad_account_id = null
where id = '389e2eef-2bf5-4f2c-a260-56fdbf443291';
