-- Limpeza de advisors (security) apos a consolidacao do agendamento.
--
-- 1. booking_requests = tabela de idempotencia do book_appointment. Estava exposta via
--    PostgREST sem RLS (advisor: rls_disabled_in_public). So e tocada por funcoes
--    SECURITY DEFINER (book_appointment/convert_lead_to_appointment), que ignoram RLS, e
--    nunca pelo frontend (0 referencias em src/). Ativar RLS sem policies = deny-all:
--    bloqueia acesso direto anon/authenticated via API; as RPCs seguem funcionando.
ALTER TABLE public.booking_requests ENABLE ROW LEVEL SECURITY;

-- 2. merge_audit_2026_05_14 = tabela de auditoria de mesclagem (mai/2026), exposta sem RLS
--    e contendo patient_id (advisor: rls_disabled_in_public + sensitive_columns_exposed).
--    Tranca o acesso direto via API (deny-all). Auditoria nunca deve sair pela API publica.
ALTER TABLE public.merge_audit_2026_05_14 ENABLE ROW LEVEL SECURITY;

-- 3. fn_handle_lead_uniqueness = trigger de dedup de lead com search_path mutavel
--    (advisor: function_search_path_mutable). Fixa search_path = public (hygiene;
--    evita resolucao de nome ambigua / sequestro de search_path).
ALTER FUNCTION public.fn_handle_lead_uniqueness() SET search_path = public;
