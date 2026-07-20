-- Rollback: volta a função ao expediente fixo 6-22 e remove as colunas de janela.
create or replace function public.process_confirmation_reminders()
returns integer language plpgsql security definer set search_path to 'public' as $$
declare r record; v_msg text; v_count integer := 0;
begin
  for r in
    select a.id as appointment_id, a.clinic_id, p.name as paciente_nome,
           normalize_br_phone(p.phone) as phone,
           to_char(a.date,'DD/MM/YYYY') as data_consulta, to_char(a.time,'HH24:MI') as hora_consulta,
           ai.confirm_message, wa.api_token
    from appointments a
    join patients p on a.patient_id = p.id
    join doctors d on a.doctor_id = d.id
    join ai_config ai on a.clinic_id = ai.clinic_id
    join whatsapp_instances wa on a.clinic_id = wa.clinic_id
    left join tickets t on t.id = a.ticket_id
    left join leads l on l.id = t.lead_id
    where ai.confirm_enabled = true and a.reminder_sent_at is null and a.status in ('pendente','confirmado')
      and wa.status = 'connected' and coalesce(l.followup_enabled, true) = true
      and ((a.date + a.time) at time zone 'America/Sao_Paulo') <= now() + (coalesce(ai.confirm_lead_time,1440) || ' minutes')::interval
      and ((a.date + a.time) at time zone 'America/Sao_Paulo') > now()
      and extract(hour from now() at time zone 'America/Sao_Paulo') >= 6
      and extract(hour from now() at time zone 'America/Sao_Paulo') <  22
  loop
    begin
      if r.phone is null or r.api_token is null or btrim(r.api_token) = '' then continue; end if;
      v_msg := replace(replace(replace(coalesce(r.confirm_message,''),'{paciente}',coalesce(r.paciente_nome,'')),'{data}',r.data_consulta),'{hora}',r.hora_consulta);
      perform system_http_post('https://med4growautomacao.uazapi.com/send/menu',
        jsonb_build_object('Content-Type','application/json','token', r.api_token),
        jsonb_build_object('number', r.phone, 'type', 'button', 'text', v_msg,
          'choices', jsonb_build_array('Confirmar consulta|confirmado','Remarcar consulta|remarcar','Cancelar consulta|cancelado'),
          'footerText', 'Por favor, clique em uma das opções abaixo.'), 5000);
      update appointments set reminder_sent_at = (now() at time zone 'America/Sao_Paulo') where id = r.appointment_id;
      v_count := v_count + 1;
    exception when others then
      perform log_system_error('confirm-reminder','send_failed','Falha ao enviar lembrete de confirmação','error', r.clinic_id, jsonb_build_object('appointment_id', r.appointment_id, 'detail', sqlerrm), false);
    end;
  end loop;
  return v_count;
exception when others then
  perform log_system_error('confirm-reminder','job_failed','Falha no job de lembrete de confirmação','error', null, jsonb_build_object('detail', sqlerrm), false);
  return v_count;
end; $$;

alter table public.ai_config drop column if exists confirm_window_start;
alter table public.ai_config drop column if exists confirm_window_end;
