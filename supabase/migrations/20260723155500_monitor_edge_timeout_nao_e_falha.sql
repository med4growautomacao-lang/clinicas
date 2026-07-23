-- O monitor de edge tratava TIMEOUT como falha, mas as chamadas do cron para as edges sao
-- DISPARO-E-ESQUECE: o banco nao espera a resposta, e cada edge registra os proprios erros na
-- Central (helper registrarErro). Medido em 23/07/2026: a conv-ai-analyst "estourou" o timeout
-- de 5s do system_http_post e mesmo assim completou 3 analises corretas, gravando etapa, venda e
-- memoria. Ou seja, o timeout ali nao diz nada sobre o resultado do trabalho.
--
-- O estrago era de observabilidade: 235 ocorrencias falsas em 10 funcoes SAUDAVEIS (analyst,
-- learn, welcome, capi, forms-sync, reengagement, spend-sync, sync-status...). A Central e o
-- unico olho que temos; alerta falso soterra o alerta de verdade. Caso concreto: os 67 alarmes
-- falsos de "meta-forms-sync_falhou" estavam competindo com um problema REAL da mesma funcao
-- (graph_api_recusou, 370 ocorrencias, token da Meta bloqueado).
--
-- CONTINUAM sendo erro: status >= 400 e falha de conexao de verdade (sem status E sem timeout,
-- ex.: DNS, conexao recusada). A cobertura de "a edge quebrou" nao depende disto: a propria edge
-- loga, e o monitor cron_parado_* pega o caso de a funcao nem chegar a ser chamada.
--
-- Tambem passa a avancar o cursor sobre TODAS as respostas vistas, e nao so sobre as que viraram
-- erro: senao as linhas ignoradas seriam re-varridas a cada rodada, para sempre.

create or replace function public.run_system_monitors()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  r record;
  v_cursor timestamptz;
  v_novo timestamptz;
  v_tocados text[] := array[]::text[];
  n_cron int := 0; n_edge int := 0; n_mon int := 0;
begin
  insert into system_monitor_state(monitor) values ('cron') on conflict do nothing;
  select cursor_at into v_cursor from system_monitor_state where monitor = 'cron';
  v_novo := v_cursor;

  for r in
    select j.jobname, d.status, d.start_time, left(coalesce(d.return_message, ''), 400) as msg
    from cron.job_run_details d
    join cron.job j on j.jobid = d.jobid
    where d.status = 'failed' and d.start_time > v_cursor   -- 'running'/'starting' NAO sao falha
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

  insert into system_monitor_state(monitor) values ('edge') on conflict do nothing;
  select cursor_at into v_cursor from system_monitor_state where monitor = 'edge';

  -- Cursor sobre TODAS as respostas ate agora (nao so as com erro), fixado ANTES do loop para
  -- nao pular resposta que chegue no meio da varredura.
  select coalesce(max(res.created), v_cursor) into v_novo
  from net._http_response res where res.created > v_cursor;

  for r in
    select res.created, res.status_code, res.error_msg, res.timed_out,
           coalesce(regexp_replace(hc.url, '^.*/functions/v1/', ''), 'desconhecida') as funcao,
           left(coalesce(res.content, ''), 400) as corpo
    from net._http_response res
    join public.system_http_calls hc on hc.request_id = res.id
    where res.created > v_cursor and res.created <= v_novo
      and not coalesce(res.timed_out, false)   -- disparo-e-esquece: timeout nao e falha
      and (res.status_code is null or res.status_code >= 400)
    order by res.created
  loop
    perform public.log_system_error(
      'edge', r.funcao || '_falhou',
      'A funcao "' || r.funcao || '" falhou ('
        || coalesce(r.status_code::text, 'sem resposta') || ')',
      case when r.status_code is null or r.status_code >= 500 then 'error' else 'warn' end,
      null,
      jsonb_build_object('funcao', r.funcao, 'status', r.status_code,
                         'timeout', r.timed_out, 'erro', r.error_msg, 'resposta', r.corpo)
    );
    n_edge := n_edge + 1;
  end loop;

  update system_monitor_state set cursor_at = v_novo where monitor = 'edge';

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
      'WhatsApp desconectado (clinica em operacao): ' || r.name,
      'critical', r.clinic_id, jsonb_build_object('status', r.status), true
    );
    n_mon := n_mon + 1;
  end loop;

  for r in
    select c.id as clinic_id, c.name, wi.send_blocked_until
    from whatsapp_instances wi join clinics c on c.id = wi.clinic_id
    where wi.send_blocked_until is not null and wi.send_blocked_until > now()
  loop
    v_tocados := v_tocados || md5('monitor|envio_bloqueado|' || r.clinic_id::text);
    perform public.log_system_error(
      'monitor', 'envio_bloqueado',
      'Envio bloqueado pelo WhatsApp ate '
        || to_char(r.send_blocked_until at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI') || ': ' || r.name,
      'critical', r.clinic_id, jsonb_build_object('ate', r.send_blocked_until), true
    );
    n_mon := n_mon + 1;
  end loop;

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
        'obs', 'O lead JA esta atribuido como meta_ads. Renovar o token e o cron ctwa_enrich_weekly preenche a campanha sozinho.'),
      true
    );
    n_mon := n_mon + 1;
  end loop;

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
      r.orfaos || ' clique(s) pago(s) sem lead correspondente ha mais de 30 min: ' || r.name,
      'error', r.clinic_id, jsonb_build_object('cliques_orfaos', r.orfaos), true
    );
    n_mon := n_mon + 1;
  end loop;

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
      'Cron "' || r.jobname || '" nao roda desde '
        || coalesce(to_char(r.ultima at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI'), 'nunca'),
      'critical', null,
      jsonb_build_object('jobname', r.jobname, 'ultima_execucao', r.ultima), true
    );
    n_mon := n_mon + 1;
  end loop;

  update public.system_errors
     set status = 'resolved', resolved_at = now()
   where is_monitor and status <> 'resolved'
     and not (fingerprint = any(v_tocados));

  return jsonb_build_object('cron', n_cron, 'edge', n_edge, 'monitores', n_mon);
end;
$function$;

-- Limpa os alarmes falsos que ja estao na Central (todos os de escopo 'edge' cujo contexto diz
-- que a causa foi timeout). Erro de edge com status HTTP de verdade permanece aberto.
update public.system_errors
   set status = 'resolved', resolved_at = now()
 where scope = 'edge'
   and status <> 'resolved'
   and coalesce(last_context->>'timeout', 'false') = 'true';
