-- Dois monitores novos, pelo motivo do CLAUDE.md 0.5: os dois defeitos de 30/07 rodaram
-- por DIAS sem nenhum erro em lugar nenhum. Quem descobriu foi o dono lendo a conversa.
--
-- (e) ia_sem_memoria        — a chave da memoria voltou a divergir (o agente atende amnesico)
-- (f) conversa_duplicada    — o import gravou de novo uma mensagem que o proprio sistema mandou
--
-- Os dois entram MUDOS (conferido: zero em 30/07 depois do conserto) e so falam se houver
-- regressao. Cada um no seu begin/exception, e o fingerprint empilhado em v_tocados: sem isso o
-- alerta e criado e resolvido na mesma execucao e o monitor parece funcionar sem nunca aparecer.

CREATE OR REPLACE FUNCTION public.run_system_monitors()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r record;
  v_cursor timestamptz;
  v_novo timestamptz;
  v_tocados text[] := array[]::text[];
  n_cron int := 0; n_edge int := 0; n_mon int := 0;
  n_falhas int := 0;
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

  -- ==========================================================================================
  -- REGRAS ESTRUTURAIS DO CLAUDE.md. Cada bloco tem seu proprio begin/exception: monitor novo
  -- que quebra nao pode derrubar os antigos nem pular o auto-resolve do fim. No handler, os
  -- alertas ja abertos daquele monitor voltam para v_tocados, senao um monitor quebrado
  -- resolveria sozinho o alerta que ele deixou de reavaliar (falso "consertou").
  --
  -- ARMADILHA ESTRUTURAL desta funcao, para quem for acrescentar um bloco no futuro: se o
  -- fingerprint NAO for empilhado em v_tocados, o alerta e criado e resolvido na MESMA execucao
  -- e o trigger de arquivamento apaga a linha. O monitor parece funcionar e nunca aparece nada.
  -- ==========================================================================================

  -- (a) Funcao interna aberta para anon/authenticated.
  -- Foi assim que um vazamento de PII "corrigido" seguiu aberto por 17 horas sob o nome _impl:
  -- o grant vem por DOIS caminhos (o PUBLIC que todo create function concede, e o nominal de
  -- anon), e revogar um so nao fecha nada. Por isso a prova e has_function_privilege, nunca o DDL.
  -- Fora da lista de proposito: is_super_admin, is_clinic_admin e my_clinic_ids (as RLS PRECISAM
  -- que anon execute), log_system_error e build_commercial_report (o front chama os dois).
  begin
    if to_regrole('anon') is not null and to_regrole('authenticated') is not null then
      for r in
        with alvo as (
          select p.oid, p.proname
            from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.prokind = 'f'
             and ( right(p.proname, 5) = '_impl'
                or p.proname = any (array[
                     'system_http_post','emit_message','fn_clinic_send_token','log_llm_usage',
                     'apply_external_crm_outcome','run_system_monitors','purge_llm_usage',
                     'purge_outbound_messages','refresh_lead_attribution','fn_purge_pending_leads',
                     'fn_reconcile_pending_tracking','onboarding_deep_sync_tick',
                     'fn_resolve_missing_ad_ids','recover_whatsapp_zombies','run_scheduled_reports',
                     'process_appointment_reminders','process_confirmation_reminders',
                     'process_handoff_auto_return','process_pos_followup','process_sla_unanswered'
                   ]) )
        )
        select a.proname,
               bool_or(has_function_privilege('anon', a.oid, 'EXECUTE')) as anon_exec,
               bool_or(has_function_privilege('authenticated', a.oid, 'EXECUTE')) as auth_exec,
               string_agg(a.oid::regprocedure::text, ' | ') as assinaturas
          from alvo a
         group by a.proname
        having bool_or(has_function_privilege('anon', a.oid, 'EXECUTE'))
            or bool_or(has_function_privilege('authenticated', a.oid, 'EXECUTE'))
      loop
        v_tocados := v_tocados || md5('monitor|grant_indevido_' || r.proname || '|-');
        perform public.log_system_error(
          'monitor', 'grant_indevido_' || r.proname,
          case when r.anon_exec
               then 'Dado de paciente exposto: a rotina interna "' || r.proname
                    || '" ficou acessivel SEM LOGIN, direto da internet'
               else 'Dado de paciente exposto: a rotina interna "' || r.proname
                    || '" ficou acessivel a qualquer usuario logado, inclusive de outra clinica'
          end,
          'critical', null,
          jsonb_build_object(
            'funcao', r.proname, 'assinaturas', r.assinaturas,
            'anon', r.anon_exec, 'authenticated', r.auth_exec,
            'obs', 'Fechar com: revoke all on function public.' || r.proname
                   || '(<args>) from public, anon, authenticated;  Revogar so de anon NAO fecha: '
                   || 'o grant vem tambem do PUBLIC que o create function concede. '
                   || 'Conferir sempre com has_function_privilege, nunca lendo o DDL.'),
          true
        );
        n_mon := n_mon + 1;
      end loop;
    end if;
  exception when others then
    v_tocados := v_tocados
      || md5('monitor|monitor_falhou_grant_indevido|-')
      || coalesce((select array_agg(e.fingerprint) from public.system_errors e
                    where e.is_monitor and e.status <> 'resolved'
                      and starts_with(e.code, 'grant_indevido_')), array[]::text[]);
    perform public.log_system_error(
      'monitor', 'monitor_falhou_grant_indevido',
      'A vigilancia de permissao das rotinas internas parou de rodar (esse risco ficou sem vigia)',
      'error', null, jsonb_build_object('erro', SQLERRM, 'sqlstate', SQLSTATE), true
    );
    n_falhas := n_falhas + 1;
  end;

  -- (b) Chamada HTTP crua no lugar de system_http_post.
  -- ATENCAO 1: o filtro de schema (public) e LOAD-BEARING. Fora dele existem duas funcoes da
  -- PLATAFORMA Supabase que usam a versao crua e nao podem ser trocadas.
  -- ATENCAO 2: no texto de 'obs' abaixo, o nome da funcao proibida esta QUEBRADO em duas partes
  -- concatenadas de proposito. Escrito inteiro, ele fica no prosrc DESTA funcao, que e varrida
  -- junto com as outras, e o monitor passa a se denunciar sozinho para sempre.
  begin
    for r in
      select p.proname,
             string_agg(p.oid::regprocedure::text, ' | ') as assinaturas
        from pg_proc p
       where p.pronamespace = 'public'::regnamespace
         and p.prokind = 'f'
         and p.proname <> 'system_http_post'
         and regexp_replace(p.prosrc, '--[^\n]*', '', 'g') ~* 'net\s*\.\s*http_post'
       group by p.proname
    loop
      v_tocados := v_tocados || md5('monitor|http_sem_rastro_' || r.proname || '|-');
      perform public.log_system_error(
        'monitor', 'http_sem_rastro_' || r.proname,
        'A rotina "' || r.proname || '" chama servico externo por fora do canal padrao: '
          || 'se a chamada falhar, ninguem fica sabendo',
        'error', null,
        jsonb_build_object(
          'funcao', r.proname, 'assinaturas', r.assinaturas,
          'obs', 'Trocar a chamada crua (net' || '.http_post) por '
                 || 'public.system_http_post(url, headers, body, timeout). '
                 || 'So o system_http_post grava em system_http_calls, que e o que permite o monitor '
                 || 'de edge dizer qual funcao falhou em vez de "desconhecida".'),
        true
      );
      n_mon := n_mon + 1;
    end loop;
  exception when others then
    v_tocados := v_tocados
      || md5('monitor|monitor_falhou_http_sem_rastro|-')
      || coalesce((select array_agg(e.fingerprint) from public.system_errors e
                    where e.is_monitor and e.status <> 'resolved'
                      and starts_with(e.code, 'http_sem_rastro_')), array[]::text[]);
    perform public.log_system_error(
      'monitor', 'monitor_falhou_http_sem_rastro',
      'A vigilancia das chamadas externas do banco parou de rodar (esse risco ficou sem vigia)',
      'error', null, jsonb_build_object('erro', SQLERRM, 'sqlstate', SQLSTATE), true
    );
    n_falhas := n_falhas + 1;
  end;

  -- (c) As 4 travas que sao INDICE, nao codigo.
  -- Nao basta existir, tem que estar unico, valido e pronto: indice invalido (create index
  -- concurrently que falhou pela metade) nao segura nada e nao da erro nenhum.
  begin
    for r in
      select v.nome, v.consequencia,
             (ix.indexrelid is not null) as existe,
             coalesce(ix.indisunique, false) as unico,
             coalesce(ix.indisvalid, false) as valido,
             coalesce(ix.indisready, false) as pronto
        from (values
          ('uq_tickets_one_open_per_lead',
           'o mesmo cliente pode abrir dois atendimentos ao mesmo tempo, virando card duplicado no funil e venda contada em dobro'),
          ('appointments_one_active_per_ticket',
           'o mesmo atendimento pode gerar dois agendamentos, com dois pacientes marcados no mesmo horario'),
          ('uq_leads_clinic_rast_id',
           'o mesmo lead pode entrar duas vezes na clinica, partindo ao meio a atribuicao de campanha e o historico'),
          ('uq_leads_normalized_phone',
           'o mesmo telefone pode virar dois cadastros, e a conversa do paciente se divide em dois cards')
        ) as v(nome, consequencia)
        left join pg_class c on c.relname = v.nome
             and c.relnamespace = 'public'::regnamespace
             and c.relkind = 'i'
        left join pg_index ix on ix.indexrelid = c.oid
       where ix.indexrelid is null
          or not ix.indisunique
          or not ix.indisvalid
          or not ix.indisready
    loop
      v_tocados := v_tocados || md5('monitor|invariante_sumiu_' || r.nome || '|-');
      perform public.log_system_error(
        'monitor', 'invariante_sumiu_' || r.nome,
        'Trava de seguranca do banco fora do ar: ' || r.consequencia,
        'critical', null,
        jsonb_build_object(
          'indice', r.nome, 'existe', r.existe, 'unico', r.unico,
          'valido', r.valido, 'pronto', r.pronto,
          'obs', 'Essa trava e um INDICE, nao codigo: o app nao substitui, e cinco caminhos criam '
                 || 'ticket sendo que dois dao insert direto. Enquanto estiver fora, o banco aceita '
                 || 'o duplicado em silencio e o estrago so aparece no painel dias depois.'),
        true
      );
      n_mon := n_mon + 1;
    end loop;
  exception when others then
    v_tocados := v_tocados
      || md5('monitor|monitor_falhou_invariante|-')
      || coalesce((select array_agg(e.fingerprint) from public.system_errors e
                    where e.is_monitor and e.status <> 'resolved'
                      and starts_with(e.code, 'invariante_sumiu_')), array[]::text[]);
    perform public.log_system_error(
      'monitor', 'monitor_falhou_invariante',
      'A vigilancia das travas anti-duplicacao parou de rodar (esse risco ficou sem vigia)',
      'error', null, jsonb_build_object('erro', SQLERRM, 'sqlstate', SQLSTATE), true
    );
    n_falhas := n_falhas + 1;
  end;

  -- (d) Wrapper de painel sem assert_clinic_access.
  -- Reescrever o wrapper como se fosse a RPC apaga o guard e reabre o vazamento entre clinicas,
  -- sem erro nenhum aparecer. Comentarios de linha sao removidos antes do teste, de proposito:
  -- um "assert_clinic_access" comentado nao pode passar por guard.
  begin
    for r in
      with impls as (
        select distinct left(p.proname, length(p.proname) - 5) as base
          from pg_proc p
         where p.pronamespace = 'public'::regnamespace
           and p.prokind = 'f'
           and right(p.proname, 5) = '_impl'
      )
      select i.base,
             exists (select 1 from pg_proc w
                      where w.proname = i.base
                        and w.pronamespace = 'public'::regnamespace
                        and w.prokind = 'f') as tem_wrapper,
             (select string_agg(w.oid::regprocedure::text, ' | ')
                from pg_proc w
               where w.proname = i.base
                 and w.pronamespace = 'public'::regnamespace
                 and w.prokind = 'f'
                 and regexp_replace(w.prosrc, '--[^\n]*', '', 'g') !~* 'assert_clinic_access'
             ) as sem_guard
        from impls i
       where not exists (select 1 from pg_proc w
                          where w.proname = i.base
                            and w.pronamespace = 'public'::regnamespace
                            and w.prokind = 'f')
          or exists (select 1 from pg_proc w
                      where w.proname = i.base
                        and w.pronamespace = 'public'::regnamespace
                        and w.prokind = 'f'
                        and regexp_replace(w.prosrc, '--[^\n]*', '', 'g') !~* 'assert_clinic_access')
    loop
      v_tocados := v_tocados || md5('monitor|painel_sem_guard_' || r.base || '|-');
      perform public.log_system_error(
        'monitor', 'painel_sem_guard_' || r.base,
        case when r.tem_wrapper
             then 'Painel "' || r.base || '" ficou sem a trava de acesso: um cliente pode acabar '
                  || 'vendo os dados de outra clinica'
             else 'Painel "' || r.base || '" perdeu a porta de entrada: a tela vai dar erro de '
                  || 'permissao ao carregar'
        end,
        case when r.tem_wrapper then 'critical' else 'error' end,
        null,
        jsonb_build_object(
          'rpc', r.base, 'tem_wrapper', r.tem_wrapper, 'sem_guard', r.sem_guard,
          'obs', 'Toda RPC de painel e um PAR: o wrapper publico so chama '
                 || 'assert_clinic_access(p_clinic_id) e delega para a _impl, que e onde a logica '
                 || 'mora. Mexer na regra e mexer na _impl; reescrever o wrapper apaga o guard.'),
        true
      );
      n_mon := n_mon + 1;
    end loop;
  exception when others then
    v_tocados := v_tocados
      || md5('monitor|monitor_falhou_painel_sem_guard|-')
      || coalesce((select array_agg(e.fingerprint) from public.system_errors e
                    where e.is_monitor and e.status <> 'resolved'
                      and starts_with(e.code, 'painel_sem_guard_')), array[]::text[]);
    perform public.log_system_error(
      'monitor', 'monitor_falhou_painel_sem_guard',
      'A vigilancia da trava de acesso dos paineis parou de rodar (esse risco ficou sem vigia)',
      'error', null, jsonb_build_object('erro', SQLERRM, 'sqlstate', SQLSTATE), true
    );
    n_falhas := n_falhas + 1;
  end;

  -- (e) A IA voltou a atender SEM MEMORIA.
  -- Prova direta e barata: no MESMO lead, a resposta da IA gravada numa session_id e a mensagem
  -- do paciente em outra. Quando isso acontece, a janela de conversa que o agente le so tem as
  -- falas dele mesmo, o loadConversation descarta os 'assistant' do inicio, e o modelo atende com
  -- UMA mensagem sem historico: se reapresenta e repergunta o nome no meio do atendimento.
  -- Foi o defeito de 17/07 a 30/07 (Vaz: 49 de 59 leads). A chave e o telefone NORMALIZADO, e a
  -- fonte dela e uma so: ingest_wa_message devolve, wa-inbound repassa, ai-agent usa.
  begin
    for r in
      with recentes as (
        select cm.clinic_id, cm.lead_id,
               min(cm.session_id) filter (where cm.sender = 'ai') as sess_ai,
               min(cm.session_id) filter (where cm.direction = 'inbound') as sess_in
          from chat_messages cm
         where cm.created_at >= (now() at time zone 'America/Sao_Paulo') - interval '24 hours'
           and cm.lead_id is not null
         group by cm.clinic_id, cm.lead_id
      )
      select x.clinic_id, c.name, count(*) as leads
        from recentes x join clinics c on c.id = x.clinic_id
       where x.sess_ai is not null and x.sess_in is not null and x.sess_ai <> x.sess_in
       group by x.clinic_id, c.name
    loop
      v_tocados := v_tocados || md5('monitor|ia_sem_memoria|' || r.clinic_id::text);
      perform public.log_system_error(
        'monitor', 'ia_sem_memoria',
        r.leads || ' atendimento(s) da IA nas ultimas 24h com a memoria partida em duas: a IA esta '
          || 'respondendo sem lembrar da conversa em ' || r.name,
        'critical', r.clinic_id,
        jsonb_build_object(
          'leads', r.leads,
          'obs', 'A resposta da IA e a mensagem do paciente cairam em session_id diferentes no MESMO '
                 || 'lead. Quase sempre e o 9o digito: a chave tem que sair do telefone NORMALIZADO, '
                 || 'e quem manda e o banco (ingest_wa_message devolve session_id, o wa-inbound '
                 || 'repassa, o ai-agent usa). Conferir tambem o alerta sessao_montada_no_fallback.'),
        true
      );
      n_mon := n_mon + 1;
    end loop;
  exception when others then
    v_tocados := v_tocados
      || md5('monitor|monitor_falhou_ia_sem_memoria|-')
      || coalesce((select array_agg(e.fingerprint) from public.system_errors e
                    where e.is_monitor and e.status <> 'resolved'
                      and e.code = 'ia_sem_memoria'), array[]::text[]);
    perform public.log_system_error(
      'monitor', 'monitor_falhou_ia_sem_memoria',
      'A vigilancia da memoria da IA parou de rodar (esse risco ficou sem vigia)',
      'error', null, jsonb_build_object('erro', SQLERRM, 'sqlstate', SQLSTATE), true
    );
    n_falhas := n_falhas + 1;
  end;

  -- (f) O import do onboarding gravou de novo uma mensagem que o PROPRIO sistema mandou.
  -- Assinatura: linha outbound com sender='human' (o import fixa 'human') e created_at em segundo
  -- INTEIRO (o import usa o messageTimestamp da uazapi; linha viva tem microssegundos), cujo texto
  -- esta dentro de uma linha 'ai'/'system' do mesmo lead a menos de 90s. Na tela, isso e a fala da
  -- IA duplicada e assinada como atendente humano, e ainda empurra a regua IA x Humano para Humano.
  begin
    for r in
      select cm.clinic_id, c.name, count(*) as copias, count(distinct cm.lead_id) as leads
        from chat_messages cm
        join clinics c on c.id = cm.clinic_id
       where cm.created_at >= (now() at time zone 'America/Sao_Paulo') - interval '24 hours'
         and cm.direction = 'outbound' and cm.sender = 'human'
         and (date_part('microseconds', cm.created_at)::bigint % 1000000) = 0
         and exists (
           select 1 from chat_messages y
            where y.lead_id = cm.lead_id
              and y.direction = 'outbound' and y.sender in ('ai','system')
              and y.created_at between cm.created_at - interval '90 seconds'
                                   and cm.created_at + interval '90 seconds'
              and btrim(coalesce(y.message->>'content','')) <> ''
              and position(btrim(coalesce(cm.message->>'content','')) in
                           btrim(coalesce(y.message->>'content',''))) > 0)
       group by cm.clinic_id, c.name
    loop
      v_tocados := v_tocados || md5('monitor|conversa_duplicada_import|' || r.clinic_id::text);
      perform public.log_system_error(
        'monitor', 'conversa_duplicada_import',
        r.copias || ' mensagem(ns) que o sistema enviou voltaram para a conversa como se um atendente '
          || 'tivesse escrito, em ' || r.leads || ' contato(s) de ' || r.name,
        'error', r.clinic_id,
        jsonb_build_object(
          'copias', r.copias, 'leads', r.leads,
          'obs', 'E o import do onboarding relendo o store da uazapi e gravando de novo o envio '
                 || 'proprio. Conferir onboarding_deep_sync (status running numa clinica que ja '
                 || 'concluiu o onboarding) e as tres travas de _onboarding_import_run: id igual, '
                 || 'id nosso (prefixo <jid>: em wa_message_id / provider_message_id) e mesmo texto.'),
        true
      );
      n_mon := n_mon + 1;
    end loop;
  exception when others then
    v_tocados := v_tocados
      || md5('monitor|monitor_falhou_conversa_duplicada|-')
      || coalesce((select array_agg(e.fingerprint) from public.system_errors e
                    where e.is_monitor and e.status <> 'resolved'
                      and e.code = 'conversa_duplicada_import'), array[]::text[]);
    perform public.log_system_error(
      'monitor', 'monitor_falhou_conversa_duplicada',
      'A vigilancia de mensagem duplicada na conversa parou de rodar (esse risco ficou sem vigia)',
      'error', null, jsonb_build_object('erro', SQLERRM, 'sqlstate', SQLSTATE), true
    );
    n_falhas := n_falhas + 1;
  end;

  update public.system_errors
     set status = 'resolved', resolved_at = now()
   where is_monitor and status <> 'resolved'
     and not (fingerprint = any(v_tocados));

  return jsonb_build_object('cron', n_cron, 'edge', n_edge, 'monitores', n_mon,
                            'monitores_falharam', n_falhas);
end;
$function$
;
