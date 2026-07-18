-- Handoff manual: quando um HUMANO responde (mensagem outbound do operador), pausa a
-- IA e avisa a equipe (in-app + grupo WhatsApp via notify_ops).
--
-- Por que TRIGGER e não só na ingest_wa_message: assim cobre TODOS os caminhos de
-- envio humano de forma agnóstica de transporte — o hub (wa-inbound), o envio pelo app
-- (chat-send) e o próprio Receptor n8n (nó "Insere msg Secretária") — igual aos gatilhos
-- de etapa (trg_zz_apply_stage_rules). Antes, o handoff manual era MUDO: o Receptor só
-- desligava a IA (Desativa IA1), sem avisar ninguém, e o hub nem isso fazia.
--
-- Dedup: só age na TRANSIÇÃO ligada->pausada (lead.ai_enabled = true). Depois de pausada,
-- respostas humanas seguintes não re-notificam. Só clínicas que usam IA (auto_schedule),
-- pra não gerar ruído onde não há agente. NUNCA derruba o insert da mensagem (EXCEPTION).
--
-- ⚠️ ABRANGÊNCIA: dispara para TODAS as clínicas (não só a canário do hub), porque é no
-- INSERT de chat_messages. É o comportamento desejado (grupo único de avisos), mas é uma
-- mudança global — clínicas com IA + notification_group_id passam a receber aviso de
-- transbordo manual no grupo.

create or replace function public.fn_handoff_on_human_reply()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_lead record;
  v_uses_ai boolean;
begin
  if NEW.lead_id is null then
    return NEW;
  end if;

  select id, name, phone, ai_enabled into v_lead from leads where id = NEW.lead_id;
  -- só na transição ligada->pausada (1 notificação por handoff)
  if v_lead.id is null or v_lead.ai_enabled is not true then
    return NEW;
  end if;

  -- só clínicas que usam IA (evita ruído onde não há agente)
  select coalesce(auto_schedule, false) into v_uses_ai from ai_config where clinic_id = NEW.clinic_id;
  if not coalesce(v_uses_ai, false) then
    return NEW;
  end if;

  update leads
     set ai_enabled = false,
         handoff_triggered_at = (now() at time zone 'America/Sao_Paulo')  -- SP wall-clock (coluna sem tz)
   where id = v_lead.id;

  perform notify_ops(
    NEW.clinic_id,
    'handoff',
    'Atendimento assumido por humano',
    coalesce(nullif(btrim(v_lead.name), ''), v_lead.phone) || ' — a IA foi pausada para este lead.',
    'warning',
    v_lead.id, null, null, null,
    jsonb_build_object('reason', 'manual_reply'),
    true, null
  );

  return NEW;
exception when others then
  perform log_system_error(
    'handoff-trigger', 'handoff_write_failed',
    'Falha ao pausar IA / notificar no handoff manual', 'error',
    NEW.clinic_id, jsonb_build_object('lead_id', NEW.lead_id, 'detail', sqlerrm), false
  );
  return NEW;
end;
$$;

drop trigger if exists trg_handoff_on_human_reply on public.chat_messages;
create trigger trg_handoff_on_human_reply
  after insert on public.chat_messages
  for each row
  when (NEW.direction = 'outbound' and NEW.sender = 'human')
  execute function public.fn_handoff_on_human_reply();
