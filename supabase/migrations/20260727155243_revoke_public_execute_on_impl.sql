-- Correcao de falha de seguranca introduzida pelas migrations de 26/07 (as _tenant_guard).
--
-- O QUE EU ERREI: aquelas migrations "fecharam" o acesso dos `_impl` com
--     revoke all on function ... from anon, authenticated;
-- e isso nao fechou nada. O grant de EXECUTE chega por DOIS caminhos independentes:
--   1. `=X/postgres` no proacl, o PUBLIC que todo `create function` concede; e
--   2. `anon=X/postgres` / `authenticated=X/postgres`, grants NOMINAIS que vem do
--      `pg_default_acl` deste schema.
-- Revogar so dos roles nominais deixa o PUBLIC de pe; revogar so do PUBLIC deixa os nominais.
-- Tem que ser dos tres (`from public, anon, authenticated`), que e o que esta migration faz.
-- (A primeira versao deste comentario dizia que anon executava "por herdar de PUBLIC, nao por
-- grant proprio". Errado: aqui as funcoes carregam os dois. Corrigido em 20260727163000, que
-- ataca a raiz com `alter default privileges`.)
--
-- CONSEQUENCIA, verificada em producao hoje (27/07): o vazamento de PII que a migration
-- 20260726215206 dizia ter fechado seguia ABERTO, apenas com outro nome:
--     set role anon;
--     select ... from get_commercial_leads_impl('<intubacao>', ...)
--       -> total = 752, com `name` e `phone` preenchidos.
-- `get_commercial_leads_impl`, `get_dashboard_stats_impl` e `get_commercial_dashboard_impl` sao
-- SECURITY DEFINER e NAO tem guard (o guard mora no wrapper), entao bastava chamar o `_impl` pelo
-- PostgREST com a anon key para contornar `assert_clinic_access` por inteiro.
--
-- O que salvou os WRAPPERS foi o guard: eles tambem estavam com PUBLIC, mas `assert_clinic_access`
-- barra anon de qualquer forma. E exatamente a defesa em profundidade que a migration
-- 20260726214842 descreveu, e e o unico motivo de isto nao ter sido pior.
--
-- REGRA daqui em diante: `revoke all on function ... from public, anon, authenticated` e depois
-- `grant` para quem deve. E conferir sempre com has_function_privilege('anon', oid, 'EXECUTE'),
-- nunca so lendo o DDL da migration.

-- 1. _impl: fora do alcance de qualquer cliente ------------------------------------
-- (o wrapper alcança por ser SECURITY DEFINER, e service_role por grant nominal abaixo)
revoke all on function public.marketing_kpis_impl(uuid, date, date)                    from public, anon, authenticated;
revoke all on function public.marketing_funnel_cohort_impl(uuid, date, date)           from public, anon, authenticated;
revoke all on function public.marketing_utm_funnel_cohort_impl(uuid, date, date)       from public, anon, authenticated;
revoke all on function public.marketing_campaign_investment_impl(uuid, date, date)     from public, anon, authenticated;
revoke all on function public.marketing_campaign_platform_split_impl(uuid, date, date) from public, anon, authenticated;
revoke all on function public.marketing_loss_reasons_impl(uuid, date, date)            from public, anon, authenticated;
revoke all on function public.get_dashboard_stats_impl(uuid, date, date, text, text, text) from public, anon, authenticated;
revoke all on function public.get_commercial_dashboard_impl(uuid, date, date, date, date, text, text, text, date, date, text, text) from public, anon, authenticated;
revoke all on function public.get_commercial_leads_impl(uuid, date, date, date, date, text, text, integer, integer, text, text, date, date, text, text, text, text) from public, anon, authenticated;

grant execute on function public.get_dashboard_stats_impl(uuid, date, date, text, text, text) to service_role;
grant execute on function public.get_commercial_dashboard_impl(uuid, date, date, date, date, text, text, text, date, date, text, text) to service_role;
grant execute on function public.get_commercial_leads_impl(uuid, date, date, date, date, text, text, integer, integer, text, text, date, date, text, text, text, text) to service_role;

-- 2. wrappers: tirar PUBLIC e deixar só quem deve ----------------------------------
-- Continuam protegidos pelo guard; isto é para o REVOKE dizer a verdade e o anon não entrar.
revoke all on function public.marketing_kpis(uuid, date, date)                    from public, anon;
revoke all on function public.marketing_funnel_cohort(uuid, date, date)           from public, anon;
revoke all on function public.marketing_utm_funnel_cohort(uuid, date, date)       from public, anon;
revoke all on function public.marketing_campaign_investment(uuid, date, date)     from public, anon;
revoke all on function public.marketing_campaign_platform_split(uuid, date, date) from public, anon;
revoke all on function public.marketing_loss_reasons(uuid, date, date)            from public, anon;
revoke all on function public.get_dashboard_stats(uuid, date, date, text, text, text) from public, anon;
revoke all on function public.get_commercial_dashboard(uuid, date, date, date, date, text, text, text, date, date, text, text) from public, anon;
revoke all on function public.get_commercial_leads(uuid, date, date, date, date, text, text, integer, integer, text, text, date, date, text, text, text, text) from public, anon;

grant execute on function public.marketing_kpis(uuid, date, date)                    to authenticated, service_role;
grant execute on function public.marketing_funnel_cohort(uuid, date, date)           to authenticated, service_role;
grant execute on function public.marketing_utm_funnel_cohort(uuid, date, date)       to authenticated, service_role;
grant execute on function public.marketing_campaign_investment(uuid, date, date)     to authenticated, service_role;
grant execute on function public.marketing_campaign_platform_split(uuid, date, date) to authenticated, service_role;
grant execute on function public.marketing_loss_reasons(uuid, date, date)            to authenticated, service_role;
grant execute on function public.get_dashboard_stats(uuid, date, date, text, text, text) to authenticated, service_role;
grant execute on function public.get_commercial_dashboard(uuid, date, date, date, date, text, text, text, date, date, text, text) to authenticated, service_role;
grant execute on function public.get_commercial_leads(uuid, date, date, date, date, text, text, integer, integer, text, text, date, date, text, text, text, text) to authenticated, service_role;

-- 3. assert_clinic_access: idem ----------------------------------------------------
revoke all on function public.assert_clinic_access(uuid) from public, anon;
grant execute on function public.assert_clinic_access(uuid) to authenticated, service_role;

-- 4. my_clinic_ids: anon MANTEM execute, de propósito ------------------------------
-- A policy de leads/tickets é avaliada no papel do chamador, inclusive anon. Sem EXECUTE a
-- avaliação erraria com "permission denied for function" em vez de simplesmente não casar. Para
-- anon, auth.uid() é NULL e o retorno é vazio, não há o que vazar.
revoke all on function public.my_clinic_ids() from public;
grant execute on function public.my_clinic_ids() to anon, authenticated, service_role;
