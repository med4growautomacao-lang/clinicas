-- Notificação de comprovante de pagamento (Fase 1).
-- Quando a clínica usa pagamento antecipado (ai_config.payment_enabled) e o paciente envia
-- uma IMAGEM ou DOCUMENTO que parece comprovante, notifica a equipe (sino + grupo):
-- "Comprovante recebido — {nome} · {telefone} — Verifique se o pagamento foi realizado."
-- O clique no sino abre a conversa (onde a mídia/comprovante aparece).
--
-- Detecção híbrida (transcrição de mídia varia entre hub e Receptor):
--   * MARCADOR de pagamento no content (comprovante|pagamento|pix|transfer|recibo|r$) → notifica
--   * PLACEHOLDER / vazio (não deu pra ler a imagem) → notifica por segurança
--   * content legível SEM marcador (é outra imagem) → NÃO notifica

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

  -- só clínicas com pagamento antecipado ativo
  select coalesce(payment_enabled, false) into v_pay from ai_config where clinic_id = NEW.clinic_id;
  if not coalesce(v_pay, false) then return NEW; end if;

  -- é imagem ou documento? (kind do hub; mimetype no Receptor)
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
    return NEW;  -- leu a imagem e não é pagamento
  end if;

  select name, phone into v_lead from leads where id = NEW.lead_id;

  perform notify_ops(
    NEW.clinic_id, 'comprovante', 'Comprovante recebido',
    coalesce(nullif(btrim(v_lead.name), ''), v_lead.phone)
      || coalesce(' · ' || nullif(v_lead.phone, ''), '')
      || E'\nVerifique se o pagamento foi realizado.',
    'warning', NEW.lead_id, null, null, null,
    jsonb_build_object('kind', v_kind), true, null
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

drop trigger if exists trg_notify_comprovante on public.chat_messages;
create trigger trg_notify_comprovante
  after insert on public.chat_messages
  for each row
  when (NEW.direction = 'inbound')
  execute function public.fn_notify_comprovante();
