-- 20260722033342_fn_lead_matches_agent_helper
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

CREATE OR REPLACE FUNCTION public.fn_lead_matches_agent(p_lead_id uuid, p_clinic_id uuid, p_agent text)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT p_agent = 'todos' OR EXISTS (
    SELECT 1 FROM public.vw_lead_agent_class v
    WHERE v.lead_id = p_lead_id AND v.clinic_id = p_clinic_id AND v.agent = p_agent
  )
$$;
