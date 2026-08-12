-- 20260330172316_clean_duplicate_leads
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Clean duplicates across all clinics
DELETE FROM public.leads 
WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY clinic_id, phone ORDER BY created_at ASC) as rnum
    FROM public.leads
  ) t
  WHERE t.rnum > 1
);

-- Add unique constraint
ALTER TABLE public.leads ADD CONSTRAINT leads_clinic_id_phone_key UNIQUE (clinic_id, phone);
