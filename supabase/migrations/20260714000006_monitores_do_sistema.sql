-- Coletores e monitores da Central de Erros.
--
-- FONTES QUE JÁ EXISTIAM E NINGUÉM LIA:
--   • cron.job_run_details — toda execução de cron que falhou (havia 741 acumuladas).
--   • net._http_response   — toda chamada pg_net que voltou != 2xx. É por aqui que as edges
--     disparadas por cron (meta-forms-sync, ctwa-enrich, whatsapp-sync-status…) ficam cobertas
--     SEM tocar no código delas.
--
-- ⚠️ PORÉM: `net._http_response` NÃO guarda a URL — a fila (`net.http_request_queue`) é apagada
-- assim que a resposta chega. Sem a URL, saberíamos que "algo falhou" mas não O QUÊ, o que é quase
-- inútil. Por isso as chamadas passam a sair por `system_http_post()`, que registra id → URL. E o
-- pg_net poda a tabela de respostas em poucas horas, daí o cron de 5 min.
--
-- OS MONITORES DE INVARIANTE são o ponto todo: não esperam algo estourar, perguntam "o mundo está
-- como deveria?". São eles que pegariam as falhas silenciosas desta semana — a instância caída, o
-- token bloqueado, o clique que entrou e nunca casou com o lead, o cron que simplesmente parou.
--
-- 🔇 RUÍDO É O QUE MATA MONITORAMENTO. Exemplo real: 14 instâncias estão "desconectadas", mas 12
-- delas são clínicas que NUNCA conectaram (setup incompleto) — alertar as 14 faria o painel nascer
-- inundado e ninguém olharia mais. O monitor só acusa clínica ATIVA e COM CONVERSA RECENTE cujo
-- WhatsApp caiu: aí são 2, e as 2 são de verdade.
--
-- Monitor é CONDIÇÃO, não evento: se o problema some, o próprio monitor marca como resolvido.

begin;

-- ---------------------------------------------------------------------------
-- Chamadas HTTP rastreáveis (id → url), para saber QUAL função falhou
-- ---------------------------------------------------------------------------
create table if not exists public.system_http_calls (
  request_id bigint primary key,
  url        text not null,
  created_at timestamptz not null default now()
);

create or replace function public.system_http_post(p_url text, p_body jsonb default '{}'::jsonb)
returns bigint
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_id bigint;
begin
  select net.http_post(
    url     := p_url,
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body    := p_body
  ) into v_id;

  insert into public.system_http_calls (request_id, url) values (v_id, p_url)
  on conflict (request_id) do nothing;

  -- Poda: o pg_net apaga as respostas em poucas horas; guardar o mapa além disso é lixo.
  delete from public.system_http_calls where created_at < now() - interval '2 days';

  return v_id;
end;
$function$;

create table if not exists public.system_monitor_state (
  monitor    text primary key,
  cursor_at  timestamptz not null default (now() - interval '1 hour')
);

-- ---------------------------------------------------------------------------
-- O coletor + os monitores
-- ---------------------------------------------------------------------------
create or replace function public.run_system_monitors()
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  r record;
  v_cursor timestamptz;
  v_novo timestamptz;
  v_tocados text[] := array[]::text[];
  n_cron int := 0; n_edge int := 0; n_mon int := 0;
