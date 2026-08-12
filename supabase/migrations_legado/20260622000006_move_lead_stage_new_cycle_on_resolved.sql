-- 20260622000006_move_lead_stage_new_cycle_on_resolved.sql
--
-- Contexto
-- --------
-- A `move_lead_stage(ticket, stage)` é o ponto único por onde as transições de etapa
-- passam: o nó "Atualiza etapa de funil" do n8n (clínicas que operam só por mensagem-
-- gatilho, ex. Gheller) e o Kanban do app (moveTicket em useSupabase.ts) chamam ela.
--
-- Problema
-- --------
-- Pelo caminho-gatilho, chegar numa etapa terminal NÃO fechava o ticket (só o
-- `finalize_ticket` do app fecha). Resultado: o MESMO ticket aberto era reaproveitado e
-- o próximo gatilho sobrescrevia o desfecho — o clássico "bate-volta" Agendado↔Ganho,
-- que APAGAVA a venda (vimos lead terminar status=open, stage=agendado, outcome=NULL),
-- e os 95 tickets "perdido" com status=open da Gheller.
--
-- Solução (espelha fn_resolve_patient_lead_ticket, usada pelo book_appointment)
-- ---------------------------------------------------------------------------
-- Quando a `move_lead_stage` recebe uma transição para uma etapa ATIVA (não-terminal)
-- num ticket JÁ RESOLVIDO (outcome ganho/perdido, ou status=closed):
--   - preserva o ticket resolvido (fecha-o se ainda estiver aberto), e
--   - abre um ticket NOVO já na etapa-alvo (novo ciclo).
-- Assim a venda/desfecho fica intacto, o funil (por ticket / última entrada) conta cada
-- ciclo separado, e mantém-se o invariante "1 ticket aberto por lead / novo ciclo após
-- fechar".
--
-- Observações
-- -----------
-- * Mover PARA terminal (ganho/perdido) segue como hoje (não fecha aqui; o ticket fica
--   resolvido/aberto até o próximo gatilho ativo disparar o novo ciclo). Isso evita que
--   o fn_auto_open_ticket crie um ticket novo já em "ganho" (leads.stage_id acompanha o
--   stage do ticket).
-- * Escopo GLOBAL (todas as clínicas). Consequência no Kanban: arrastar um card já ganho
--   de volta para uma etapa ativa passa a abrir um ticket novo (em vez de "desfazer" o
--   ganho no mesmo ticket).
-- * Fechar um ticket "perdido" no novo ciclo religa a IA (fn_activate_ai_on_ticket_resolved,
--   só p/ outcome != ganho) — comportamento de reengajamento já existente e desejado.

CREATE OR REPLACE FUNCTION public.move_lead_stage(p_ticket_id uuid, p_new_stage_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ticket      RECORD;
  v_new_slug    text;
  v_new_ticket  uuid;
BEGIN
  SELECT id, lead_id, stage_id, clinic_id, status, outcome
    INTO v_ticket
  FROM tickets WHERE id = p_ticket_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'ticket_not_found');
  END IF;

  SELECT slug INTO v_new_slug FROM funnel_stages WHERE id = p_new_stage_id;
  IF v_new_slug IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'stage_not_found');
  END IF;

  -- NOVO CICLO: ticket já resolvido (ganho/perdido) recebendo gatilho de etapa ATIVA.
  IF (v_ticket.outcome IS NOT NULL OR v_ticket.status = 'closed')
     AND v_new_slug NOT IN ('ganho', 'perdido') THEN

    -- fecha o ticket resolvido se ainda estiver aberto (mantém 1 ticket aberto por lead)
    IF v_ticket.status <> 'closed' THEN
      UPDATE tickets
        SET status = 'closed', closed_at = COALESCE(closed_at, now())
        WHERE id = v_ticket.id;
    END IF;

    -- abre o ticket do novo ciclo já na etapa-alvo
    INSERT INTO tickets (clinic_id, lead_id, stage_id, status, opened_at)
    VALUES (v_ticket.clinic_id, v_ticket.lead_id, p_new_stage_id, 'open', now())
    RETURNING id INTO v_new_ticket;

    RETURN jsonb_build_object(
      'success', true,
      'ticket_id', v_new_ticket,
      'previous_ticket_id', v_ticket.id,
      'new_stage_id', p_new_stage_id,
      'new_cycle', true
    );
  END IF;

  -- comportamento normal
  UPDATE tickets SET stage_id = p_new_stage_id WHERE id = p_ticket_id;

  RETURN jsonb_build_object(
    'success', true,
    'ticket_id', p_ticket_id,
    'new_stage_id', p_new_stage_id,
    'new_cycle', false
  );
END;
$function$;
