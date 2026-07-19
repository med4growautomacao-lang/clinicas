-- Reengajamento: anti-burst por CLÍNICA (antes era global, LIMIT 5 no total).
--
-- Mesmo tratamento aplicado ao welcome (migr. 20260719000003): o cap de 5/tick agora é POR clínica
-- (row_number particionado por clinic_id, ordenado pelo lead mais inativo primeiro — last_at asc).
-- Duas clínicas com backlog não competem mais pela mesma cota. Preserva TODA a lógica de gates:
-- gates duráveis (converted/ganho/is_not_lead), ai_enabled, handoff, etapa não-terminal, inatividade
-- por última mensagem OUTBOUND, janela de horário e anti-reenvio (followup_sent_at).

CREATE OR REPLACE FUNCTION public.process_reengagement_followup()
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare
  r record;
  v_url text := 'https://yzpclhuifquhfqpiwysh.supabase.co/functions/v1/reengagement-followup';
  v_now timestamp := now() at time zone 'America/Sao_Paulo';
  v_hour int := extract(hour from (now() at time zone 'America/Sao_Paulo'));
  v_max_per_clinic int := 5;   -- anti-burst POR clínica
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
