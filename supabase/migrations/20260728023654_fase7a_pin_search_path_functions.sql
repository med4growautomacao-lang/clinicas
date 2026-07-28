-- FASE 7a (hardening): fixa SET search_path em TODA funcao de public sem ele (as 63 apontadas pelo
-- advisor 'function_search_path_mutable'). Analisadas corpo a corpo (workflow + verificacao
-- adversarial): nenhuma referencia nome NAO-qualificado de schema sensivel (net/cron/storage/vault/
-- graphql/realtime); as 2 que emitem HTTP usam public.system_http_post qualificado; refs a auth.*
-- sao qualificadas. Logo 'public, extensions' e seguro para todas.
--
-- NAO e vuln exploravel (ja apurado: anon/authenticated NAO tem CREATE em public/extensions, entao
-- ninguem consegue plantar objeto para sequestrar um nome). E endurecimento: fecha o aviso e
-- protege as 12 SECURITY DEFINER da lista. Idempotente: so toca funcao ainda sem search_path.
do $$
declare
  r record;
  n int := 0;
begin
  for r in
    select p.oid::regprocedure::text as sig
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public'
      and p.prokind = 'f'
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('alter function %s set search_path to public, extensions', r.sig);
    n := n + 1;
  end loop;
  raise notice 'search_path fixado em % funcoes', n;
end $$;
