-- 20260406195031_fix_lead_pedro_stage_to_forms
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Corrige o lead "Pedro" da clínica Vaz para a etapa "Contato via Forms"
UPDATE public.leads
SET stage_id = (
    SELECT id FROM public.funnel_stages
    WHERE clinic_id = (SELECT id FROM public.clinics WHERE name = 'Vaz')
      AND LOWER(name) LIKE '%forms%'
    ORDER BY position ASC
    LIMIT 1
)
WHERE id = 'a53c2405-944a-4f38-9093-636daa110215';
