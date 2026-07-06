-- 20260706000004_fix_purge_trigger_perdido_only.sql
--
-- Correção de segurança do gatilho de 20260706000003 (verificação adversarial multi-agente).
--
-- Bug: fn_ticket_left_ganho purgava a venda em QUALQUER saída de 'ganho' (incl. ganho->NULL).
-- Mas a única saída AUTOMÁTICA ganho->NULL é o FLUXO DE AGENDAMENTO: fn_resolve_patient_lead_ticket
-- REUSA um ticket ganho aberto sem consulta ativa; o INSERT do appointment dispara
-- fn_auto_move_lead_to_agendado (stage=agendado, outcome=NULL), e o gatilho apagava a conversão
-- (e a receita) de uma VENDA LEGÍTIMA — só por agendar uma consulta. 58 tickets com conversão
-- expostos, 4 já com receita real. Provado por teste transacional (conversions 1->0).
--
-- Correção: purgar SOMENTE na transição EXPLÍCITA ganho->perdido (venda virou perda).
--   - ganho->NULL (agendamento / etapa ativa): NÃO purga (a venda continua válida; o lead só
--     progrediu). Se algum dia virar órfã pendurada, é a raiz do agendamento que deve reciclar.
--   - "Cancelar venda" (reopen_ticket): já apaga conversão+receita por conta própria antes de
--     reabrir; o gatilho aqui seria redundante — e como reabre para etapa ativa (outcome NULL),
--     nem dispara. Sem regressão.
--   - move_lead_stage "novo ciclo" (Manter): fecha o ticket ganho sem mexer no outcome -> não dispara.
--   - finalize_ticket / arraste ganho->perdido: dispara e purga corretamente.

CREATE OR REPLACE FUNCTION public.fn_ticket_left_ganho()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Só a transição EXPLÍCITA ganho -> perdido remove a venda.
  IF OLD.outcome = 'ganho' AND NEW.outcome = 'perdido' THEN
    PERFORM public.fn_purge_ticket_sale(OLD.id);
  END IF;
  RETURN NEW;
END;
$function$;

-- Blindagem (Prioridade 3): 1 conversão por receita. Impede que duas conversões apontem para
-- o mesmo financial_transaction, o que faria o purge de uma venda apagar a receita de outra.
-- Hoje não há duplicados (auditado), então o índice cria sem conflito.
CREATE UNIQUE INDEX IF NOT EXISTS uq_conversions_financial_transaction_id
  ON public.conversions (financial_transaction_id)
  WHERE financial_transaction_id IS NOT NULL;
