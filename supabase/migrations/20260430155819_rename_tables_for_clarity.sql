-- 20260430155819_rename_tables_for_clarity
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

ALTER TABLE public.users RENAME TO clinic_users;
ALTER TABLE public.clinic_members RENAME TO org_clinic_assignments;
