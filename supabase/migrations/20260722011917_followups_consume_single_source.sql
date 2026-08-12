-- 20260722011917_followups_consume_single_source
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Cutover: os 4 motores e o preview passam a consumir fn_followup_candidates_* em vez de cada um
-- carregar sua cópia dos gates. Equivalência verificada ANTES do corte, comparando os conjuntos
-- candidatos antigos e novos: welcome 78=78, reengajamento 973=973, confirmação 16=16, pós 725=725,
-- diferença simétrica ZERO nos quatro. Nenhuma regra de negócio muda aqui.
-- O motor continua dono do que é dele: corte de tempo, janela de horário, cap por rodada e envio.

-- ------------------------------------------------------------------ BOAS-VINDAS
create or replace function public.process_forms_followup()
 returns void language plpgsql as $function$
declare
  r record;
  v_url text := 'https://yzpclhuifquhfqpiwysh.supabase.co/functions/v1/forms-welcome-followup';
  v_payload jsonb;
  v_now timestamp := now() at time zone 'America/Sao_Paulo';
  v_hour int := extract(hour from (now() at time zone 'America/Sao_Paulo'));
  v_max_per_clinic int := 3;
begin
  for r in
    select * from (
      select c.*, row_number() over (partition by c.clinic_id order by c.eligible_at asc) as rn
        from public.fn_followup_candidates_welcome() c
       where c.toggle_on and c.wa_ok
         and c.eligible_at < v_now
         and v_hour >= c.window_start and v_hour < c.window_end
    ) q where q.rn <= v_max_per_clinic
  loop
    v_payload := jsonb_build_object(
      'lead_id', r.lead_id, 'name', r.nome, 'phone', r.telefone,
      'clinic_id', r.clinic_id, 'clinic_phone', r.clinic_phone,
      'message_text', r.message_text, 'type', 'welcome');
    perform public.system_http_post(
      url := v_url, headers := jsonb_build_object('Content-Type','application/json'), body := v_payload);
  end loop;
end; $function$;

-- ------------------------------------------------------------------ REENGAJAMENTO
create or replace function public.process_reengagement_followup()
 returns void language plpgsql as $function$
declare
  r record;
  v_url text := 'https://yzpclhuifquhfqpiwysh.supabase.co/functions/v1/reengagement-followup';
  v_payload jsonb;
  v_now timestamp := now() at time zone 'America/Sao_Paulo';
  v_hour int := extract(hour from (now() at time zone 'America/Sao_Paulo'));
  v_max_per_clinic int := 5;
begin
  for r in
    select * from (
      select c.*, row_number() over (partition by c.clinic_id order by c.eligible_at asc) as rn
        from public.fn_followup_candidates_reengagement() c
       where c.toggle_on and c.wa_ok
         and c.eligible_at < v_now
         and v_hour >= c.window_start and v_hour < c.window_end
    ) q where q.rn <= v_max_per_clinic
  loop
    v_payload := jsonb_build_object(
      'lead_id', r.lead_id, 'clinic_id', r.clinic_id, 'name', r.nome, 'phone', r.telefone,
      'clinic_phone', r.clinic_phone, 'message_text', r.message_text,
      'step_no', r.step_no, 'is_closing', r.is_closing, 'expected_count', r.expected_count);
    perform public.system_http_post(
      url := v_url, headers := jsonb_build_object('Content-Type','application/json'), body := v_payload);
  end loop;
end; $function$;

-- ------------------------------------------------------------------ CONFIRMAÇÃO
create or replace function public.process_confirmation_reminders()
 returns integer language plpgsql security definer set search_path to 'public' as $function$
declare
  r record; v_msg text; v_count integer := 0;
  v_now timestamp := now() at time zone 'America/Sao_Paulo';
  v_hour int := extract(hour from (now() at time zone 'America/Sao_Paulo'));
  v_max_per_clinic int := 5;