begin
  -- =========================================================================
  -- 1) EVENTO: cron que falhou
  -- =========================================================================
  insert into system_monitor_state(monitor) values ('cron') on conflict do nothing;
  select cursor_at into v_cursor from system_monitor_state where monitor = 'cron';
  v_novo := v_cursor;

  for r in
    select j.jobname, d.status, d.start_time, left(coalesce(d.return_message, ''), 400) as msg
    from cron.job_run_details d
    join cron.job j on j.jobid = d.jobid
    where d.status = 'failed' and d.start_time > v_cursor   -- 'running'/'starting' NÃO são falha
    order by d.start_time
  loop
    perform public.log_system_error(
      'cron', 'job_failed_' || r.jobname,
      'Cron "' || r.jobname || '" falhou: ' || coalesce(nullif(r.msg, ''), r.status),
      'error', null,
      jsonb_build_object('jobname', r.jobname, 'status', r.status, 'mensagem', r.msg, 'quando', r.start_time)
    );
    n_cron := n_cron + 1;
    if r.start_time > v_novo then v_novo := r.start_time; end if;
  end loop;

  update system_monitor_state set cursor_at = v_novo where monitor = 'cron';

  -- =========================================================================
  -- 2) EVENTO: edge chamada por cron que respondeu erro (ou não respondeu)
  -- =========================================================================
  insert into system_monitor_state(monitor) values ('edge') on conflict do nothing;
  select cursor_at into v_cursor from system_monitor_state where monitor = 'edge';
  v_novo := v_cursor;

  for r in
    select res.created, res.status_code, res.error_msg, res.timed_out,
           coalesce(regexp_replace(hc.url, '^.*/functions/v1/', ''), 'desconhecida') as funcao,
           left(coalesce(res.content, ''), 400) as corpo
    from net._http_response res
    join public.system_http_calls hc on hc.request_id = res.id
    where res.created > v_cursor
      and (res.status_code is null or res.status_code >= 400)
    order by res.created
  loop
    perform public.log_system_error(
      'edge', r.funcao || '_falhou',
      'A função "' || r.funcao || '" falhou ('
        || coalesce(r.status_code::text, case when r.timed_out then 'timeout' else 'sem resposta' end) || ')',
      case when r.status_code is null or r.status_code >= 500 then 'error' else 'warn' end,
      null,
      jsonb_build_object('funcao', r.funcao, 'status', r.status_code,
                         'timeout', r.timed_out, 'erro', r.error_msg, 'resposta', r.corpo)
    );
    n_edge := n_edge + 1;
    if r.created > v_novo then v_novo := r.created; end if;
  end loop;

  update system_monitor_state set cursor_at = v_novo where monitor = 'edge';

  -- =========================================================================
  -- 3) CONDIÇÕES (invariantes) — auto-resolvem quando o problema some
  -- =========================================================================

  -- 3.1 WhatsApp caiu numa clínica que está OPERANDO. Clínica sem conversa recente e desconectada
  -- é setup incompleto, não incidente — alertar isso seria o ruído que mata o painel.
  for r in
    select c.id as clinic_id, c.name, wi.status
    from whatsapp_instances wi
    join clinics c on c.id = wi.clinic_id
    where coalesce(wi.status, '') <> 'connected'
      and c.is_active
      and exists (
        select 1 from chat_messages m
        where m.clinic_id = c.id
          and m.created_at > (now() at time zone 'America/Sao_Paulo') - interval '14 days'
      )
  loop
    v_tocados := v_tocados || md5('monitor|whatsapp_desconectado|' || r.clinic_id::text);
    perform public.log_system_error(
      'monitor', 'whatsapp_desconectado',
      'WhatsApp desconectado (clínica em operação): ' || r.name,
      'critical', r.clinic_id, jsonb_build_object('status', r.status), true
    );
    n_mon := n_mon + 1;
  end loop;

  -- 3.2 Conta punida pelo WhatsApp (erro 463). Enquanto durar, nada sai — e é silencioso.
  for r in
    select c.id as clinic_id, c.name, wi.send_blocked_until
    from whatsapp_instances wi join clinics c on c.id = wi.clinic_id
    where wi.send_blocked_until is not null and wi.send_blocked_until > now()
  loop
    v_tocados := v_tocados || md5('monitor|envio_bloqueado|' || r.clinic_id::text);
    perform public.log_system_error(
      'monitor', 'envio_bloqueado',
      'Envio bloqueado pelo WhatsApp até '
        || to_char(r.send_blocked_until at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI') || ': ' || r.name,
      'critical', r.clinic_id, jsonb_build_object('ate', r.send_blocked_until), true
    );
    n_mon := n_mon + 1;
  end loop;

  -- 3.3 Token da Meta bloqueado — detectado SEM chamar a Graph API: cliques recentes que têm id do
  -- anúncio guardado e seguem sem nome de campanha.
  for r in
    select i.clinic_id, c.name, count(*) as cliques
    from attribution_inbox i join clinics c on c.id = i.clinic_id
    where i.created_at > now() - interval '7 days'
      and i.raw ? 'source_id'
      and nullif(i.fb_campaign_name, '') is null
    group by i.clinic_id, c.name
  loop
    v_tocados := v_tocados || md5('monitor|campanha_nao_resolvida|' || r.clinic_id::text);
    perform public.log_system_error(
      'monitor', 'campanha_nao_resolvida',
      r.cliques || ' clique(s) pagos sem nome de campanha (token da Meta provavelmente bloqueado): ' || r.name,
      'warn', r.clinic_id,
      jsonb_build_object('cliques', r.cliques,
        'obs', 'O lead JÁ está atribuído como meta_ads. Renovar o token e o cron ctwa_enrich_weekly preenche a campanha sozinho.'),
      true
    );
    n_mon := n_mon + 1;
  end loop;

  -- 3.4 Clique pago que entrou e nunca casou com lead: a atribuição parou no meio do caminho.
  for r in
    select i.clinic_id, c.name, count(*) as orfaos
    from attribution_inbox i join clinics c on c.id = i.clinic_id
    where i.consumed_at is null
      and i.created_at < now() - interval '30 minutes'
      and i.created_at > now() - interval '30 days'
    group by i.clinic_id, c.name
  loop
    v_tocados := v_tocados || md5('monitor|clique_orfao|' || r.clinic_id::text);
    perform public.log_system_error(
      'monitor', 'clique_orfao',
      r.orfaos || ' clique(s) pago(s) sem lead correspondente há mais de 30 min: ' || r.name,
      'error', r.clinic_id, jsonb_build_object('cliques_orfaos', r.orfaos), true
    );
    n_mon := n_mon + 1;
  end loop;

  -- 3.5 Cron que simplesmente PAROU. Não gera erro nenhum — some em silêncio. É o mais traiçoeiro,
  -- e foi exatamente o padrão do "Tracking Meta" pausado que abriu 6,5h de ponto cego.
  for r in
    select j.jobname, max(d.start_time) as ultima
    from cron.job j
    left join cron.job_run_details d on d.jobid = j.jobid
    where j.active and (j.schedule like '* %' or j.schedule like '*/%')
    group by j.jobname
    having max(d.start_time) is null or max(d.start_time) < now() - interval '20 minutes'
  loop
    v_tocados := v_tocados || md5('monitor|cron_parado_' || r.jobname || '|-');
    perform public.log_system_error(
      'monitor', 'cron_parado_' || r.jobname,
      'Cron "' || r.jobname || '" não roda desde '
        || coalesce(to_char(r.ultima at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI'), 'nunca'),
      'critical', null,
      jsonb_build_object('jobname', r.jobname, 'ultima_execucao', r.ultima), true
    );
    n_mon := n_mon + 1;
  end loop;

  -- Condição que não apareceu nesta rodada deixou de existir.
  update public.system_errors
     set status = 'resolved', resolved_at = now()
   where is_monitor and status <> 'resolved'
     and not (fingerprint = any(v_tocados));

  return jsonb_build_object('cron', n_cron, 'edge', n_edge, 'monitores', n_mon);
end;
$function$;

revoke all on function public.run_system_monitors() from public, anon, authenticated;
grant execute on function public.run_system_monitors() to service_role;

select cron.schedule('system_monitors_job', '*/5 * * * *', $$ select public.run_system_monitors(); $$);

commit;
