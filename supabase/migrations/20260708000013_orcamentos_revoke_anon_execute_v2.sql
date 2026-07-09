-- v1 (20260708000012, REVOKE ... FROM PUBLIC) não bastou: este projeto Supabase concede
-- EXECUTE a `anon` diretamente (default privilege do schema public, não via PUBLIC) —
-- confirmado que finalize_ticket/complete_production_order/move_ticket_keep_outcome têm o
-- mesmo padrão; só reopen_ticket já era anon-blocked. has_clinic_access() já barrava o
-- anon na prática (sem auth.uid()), mas fecha o achado do linter revogando explicitamente
-- do papel `anon`. Verificado com has_function_privilege() após aplicar: anon=false nas 4,
-- authenticated=true só nas 3 RPCs reais (fn_orcamento_revert_on_sale_lost é função de
-- trigger, ninguém deveria chamá-la via RPC).
REVOKE EXECUTE ON FUNCTION public.save_orcamento(uuid, uuid, uuid, text, text, text, text, numeric, numeric, numeric, numeric, date, date, text, text, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.update_orcamento_status(uuid, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.close_sale_from_orcamento(uuid, text, text, date, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_orcamento_revert_on_sale_lost() FROM anon, authenticated;
