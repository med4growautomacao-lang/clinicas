-- 20260613025818_advisors_security_cleanup
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- 1. booking_requests: idempotencia, so SECURITY DEFINER toca; deny-all via RLS.
ALTER TABLE public.booking_requests ENABLE ROW LEVEL SECURITY;
-- 2. merge_audit_2026_05_14: auditoria com patient_id; deny-all via RLS.
ALTER TABLE public.merge_audit_2026_05_14 ENABLE ROW LEVEL SECURITY;
-- 3. fn_handle_lead_uniqueness: fixa search_path.
ALTER FUNCTION public.fn_handle_lead_uniqueness() SET search_path = public;
