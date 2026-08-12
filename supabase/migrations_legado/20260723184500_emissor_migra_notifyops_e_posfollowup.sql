-- Migra mais 2 dos 5 emissores do BANCO atras da chave `fn_emissor_ativo`.
--   notify_ops         -> espelho no GRUPO interno (token da clinica). Corrige `api_token limit 1` cru.
--   process_pos_followup -> pos-atendimento ao paciente. Corrige o telefone CRU (emit normaliza).
--
-- send_clinic_report FICA no caminho antigo DE PROPOSITO: envia pelo WhatsApp da ORG (token por
-- org_id), e o gate do worker resolve token por clinic_id. Migra-lo exige o Emissor aprender
-- roteamento por instancia de ORG. Anotado como pendente; ele ja tem gate proprio de conexao.

-- =============================================================================================
-- notify_ops: so o espelho no grupo muda. Sino/notifications e toda a logica de prefs ficam.
-- =============================================================================================
create or replace function public.notify_ops(p_clinic_id uuid, p_event text, p_title text, p_body text DEFAULT NULL::text, p_level text DEFAULT 'info'::text, p_lead_id uuid DEFAULT NULL::uuid, p_ticket_id uuid DEFAULT NULL::uuid, p_appointment_id uuid DEFAULT NULL::uuid, p_link text DEFAULT NULL::text, p_payload jsonb DEFAULT '{}'::jsonb, p_notify_group boolean DEFAULT true, p_group_text text DEFAULT NULL::text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_id uuid; v_group text; v_token text; v_text text;
  v_prefs jsonb; v_ev jsonb; v_sino boolean; v_grupo boolean; v_roles text[];
begin
  if coalesce(current_setting('app.suppress_ops_notify', true), '') = 'on' then
    return null;
  end if;

  select notification_prefs, notification_group_id into v_prefs, v_group
    from clinics where id = p_clinic_id;
  v_prefs := coalesce(v_prefs, '{}'::jsonb);
  v_ev := v_prefs -> 'events' -> p_event;

  v_sino  := coalesce((v_prefs->>'sino_all')::boolean, true)  and coalesce((v_ev->>'sino')::boolean, true);
  v_grupo := coalesce((v_prefs->>'group_all')::boolean, true) and coalesce((v_ev->>'grupo')::boolean, true);

  if v_ev ? 'roles' and jsonb_typeof(v_ev->'roles') = 'array' then
    v_roles := array(select jsonb_array_elements_text(v_ev->'roles'));
  else
    v_roles := null;
  end if;

  if v_sino then
    insert into notifications (clinic_id, event, level, title, body, lead_id, ticket_id, appointment_id, link, payload, target_roles)
    values (p_clinic_id, p_event, coalesce(nullif(p_level,''),'info'), p_title, p_body,
            p_lead_id, p_ticket_id, p_appointment_id, p_link, coalesce(p_payload,'{}'::jsonb), v_roles)
    returning id into v_id;
  end if;

  if coalesce(p_notify_group, true) and v_grupo then
    begin
      if v_group is not null and btrim(v_group) <> '' then
        v_text := coalesce(
          nullif(btrim(p_group_text), ''),
          p_title || case when p_body is not null and btrim(p_body) <> '' then E'\n' || p_body else '' end
        );
        if public.fn_emissor_ativo(p_clinic_id) then
          -- EMISSOR: enfileira para o grupo (to_kind='group' -> nao normaliza, nao entra na
          -- conversa do paciente). O gate/entrega/retry ficam no worker.
          perform public.emit_message(
            p_clinic_id => p_clinic_id, p_to_addr => v_group, p_producer => 'notify_ops_group',
            p_body => v_text, p_to_kind => 'group');
        else
          -- Caminho antigo (chave desligada): envio inline.
          select api_token into v_token from whatsapp_instances where clinic_id = p_clinic_id limit 1;
          if v_token is not null and btrim(v_token) <> '' then
            perform system_http_post(
              'https://med4growautomacao.uazapi.com/send/text',
              jsonb_build_object('Content-Type','application/json','Accept','application/json','token', v_token),
              jsonb_build_object('number', v_group, 'text', v_text, 'delay', 0), 5000);
          end if;
        end if;
      end if;
    exception when others then
      perform log_system_error(
        'notify_ops','group_send_failed','Falha ao espelhar notificação no grupo WhatsApp',
        'warning', p_clinic_id, jsonb_build_object('event', p_event, 'detail', sqlerrm), false);
    end;
  end if;

  return v_id;
end;
$function$;

-- =============================================================================================
-- process_pos_followup: so o bloco de envio no loop muda. A logica de expiracao, janela, cap e
-- os candidatos ficam. emit_message normaliza r.telefone (o caminho antigo mandava cru).
-- =============================================================================================
create or replace function public.process_pos_followup()
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  r record; v_msg text; v_token text; v_count integer := 0; v_expired integer := 0;
  v_now timestamp := now() at time zone 'America/Sao_Paulo';
  v_hour int := extract(hour from (now() at time zone 'America/Sao_Paulo'));
  v_max_per_clinic int := 5;
begin
  with expired as (
    update public.tickets t set pos_followup_expired_at = now()
      from public.ai_config ai
     where ai.clinic_id = t.clinic_id
       and t.outcome in ('ganho','perdido') and t.outcome_at is not null
       and t.pos_followup_sent_at is null and t.pos_followup_expired_at is null
       and (
         (t.outcome = 'ganho'
            and t.outcome_at < now() - ((coalesce(ai.pos_followup_ganho_days,1)  + coalesce(ai.pos_followup_grace_days,2)) || ' days')::interval)
         or
         (t.outcome = 'perdido'
            and t.outcome_at < now() - ((coalesce(ai.pos_followup_perdido_days,1) + coalesce(ai.pos_followup_grace_days,2)) || ' days')::interval)
       )
    returning 1
  )
  select count(*) into v_expired from expired;

  if v_expired > 0 then
    perform log_system_error('pos-followup','expired_suppressed',
      'Pós-atendimento retirado da fila por vencimento (janela expirada)','info',
      null, jsonb_build_object('count', v_expired), false);
  end if;

  for r in
    select * from (
      select c.*, row_number() over (partition by c.clinic_id order by c.eligible_at asc) as rn
        from public.fn_followup_candidates_pos() c
       where c.toggle_on and c.wa_ok
         and c.eligible_at <= v_now and c.expires_at >= v_now
         and v_hour >= c.window_start and v_hour < c.window_end
    ) q where q.rn <= v_max_per_clinic
  loop
    begin
      v_msg := r.message;
      if v_msg is null or btrim(v_msg) = '' then
        update tickets set pos_followup_sent_at = now() where id = r.ticket_id;
        continue;
      end if;
      v_msg := replace(replace(v_msg, '{paciente}', coalesce(r.nome,'')), '{nome}', coalesce(r.nome,''));

      if public.fn_emissor_ativo(r.clinic_id) then
        -- EMISSOR: enfileira (worker resolve token e normaliza telefone) e marca como enviado.
        -- dedup_key 'pos:<ticket>' = idempotencia se o cron sobrepuser.
        perform public.emit_message(
          p_clinic_id => r.clinic_id, p_to_addr => r.telefone, p_producer => 'pos_followup',
          p_body => v_msg, p_lead_id => r.lead_id, p_dedup_key => 'pos:' || r.ticket_id::text,
          p_chat_payload => jsonb_build_object('sender','system',
            'message', jsonb_build_object('type','system','content', v_msg,
                       'additional_kwargs','{}'::jsonb,'response_metadata','{}'::jsonb)));
        update tickets set pos_followup_sent_at = now() where id = r.ticket_id;
        v_count := v_count + 1;
      else
        -- Caminho antigo (chave desligada): gate inline + envio com telefone CRU, como sempre foi.
        v_token := fn_clinic_send_token(r.clinic_id);
        if v_token is null then continue; end if;
        perform system_http_post('https://med4growautomacao.uazapi.com/send/text',
          jsonb_build_object('Content-Type','application/json','token', v_token),
          jsonb_build_object('number', r.telefone, 'text', v_msg, 'delay', 0), 5000);
        insert into chat_messages (clinic_id, lead_id, phone, direction, sender, message)
        values (r.clinic_id, r.lead_id, r.telefone, 'outbound', 'system',
                jsonb_build_object('type','system','content', v_msg, 'additional_kwargs','{}'::jsonb, 'response_metadata','{}'::jsonb));
        update tickets set pos_followup_sent_at = now() where id = r.ticket_id;
        v_count := v_count + 1;
      end if;
    exception when others then
      perform log_system_error('pos-followup','send_failed','Falha ao enviar pós-atendimento',
        'error', r.clinic_id, jsonb_build_object('ticket_id', r.ticket_id, 'detail', sqlerrm), false);
    end;
  end loop;
  return v_count;
exception when others then
  perform log_system_error('pos-followup','job_failed','Falha no job de pós-atendimento','error',
    null, jsonb_build_object('detail', sqlerrm), false);
  return v_count;
end; $function$;