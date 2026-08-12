-- 20260729041950_conv_ai_mechanical_automation_crons
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Wrapper: varre todas as clínicas que têm padrões ativos (chama a cascata por clínica).
create or replace function public.conv_ai_mechanical_sweep_all(p_dry boolean default false)
returns table(clinic_id uuid, flagged int)
language plpgsql
security definer
set search_path to 'public'
set statement_timeout to '300s'
as $function$
declare c record; n int;
begin
  for c in select distinct p.clinic_id from conv_ai_patterns p where p.is_active loop
    select count(*) into n from conv_ai_mechanical_sweep(c.clinic_id, p_dry);
    clinic_id := c.clinic_id; flagged := n; return next;
  end loop;
end;
$function$;

revoke all on function public.conv_ai_mechanical_sweep_all(boolean) from public;
grant execute on function public.conv_ai_mechanical_sweep_all(boolean) to service_role;

-- Cron 1: curadoria diária dos padrões (edge conv-ai-mine varre as clínicas com o analista ligado).
select cron.schedule('conv_ai_mine', '40 4 * * *',
  $q$select public.system_http_post('https://yzpclhuifquhfqpiwysh.supabase.co/functions/v1/conv-ai-mine');$q$);

-- Cron 2: varredura mecânica a cada 3h, em SOMBRA (grava sugestões shadow, invisíveis ao cliente).
select cron.schedule('conv_ai_mechanical_sweep', '0 */3 * * *',
  $q$select public.conv_ai_mechanical_sweep_all(false);$q$);
