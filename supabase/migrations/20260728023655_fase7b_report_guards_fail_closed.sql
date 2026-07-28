-- FASE 7b (hardening): troca o guard FAIL-OPEN de build_commercial_report e send_clinic_report
-- ('if auth.uid() is not null then <check> end if' — qualquer chamador sem uid que nao seja cron
-- pulava) por um gate FAIL-CLOSED igual ao assert_clinic_access: passa so sem JWT (cron/psql) ou
-- role=service_role; qualquer outro portador precisa provar a checagem INTERNA, que fica IDENTICA
-- (build: super/clinic_admin/membro clinic_users/membro org; send: super/clinic_admin/org_admin|owner).
--
-- Vetor ja estava fechado (anon sem EXECUTE desde a fase1); isto e defesa-em-profundidade.
-- Metodo: le o pg_get_functiondef ATUAL e troca APENAS a linha do guard (corpo com emoji/escapes
-- preservado byte a byte; aborta se a linha nao for unica). O cron 21 (run_scheduled_reports ->
-- send_clinic_report -> build_commercial_report) roda SEM JWT -> claims NULL -> gate passa.
-- Verificado pos-fix: cron_gerou_relatorio=t, cross_tenant_blocked=t.
do $$
declare
  v_def text;
  v_old constant text := 'if auth.uid() is not null then';
  v_new constant text := 'if current_setting(''request.jwt.claims'', true) is not null and coalesce(nullif(current_setting(''request.jwt.claims'', true),'''')::jsonb->>''role'','''') <> ''service_role'' then';
  v_cnt int;
begin
  -- build_commercial_report
  select pg_get_functiondef('public.build_commercial_report(uuid,text,date,date,date,date,date,date,boolean)'::regprocedure) into v_def;
  v_cnt := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_cnt <> 1 then raise exception 'build_commercial_report: esperava 1 ocorrencia do guard, achei %', v_cnt; end if;
  execute replace(v_def, v_old, v_new);

  -- send_clinic_report
  select pg_get_functiondef('public.send_clinic_report(uuid,text,date,date,date,date,date,date,text)'::regprocedure) into v_def;
  v_cnt := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_cnt <> 1 then raise exception 'send_clinic_report: esperava 1 ocorrencia do guard, achei %', v_cnt; end if;
  execute replace(v_def, v_old, v_new);
end $$;
