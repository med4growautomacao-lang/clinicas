-- Rollback de 20260719000056 (travas de vencimento de followup).
-- Restaura process_pos_followup e process_reengagement_followup às versões anteriores
-- (sem cap/rate-limit/expiração). As colunas e o índice podem ficar (inertes) ou cair.
--
-- ATENÇÃO: dropar as colunas reintroduz o risco de burst ao religar. Só faça isso
-- se estiver revertendo o conceito inteiro. O carimbo pos_followup_expired_at já
-- aplicado (retirada do acúmulo) NÃO é revertido por este rollback.

-- process_pos_followup -> versão de 20260719000055 (sender system, sem cap/rate-limit).
create or replace function public.process_pos_followup()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare r record; v_msg text; v_count integer := 0;
begin
  for r in
    select t.id as ticket_id, t.clinic_id, t.lead_id, t.outcome,
           normalize_br_phone(l.phone) as phone, l.name as lead_name,
           ai.pos_followup_ganho_message, ai.pos_followup_perdido_message, wa.api_token
    from tickets t
    join leads l on l.id = t.lead_id
    join ai_config ai on ai.clinic_id = t.clinic_id
    join whatsapp_instances wa on wa.clinic_id = t.clinic_id
    where t.outcome in ('ganho','perdido') and t.outcome_at is not null
      and t.pos_followup_sent_at is null and wa.status = 'connected'
      and coalesce(l.followup_enabled, true) = true and coalesce(l.is_not_lead, false) = false
      and ((t.outcome = 'ganho' and coalesce(ai.pos_followup_ganho_enabled,false)
            and t.outcome_at <= now() - (coalesce(ai.pos_followup_ganho_days,1) || ' days')::interval)
        or (t.outcome = 'perdido' and coalesce(ai.pos_followup_perdido_enabled,false)
            and t.outcome_at <= now() - (coalesce(ai.pos_followup_perdido_days,1) || ' days')::interval))
      and extract(hour from now() at time zone 'America/Sao_Paulo') >= 8
      and extract(hour from now() at time zone 'America/Sao_Paulo') < 20
  loop
    begin
      v_msg := case when r.outcome = 'ganho' then r.pos_followup_ganho_message else r.pos_followup_perdido_message end;
      if v_msg is null or btrim(v_msg) = '' then
        update tickets set pos_followup_sent_at = now() where id = r.ticket_id;
        continue;
      end if;
      if r.phone is null or r.api_token is null or btrim(r.api_token) = '' then continue; end if;
      v_msg := replace(replace(v_msg, '{paciente}', coalesce(r.lead_name,'')), '{nome}', coalesce(r.lead_name,''));

      perform system_http_post('https://med4growautomacao.uazapi.com/send/text',
        jsonb_build_object('Content-Type','application/json','token', r.api_token),
        jsonb_build_object('number', r.phone, 'text', v_msg, 'delay', 0), 5000);

      insert into chat_messages (clinic_id, lead_id, phone, direction, sender, message)
      values (r.clinic_id, r.lead_id, r.phone, 'outbound', 'system',
              jsonb_build_object('type','system','content', 'PÓS-ATENDIMENTO: ' || v_msg, 'additional_kwargs','{}'::jsonb, 'response_metadata','{}'::jsonb));

      update tickets set pos_followup_sent_at = now() where id = r.ticket_id;
      v_count := v_count + 1;
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

-- process_reengagement_followup -> sem o cap de idade (remove a cláusula lm.last_at >= ...).
create or replace function public.process_reengagement_followup()
 returns void
 language plpgsql
as $function$
declare
  r record;
  v_url text := 'https://yzpclhuifquhfqpiwysh.supabase.co/functions/v1/reengagement-followup';
  v_now timestamp := now() at time zone 'America/Sao_Paulo';
  v_hour int := extract(hour from (now() at time zone 'America/Sao_Paulo'));
  v_max_per_clinic int := 5;
  v_payload jsonb;
begin
  for r in
    with elegiveis as (
      select l.id, l.name, l.phone, l.clinic_id, l.followup_count,
             w.phone_number as clinic_phone,
             s.message_text, s.step_no, s.is_closing,
             row_number() over (partition by l.clinic_id order by lm.last_at asc) as rn
      from public.leads l
      join public.ai_config ac on ac.clinic_id = l.clinic_id
      join public.followup_steps s
        on s.clinic_id = l.clinic_id
       and s.step_no = l.followup_count + 1
       and s.enabled = true
      join lateral (
        select wi.phone_number, wi.api_token
        from public.whatsapp_instances wi
        where wi.clinic_id = l.clinic_id
        limit 1
      ) w on true
      join lateral (
        select cm.direction as last_dir, cm.created_at as last_at
        from public.chat_messages cm
        where cm.lead_id = l.id
        order by cm.seq desc
        limit 1
      ) lm on true
      where ac.followup_enabled = true
        and l.followup_enabled = true
        and l.ai_enabled = true
        and l.handoff_triggered_at is null
        and l.converted_patient_id is null
        and coalesce(l.is_not_lead, false) = false
        and w.api_token is not null
        and l.phone is not null and l.phone <> ''
        and v_hour >= coalesce(ac.followup_window_start, 6)
        and v_hour <  coalesce(ac.followup_window_end, 22)
        and not exists (
          select 1 from public.tickets t
          where t.lead_id = l.id and t.outcome = 'ganho'
        )
        and exists (
          select 1 from public.tickets t
          join public.funnel_stages fs on fs.id = t.stage_id
          where t.lead_id = l.id and t.status = 'open'
            and fs.slug not in ('agendado','compareceu','ganho','perdido')
        )
        and lm.last_dir = 'outbound'
        and lm.last_at < (v_now - (s.delay_minutes || ' minutes')::interval)
        and (l.followup_sent_at is null or l.followup_sent_at < (v_now - (s.delay_minutes || ' minutes')::interval))
    )
    select id, name, phone, clinic_id, followup_count, clinic_phone, message_text, step_no, is_closing
    from elegiveis
    where rn <= v_max_per_clinic
  loop
    v_payload := jsonb_build_object(
      'lead_id',        r.id,
      'clinic_id',      r.clinic_id,
      'name',           r.name,
      'phone',          r.phone,
      'clinic_phone',   r.clinic_phone,
      'message_text',   r.message_text,
      'step_no',        r.step_no,
      'is_closing',     r.is_closing,
      'expected_count', r.followup_count
    );
    perform public.system_http_post(
      url     := v_url,
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body    := v_payload
    );
  end loop;
end;
$function$;

-- Opcional (só se revertendo o conceito inteiro):
-- drop index if exists public.idx_tickets_pos_followup_pending;
-- alter table public.tickets   drop column if exists pos_followup_expired_at;
-- alter table public.ai_config drop column if exists pos_followup_grace_days;
-- alter table public.ai_config drop column if exists followup_max_idle_days;
