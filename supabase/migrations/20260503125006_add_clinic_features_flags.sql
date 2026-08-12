-- 20260503125006_add_clinic_features_flags
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

ALTER TABLE public.clinics 
ADD COLUMN IF NOT EXISTS features jsonb DEFAULT '{"feature_followup": true, "feature_ia": true}'::jsonb;

-- Atualiza clínicas existentes com o default
UPDATE public.clinics 
SET features = '{"feature_followup": true, "feature_ia": true}'::jsonb
WHERE features IS NULL;
