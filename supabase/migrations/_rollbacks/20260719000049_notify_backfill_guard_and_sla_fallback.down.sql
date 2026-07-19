-- Rollback: remove a guarda de backfill do notify_ops e volta o open_clinic do SLA
-- para a versão só-médicos (000038). NÃO recomendado (reintroduz o SLA morto p/ varejo).

-- notify_ops SEM a guarda app.suppress_ops_notify.
create or replace function public.notify_ops(
  p_clinic_id uuid, p_event text, p_title text, p_body text default null,
  p_level text default 'info', p_lead_id uuid default null, p_ticket_id uuid default null,
  p_appointment_id uuid default null, p_link text default null, p_payload jsonb default '{}'::jsonb,
  p_notify_group boolean default true, p_group_text text default null
) returns uuid language plpgsql security definer set search_path to 'public' as $function$
declare
  v_id uuid; v_group text; v_token text; v_text text; v_prefs jsonb; v_ev jsonb;
  v_sino boolean; v_grupo boolean; v_roles text[];
begin
  select notification_prefs, notification_group_id into v_prefs, v_group from clinics where id = p_clinic_id;
  v_prefs := coalesce(v_prefs, '{}'::jsonb);
  v_ev := v_prefs -> 'events' -> p_event;
  v_sino  := coalesce((v_prefs->>'sino_all')::boolean, true)  and coalesce((v_ev->>'sino')::boolean, true);
  v_grupo := coalesce((v_prefs->>'group_all')::boolean, true) and coalesce((v_ev->>'grupo')::boolean, true);
  if v_ev ? 'roles' and jsonb_typeof(v_ev->'roles') = 'array' then
    v_roles := array(select jsonb_array_elements_text(v_ev->'roles'));
  else v_roles := null; end if;
  if v_sino then
    insert into notifications (clinic_id, event, level, title, body, lead_id, ticket_id, appointment_id, link, payload, target_roles)
    values (p_clinic_id, p_event, coalesce(nullif(p_level,''),'info'), p_title, p_body,
            p_lead_id, p_ticket_id, p_appointment_id, p_link, coalesce(p_payload,'{}'::jsonb), v_roles)
    returning id into v_id;
  end if;
  if coalesce(p_notify_group, true) and v_grupo then
    begin
      if v_group is not null and btrim(v_group) <> '' then
        select api_token into v_token from whatsapp_instances where clinic_id = p_clinic_id limit 1;
        if v_token is not null and btrim(v_token) <> '' then
          v_text := coalesce(nullif(btrim(p_group_text), ''),
            p_title || case when p_body is not null and btrim(p_body) <> '' then E'\n' || p_body else '' end);
          perform system_http_post('https://med4growautomacao.uazapi.com/send/text',
            jsonb_build_object('Content-Type','application/json','Accept','application/json','token', v_token),
            jsonb_build_object('number', v_group, 'text', v_text, 'delay', 0), 5000);
        end if;
      end if;
    exception when others then
      perform log_system_error('notify_ops','group_send_failed','Falha ao espelhar notificação no grupo WhatsApp',
        'warning', p_clinic_id, jsonb_build_object('event', p_event, 'detail', sqlerrm), false);
    end;
  end if;
  return v_id;
end; $function$;

-- process_sla_unanswered com open_clinic SÓ-médicos (000038).
create or replace function public.process_sla_unanswered(p_minutes integer default 15)
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare
  v_now timestamp := (now() at time zone 'America/Sao_Paulo');
  v_dow text := extract(dow from v_now)::text;
  v_time text := to_char(v_now, 'HH24:MI');
  r record; v_count integer := 0;
begin
  for r in
    with cand as (
      select l.id, l.clinic_id, l.name, l.phone, l.sla_alerted_at,
             coalesce((c.notification_prefs->'sla'->>'enabled')::boolean, c.notification_group_id is not null) as sla_on,
             coalesce((c.notification_prefs->'sla'->>'minutes')::int, p_minutes) as sla_min
      from leads l join clinics c on c.id = l.clinic_id
      where l.last_activity_at > v_now - interval '6 hours' and coalesce(l.is_not_lead, false) = false
    ),
    open_clinic as (
      select distinct d.clinic_id from doctors d
      cross join lateral jsonb_array_elements(coalesce(d.working_hours -> v_dow, '[]'::jsonb)) sh
      where d.is_active and v_time >= (sh->>'start') and v_time < (sh->>'end')
    ),
    last_msg as (
      select distinct on (m.lead_id) m.lead_id, m.direction, m.created_at
      from chat_messages m where m.lead_id in (select id from cand)
      order by m.lead_id, m.created_at desc
    )
    select cand.id, cand.clinic_id, cand.name, cand.phone, cand.sla_alerted_at, cand.sla_min,
           lm.created_at as last_in,
           (select max(m2.created_at) from chat_messages m2 where m2.lead_id = cand.id and m2.direction = 'outbound') as last_out
    from cand join last_msg lm on lm.lead_id = cand.id join open_clinic oc on oc.clinic_id = cand.clinic_id
    where cand.sla_on and lm.direction = 'inbound' and lm.created_at < v_now - make_interval(mins => cand.sla_min)
  loop
    if r.sla_alerted_at is null or (r.last_out is not null and r.sla_alerted_at < r.last_out) then
      update leads set sla_alerted_at = v_now where id = r.id;
      perform notify_ops(r.clinic_id, 'nao_atendido', 'Lead sem resposta há ' || r.sla_min || ' min',
        coalesce(nullif(btrim(r.name), ''), r.phone) || coalesce(' · ' || nullif(r.phone, ''), '') || E'\nNinguém respondeu ainda.',
        'warning', r.id, null, null, null, '{}'::jsonb, true, null);
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
exception when others then
  perform log_system_error('sla-unanswered', 'sla_failed', 'Falha no alerta de nao-atendido', 'error', null, jsonb_build_object('detail', sqlerrm), false);
  return v_count;
end; $function$;