begin
  for r in
    select * from (
      select c.*, row_number() over (partition by c.clinic_id order by c.eligible_at asc) as rn
        from public.fn_followup_candidates_confirmation() c
       where c.toggle_on and c.wa_ok
         and c.eligible_at <= v_now
         and v_hour >= c.window_start and v_hour < c.window_end
    ) q where q.rn <= v_max_per_clinic
  loop
    begin
      v_msg := replace(replace(replace(coalesce(r.confirm_message,''),
        '{paciente}', coalesce(r.nome,'')), '{data}', r.data_consulta), '{hora}', r.hora_consulta);

      perform system_http_post('https://med4growautomacao.uazapi.com/send/menu',
        jsonb_build_object('Content-Type','application/json','token', r.api_token),
        jsonb_build_object('number', r.telefone, 'type', 'button', 'text', v_msg,
          'choices', jsonb_build_array('Confirmar consulta|confirmado','Remarcar consulta|remarcar','Cancelar consulta|cancelado'),
          'footerText', 'Por favor, clique em uma das opções abaixo.'),
        5000);

      if r.lead_id is not null then
        insert into chat_messages (clinic_id, lead_id, phone, direction, sender, message)
        values (r.clinic_id, r.lead_id, r.telefone, 'outbound', 'system',
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

-- ------------------------------------------------------------------ PÓS-ATENDIMENTO
create or replace function public.process_pos_followup()
 returns integer language plpgsql security definer set search_path to 'public' as $function$
declare
  r record; v_msg text; v_count integer := 0; v_expired integer := 0;
  v_now timestamp := now() at time zone 'America/Sao_Paulo';
  v_hour int := extract(hour from (now() at time zone 'America/Sao_Paulo'));
  v_max_per_clinic int := 5;
begin
  -- Vencimento continua sendo escrita do motor (a fonte única é só leitura).
  with expired as (
    update public.tickets t set pos_followup_expired_at = now()
      from public.ai_config ai
     where ai.clinic_id = t.clinic_id
       and t.outcome in ('ganho','perdido') and t.outcome_at is not null
       and t.pos_followup_sent_at is null and t.pos_followup_expired_at is null
       and (
         (t.outcome = 'ganho'
            and t.outcome_at < now() - ((coalesce(ai.pos_followup_ganho_days,1)  + coalesce(ai.pos_followup_grace_days,2)) || ' days')::interval)
         or
         (t.outcome = 'perdido'
            and t.outcome_at < now() - ((coalesce(ai.pos_followup_perdido_days,1) + coalesce(ai.pos_followup_grace_days,2)) || ' days')::interval)
       )
    returning 1
  )
  select count(*) into v_expired from expired;

  if v_expired > 0 then
    perform log_system_error('pos-followup','expired_suppressed',
      'Pós-atendimento retirado da fila por vencimento (janela expirada)','info',
      null, jsonb_build_object('count', v_expired), false);
  end if;

  for r in
    select * from (
      select c.*, row_number() over (partition by c.clinic_id order by c.eligible_at asc) as rn
        from public.fn_followup_candidates_pos() c
       where c.toggle_on and c.wa_ok
         and c.eligible_at <= v_now and c.expires_at >= v_now
         and v_hour >= c.window_start and v_hour < c.window_end
    ) q where q.rn <= v_max_per_clinic
  loop
    begin
      v_msg := r.message;
      if v_msg is null or btrim(v_msg) = '' then
        update tickets set pos_followup_sent_at = now() where id = r.ticket_id;
        continue;
      end if;
      if r.telefone is null or r.api_token is null or btrim(r.api_token) = '' then continue; end if;
      v_msg := replace(replace(v_msg, '{paciente}', coalesce(r.nome,'')), '{nome}', coalesce(r.nome,''));

      perform system_http_post('https://med4growautomacao.uazapi.com/send/text',
        jsonb_build_object('Content-Type','application/json','token', r.api_token),
        jsonb_build_object('number', r.telefone, 'text', v_msg, 'delay', 0), 5000);

      insert into chat_messages (clinic_id, lead_id, phone, direction, sender, message)
      values (r.clinic_id, r.lead_id, r.telefone, 'outbound', 'system',
              jsonb_build_object('type','system','content', v_msg, 'additional_kwargs','{}'::jsonb, 'response_metadata','{}'::jsonb));

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
