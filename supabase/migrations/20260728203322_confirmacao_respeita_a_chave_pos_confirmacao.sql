-- Confirmação: a chave "Disparar Pós-Confirmação" passa a valer de verdade.
--
-- DEFEITO (provado por teste, nao por leitura): a tela grava `ai_config.confirm_post_enabled`,
-- mas `fn_handle_confirmation_reply` NUNCA lia essa coluna. Com a chave DESLIGADA e o texto
-- preenchido, a resposta saia para o paciente do mesmo jeito. Ou seja: o cliente desligava na
-- tela e o sistema continuava mandando. Painel que mente sobre o proprio estado e pior do que
-- funcionalidade que falta, porque o cliente para de confiar no que ve.
--
-- Semantica escolhida: a chave controla SO a resposta do "Confirmar", que e o que a propria tela
-- diz ("Enviada quando o paciente confirma") e o que ela desabilita visualmente. As respostas de
-- "Remarcar" e "Cancelar" continuam governadas por terem texto preenchido, que e como os campos
-- delas aparecem na tela (sempre editaveis, sem chave propria).
--
-- OPT-IN (`is true`), nao opt-out: a tela nasce com a chave desligada (AISecretary.tsx usa
-- `confirm_post_enabled: false` como default), entao `is true` e o que casa com o que o cliente
-- ve. Trocar por `is not false` ligaria a resposta em quem nunca pediu. Ver §0.3 do CLAUDE.md.
--
-- IMPACTO HOJE: zero. As 2 clinicas com confirmacao nativa ligada estao com a chave false E com
-- os 3 textos vazios, entao nao sai resposta nenhuma nem antes nem depois. A partir daqui, para
-- a resposta de confirmacao sair, a clinica precisa ligar a chave E preencher o texto.
--
-- PROVA (begin/rollback, clinica com tudo ligado, lead e agendamento reais):
--   chave OFF -> status vira 'confirmado', resposta ao paciente = 0
--   chave ON  -> status vira 'confirmado', resposta ao paciente = 1, variaveis trocadas
--
-- O resto da funcao fica IDENTICO (verificado em teste de ponta a ponta com tudo ligado:
-- Confirmar -> status 'confirmado' + resposta + aviso 'confirmacao'; Cancelar -> status
-- 'cancelado' + resposta + aviso 'cancelamento' (esse vem do gatilho da agenda, nao daqui, para
-- nao avisar duas vezes); Remarcar -> status intacto + resposta + aviso 'remarcacao').

create or replace function public.fn_handle_confirmation_reply()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_content text; v_action text; v_cfg record; v_appt record;
  v_reply text; v_token text; v_number text;
  v_event text; v_title text; v_level text; v_new_status text;
