-- FASE 1a: fecha a CAUSA RAIZ que faltou em 20260727163000 (que só cobriu funções) e varre o
-- passado por PRIVILÉGIO (não por regex de corpo, que deixou finalize_ticket/set_ticket_stage
-- escaparem).
--
-- 1) Default-deny para TABELAS e SEQUENCES: toda tabela nova em public deixa de nascer com CRUD
--    para anon/authenticated (era {anon=arwdDxtm}, a origem das scratch tables expostas).
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;

-- 2) Sweep idempotente por has_function_privilege: revoga o vetor anon (public + nominal) de TODA
--    função de aplicação que ainda o tem, preservando authenticated. Exclui: helpers de policy
--    (avaliados no papel do chamador — sem EXECUTE viraria 'permission denied' na leitura da
--    tabela) e funções de extensão.
do $$
declare
  r record;
  v_helpers text[];
begin
  select coalesce(array_agg(distinct p.proname), array[]::text[]) into v_helpers
  from pg_policies pol
  join pg_proc p on p.pronamespace='public'::regnamespace
  where (pol.qual ~ ('\y'||p.proname||'\s*\(') or coalesce(pol.with_check,'') ~ ('\y'||p.proname||'\s*\('));

  v_helpers := v_helpers || array[
    'is_clinic_active','is_clinic_admin','is_super_admin','is_admin','has_clinic_access',
    'my_clinic_ids','get_my_clinic_id','check_org_access','can_manage_org','can_manage_clinic',
    'is_org_owner','can_access_clinic_media_text'
  ];

  for r in
    select p.oid, p.oid::regprocedure::text as sig,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_had
    from pg_proc p
    where p.pronamespace='public'::regnamespace
      and p.prorettype <> 'trigger'::regtype
      and has_function_privilege('anon', p.oid, 'EXECUTE')
      and not (p.proname = any(v_helpers))
      and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')  -- não tocar extensão
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    if r.auth_had then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end $$;
