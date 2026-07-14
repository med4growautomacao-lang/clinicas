-- 1) O helper ganha a MESMA assinatura nomeada do net.http_post (url/headers/body/timeout), o que
--    permite trocar o gravador nas funções existentes por substituição textual — sem reescrever
--    centenas de linhas de plpgsql na mão (e sem o risco de errar transcrevendo).
--
-- 2) Os crons e os selectors (welcome, reengajamento, notificação de ganho) passam a sair por ele.
--    Sem isso, a resposta de erro chega em net._http_response SEM a URL (a fila é apagada assim que
--    a resposta chega) e a Central saberia que "algo falhou", mas não O QUÊ.
--
-- 3) FALSO POSITIVO corrigido — pego no teste, e irônico: o monitor acusava a si mesmo. O pg_cron
--    usa status transitórios ('starting', 'running', 'sending') além de 'succeeded'/'failed'. Eu
--    tratava "tudo que não é succeeded" como falha, então o monitor lia a PRÓPRIA execução em curso
--    como 'running' e registrava um erro. Só 'failed' é falha.

begin;

drop function if exists public.system_http_post(text, jsonb);

create or replace function public.system_http_post(
  url                  text,
  headers              jsonb   default '{"Content-Type": "application/json"}'::jsonb,
  body                 jsonb   default '{}'::jsonb,
  timeout_milliseconds integer default 5000
)
returns bigint
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_url     text    := url;
  v_headers jsonb   := coalesce(headers, '{"Content-Type": "application/json"}'::jsonb);
  v_body    jsonb   := coalesce(body, '{}'::jsonb);
  v_timeout integer := coalesce(timeout_milliseconds, 5000);
  v_id      bigint;
begin
  select net.http_post(
    url := v_url, headers := v_headers, body := v_body, timeout_milliseconds := v_timeout
  ) into v_id;

  -- O mapa id → URL é o que permite a Central dizer QUAL função falhou.
  insert into public.system_http_calls (request_id, url) values (v_id, v_url)
  on conflict (request_id) do nothing;

  delete from public.system_http_calls where created_at < now() - interval '2 days';

  return v_id;
end;
$function$;

revoke all on function public.system_http_post(text, jsonb, jsonb, integer) from public, anon, authenticated;
grant execute on function public.system_http_post(text, jsonb, jsonb, integer) to service_role;

-- Troca o gravador nas funções que já existiam, preservando o corpo delas intacto.
do $$
declare d text;
begin
  for d in
    select pg_get_functiondef(p.oid)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('process_forms_followup','process_reengagement_followup','fn_notify_encerramento_ganho')
  loop
    execute replace(d, 'net.http_post(', 'public.system_http_post(');
  end loop;
end $$;

commit;

-- Os crons que chamam edge também.
select cron.unschedule('meta_forms_sync');
select cron.schedule('meta_forms_sync', '* * * * *', $$
  select public.system_http_post('https://yzpclhuifquhfqpiwysh.supabase.co/functions/v1/meta-forms-sync');
$$);

select cron.unschedule('whatsapp_sync_status');
select cron.schedule('whatsapp_sync_status', '0 12,21 * * *', $$
  select public.system_http_post('https://yzpclhuifquhfqpiwysh.supabase.co/functions/v1/whatsapp-sync-status');
$$);

select cron.unschedule('ctwa_enrich_weekly');
select cron.schedule('ctwa_enrich_weekly', '0 12 * * 1', $$
  select public.system_http_post('https://yzpclhuifquhfqpiwysh.supabase.co/functions/v1/ctwa-enrich');
$$);
