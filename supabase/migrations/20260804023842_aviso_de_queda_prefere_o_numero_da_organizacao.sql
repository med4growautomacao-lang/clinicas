-- O aviso saia pelo WhatsApp da PROPRIA clinica, que e justamente o que caiu: numa
-- queda real a uazapi recusa e ninguem e avisado. Agora ele prefere o numero da
-- ORGANIZACAO, que segue no ar independente da clinica.
--
-- ⚠️ ORDEM DELIBERADA: org PRIMEIRO, clinica so como ultimo recurso.
-- O instinto seria tentar a clinica e cair para a org se falhasse, mas o
-- system_http_post e assincrono (pg_net enfileira e devolve na hora), entao NAO da
-- para saber se o primeiro envio falhou e so entao tentar o segundo. Mandar pelos
-- dois entregaria a mensagem DUAS VEZES no alarme falso. Preferir a org resolve os
-- dois casos com um envio so: ela esta no ar tanto na queda real quanto na falsa.
--
-- ⚠️ PRE-REQUISITO QUE O CODIGO NAO GARANTE: para postar num grupo do WhatsApp e
-- preciso SER MEMBRO dele. O numero da org precisa ser adicionado a cada grupo de
-- notificacao, senao o envio falha calado. Por isso o request_id do pg_net passou a
-- ser gravado no evento: da para conferir o desfecho depois em net._http_response.
--
-- Sem instancia de organizacao conectada, cai no numero da clinica (comportamento
-- anterior), que cobre o alarme falso. Medido em 03/08/2026: existiam ZERO
-- instancias de organizacao, entao ate alguem parear um numero em OrgWhatsapp nada
-- muda na pratica.
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
  v_token   text;
  v_remet   text;
  v_conn    uuid;
  v_inst    uuid;
  v_org     uuid;
  v_base    text;
  v_link    text;
  v_texto   text;
  v_ja      boolean;
  v_sino    boolean;
  v_pode    boolean;
  v_roles   text[];
  v_req     bigint;
begin
  select c.name, c.notification_group_id, coalesce(c.notification_prefs, '{}'::jsonb), c.organization_id
    into v_nome, v_grupo, v_prefs, v_org
  from clinics c where c.id = p_clinic_id and c.is_active;

  if v_nome is null then
    return jsonb_build_object('enviado', false, 'motivo', 'clinica_inativa_ou_inexistente');
  end if;

  select w.id, w.connect_token into v_inst, v_conn
  from whatsapp_instances w where w.clinic_id = p_clinic_id limit 1;

  -- Antirrepeticao: instancia instavel (cai e volta) nao vira metralhadora no grupo.
  select exists (
    select 1 from whatsapp_events e
    where e.instance_id = v_inst
      and e.event_type = 'aviso_queda_enviado'
      and e.created_at > now() - interval '3 hours'
  ) into v_ja;

  if v_ja then
    return jsonb_build_object('enviado', false, 'motivo', 'ja_avisado_nas_ultimas_3h');
  end if;

  v_ev := v_prefs -> 'events' -> 'whatsapp_desconectado';

  -- Cargos escolhidos na tela. Vazio/ausente = todos (mesma regra do notify_ops).
  if v_ev ? 'roles' and jsonb_typeof(v_ev->'roles') = 'array' then
    v_roles := array(select jsonb_array_elements_text(v_ev->'roles'));
    if coalesce(array_length(v_roles, 1), 0) = 0 then v_roles := null; end if;
  else
    v_roles := null;
  end if;

  -- Sino: direto em notifications, sem passar por notify_ops, que aplicaria
  -- `sino_all` e suprimiria 27 das 28 clinicas. E o unico canal que funciona
  -- SEMPRE, porque nao depende de WhatsApp nenhum.
  v_sino := coalesce((v_ev->>'sino')::boolean, true);
  if v_sino then
    insert into notifications (clinic_id, event, level, title, body, payload, target_roles)
    values (p_clinic_id, 'whatsapp_desconectado', 'critical',
            'WhatsApp desconectado',
            'Reconecte em Configuracoes > Integracoes > WhatsApp.',
            jsonb_build_object('origem', p_origem, 'motivo', p_motivo),
            v_roles);
  end if;

  v_pode := coalesce((v_ev->>'grupo')::boolean, true);
  if not v_pode then
    return jsonb_build_object('enviado', false, 'motivo', 'grupo_desligado_para_este_evento', 'sino', v_sino);
  end if;
  if v_grupo is null or btrim(v_grupo) = '' then
    return jsonb_build_object('enviado', false, 'motivo', 'clinica_sem_grupo_configurado', 'sino', v_sino);
  end if;

  -- 1a opcao: numero da ORGANIZACAO (no ar mesmo com a clinica fora).
  select w.api_token into v_token
  from whatsapp_instances w
  where w.org_id = v_org and w.status = 'connected'
    and coalesce(btrim(w.api_token), '') <> ''
    and (w.send_blocked_until is null or w.send_blocked_until <= now())
  limit 1;
  v_remet := case when v_token is not null then 'organizacao' else null end;

  -- 2a opcao: numero da propria clinica. So resolve o ALARME FALSO, porque numa
  -- queda real a uazapi recusa. De proposito NAO exige status='connected': neste
  -- ponto o status ja foi derrubado, e e exatamente o alarme falso que queremos cobrir.
  if v_token is null then
    select w.api_token into v_token
    from whatsapp_instances w where w.clinic_id = p_clinic_id
      and coalesce(btrim(w.api_token), '') <> '' limit 1;
    v_remet := case when v_token is not null then 'clinica' else null end;
  end if;

  if v_token is null then
    return jsonb_build_object('enviado', false, 'motivo', 'sem_remetente_disponivel', 'sino', v_sino);
  end if;

  select nullif(btrim(value), '') into v_base from system_settings where id = 'app_base_url';
  if v_base is not null and v_conn is not null then
    v_link := rtrim(v_base, '/') || '/connect?token=' || v_conn::text;
  end if;

  v_texto :=
    '⚠️ *WhatsApp desconectado*' || E'\n\n' ||
    'O WhatsApp de *' || v_nome || '* saiu do ar em ' ||
    to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM') || ' as ' ||
    to_char(now() at time zone 'America/Sao_Paulo', 'HH24:MI') || '.' ||
    case when v_link is not null
         then E'\n\n' || 'Para reconectar, abra o link e escaneie o QR Code:' || E'\n' || v_link
         else E'\n\n' || 'Para reconectar, entre no sistema em Configuracoes > Integracoes > WhatsApp.'
    end;

  v_req := system_http_post(
    'https://med4growautomacao.uazapi.com/send/text',
    jsonb_build_object('Content-Type','application/json','Accept','application/json','token', v_token),
    jsonb_build_object('number', v_grupo, 'text', v_texto, 'delay', 0),
    8000);

  insert into whatsapp_events (clinic_id, instance_id, event_type, source, payload)
  values (p_clinic_id, v_inst, 'aviso_queda_enviado', p_origem,
          jsonb_build_object('grupo', v_grupo, 'com_link', v_link is not null,
                             'motivo', p_motivo, 'remetente', v_remet, 'req_id', v_req));

  return jsonb_build_object('enviado', true, 'grupo', v_grupo, 'com_link', v_link is not null,
                            'remetente', v_remet, 'sino', v_sino, 'req_id', v_req);

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
