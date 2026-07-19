-- Rollback de 20260719000038_sla_business_hours.sql — volta ao gate fixo 7h-21h (000035).
create or replace function public.process_sla_unanswered(p_minutes integer default 15)
returns integer language plpgsql security definer set search_path to 'public' as $$
declare v_now timestamp := (now() at time zone 'America/Sao_Paulo'); r record; v_count integer := 0;
begin
  if extract(hour from v_now) < 7 or extract(hour from v_now) >= 21 then return 0; end if;
  for r in
    with cand as (
      select l.id, l.clinic_id, l.name, l.phone, l.sla_alerted_at
      from leads l join clinics c on c.id = l.clinic_id
      where l.last_activity_at > v_now - interval '6 hours'
        and coalesce(l.is_not_lead, false) = false and c.notification_group_id is not null
    ),
    last_msg as (
      select distinct on (m.lead_id) m.lead_id, m.direction, m.created_at
      from chat_messages m where m.lead_id in (select id from cand)
      order by m.lead_id, m.created_at desc
    )
    select cand.id, cand.clinic_id, cand.name, cand.phone, cand.sla_alerted_at, lm.created_at as last_in,
      (select max(m2.created_at) from chat_messages m2 where m2.lead_id = cand.id and m2.direction='outbound') as last_out
    from cand join last_msg lm on lm.lead_id = cand.id
    where lm.direction='inbound' and lm.created_at < v_now - make_interval(mins => p_minutes)
  loop
    if r.sla_alerted_at is null or (r.last_out is not null and r.sla_alerted_at < r.last_out) then
      update leads set sla_alerted_at = v_now where id = r.id;
      perform notify_ops(r.clinic_id,'nao_atendido','Lead sem resposta há '||p_minutes||' min',
        coalesce(nullif(btrim(r.name),''), r.phone) || coalesce(' · '||nullif(r.phone,''),'') || E'\nNinguém respondeu ainda.',
        'warning', r.id, null, null, null, '{}'::jsonb, true, null);
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
exception when others then
  perform log_system_error('sla-unanswered','sla_failed','Falha no alerta de nao-atendido','error', null, jsonb_build_object('detail', sqlerrm), false);
  return v_count;
end; $$;
