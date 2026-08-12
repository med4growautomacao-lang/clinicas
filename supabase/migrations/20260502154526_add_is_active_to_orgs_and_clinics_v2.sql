-- 20260502154526_add_is_active_to_orgs_and_clinics_v2
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

ALTER TABLE public.organizations ADD COLUMN is_active boolean DEFAULT true;
ALTER TABLE public.clinics ADD COLUMN is_active boolean DEFAULT true;

-- Update RLS logic helper if needed, but for now let's just make it available in the UI.
-- We should also ensure that when an organization is deactivated, its clinics are effectively treated as inactive.;
