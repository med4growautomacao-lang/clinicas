-- 20260613010503_find_patient_by_phone
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

CREATE OR REPLACE FUNCTION public.find_patient_by_phone(p_clinic_id uuid, p_phone text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT jsonb_build_object(
    'canonical_phone', normalize_br_phone(p_phone),
    'patient', (SELECT to_jsonb(x) FROM (
        SELECT id, name, cpf, created_at FROM patients
        WHERE clinic_id = p_clinic_id AND normalize_br_phone(phone) = normalize_br_phone(p_phone)
        LIMIT 1) x)
  );
$$;
