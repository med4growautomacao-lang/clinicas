-- SLA respeita o horário de funcionamento (expediente dos médicos) em vez do 7h-21h fixo,
-- e lê a config por clínica de notification_prefs.sla { enabled, minutes }.
-- Clínica "aberta agora" = existe médico ativo com um turno (working_hours) contendo o horário atual.
-- Default: sla.enabled = (tem grupo de notificações), minutes = 15 (fallback do param).

create or replace function public.process_sla_unanswered(p_minutes integer default 15)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_now timestamp := (now() at time zone 'America/Sao_Paulo');
  v_dow text := extract(dow from v_now)::text;   -- 0=Dom..6=Sáb (mesma convenção do get_available_slots)
  v_time text := to_char(v_now, 'HH24:MI');
  r record;
  v_count integer := 0;
begin
  for r in
    with cand as (
      select l.id, l.clinic_id, l.name, l.phone, l.sla_alerted_at,
             coalesce((c.notification_prefs->'sla'->>'enabled')::boolean, c.notification_group_id is not null) as sla_on,
             coalesce((c.notification_prefs->'sla'->>'minutes')::int, p_minutes) as sla_min
      from leads l
      join clinics c on c.id = l.clinic_id
      where l.last_activity_at > v_now - interval '6 hours'
        and coalesce(l.is_not_lead, false) = false
    ),
    open_clinic as (   -- clínicas com expediente ativo AGORA (algum médico com turno contendo o horário)
      select distinct d.clinic_id
      from doctors d
      cross join lateral jsonb_array_elements(coalesce(d.working_hours -> v_dow, '[]'::jsonb)) sh
      where d.is_active
        and v_time >= (sh->>'start') and v_time < (sh->>'end')
    ),
    last_msg as (
      select distinct on (m.lead_id) m.lead_id, m.direction, m.created_at
      from chat_messages m
      where m.lead_id in (select id from cand)
      order by m.lead_id, m.created_at desc
    )
    select cand.id, cand.clinic_id, cand.name, cand.phone, cand.sla_alerted_at, cand.sla_min,
           lm.created_at as last_in,
           (select max(m2.created_at) from chat_messages m2
              where m2.lead_id = cand.id and m2.direction = 'outbound') as last_out
    from cand
    join last_msg lm on lm.lead_id = cand.id
    join open_clinic oc on oc.clinic_id = cand.clinic_id
    where cand.sla_on
      and lm.direction = 'inbound'
      and lm.created_at < v_now - make_interval(mins => cand.sla_min)
  loop
    if r.sla_alerted_at is null
       or (r.last_out is not null and r.sla_alerted_at < r.last_out) then
      update leads set sla_alerted_at = v_now where id = r.id;
      perform notify_ops(
        r.clinic_id, 'nao_atendido',
        'Lead sem resposta há ' || r.sla_min || ' min',
        coalesce(nullif(btrim(r.name), ''), r.phone) || coalesce(' · ' || nullif(r.phone, ''), '')
          || E'\nNinguém respondeu ainda.',
        'warning', r.id, null, null, null, '{}'::jsonb, true, null
      );
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
exception when others then
  perform log_system_error('sla-unanswered', 'sla_failed', 'Falha no alerta de nao-atendido',
    'error', null, jsonb_build_object('detail', sqlerrm), false);
  return v_count;
end;
$$;
