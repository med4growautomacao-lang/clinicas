-- fn_enqueue_meta_capi_event é função de TRIGGER: dispara pelo mecanismo de trigger,
-- não precisa de EXECUTE concedido a ninguém. Revogar fecha a superfície de chamada direta
-- (o advisor de segurança acusava "anon pode executar SECURITY DEFINER"). O trigger segue firing.
REVOKE ALL ON FUNCTION public.fn_enqueue_meta_capi_event() FROM PUBLIC, anon, authenticated;
