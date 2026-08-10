-- ETAPA 1 de 6 do plano "varias vendas no mesmo card" (decisao do dono, 10/08).
--
-- ⚠️ LEIA JUNTO COM A MIGRATION SEGUINTE (20260810194132): o bloco de `finalize_ticket` abaixo foi
-- escrito sobre a assinatura de 5 argumentos, que outra sessao havia acabado de dropar. Ele criou
-- uma overload duplicada e a migration seguinte a remove e reaplica na assinatura certa. As outras
-- duas funcoes deste arquivo (finalize_appointment e fn_auto_move_lead_on_status_change) estao
-- corretas e continuam valendo.
--
-- ⚠️ O QUE ISTO IMPEDE: hoje o indice `conversions_one_per_ticket` (uma receita por card) esta, sem
-- querer, protegendo a DATA da primeira venda. Tres funcoes gravam `outcome_at = now()` sem condicao
-- nenhuma, entao no dia em que a segunda venda entrar no mesmo card a PRIMEIRA venda muda de mes
-- sozinha: junho perde uma venda do historico e agosto ganha uma, sem erro, sem aviso, em relatorio
-- que o cliente ja recebeu.
--
-- Tamanho medido em 10/08: 1.405 cards ganhos, 1.283 com a venda datada em mes ja fechado, e
-- 555 desses com o card ainda ABERTO, ou seja, alcancaveis por uma venda nova amanha.
--
-- 📌 REGRA NOVA, uniforme nas tres: `outcome_at` e a data em que o desfecho ATUAL foi alcancado pela
-- PRIMEIRA vez. Mudar de ganho para perdido (ou o contrario) continua carimbando now(), porque ai o
-- desfecho e outro de verdade. Repetir o mesmo desfecho preserva a data.
--
-- ⚠️ `fn_enforce_ticket_resolution_consistency` ja fazia isso certo (`COALESCE(NEW.outcome_at, now())`)
-- e NAO foi tocada. As tres abaixo eram as que faltavam.
--
-- Esta etapa e segura sozinha e ja e ganho hoje: qualquer caminho que chame `finalize_ticket` duas
-- vezes num card ja ganho hoje ja move a venda de mes, e isso para aqui.

-- 1) finalize_ticket: o caminho usado pelo Kanban, pelo orcamento e pelas RPCs de desfecho.
--    ⚠️ Assinatura de 5 argumentos: REVOGADA pela migration 20260810194132 (ver cabecalho).
CREATE OR REPLACE FUNCTION public.finalize_ticket(p_ticket_id uuid, p_outcome text, p_loss_reason text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_resolve boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ticket RECORD;
  v_target_stage_id uuid;
BEGIN
  PERFORM set_config('app.stage_source', 'finalize', true);
  PERFORM set_config('app.stage_actor', COALESCE(auth.uid()::text, ''), true);

  IF p_outcome NOT IN ('ganho', 'perdido') THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'invalid_outcome');
  END IF;

  SELECT id, lead_id, stage_id, clinic_id INTO v_ticket
  FROM tickets WHERE id = p_ticket_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'ticket_not_found');
  END IF;

  -- Guard de tenant: barra chamador authenticated de outra clínica. Passa para service_role e
  -- para chamada sem JWT (cron/psql/trigger interno).
  PERFORM public.assert_clinic_access(v_ticket.clinic_id);

  SELECT id INTO v_target_stage_id FROM funnel_stages
  WHERE clinic_id = v_ticket.clinic_id AND slug = p_outcome LIMIT 1;

  UPDATE tickets SET
    status      = CASE WHEN p_resolve THEN 'closed' ELSE status END,
    closed_at   = CASE WHEN p_resolve THEN COALESCE(closed_at, now()) ELSE closed_at END,
    outcome     = p_outcome,
    -- ⚠️ Preserva a data quando o desfecho JA era este. Sem isto, a 2a venda no mesmo card
    -- reescreve a data da 1a e a venda antiga migra de mes.
    outcome_at  = CASE WHEN outcome IS NOT DISTINCT FROM p_outcome
                       THEN COALESCE(outcome_at, now())
                       ELSE now() END,
    loss_reason = CASE WHEN p_outcome = 'perdido' THEN p_loss_reason ELSE loss_reason END,
    notes       = COALESCE(p_notes, notes),
    stage_id    = COALESCE(v_target_stage_id, stage_id)
  WHERE id = p_ticket_id;

  RETURN jsonb_build_object(
    'success', true,
    'ticket_id', p_ticket_id,
    'lead_id', v_ticket.lead_id,
    'outcome', p_outcome,
    'resolved', p_resolve,
    'new_stage_id', v_target_stage_id
  );
