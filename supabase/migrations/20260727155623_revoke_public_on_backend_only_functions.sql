-- URGENTE: tira do alcance do cliente três funções que o PostgREST expunha a `anon`.
--
-- Descoberto ao investigar por que os REVOKE da migration 20260727155243 não tinham funcionado:
-- no Postgres TODA função nasce com EXECUTE para **PUBLIC**, e este schema nunca revogou. O efeito
-- não se limitava aos `_impl` �?" vale para praticamente todo `public.*`.
--
-- VERIFICADO em produção (27/07), como `set role anon` com JWT `{"role":"anon"}`:
--
--   1. fn_outbound_token(<clinica conectada>, 'clinic')  -> devolveu token de 36 caracteres.
--      �? o **api_token da uazapi**: quem o tem lê e envia WhatsApp da clínica, com pacientes reais.
--      Vazamento de CREDENCIAL, não de dado. fn_clinic_send_token é a irmã interna, mesma coisa.
--
--   2. sandbox_send(...) -> SECURITY DEFINER e sem checagem de acesso nenhuma.
--
--   3. send_clinic_report(...) -> tem guard, mas no formato `if auth.uid() is not null then ...`,
--      que é FAIL-OPEN: `anon` tem auth.uid() nulo, pula a checagem inteira e dispara o envio do
--      relatório pelo WhatsApp da org. (�? o mesmo vício que a migration 20260727155757 corrige em
--      assert_clinic_access. Aqui o REVOKE resolve o alcance; o guard em si segue fail-open e está
--      anotado como pendência.)
--
-- Nada disto foi introduzido pelas migrations desta semana: é anterior. Mas foi confirmado agora e
-- não dá para deixar aberto.
--
-- QUEM CHAMA (levantado antes de revogar, para não quebrar nada):
--   fn_outbound_token / fn_clinic_send_token -> só edge `emissor-worker` e `chat-send` (service_role)
--   sandbox_send                             -> só edge `ai-sandbox` (service_role)
--   send_clinic_report                       -> front (ComercialDashboard.tsx, ReportQuick.tsx),
--                                               autenticado; por isso `authenticated` é mantido.
--
-- N�fO estão nesta migration, porque foram verificadas e JÁ estão protegidas por
-- `IF NOT is_super_admin() THEN RAISE 'forbidden'`: set_meta_cloud_secret, delete_meta_cloud_secret,
-- meta_cloud_secrets_status.

-- 1. Credenciais de envio: exclusivas do backend --------------------------------
revoke all on function public.fn_outbound_token(uuid, text) from public, anon, authenticated;
grant execute on function public.fn_outbound_token(uuid, text) to service_role;

revoke all on function public.fn_clinic_send_token(uuid) from public, anon, authenticated;
grant execute on function public.fn_clinic_send_token(uuid) to service_role;

-- 2. Envio do simulador: exclusivo do backend -----------------------------------
revoke all on function public.sandbox_send(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.sandbox_send(uuid, uuid, text, text, text) to service_role;

-- 3. Relatório por WhatsApp: o front usa autenticado; anon fora -----------------
revoke all on function public.send_clinic_report(uuid, text, date, date, date, date, date, date, text) from public, anon;
grant execute on function public.send_clinic_report(uuid, text, date, date, date, date, date, date, text) to authenticated, service_role;
