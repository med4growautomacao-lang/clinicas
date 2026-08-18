-- Correções apontadas na revisão de 18/08/2026.
--
-- ⚠️ TRANSCRIÇÃO. Esta migration foi aplicada no banco por OUTRA sessão (versão registrada
-- 20260818163425) e o arquivo não chegou ao repositório. Reconstruído a partir do banco para que
-- um ambiente novo reproduza produção. As partes (B) claim e (D) selector, que aquela sessão
-- também tocou, foram substituídas poucos minutos depois pelas migrations 20260818182542 e
-- 20260818183120 — aqui ficam só as partes que continuam valendo, com a intenção original
-- registrada. Ver a memória `reengajamento-regua-por-etapa` para o histórico das duas frentes.
--
-- (A) Congela o comportamento de encerramento que cada clínica tinha ATÉ HOJE.
--
-- O default `coalesce(cfg.close_ticket_on_exhaust, true)` fazia TODA régua passar a fechar o
-- atendimento no último passo. Para as 26 clínicas que nunca tiveram passo de encerramento isso
-- é comportamento novo (antes o esgotamento só movia o card para Perdido e o deixava ABERTO), e
-- o último passo delas não é uma despedida escrita, é mais um lembrete. Nenhuma tem follow-up
-- ligado hoje, então o dano é zero, mas ligar sem revisar o texto seria surpresa.
-- Aqui cada clínica ganha a linha explícita com o que ela já fazia.
insert into public.followup_rulesets (clinic_id, stage_id, close_ticket_on_exhaust)
select s.clinic_id, null, bool_or(s.is_closing)
  from public.followup_steps s
 where s.stage_id is null
 group by s.clinic_id
on conflict (clinic_id, stage_id) do nothing;

-- (C) Enfileiramento das bolhas vira TUDO OU NADA, e recusa contato fora do WhatsApp.
--
-- Dois defeitos de uma vez:
--   1. `emit_message` BLOQUEIA contato com whatsapp_invalid, grava a linha como 'dropped' e
--      devolve o id assim mesmo (de propósito, para o produtor distinguir "não enfileirei" de
--      "falhei"). A edge lia "sem erro" como enviado, marcava 'sent' e o passo de despedida
--      fechava o atendimento sem ninguém receber nada. Hoje há 37 contatos marcados assim,
--      35 com atendimento aberto, e 4 envios de reengajamento já saíram como 'dropped'.
--   2. Bolha a bolha, uma falha no meio deixava as anteriores na fila; ao devolver o passo à
--      régua, a rodada seguinte gerava chave nova (o ciclo mudou) e o contato recebia as
--      primeiras bolhas duas vezes.
-- Uma chamada só: ou todas as bolhas entram, ou nenhuma (o handler desfaz o que já entrou).
create or replace function public.fn_emit_reengagement(
  p_clinic_id uuid,
  p_lead_id uuid,
  p_to_addr text,
  p_bubbles text[],
  p_dedup_prefix text,
  p_delay_ms int default 0,
  p_chat_content text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_i int;
  v_n int := coalesce(array_length(p_bubbles, 1), 0);
  v_id uuid;
  v_bloq boolean;
begin
  if v_n = 0 then
    return jsonb_build_object('ok', false, 'reason', 'sem_conteudo');
  end if;

  select coalesce(l.whatsapp_invalid, false) into v_bloq
    from public.leads l where l.id = p_lead_id;
  if coalesce(v_bloq, false) then
    -- não enfileira: o gate do emit_message devolveria id de uma linha 'dropped' e o produtor
    -- leria isso como envio feito
    return jsonb_build_object('ok', false, 'reason', 'lead_sem_whatsapp');
  end if;

  for v_i in 1 .. v_n loop
    v_id := public.emit_message(
      p_clinic_id  := p_clinic_id,
      p_to_addr    := p_to_addr,
      p_producer   := 'reengagement',
      p_body       := p_bubbles[v_i],
      p_lead_id    := p_lead_id,
      p_delay_ms   := coalesce(p_delay_ms, 0),
      p_dedup_key  := p_dedup_prefix || ':' || v_i,
      -- conversa gravada uma vez, no último balão, com o conteúdo unido
      p_chat_payload := case when v_i = v_n and p_chat_content is not null
        then jsonb_build_object(
               'sender', 'system',
               'message', jsonb_build_object('type','system','content',p_chat_content,
                                             'additional_kwargs','{}'::jsonb,
                                             'response_metadata','{}'::jsonb))
        else null end);
    if v_id is null then
      raise exception 'emit_message devolveu null na bolha %', v_i;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'n', v_n);
exception when others then
  -- o handler é a subtransação: o que já tinha sido enfileirado nesta chamada é desfeito
  return jsonb_build_object('ok', false, 'reason', 'erro_ao_enfileirar', 'detail', sqlerrm);
end;
$function$;

comment on function public.fn_emit_reengagement(uuid, uuid, text, text[], text, int, text) is
  'Enfileira as bolhas de um passo do reengajamento em uma transação só (tudo ou nada) e recusa contato marcado como fora do WhatsApp, para o produtor nunca ler bloqueio como envio.';

revoke all on function public.fn_emit_reengagement(uuid, uuid, text, text[], text, int, text) from public, anon, authenticated;
grant execute on function public.fn_emit_reengagement(uuid, uuid, text, text[], text, int, text) to service_role;

-- (D/E) Higiene de ACL que a migration original também aplicou e que esta transcrição precisa
-- carregar: todo `create function` concede EXECUTE a PUBLIC, e este projeto já teve um vazamento
-- de 17 horas por isso. Em produção os revokes estão de pé; sem estas linhas, um ambiente
-- reconstruído nasceria com o job do cron aberto — uma das quatro condições que o
-- run_system_monitors acende sozinho.
revoke all on function public.fn_followup_candidates_reengagement(uuid) from public, anon, authenticated;
revoke all on function public.process_reengagement_followup() from public, anon, authenticated;