END;
$function$;

-- 2) finalize_appointment: o caminho da agenda (consulta realizada vira venda).
CREATE OR REPLACE FUNCTION public.finalize_appointment(p_appointment_id uuid, p_value numeric DEFAULT 0, p_payment_method text DEFAULT NULL::text, p_payment_status text DEFAULT 'pago'::text, p_description text DEFAULT NULL::text, p_protocol_ids uuid[] DEFAULT ARRAY[]::uuid[], p_ticket_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_apt RECORD; v_lead_id uuid; v_ganho_stage_id uuid; v_tx_id uuid; v_conv_id uuid;
  v_final_method text; v_has_money boolean;
BEGIN
  SELECT a.*, p.phone AS patient_phone INTO v_apt
  FROM appointments a LEFT JOIN patients p ON p.id = a.patient_id
  WHERE a.id = p_appointment_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error_code', 'appointment_not_found'); END IF;

  v_final_method := CASE WHEN p_payment_method IN ('pix','cartao','dinheiro','plano') THEN p_payment_method ELSE NULL END;

  v_has_money := EXISTS (SELECT 1 FROM financial_transactions WHERE appointment_id = p_appointment_id);

  IF v_apt.status <> 'realizado' THEN
    UPDATE appointments SET status = 'realizado' WHERE id = p_appointment_id;
  END IF;

  IF p_value > 0 AND NOT v_has_money THEN
    INSERT INTO financial_transactions (
      clinic_id, patient_id, appointment_id, type, category,
      amount, description, payment_method, status, date, protocol_ids
    ) VALUES (
      v_apt.clinic_id, v_apt.patient_id, p_appointment_id, 'receita', 'Consulta',
      p_value, COALESCE(NULLIF(p_description, ''), 'Consulta realizada'),
      v_final_method,
      CASE WHEN p_payment_status IN ('pago', 'pendente') THEN p_payment_status ELSE 'pago' END,
      v_apt.date, p_protocol_ids
    ) RETURNING id INTO v_tx_id;

    SELECT id INTO v_lead_id FROM leads WHERE converted_patient_id = v_apt.patient_id LIMIT 1;
    IF v_lead_id IS NULL AND v_apt.patient_phone IS NOT NULL THEN
      SELECT id INTO v_lead_id FROM leads
      WHERE clinic_id = v_apt.clinic_id AND normalize_br_phone(phone) = normalize_br_phone(v_apt.patient_phone)
      ORDER BY created_at DESC LIMIT 1;
      IF v_lead_id IS NOT NULL THEN
        UPDATE leads SET converted_patient_id = v_apt.patient_id WHERE id = v_lead_id;
      END IF;
    END IF;

    IF v_lead_id IS NOT NULL THEN
      INSERT INTO conversions (
        clinic_id, lead_id, value, description, payment_method,
        protocol_ids, converted_at, financial_transaction_id, ticket_id
      ) VALUES (
        v_apt.clinic_id, v_lead_id, p_value,
        COALESCE(NULLIF(p_description, ''), 'Consulta realizada'),
        v_final_method, p_protocol_ids,
        (v_apt.date::text || ' ' || COALESCE(v_apt.time::text, '00:00:00'))::timestamptz,
        v_tx_id, COALESCE(p_ticket_id, v_apt.ticket_id)
      )
      ON CONFLICT (lead_id, financial_transaction_id) WHERE financial_transaction_id IS NOT NULL DO NOTHING
      RETURNING id INTO v_conv_id;
    END IF;
  END IF;

  IF p_ticket_id IS NOT NULL THEN
    SELECT id INTO v_ganho_stage_id FROM funnel_stages WHERE clinic_id = v_apt.clinic_id AND slug = 'ganho' LIMIT 1;
    IF v_ganho_stage_id IS NOT NULL THEN
      -- ⚠️ Mesma regra do finalize_ticket: card que ja era ganho mantem a data da 1a venda.
      UPDATE tickets SET stage_id = v_ganho_stage_id, outcome = 'ganho',
        outcome_at = CASE WHEN outcome IS NOT DISTINCT FROM 'ganho'
                          THEN COALESCE(outcome_at, now())
                          ELSE now() END
      WHERE id = p_ticket_id;
    END IF;
  END IF;

  RETURN jsonb_build_object('success', true, 'appointment_id', p_appointment_id,
    'transaction_id', v_tx_id, 'conversion_id', v_conv_id, 'lead_id', v_lead_id,
    'money_skipped', v_has_money);
END; $function$;

-- 3) fn_auto_move_lead_on_status_change: o gatilho que move o card quando o status da consulta muda.
CREATE OR REPLACE FUNCTION public.fn_auto_move_lead_on_status_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ticket_id uuid;
  v_target_slug text;
  v_target_stage_id uuid;
  v_target_position int;
  v_current_position int;
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;

  PERFORM set_config('app.stage_source', 'agenda', true);

  v_target_slug := CASE NEW.status
    WHEN 'compareceu' THEN 'compareceu'
    WHEN 'realizado'  THEN 'ganho'
    WHEN 'cancelado'  THEN 'faltou_cancelou'
    WHEN 'faltou'     THEN 'faltou_cancelou'
    ELSE NULL
  END;
  IF v_target_slug IS NULL THEN RETURN NEW; END IF;

  v_ticket_id := NEW.ticket_id;
  IF v_ticket_id IS NULL THEN
    SELECT t.id INTO v_ticket_id
    FROM tickets t
    JOIN leads l ON l.id = t.lead_id
    JOIN patients p ON p.phone = l.phone AND p.clinic_id = l.clinic_id
    WHERE p.id = NEW.patient_id AND l.clinic_id = NEW.clinic_id
    ORDER BY (t.status = 'open') DESC, t.opened_at DESC
    LIMIT 1;
  END IF;
  IF v_ticket_id IS NULL THEN RETURN NEW; END IF;

  SELECT id, position INTO v_target_stage_id, v_target_position
  FROM funnel_stages WHERE clinic_id = NEW.clinic_id AND slug = v_target_slug LIMIT 1;
  IF v_target_stage_id IS NULL THEN RETURN NEW; END IF;

  SELECT fs.position INTO v_current_position
  FROM tickets t JOIN funnel_stages fs ON fs.id = t.stage_id
  WHERE t.id = v_ticket_id;

  IF NEW.status IN ('cancelado', 'faltou')
     OR v_current_position IS NULL
     OR v_current_position < v_target_position THEN
    UPDATE tickets
      SET stage_id = v_target_stage_id,
          outcome = CASE WHEN NEW.status = 'realizado' THEN 'ganho'
                         WHEN NEW.status IN ('cancelado', 'faltou') THEN 'perdido'
                         ELSE outcome END,
          -- ⚠️ So carimba quando o desfecho MUDA de verdade. Repetir o mesmo desfecho
          -- (consulta remarcada e realizada de novo, por exemplo) preserva a data original.
          outcome_at = CASE
            WHEN NEW.status NOT IN ('realizado', 'cancelado', 'faltou') THEN outcome_at
            WHEN outcome IS DISTINCT FROM (CASE WHEN NEW.status = 'realizado' THEN 'ganho' ELSE 'perdido' END) THEN now()
            ELSE COALESCE(outcome_at, now())
          END
      WHERE id = v_ticket_id;
  END IF;

  RETURN NEW;
END;
$function$;
