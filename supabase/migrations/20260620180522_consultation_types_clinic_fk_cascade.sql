-- 20260620180522_consultation_types_clinic_fk_cascade
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

ALTER TABLE public.consultation_types
  DROP CONSTRAINT consultation_types_clinic_id_fkey;

ALTER TABLE public.consultation_types
  ADD CONSTRAINT consultation_types_clinic_id_fkey
  FOREIGN KEY (clinic_id) REFERENCES public.clinics(id) ON DELETE CASCADE;
