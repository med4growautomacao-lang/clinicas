-- 20260312172610_add_qr_code_to_whatsapp_instances
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

ALTER TABLE public.whatsapp_instances ADD COLUMN IF NOT EXISTS qr_code TEXT;
COMMENT ON COLUMN public.whatsapp_instances.qr_code IS 'Base64 do QR Code para conexão WhatsApp';
