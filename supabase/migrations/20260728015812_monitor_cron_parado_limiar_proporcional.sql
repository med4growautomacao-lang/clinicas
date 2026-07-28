-- O monitor de "cron parado" usava limiar fixo de 20 minutos para QUALQUER job frequente. O
-- resolve_ad_ids_sweep roda '*/30', entao passava 10 minutos de cada ciclo acusado de parado:
-- um critico FALSO a cada meia hora, 48 por dia. Antes isso oscilava open/resolved na mesma
-- linha e passava batido; com a regra nova (resolvido sai do painel) viraria linha nova toda
-- vez, e critico falso recorrente e o jeito mais rapido de fazer o dono parar de olhar o painel.
--
-- Agora o limiar acompanha o intervalo declarado no proprio schedule: greatest(20, intervalo*2).
-- '* * * * *' segue em 20 min; '*/30' so acende com 60 min de silencio, que ai e problema real.
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
    where d.status = 'failed' and d.start_time > v_cursor
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

  select coalesce(max(res.created), v_cursor) into v_novo
  from net._http_response res where res.created > v_cursor;

  for r in
    select res.created, res.status_code, res.error_msg, res.timed_out,
           coalesce(regexp_replace(hc.url, '^.*/functions/v1/', ''), 'desconhecida') as funcao,
           left(coalesce(res.content, ''), 400) as corpo
    from net._http_response res
    join public.system_http_calls hc on hc.request_id = res.id
    where res.created > v_cursor and res.created <= v_novo
      and not coalesce(res.timed_out, false)
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

  -- Cron parado. O limiar acompanha o intervalo do proprio job (greatest(20, intervalo*2)):
  -- limiar fixo acusava '*/30' de parado em 10 de cada 30 minutos, e alarme falso recorrente
  -- treina o dono a ignorar o painel.
  for r in
    select * from (
      select j.jobname,
             case when j.schedule ~ '^\*/\d+ '
                  then (regexp_match(j.schedule, '^\*/(\d+) '))[1]::int
                  else 1 end as intervalo_min,
             max(d.start_time) as ultima
        from cron.job j
        left join cron.job_run_details d on d.jobid = j.jobid
       where j.active and (j.schedule like '* %' or j.schedule like '*/%')
       group by j.jobname, j.schedule
    ) q
    where q.ultima is null
       or q.ultima < now() - (greatest(20, q.intervalo_min * 2) || ' minutes')::interval
  loop
    v_tocados := v_tocados || md5('monitor|cron_parado_' || r.jobname || '|-');
    perform public.log_system_error(
      'monitor', 'cron_parado_' || r.jobname,
      'Cron "' || r.jobname || '" nao roda desde '
        || coalesce(to_char(r.ultima at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI'), 'nunca'),
      'critical', null,
      jsonb_build_object('jobname', r.jobname, 'ultima_execucao', r.ultima,
                         'intervalo_min', r.intervalo_min,
                         'limiar_min', greatest(20, r.intervalo_min * 2)), true
    );
    n_mon := n_mon + 1;
  end loop;

  -- Desfecho do CRM externo silencioso. O filtro outcome in ('ganho','perdido') e LOAD-BEARING:
  -- sem ele, um CRM que so manda ?tipo=lead mantem o max(received_at) fresco e o monitor nunca
  -- acende, mesmo com o desfecho morto ha semanas.
  for r in
    select ci.clinic_id, c.name,
           (select max(e.received_at) from external_crm_events e
             where e.clinic_id = ci.clinic_id and e.outcome in ('ganho','perdido')) as ultimo_evento
    from clinic_external_integrations ci
    join clinics c on c.id = ci.clinic_id
    where ci.crm_token is not null
      and (coalesce(ci.won_enabled, false) or coalesce(ci.lost_enabled, false))
      and c.is_active
      and exists (
        select 1 from leads l
        where l.clinic_id = ci.clinic_id
          and l.created_at > (now() at time zone 'America/Sao_Paulo') - interval '3 days'
      )
      and coalesce(
        (select max(e.received_at) from external_crm_events e
          where e.clinic_id = ci.clinic_id and e.outcome in ('ganho','perdido')),
        'epoch'::timestamptz
      ) < now() - interval '3 days'
  loop
    v_tocados := v_tocados || md5('monitor|crm_desfecho_silencioso|' || r.clinic_id::text);
    perform public.log_system_error(
      'monitor', 'crm_desfecho_silencioso',
      'CRM externo sem desfecho ha 3+ dias (leads entrando, ganho/perdido nao chega): ' || r.name,
      'error', r.clinic_id,
      jsonb_build_object(
        'ultimo_evento', r.ultimo_evento,
        'obs', 'Cliente com desfecho habilitado e leads ativos, mas external_crm_events de ganho/perdido parou. Conferir a automacao do CRM (ex.: Clint) apontando para external-crm-status?k=<crm_token>&tipo=ganho|perdido.'
      ),
      true
    );
    n_mon := n_mon + 1;
  end loop;

  -- Welcome de forms que nunca virou conversa (perda silenciosa de lead).
  -- Janela de 3 dias: e a mesma do selector fn_followup_candidates_welcome, entao o alerta morre
  -- sozinho quando os leads saem do alcance de reenvio. O "nao existe outbound pending/sending"
  -- evita acender enquanto a mensagem esta legitimamente na fila (ex.: agendada para a janela
  -- de envio da manha).
  for r in
    select l.clinic_id, c.name, count(*) as leads, min(l.created_at) as mais_antigo
      from leads l
      join clinics c on c.id = l.clinic_id
     where l.capture_channel = 'forms'
       and coalesce(l.welcome_sent, false)
       and not coalesce(l.whatsapp_invalid, false)
       and not coalesce(l.is_not_lead, false)
       and not coalesce(l.is_simulation, false)
       and l.created_at < (now() at time zone 'America/Sao_Paulo') - interval '30 minutes'
       and l.created_at > (now() at time zone 'America/Sao_Paulo') - interval '3 days'
       and not exists (select 1 from chat_messages m where m.lead_id = l.id)
       and not exists (select 1 from outbound_messages o
                        where o.lead_id = l.id and o.producer = 'forms_welcome'
                          and o.status in ('pending', 'sending'))
     group by l.clinic_id, c.name
  loop
    v_tocados := v_tocados || md5('monitor|welcome_sem_conversa|' || r.clinic_id::text);
    perform public.log_system_error(
      'monitor', 'welcome_sem_conversa',
      r.leads || ' lead(s) de formulario marcados como "boas-vindas enviada" sem nenhuma mensagem: ' || r.name,
      'error', r.clinic_id,
      jsonb_build_object(
        'leads', r.leads, 'mais_antigo', r.mais_antigo,
        'obs', 'welcome_sent=true e zero chat_messages: o lead nao recebeu nada E esta fora do reengajamento (que so olha quem tem conversa). Conferir outbound_messages producer=forms_welcome status=failed e automation_logs type=forms_welcome.'
      ),
      true
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

revoke all on function public.run_system_monitors() from public, anon, authenticated;
grant execute on function public.run_system_monitors() to service_role;
