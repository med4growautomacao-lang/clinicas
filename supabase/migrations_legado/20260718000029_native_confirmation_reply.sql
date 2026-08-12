-- Handler NATIVO de resposta de confirmação (Confirmar / Remarcar / Cancelar).
-- Substitui o subgrafo If2/If6 do Receptor. Corrige o bug de "confirma TODOS os
-- agendamentos do paciente": mira o agendamento ESPECÍFICO que recebeu o lembrete
-- (reminder_sent_at) e é futuro/pendente.
--
-- Gate confirm_native_enabled (default false) -> INERTE até o cutover, para conviver
-- com o Receptor sem duplicar resposta enquanto a migração não vira a chave.
--
-- Sempre: atualiza status (confirmado/cancelado), envia a resposta configurada e
-- notifica (notify_ops). Clínica com IA -> a IA segue habilitada e assume a remarcação
-- na conversa. Cancelamento é notificado pelo trigger de agendamento (evita duplicar).

alter table public.ai_config
  add column if not exists confirm_native_enabled boolean not null default false;
comment on column public.ai_config.confirm_native_enabled is
  'Liga o handler NATIVO de resposta de confirmação (substitui o Receptor). Ativar só após desligar os nós de confirmação do Receptor.';

create or replace function public.fn_handle_confirmation_reply()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_content text;
  v_action text;   -- confirmado | remarcado | cancelado
  v_cfg record;
  v_appt record;
  v_reply text;
  v_token text;
  v_number text;
  v_title text;
  v_level text;
  v_new_status text;
begin
  if NEW.lead_id is null then return NEW; end if;

  v_content := lower(btrim(coalesce(NEW.message->>'content', '')));
  if v_content = '' then return NEW; end if;

  -- Detecta o botão (label da uazapi; aceita também o valor).
  if v_content like '%confirmar consulta%' or v_content = 'confirmado' then
    v_action := 'confirmado';
  elsif v_content like '%remarcar consulta%' or v_content in ('remarcar','remarcado') then
    v_action := 'remarcado';
  elsif v_content like '%cancelar consulta%' or v_content = 'cancelado' then
    v_action := 'cancelado';
  else
    return NEW;
  end if;

  select confirm_native_enabled, confirm_post_message,
         confirm_reply_remarcado, confirm_reply_cancelado
    into v_cfg
    from ai_config where clinic_id = NEW.clinic_id;
  if v_cfg is null or v_cfg.confirm_native_enabled is not true then
    return NEW;  -- cutover ainda não ligado
  end if;

  -- Agendamento ESPECÍFICO que recebeu o lembrete (não "todos do paciente").
  select a.id, a.date, a.time, p.name as patient_name
    into v_appt
    from appointments a
    join patients p on p.id = a.patient_id
    left join tickets t on t.id = a.ticket_id
   where a.clinic_id = NEW.clinic_id
     and a.reminder_sent_at is not null
     and a.status in ('pendente','confirmado')
     and ((a.date + a.time) at time zone 'America/Sao_Paulo') > now()
     and (t.lead_id = NEW.lead_id
          or normalize_br_phone(p.phone) = normalize_br_phone(NEW.phone))
   order by a.reminder_sent_at desc
   limit 1;
  if v_appt.id is null then
    return NEW;  -- nada aguardando confirmação -> ignora (evita falso positivo)
  end if;

  if v_action = 'confirmado' then
    v_new_status := 'confirmado'; v_reply := v_cfg.confirm_post_message;
    v_title := 'Consulta confirmada'; v_level := 'success';
  elsif v_action = 'cancelado' then
    v_new_status := 'cancelado'; v_reply := v_cfg.confirm_reply_cancelado;
    v_title := null; v_level := null;  -- cancelamento já é notificado pelo trigger de agendamento
  else
    v_new_status := null; v_reply := v_cfg.confirm_reply_remarcado;
    v_title := 'Remarcação solicitada'; v_level := 'warning';
  end if;

  if v_new_status is not null then
    update appointments set status = v_new_status where id = v_appt.id;
  end if;

  if v_reply is not null and btrim(v_reply) <> '' then
    v_reply := replace(replace(replace(v_reply,
      '{paciente}', coalesce(v_appt.patient_name, '')),
      '{data}', to_char(v_appt.date, 'DD/MM/YYYY')),
      '{hora}', substr(v_appt.time::text, 1, 5));

    select api_token into v_token from whatsapp_instances where clinic_id = NEW.clinic_id limit 1;
    v_number := normalize_br_phone(NEW.phone);
    if v_token is not null and btrim(v_token) <> '' and v_number is not null then
      perform system_http_post(
        'https://med4growautomacao.uazapi.com/send/text',
        jsonb_build_object('Content-Type','application/json','token', v_token),
        jsonb_build_object('number', v_number, 'text', v_reply, 'delay', 0),
        5000
      );
      -- registra a resposta na conversa. sender='ai' NÃO dispara o handoff manual.
      insert into chat_messages (clinic_id, lead_id, phone, direction, sender, message)
      values (NEW.clinic_id, NEW.lead_id, NEW.phone, 'outbound', 'ai',
              jsonb_build_object('type','ai','content', v_reply,
                                 'additional_kwargs','{}'::jsonb,'response_metadata','{}'::jsonb));
    end if;
  end if;

  if v_title is not null then
    perform notify_ops(
      NEW.clinic_id, 'agendamento', v_title,
      coalesce(v_appt.patient_name, 'Paciente') || ' — ' ||
        to_char(v_appt.date, 'DD/MM') || ' ' || substr(v_appt.time::text, 1, 5),
      v_level, NEW.lead_id, null, v_appt.id, null,
      jsonb_build_object('action', v_action), true, null
    );
  end if;

  return NEW;
exception when others then
  perform log_system_error(
    'confirm-reply', 'confirm_reply_failed', 'Falha ao processar resposta de confirmação',
    'error', NEW.clinic_id, jsonb_build_object('lead_id', NEW.lead_id, 'detail', sqlerrm), false
  );
  return NEW;
end;
$$;

drop trigger if exists trg_confirmation_reply on public.chat_messages;
create trigger trg_confirmation_reply
  after insert on public.chat_messages
  for each row
  when (NEW.direction = 'inbound')
  execute function public.fn_handle_confirmation_reply();
