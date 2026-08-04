-- Avisa o grupo da clinica quando a instancia cai, com o link de reconexao.
-- Ate hoje a queda era silenciosa para o cliente: o atendimento automatico parava
-- (IA, follow-up, lembrete, confirmacao) e ninguem na clinica ficava sabendo.
--
-- ⚠️ ATENCAO: esta versao foi CORRIGIDA na migration 20260804014806, que descobriu
-- que os gates `sino_all`/`group_all` usados aqui zerariam a feature. Mantida como
-- historico; a definicao valida da funcao e a da migration seguinte.
--
-- ⚠️ POR QUE NAO PASSA PELO EMISSOR (excecao consciente a regra da §0.4)
-- O Emissor pega o token em fn_clinic_send_token, que EXIGE status='connected'. No
-- momento exato deste aviso o status acabou de virar 'disconnected', entao a fila
-- nunca entregaria: o canal que reportaria a quebra e o mesmo que quebrou.
-- Enfileirar antes de marcar tambem nao resolve, porque quem resgata o token e o
-- emissor-worker, la na frente, ja com o status derrubado.
-- Por isso o envio ao grupo e DIRETO, com o api_token da instancia (preservado na
-- queda). Numa queda REAL a uazapi recusa e nada e entregue, o que e inofensivo;
-- num alarme falso (o caso do incidente de 03/08) o aviso chega.
--
-- O link sai de system_settings.app_base_url. Sem esse valor o aviso vai SEM link,
-- de proposito: aviso sem link ainda avisa; nao avisar nao ajuda ninguem.
insert into system_settings (id, value, description)
values ('app_base_url', '',
        'Dominio publico do app (ex: https://app.exemplo.com.br), usado para montar o link de reconexao do WhatsApp enviado ao grupo da clinica. Vazio = aviso sai sem link.')
on conflict (id) do nothing;

create or replace function public.avisar_queda_whatsapp(
  p_clinic_id uuid,
  p_origem    text default 'sync_cron',
  p_motivo    text default null
) returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_nome    text;
  v_grupo   text;
  v_prefs   jsonb;
  v_ev      jsonb;
  v_pode    boolean;
  v_token   text;
  v_conn    uuid;
  v_inst    uuid;
  v_base    text;
  v_link    text;
  v_texto   text;
  v_ja      boolean;
begin
  select c.name, c.notification_group_id, coalesce(c.notification_prefs, '{}'::jsonb)
    into v_nome, v_grupo, v_prefs
  from clinics c where c.id = p_clinic_id and c.is_active;

  if v_nome is null then
    return jsonb_build_object('enviado', false, 'motivo', 'clinica_inativa_ou_inexistente');
  end if;

  select w.id, w.api_token, w.connect_token
    into v_inst, v_token, v_conn
  from whatsapp_instances w where w.clinic_id = p_clinic_id limit 1;

  select exists (
    select 1 from whatsapp_events e
    where e.instance_id = v_inst
      and e.event_type = 'aviso_queda_enviado'
      and e.created_at > now() - interval '3 hours'
  ) into v_ja;

  if v_ja then
    return jsonb_build_object('enviado', false, 'motivo', 'ja_avisado_nas_ultimas_3h');
  end if;

  perform public.notify_ops(
    p_clinic_id   => p_clinic_id,
    p_event       => 'whatsapp_desconectado',
    p_title       => 'WhatsApp desconectado',
    p_body        => 'O atendimento automatico esta parado ate reconectar.',
    p_level       => 'critical',
    p_notify_group=> false
  );

  v_ev := v_prefs -> 'events' -> 'whatsapp_desconectado';
  v_pode := coalesce((v_prefs->>'group_all')::boolean, true)
        and coalesce((v_ev->>'grupo')::boolean, true);

  if not v_pode then
    return jsonb_build_object('enviado', false, 'motivo', 'grupo_desligado_na_preferencia');
  end if;
  if v_grupo is null or btrim(v_grupo) = '' then
    return jsonb_build_object('enviado', false, 'motivo', 'clinica_sem_grupo_configurado');
  end if;
  if v_token is null or btrim(v_token) = '' then
    return jsonb_build_object('enviado', false, 'motivo', 'instancia_sem_token');
  end if;

  select nullif(btrim(value), '') into v_base from system_settings where id = 'app_base_url';
  if v_base is not null and v_conn is not null then
    v_link := rtrim(v_base, '/') || '/connect?token=' || v_conn::text;
  end if;

  v_texto :=
    '⚠️ *WhatsApp desconectado*' || E'\n\n' ||
    'O WhatsApp de *' || v_nome || '* saiu do ar em ' ||
    to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM ') || 'as ' ||
    to_char(now() at time zone 'America/Sao_Paulo', 'HH24:MI') || '.' || E'\n\n' ||
    'Enquanto isso o atendimento automatico fica parado: a IA nao responde, e os follow-ups, lembretes e confirmacoes nao saem. As mensagens que chegarem precisam ser respondidas a mao.' ||
    case when v_link is not null
         then E'\n\n' || 'Para reconectar, abra o link e escaneie o QR Code:' || E'\n' || v_link
         else E'\n\n' || 'Para reconectar, entre no sistema em Configuracoes > Integracoes > WhatsApp.'
    end;

  perform system_http_post(
    'https://med4growautomacao.uazapi.com/send/text',
    jsonb_build_object('Content-Type','application/json','Accept','application/json','token', v_token),
    jsonb_build_object('number', v_grupo, 'text', v_texto, 'delay', 0),
    8000);

  insert into whatsapp_events (clinic_id, instance_id, event_type, source, payload)
  values (p_clinic_id, v_inst, 'aviso_queda_enviado', p_origem,
          jsonb_build_object('grupo', v_grupo, 'com_link', v_link is not null, 'motivo', p_motivo));

  return jsonb_build_object('enviado', true, 'grupo', v_grupo, 'com_link', v_link is not null);

exception when others then
  perform log_system_error(
    'whatsapp', 'aviso_queda_falhou',
    'Falha ao avisar o grupo da clinica sobre a queda do WhatsApp',
    'error', p_clinic_id, jsonb_build_object('detalhe', sqlerrm, 'origem', p_origem), false);
  return jsonb_build_object('enviado', false, 'motivo', 'excecao', 'detalhe', sqlerrm);
end;
$function$;

revoke all on function public.avisar_queda_whatsapp(uuid, text, text) from public, anon, authenticated;
grant execute on function public.avisar_queda_whatsapp(uuid, text, text) to service_role;
