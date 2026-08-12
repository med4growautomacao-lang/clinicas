-- Anti-burst: o selector de reengajamento processa no máximo N leads por tick (ordenando os mais
-- antigos inativos primeiro). Evita estourar um backlog inteiro de uma vez (ex.: ao ligar a régua,
-- todo o backlog de leads já cutucados ficou elegível e foi enviado num único tick). Com o cron */15,
-- o backlog dreha ~N por 15 min. N é uma constante fácil de tunar.

create or replace function public.process_reengagement_followup()
 returns void
 language plpgsql
as $function$
declare
  r record;
  v_url text := 'https://yzpclhuifquhfqpiwysh.supabase.co/functions/v1/reengagement-followup';
  v_now timestamp := now() at time zone 'America/Sao_Paulo';
  v_hour int := extract(hour from (now() at time zone 'America/Sao_Paulo'));
  v_max_per_tick int := 5;   -- anti-burst: no máx. N leads por execução
  v_payload jsonb;
begin
  if v_hour < 6 or v_hour >= 22 then
    return;
  end if;

  for r in
    select l.id, l.name, l.phone, l.clinic_id, l.followup_count,
           w.phone_number as clinic_phone,
           s.message_text, s.step_no, s.is_closing,
           coalesce(lm.last_inbound, l.created_at) as inativo_desde
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
    left join lateral (
      select max(cm.created_at) as last_inbound
      from public.chat_messages cm
      where cm.lead_id = l.id and cm.direction = 'inbound'
    ) lm on true
    where ac.followup_enabled = true
      and l.followup_enabled = true
      and l.ai_enabled = true
      and l.handoff_triggered_at is null
      and l.converted_patient_id is null
      and coalesce(l.is_not_lead, false) = false
      and w.api_token is not null
      and l.phone is not null and l.phone <> ''
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
      and coalesce(lm.last_inbound, l.created_at) < (v_now - (s.delay_minutes || ' minutes')::interval)
      and (l.followup_sent_at is null or l.followup_sent_at < (v_now - (s.delay_minutes || ' minutes')::interval))
    order by coalesce(lm.last_inbound, l.created_at) asc   -- mais antigos primeiro
    limit v_max_per_tick                                    -- anti-burst
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
