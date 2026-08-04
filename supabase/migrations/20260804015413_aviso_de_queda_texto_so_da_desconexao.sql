-- Texto do aviso enxugado (decisao do dono, 03/08/2026): a mensagem fala SO da
-- desconexao e de como reconectar. Saiu o paragrafo que listava o que para de
-- funcionar (IA, follow-up, lembrete, confirmacao).
--
-- Motivo: quem le o aviso no grupo da clinica precisa de duas coisas, o fato e a
-- acao. O resto e ruido, e citar a IA num aviso de infraestrutura mistura assuntos.
--
-- Unica mudanca em relacao a 20260804014806: o texto do grupo e o corpo do sino.
-- Toda a logica de guards, antirrepeticao e permissoes segue identica.
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
  v_conn    uuid;
  v_inst    uuid;
  v_base    text;
  v_link    text;
  v_texto   text;
  v_ja      boolean;
  v_sino    boolean;
  v_pode    boolean;
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

  -- Sino: direto em notifications, sem passar por notify_ops, que aplicaria
  -- `sino_all` e suprimiria 27 das 28 clinicas. Funciona ate na queda REAL,
  -- porque nao depende do WhatsApp.
  v_sino := coalesce((v_ev->>'sino')::boolean, true);
  if v_sino then
    insert into notifications (clinic_id, event, level, title, body, payload)
    values (p_clinic_id, 'whatsapp_desconectado', 'critical',
            'WhatsApp desconectado',
            'Reconecte em Configuracoes > Integracoes > WhatsApp.',
            jsonb_build_object('origem', p_origem, 'motivo', p_motivo));
  end if;

  v_pode := coalesce((v_ev->>'grupo')::boolean, true);
  if not v_pode then
    return jsonb_build_object('enviado', false, 'motivo', 'grupo_desligado_para_este_evento', 'sino', v_sino);
  end if;
  if v_grupo is null or btrim(v_grupo) = '' then
    return jsonb_build_object('enviado', false, 'motivo', 'clinica_sem_grupo_configurado', 'sino', v_sino);
  end if;
  if v_token is null or btrim(v_token) = '' then
    return jsonb_build_object('enviado', false, 'motivo', 'instancia_sem_token', 'sino', v_sino);
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

  perform system_http_post(
    'https://med4growautomacao.uazapi.com/send/text',
    jsonb_build_object('Content-Type','application/json','Accept','application/json','token', v_token),
    jsonb_build_object('number', v_grupo, 'text', v_texto, 'delay', 0),
    8000);

  insert into whatsapp_events (clinic_id, instance_id, event_type, source, payload)
  values (p_clinic_id, v_inst, 'aviso_queda_enviado', p_origem,
          jsonb_build_object('grupo', v_grupo, 'com_link', v_link is not null, 'motivo', p_motivo));

  return jsonb_build_object('enviado', true, 'grupo', v_grupo, 'com_link', v_link is not null, 'sino', v_sino);

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
