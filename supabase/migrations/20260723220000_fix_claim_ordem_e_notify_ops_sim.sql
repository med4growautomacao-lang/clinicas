-- FIX 1 (ordem por conversa): uma bolha posterior nao pode ultrapassar uma anterior que esta em
-- BACKOFF. A checagem de "existe anterior pendente" exigia `not_before <= now()`, entao uma bolha
-- anterior em retry (not_before no futuro) nao contava e a seguinte era enviada antes dela. Remover
-- a condicao de not_before: se existe QUALQUER anterior pendente (vai ser reenviada), a atual espera.
create or replace function public.claim_outbound_messages(
  p_limit  int  default 25,
  p_worker text default null
) returns setof public.outbound_messages
language plpgsql security definer set search_path to 'public'
as $$
begin
  return query
  with candidatas as (
    select o.id
      from public.outbound_messages o
     where o.status = 'pending'
       and o.not_before <= now()
       and not exists (
             select 1 from public.outbound_messages b
              where b.conversation_key = o.conversation_key and b.status = 'sending')
       and not exists (
             -- QUALQUER anterior ainda pendente (due OU em backoff) segura a atual: ordem estrita.
             select 1 from public.outbound_messages b
              where b.conversation_key = o.conversation_key
                and b.status = 'pending' and b.seq < o.seq)
       and pg_try_advisory_xact_lock(hashtext(o.conversation_key))
     order by o.seq
     limit greatest(coalesce(p_limit, 25), 1)
     for update skip locked
  )
  update public.outbound_messages o
     set status     = 'sending',
         claimed_at = now(),
         claimed_by = coalesce(p_worker, 'worker'),
         attempts   = o.attempts + 1
    from candidatas c
   where o.id = c.id
  returning o.*;
end $$;

-- FIX 2 (vazamento do sandbox): notify_ops de um lead de SIMULACAO nao pode gerar sino nem espelho
-- no grupo real (o envio ao grupo usa to_kind='group' sem lead_id -> transport='uazapi', ignorando
-- o roteamento de sandbox). Guarda no lugar CERTO (a fonte unica das notificacoes de ops), em vez de
-- remendar cada trigger que a chama.
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

  -- Lead de simulacao (sandbox): nao notifica ops (nem sino nem grupo). O envio ao grupo nao passa
  -- pelo roteamento de sandbox, entao sem esta guarda um teste vazaria para o WhatsApp real da ops.
  if p_lead_id is not null and exists (
       select 1 from public.leads where id = p_lead_id and coalesce(is_simulation, false)
     ) then
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
          perform public.emit_message(
            p_clinic_id => p_clinic_id, p_to_addr => v_group, p_producer => 'notify_ops_group',
            p_body => v_text, p_to_kind => 'group');
        else
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
