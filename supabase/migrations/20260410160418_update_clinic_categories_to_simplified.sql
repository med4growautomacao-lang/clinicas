-- 20260410160418_update_clinic_categories_to_simplified
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

UPDATE clinics SET category = 'clinica' WHERE category != 'outro' OR category IS NULL;
