-- Comprovante: separa os canais da notificação.
--   SINO (in-app) = trigger trg_notify_comprovante (todas as clínicas)  -> notify_group=FALSE
--   GRUPO (WhatsApp) = wa-inbound envia a MÍDIA (imagem/PDF) + legenda via /send/media
-- Assim o grupo recebe o comprovante EM SI (não só texto), e não há mensagem duplicada.

create or replace function public.fn_notify_comprovante()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_pay boolean;
  v_mime text;
  v_kind text;
  v_content text;
  v_is_marker boolean;
  v_is_placeholder boolean;
  v_lead record;
begin
  if NEW.lead_id is null then return NEW; end if;

  select coalesce(payment_enabled, false) into v_pay from ai_config where clinic_id = NEW.clinic_id;
  if not coalesce(v_pay, false) then return NEW; end if;

  v_mime := coalesce(NEW.message->>'mimetype', '');
  v_kind := coalesce(
    nullif(NEW.message->>'kind', ''),
    nullif(NEW.metadata->>'kind', ''),
    case when v_mime like 'image/%' then 'image'
         when v_mime = 'application/pdf' or v_mime like 'application/%' then 'document'
         else '' end
  );
  if v_kind not in ('image', 'document') then return NEW; end if;

  v_content := lower(coalesce(NEW.message->>'content', ''));
  v_is_marker := v_content ~ '(comprovante|pagamento|\mpix\M|transfer|recibo|r\$)';
  v_is_placeholder := v_content = '' or v_content ~ 'recebida?\]';
  if not (v_is_marker or v_is_placeholder) then
    return NEW;
  end if;

  select name, phone into v_lead from leads where id = NEW.lead_id;

  perform notify_ops(
    NEW.clinic_id, 'comprovante', 'Comprovante recebido',
    coalesce(nullif(btrim(v_lead.name), ''), v_lead.phone)
      || coalesce(' · ' || nullif(v_lead.phone, ''), '')
      || E'\nVerifique se o pagamento foi realizado.',
    'warning', NEW.lead_id, null, null, null,
    jsonb_build_object('kind', v_kind), false, null   -- notify_group=FALSE: o grupo recebe a MÍDIA via wa-inbound
  );
  return NEW;
exception when others then
  perform log_system_error(
    'comprovante-notify', 'notify_failed', 'Falha ao notificar comprovante',
    'error', NEW.clinic_id, jsonb_build_object('lead_id', NEW.lead_id, 'detail', sqlerrm), false
  );
  return NEW;
end;
$$;
