-- 20260408131556_whatsapp_instances_sp_view
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

CREATE OR REPLACE VIEW whatsapp_instances_sp AS
SELECT
  id,
  clinic_id,
  clinic_name,
  api_id,
  api_token,
  phone_number,
  status,
  qr_code,
  connect_token,
  connected_at AT TIME ZONE 'America/Sao_Paulo' AS connected_at
FROM whatsapp_instances;
