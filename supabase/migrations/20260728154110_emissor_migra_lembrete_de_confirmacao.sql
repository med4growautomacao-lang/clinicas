-- Emissor: migra o LEMBRETE DE CONFIRMACAO (process_confirmation_reminders) para a fila.
--
-- Era o unico produtor de saida fora do Emissor. Consequencias do jeito antigo, todas silenciosas:
--   1. system_http_post e assincrono e a resposta NUNCA era lida: uazapi recusando = ninguem sabia.
--   2. chat_messages recebia a linha INCONDICIONALMENTE, entao o painel dizia "enviado" para
--      mensagem que nao saiu.
--   3. sem re-tentativa: WhatsApp fora do ar por 1 minuto = lembrete perdido para sempre.
--   4. o cron roda 1x/min, ativo, entao isso valia para todas as clinicas com confirmacao ligada.
--
-- Nao confundir com `fn_handle_confirmation_reply` (a RESPOSTA do paciente ao botao), que ja
-- estava na fila desde 23/07. Este e o DISPARO.
--
-- O payload dos botoes fica IDENTICO ao de hoje (mesmos textos e mesmos ids 'confirmado' /
-- 'remarcar' / 'cancelado'): fn_handle_confirmation_reply casa a resposta por esses ids, mudar
-- qualquer um quebraria a confirmacao inteira. Formato conforme
-- https://docs.uazapi.com/endpoint/post/send~menu (obrigatorios: number, type, text, choices).
--
-- Mesmo padrao do irmao ja migrado (process_appointment_reminders): gate por clinica, dedup_key
-- com data+hora (remarcou = lembrete novo, mesma consulta nao duplica) e chat_payload so quando ha
-- lead. O ramo antigo fica de pe como rollback: desligar a chave volta o comportamento anterior.

create or replace function public.process_confirmation_reminders()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r record; v_msg text; v_token text; v_count integer := 0;
  v_menu jsonb;
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

      -- Campos especificos do /send/menu. `number` e `delay` sao postos pelo worker.
      v_menu := jsonb_build_object(
        'type', 'button',
        'text', v_msg,
        'choices', jsonb_build_array(
          'Confirmar consulta|confirmado',
          'Remarcar consulta|remarcar',
          'Cancelar consulta|cancelado'),
        'footerText', 'Por favor, clique em uma das opções abaixo.');

      if public.fn_emissor_ativo(r.clinic_id) then
        perform public.emit_message(
          p_clinic_id => r.clinic_id, p_to_addr => r.telefone, p_producer => 'confirm_reminder',
          p_kind => 'menu', p_menu => v_menu,
          -- body espelha o texto para a Central e o fallback do chat_payload lerem algo util.
          p_body => v_msg, p_lead_id => r.lead_id,
          p_dedup_key => 'confirm_reminder:' || r.appointment_id::text || ':' || r.data_consulta || ' ' || r.hora_consulta,
          p_chat_payload => case when r.lead_id is not null then
            jsonb_build_object('sender','system',
              'message', jsonb_build_object('type','system','content', v_msg,
                         'additional_kwargs','{}'::jsonb,'response_metadata','{}'::jsonb))
            else null end);
        update appointments set reminder_sent_at = (now() at time zone 'America/Sao_Paulo') where id = r.appointment_id;
        v_count := v_count + 1;
      else
        v_token := fn_clinic_send_token(r.clinic_id);   -- token da instância que passou no gate
        if v_token is null then continue; end if;

        perform system_http_post('https://med4growautomacao.uazapi.com/send/menu',
          jsonb_build_object('Content-Type','application/json','token', v_token),
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
      end if;
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
