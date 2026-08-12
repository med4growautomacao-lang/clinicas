-- 20260402005025_add_capture_channel
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Add capture_channel column to leads table
ALTER TABLE leads ADD COLUMN IF NOT EXISTS capture_channel text DEFAULT 'whatsapp';

-- Set capture_channel for all existing leads
UPDATE leads SET capture_channel = 'whatsapp' WHERE capture_channel IS NULL;

-- Migrate source values to new platform format
UPDATE leads SET source = 'meta_ads' WHERE source IN ('facebook_ads', 'instagram');
UPDATE leads SET source = 'google_ads' WHERE source = 'google';
UPDATE leads SET source = NULL WHERE source IN ('whatsapp', 'manual', 'indicacao', 'site');
