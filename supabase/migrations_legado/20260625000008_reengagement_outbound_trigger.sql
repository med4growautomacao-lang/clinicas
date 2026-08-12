-- O reengajamento conta o relógio a partir da ÚLTIMA mensagem OUTBOUND da conversa (i.e.,
-- "mandamos algo e o lead não respondeu"). Se a última mensagem foi do lead (inbound), a bola está
-- com a gente → NÃO reengaja. Lead sem conversa nenhuma → não entra (isso é o welcome).
-- Usa chat_messages.seq (ordem confiável) p/ achar a última mensagem; o delay usa o created_at dela.
-- Inclui janela de envio por clínica (followup_window_start/end) e anti-burst (5/tick).
create or replace function public.process_reengagement_followup()
 returns void
 language plpgsql
as $function$
declare
  r record;
  v_url text := 'https://yzpclhuifquhfqpiwysh.supabase.co/functions/v1/reengagement-followup';
  v_now timestamp := now() at time zone 'America/Sao_Paulo';
  v_hour int := extract(hour from (now() at time zone 'America/Sao_Paulo'));
  v_max_per_tick int := 5;
  v_payload jsonb;
begin
  for r in
    select l.id, l.name, l.phone, l.clinic_id, l.followup_count,
           w.phone_number as clinic_phone,
           s.message_text, s.step_no, s.is_closing
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
    -- última mensagem da conversa (pela seq) + sua direção/horário
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
      -- janela de envio por clínica (SP)
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
      -- a ÚLTIMA mensagem foi NOSSA (outbound) e sem resposta há mais que o delay do passo
      and lm.last_dir = 'outbound'
      and lm.last_at < (v_now - (s.delay_minutes || ' minutes')::interval)
      -- não reenviar o followup cedo demais
      and (l.followup_sent_at is null or l.followup_sent_at < (v_now - (s.delay_minutes || ' minutes')::interval))
    order by lm.last_at asc
    limit v_max_per_tick
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
    perform net.http_post(
      url     := v_url,
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body    := v_payload
    );
  end loop;
end;
$function$;
