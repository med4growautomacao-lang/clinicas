-- 20260714024033_system_http_post_compativel_com_pgnet
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- O helper passa a ter a MESMA assinatura nomeada do net.http_post (url/headers/body/timeout).
-- Assim, trocar o gravador nas funções existentes é uma substituição textual — sem reescrever
-- centenas de linhas de plpgsql na mão (e sem o risco de errar transcrevendo).
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

  -- O mapa id → URL é o que permite a Central dizer QUAL função falhou: a resposta do pg_net não
  -- guarda a URL, e a fila de requisições é apagada assim que a resposta chega.
  insert into public.system_http_calls (request_id, url) values (v_id, v_url)
  on conflict (request_id) do nothing;

  delete from public.system_http_calls where created_at < now() - interval '2 days';

  return v_id;
end;
$function$;

revoke all on function public.system_http_post(text, jsonb, jsonb, integer) from public, anon, authenticated;
grant execute on function public.system_http_post(text, jsonb, jsonb, integer) to service_role;

commit;
