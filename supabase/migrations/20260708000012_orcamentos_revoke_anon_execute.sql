-- Fecha o achado do Supabase security advisor (anon/authenticated_security_definer_function_
-- executable) nas funções novas de orçamentos. has_clinic_access() já barrava o `anon` na
-- prática (sem auth.uid(), a checagem falha), mas o Postgres concede EXECUTE a PUBLIC por
-- padrão — revoga explicitamente e deixa só `authenticated` chamar as RPCs de escrita.
-- fn_orcamento_revert_on_sale_lost é função de TRIGGER; não deve ser invocável via RPC.
REVOKE EXECUTE ON FUNCTION public.save_orcamento(uuid, uuid, uuid, text, text, text, text, numeric, numeric, numeric, numeric, date, date, text, text, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_orcamento_status(uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.close_sale_from_orcamento(uuid, text, text, date, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_orcamento_revert_on_sale_lost() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.save_orcamento(uuid, uuid, uuid, text, text, text, text, numeric, numeric, numeric, numeric, date, date, text, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_orcamento_status(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_sale_from_orcamento(uuid, text, text, date, text) TO authenticated;