begin
  if NEW.lead_id is null then return NEW; end if;
  v_content := lower(btrim(coalesce(NEW.message->>'content', '')));
  if v_content = '' then return NEW; end if;

  if v_content like '%confirmar consulta%' or v_content = 'confirmado' then
    v_action := 'confirmado';
  elsif v_content like '%remarcar consulta%' or v_content in ('remarcar','remarcado') then
    v_action := 'remarcado';
  elsif v_content like '%cancelar consulta%' or v_content = 'cancelado' then
    v_action := 'cancelado';
  else
    return NEW;
  end if;

  -- confirm_post_enabled entra no select (era o que faltava).
  select confirm_native_enabled, confirm_post_enabled, confirm_post_message,
         confirm_reply_remarcado, confirm_reply_cancelado
    into v_cfg from ai_config where clinic_id = NEW.clinic_id;
  if v_cfg is null or v_cfg.confirm_native_enabled is not true then return NEW; end if;

  select a.id, a.date, a.time, p.name as patient_name
    into v_appt
    from appointments a
    join patients p on p.id = a.patient_id
    left join tickets t on t.id = a.ticket_id
   where a.clinic_id = NEW.clinic_id
     and a.reminder_sent_at is not null
     and a.status in ('pendente','confirmado')
     and ((a.date + a.time) at time zone 'America/Sao_Paulo') > now()
     and (t.lead_id = NEW.lead_id or normalize_br_phone(p.phone) = normalize_br_phone(NEW.phone))
   order by a.reminder_sent_at desc
   limit 1;
  if v_appt.id is null then return NEW; end if;

  -- A marca segue sendo levantada mesmo quando NAO ha resposta a enviar: ela existe para o
  -- Agente IA nao responder por cima da confirmacao (ingest_wa_message le `app.confirmation_handled`
  -- para decidir o forward_ai). Se so levantasse quando ha texto, desligar a resposta soltaria o
  -- agente para comentar o clique do botao. A trava e da CONFIRMACAO, nao da mensagem.
  perform set_config('app.confirmation_handled', 'on', true);

  if v_action = 'confirmado' then
    v_new_status := 'confirmado';
    -- AQUI: so responde se a clinica ligou a chave na tela.
    v_reply := case when v_cfg.confirm_post_enabled is true then v_cfg.confirm_post_message else null end;
    v_event := 'confirmacao'; v_title := 'Consulta confirmada'; v_level := 'success';
  elsif v_action = 'cancelado' then
    v_new_status := 'cancelado'; v_reply := v_cfg.confirm_reply_cancelado;
    -- Sem evento AQUI de proposito: o gatilho trg_zz_notify_appointment_event dispara
    -- 'cancelamento' no UPDATE de status logo abaixo. Emitir aqui tambem avisaria duas vezes.
    v_event := null; v_title := null; v_level := null;
  else
    v_new_status := null; v_reply := v_cfg.confirm_reply_remarcado;
    v_event := 'remarcacao'; v_title := 'Remarcação solicitada'; v_level := 'warning';
  end if;

  if v_new_status is not null then
    update appointments set status = v_new_status where id = v_appt.id;
  end if;

  if v_reply is not null and btrim(v_reply) <> '' then
    v_reply := replace(replace(replace(v_reply,
      '{paciente}', coalesce(v_appt.patient_name, '')),
      '{data}', to_char(v_appt.date, 'DD/MM/YYYY')),
      '{hora}', substr(v_appt.time::text, 1, 5));
    v_number := normalize_br_phone(NEW.phone);

    if v_number is not null then
      if public.fn_emissor_ativo(NEW.clinic_id, NEW.lead_id) then
        perform public.emit_message(
          p_clinic_id => NEW.clinic_id, p_to_addr => v_number, p_producer => 'confirm_reply',
          p_body => v_reply, p_lead_id => NEW.lead_id,
          p_chat_payload => jsonb_build_object(
            'sender','system', 'phone', NEW.phone,
            'message', jsonb_build_object('type','system','content', v_reply,
                       'additional_kwargs','{}'::jsonb,'response_metadata','{}'::jsonb)));
      else
        select api_token into v_token from whatsapp_instances where clinic_id = NEW.clinic_id limit 1;
        if v_token is not null and btrim(v_token) <> '' then
          perform system_http_post('https://med4growautomacao.uazapi.com/send/text',
            jsonb_build_object('Content-Type','application/json','token', v_token),
            jsonb_build_object('number', v_number, 'text', v_reply, 'delay', 0), 5000);
          insert into chat_messages (clinic_id, lead_id, phone, direction, sender, message)
          values (NEW.clinic_id, NEW.lead_id, NEW.phone, 'outbound', 'system',
                  jsonb_build_object('type','system','content', v_reply, 'additional_kwargs','{}'::jsonb,'response_metadata','{}'::jsonb));
        end if;
      end if;
    end if;
  end if;

  if v_event is not null then
    perform notify_ops(NEW.clinic_id, v_event, v_title,
      coalesce(v_appt.patient_name, 'Paciente') || ' — ' || to_char(v_appt.date,'DD/MM') || ' ' || substr(v_appt.time::text,1,5),
      v_level, NEW.lead_id, null, v_appt.id, null, jsonb_build_object('action', v_action), true, null);
  end if;
  return NEW;
exception when others then
  perform log_system_error('confirm-reply','confirm_reply_failed','Falha ao processar resposta de confirmação','error', NEW.clinic_id, jsonb_build_object('lead_id', NEW.lead_id, 'detail', sqlerrm), false);
  return NEW;
end; $function$;
