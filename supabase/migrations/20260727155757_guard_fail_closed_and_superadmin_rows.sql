-- Dois endurecimentos apontados na revisão do trabalho de 26-27/07.
--
-- 1. assert_clinic_access era FAIL-OPEN
-- ------------------------------------------------------------------------------
-- A versão anterior exigia acesso apenas quando o papel do JWT era literalmente 'anon' ou
-- 'authenticated':
--     if v_jwt_role in ('anon','authenticated') and not has_clinic_access(...) then raise
-- Qualquer outro valor de `role` passava direto, sem checagem. Hoje isso não é explorável (só
-- anon/authenticated/service_role são membros de `authenticator`), mas a correção do guard passava
-- a depender de um fato sobre associação de roles que não está escrito em lugar nenhum perto dele:
-- basta alguém criar um role PostgREST novo, ou o formato do claim mudar, para o guard virar
-- decorativo e em silêncio.
--
-- Forma nova, FAIL-CLOSED �?" só duas saídas explícitas, e o resto é barrado:
--     sem JWT nenhum          -> chamada de dentro do banco (pg_cron, psql, SECURITY DEFINER) -> passa
--     role = 'service_role'   -> backend confiável (já tem rolbypassrls de qualquer jeito)     -> passa
--     qualquer outro portador  -> tem que provar has_clinic_access
--
-- 2. Linha com clinic_id NULL ou órfão sumia para o super-admin
-- ------------------------------------------------------------------------------
-- A policy antiga terminava em `OR is_clinic_admin(clinic_id)`, que para super-admin é true
-- INDEPENDENTE do argumento �?" inclusive com clinic_id NULL. A régua nova, `clinic_id in (select
-- my_clinic_ids())`, só pode devolver ids que existam em `clinics`, então:
--     * clinic_id NULL          -> `NULL in (...)` é NULL, nunca true
--     * clinic_id órfão (clínica apagada) -> não está no conjunto
-- e o super-admin perdia a linha de vista. Pior: como a policy é FOR ALL e o USING também vale como
-- WITH CHECK, ele perdia também a capacidade de corrigir a linha por UPDATE.
--
-- A prova de equivalência dos 1.768 pares N�fO pegava isso, por construção: ela cruzava usuários com
-- as clínicas existentes em `clinics`, então clinic_id NULL/órfão estava fora do universo testado.
-- Fica o registro de que "provei equivalência" vale só dentro do universo que a prova percorreu.
--
-- Hoje o impacto é zero (leads e tickets com clinic_id NULL ou órfão: 0 de cada). �? preventivo, e o
-- custo é desprezível: `is_super_admin()` não tem argumento, então dentro de `(select ...)` ela vira
-- InitPlan e roda uma vez por query, igual a my_clinic_ids().

-- 1. Guard fail-closed ----------------------------------------------------------
create or replace function public.assert_clinic_access(p_clinic_id uuid)
returns void
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_claims text := nullif(current_setting('request.jwt.claims', true), '');
  v_jwt_role text := coalesce((v_claims::jsonb) ->> 'role', '');
begin
  -- Sem JWT: não veio pelo PostgREST. �? pg_cron, psql, ou outra função do banco
  -- (ex.: build_commercial_report no cron 21). Sempre passou, continua passando.
  if v_claims is null then
    return;
  end if;

  -- Backend confiável. Note que service_role tem rolbypassrls, então barrá-lo aqui
  -- não somaria segurança nenhuma: só quebraria edge function.
  if v_jwt_role = 'service_role' then
    return;
  end if;

  -- Todo o resto (anon, authenticated e qualquer role futuro) precisa provar acesso.
  if not public.has_clinic_access(p_clinic_id) then
    raise exception 'acesso negado a clinic_id %', p_clinic_id using errcode = '42501';
  end if;
end;
$function$;

comment on function public.assert_clinic_access(uuid) is
  'Guard de tenant das RPCs de painel (SECURITY DEFINER, que ignoram RLS). FAIL-CLOSED: só passa sem checar quando não há JWT (chamada interna do banco) ou quando o role do JWT é service_role. Levanta 42501 (PostgREST -> 403).';

revoke all on function public.assert_clinic_access(uuid) from public, anon;
grant execute on function public.assert_clinic_access(uuid) to authenticated, service_role;

-- 2. Super-admin volta a enxergar linha sem clínica válida -----------------------
-- `(select ...)` em volta é obrigatório: é o que faz o planner resolver uma vez (InitPlan) em vez
-- de por linha. Sem os parênteses, o ganho da migration 20260727145640 seria desfeito.
alter policy leads_access on public.leads
  using (clinic_id in (select public.my_clinic_ids()) or (select public.is_super_admin()));

alter policy tickets_access on public.tickets
  using (clinic_id in (select public.my_clinic_ids()) or (select public.is_super_admin()));
