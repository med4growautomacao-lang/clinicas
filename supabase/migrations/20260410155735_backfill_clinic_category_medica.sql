-- 20260410155735_backfill_clinic_category_medica
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

UPDATE clinics SET category = 'clinica_medica' WHERE category IS NULL;
