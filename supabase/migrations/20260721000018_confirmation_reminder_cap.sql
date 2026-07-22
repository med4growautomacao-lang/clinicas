-- Confirmação: cap anti-burst por clínica (era o único dos 5 motores sem teto por rodada).
--
-- Sem isto, ligar a chave dispara lembrete para TODAS as consultas dentro do confirm_lead_time
-- no mesmo minuto (clínica com 40 consultas amanhã = 40 envios num segundo). Com cap 5 e cron 1/min,
-- as mesmas 40 escoam em ~8 min. Mesmo padrão do welcome (3), reengajamento (5) e pós (5).
-- Ordem: consulta mais próxima primeiro (o lembrete mais urgente sai antes).
--
-- Base: versão VIVA da função (pós-migrations 057 + 059, sem o prefixo 'CONFIRMAÇÃO: ' no content).
-- Nenhuma outra regra alterada.

create or replace function public.process_confirmation_reminders()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  r record;
  v_msg text;
  v_count integer := 0;
  v_max_per_clinic int := 5;   -- anti-burst por clínica
begin
  for r in
    with cand as (
      select a.id as appointment_id, a.clinic_id, a.ticket_id, p.name as paciente_nome,
             normalize_br_phone(p.phone) as phone,
             to_char(a.date,'DD/MM/YYYY') as data_consulta, to_char(a.time,'HH24:MI') as hora_consulta,
             ai.confirm_message, wa.api_token, t.lead_id,
             row_number() over (partition by a.clinic_id order by (a.date + a.time) asc) as rn
      from appointments a
      join patients p on a.patient_id = p.id
      join doctors d on a.doctor_id = d.id
      join ai_config ai on a.clinic_id = ai.clinic_id
      join whatsapp_instances wa on a.clinic_id = wa.clinic_id
      left join tickets t on t.id = a.ticket_id
      left join leads l on l.id = t.lead_id
      where ai.confirm_enabled = true and a.reminder_sent_at is null
        and a.status in ('pendente','confirmado') and wa.status = 'connected'
        and (wa.send_blocked_until is null or wa.send_blocked_until <= now())
        and nullif(btrim(ai.confirm_message), '') is not null
        and coalesce(l.followup_enabled, true) = true
        -- Linha NÃO enviável não pode ocupar slot do cap. O loop abaixo pula essas com `continue`
        -- sem marcar reminder_sent_at, então com o cap elas voltariam a ser escolhidas toda rodada
        -- e travariam os lembretes válidos da clínica até a consulta passar do horário.
        and normalize_br_phone(p.phone) is not null
        and wa.api_token is not null and btrim(wa.api_token) <> ''
        and ((a.date + a.time) at time zone 'America/Sao_Paulo') <= now() + (coalesce(ai.confirm_lead_time,1440) || ' minutes')::interval
        and ((a.date + a.time) at time zone 'America/Sao_Paulo') > now()
        and extract(hour from now() at time zone 'America/Sao_Paulo') >= coalesce(ai.confirm_window_start, 6)
        and extract(hour from now() at time zone 'America/Sao_Paulo') <  coalesce(ai.confirm_window_end, 22)
    )
    select appointment_id, clinic_id, ticket_id, paciente_nome, phone,
           data_consulta, hora_consulta, confirm_message, api_token, lead_id
    from cand
    where rn <= v_max_per_clinic
  loop
    begin
      if r.phone is null or r.api_token is null or btrim(r.api_token) = '' then continue; end if;
      v_msg := replace(replace(replace(coalesce(r.confirm_message,''),
        '{paciente}', coalesce(r.paciente_nome,'')), '{data}', r.data_consulta), '{hora}', r.hora_consulta);

      perform system_http_post('https://med4growautomacao.uazapi.com/send/menu',
        jsonb_build_object('Content-Type','application/json','token', r.api_token),
        jsonb_build_object('number', r.phone, 'type', 'button', 'text', v_msg,
          'choices', jsonb_build_array('Confirmar consulta|confirmado','Remarcar consulta|remarcar','Cancelar consulta|cancelado'),
          'footerText', 'Por favor, clique em uma das opções abaixo.'),
        5000);

      if r.lead_id is not null then
        insert into chat_messages (clinic_id, lead_id, phone, direction, sender, message)
        values (r.clinic_id, r.lead_id, r.phone, 'outbound', 'system',
                jsonb_build_object('type','system','content', v_msg, 'additional_kwargs','{}'::jsonb, 'response_metadata','{}'::jsonb));
      end if;

      update appointments set reminder_sent_at = (now() at time zone 'America/Sao_Paulo') where id = r.appointment_id;
      v_count := v_count + 1;
    exception when others then
      perform log_system_error('confirm-reminder','send_failed','Falha ao enviar lembrete de confirmação',
        'error', r.clinic_id, jsonb_build_object('appointment_id', r.appointment_id, 'detail', sqlerrm), false);
    end;
  end loop;
  return v_count;
exception when others then
  perform log_system_error('confirm-reminder','job_failed','Falha no job de lembrete de confirmação','error',
    null, jsonb_build_object('detail', sqlerrm), false);
  return v_count;
end; $function$;
