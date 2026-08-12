-- Fase 0 da Central de Orçamentos (WakeDesk, clinics.category='outro'): tabela `orcamentos`
-- como fonte da verdade (número sequencial real, status, cliente, valores), + 2 RPCs de
-- escrita atômica (nunca dual-write solto no client) e uma trigger de sincronização reversa.
--
-- Decisões de produto (usuário, 08/07): só category='outro'; Ordem de Pedido (Fase 2) é só
-- documento imprimível, sem tabela própria, usa orcamentos.number; "Aprovar" FECHA a venda
-- (Ganho + receita); sem parcelamento no MVP; edição de orçamento 'enviado' sobrescreve o
-- mesmo número (sem versionamento); backfill dos quote_data existentes importa p/ a Central.
--
-- Achados da revisão adversarial (6 agentes, 08/07) que este desenho corrige:
--  * NÃO existe "a RPC de Ganho" para reusar — o GanhoModal é orquestração client-side
--    (patient -> financial_transactions -> conversions -> moveTicket -> finalize_ticket
--    p_resolve:false). close_sale_from_orcamento() replica essa sequência em transação e
--    REUSA finalize_ticket() para a parte de outcome/estágio (mesma RPC, não duplicada).
--  * Modelo real (confirmado em 20260706000005_ganho_pipeline_keep_outcome.sql): um ticket
--    'ganho' continua com status='open' (pipeline de vendas) até o botão "Resolver". Por
--    isso a venda sempre resolve o ticket ABERTO ATUAL do lead (`status='open'`), nunca um
--    ticket_id gravado no passado (que fica stale a cada novo ciclo — move_lead_stage não
--    copia quote_data para o ticket novo).
--  * Dual-write no client hoje é não-atômico e engole erro (LeadKanban.tsx onConfirm). As
--    duas RPCs abaixo são o ÚNICO ponto de escrita; tickets.quote_data/leads.estimated_value
--    continuam espelhados (Kanban/ProductionOrderModal legados) até serem aposentados (Fase 3).
--  * Cancelar a venda (reopen_ticket / arraste ganho->perdido) não pode deixar o orçamento
--    'aprovado' órfão — trigger de sync reversa reverte para 'enviado'.
--  * orcamento_items fica para a Fase 3 (YAGNI): o snapshot jsonb já basta para o MVP e para
--    o "Gerar OP" existente (prova: ProductionOrderModal já consome quote_data.lines).

-- ============================================================================
-- TABELA
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.orcamentos (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id          uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  number             integer NOT NULL DEFAULT 0,
  lead_id            uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  -- ticket_id: carimbo histórico (ticket no momento da criação). NÃO usar p/ resolver a
  -- venda — fica stale a cada novo ciclo. approved_ticket_id é o ticket que a venda usou de fato.
  ticket_id          uuid REFERENCES public.tickets(id) ON DELETE SET NULL,
  approved_ticket_id uuid REFERENCES public.tickets(id) ON DELETE SET NULL,
  status             text NOT NULL DEFAULT 'rascunho'
                        CHECK (status IN ('rascunho','enviado','aprovado','recusado','expirado')),
  client_name        text,
  client_doc         text,
  client_address     text,
  subtotal           numeric,
  desconto           numeric,
  frete              numeric,
  total              numeric NOT NULL DEFAULT 0,
  validade           date,
  vencimento         date,
  pagamento          text,
  notes              text,
  reject_reason      text,
  snapshot           jsonb,
  created_by         uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  sent_at            timestamptz,
  approved_at        timestamptz,
  rejected_at        timestamptz,
  UNIQUE (clinic_id, number)
);
CREATE INDEX IF NOT EXISTS orcamentos_clinic_idx ON public.orcamentos (clinic_id);
CREATE INDEX IF NOT EXISTS orcamentos_lead_idx   ON public.orcamentos (lead_id);
CREATE INDEX IF NOT EXISTS orcamentos_status_idx ON public.orcamentos (clinic_id, status);

-- ============================================================================
-- Numeração sequencial: estende o trigger genérico do módulo Produção (mesma função,
-- só ganha um novo ramo — os ramos de production_orders/maintenance_orders ficam intactos).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.set_clinic_sequential_number()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.number IS NULL OR NEW.number = 0 THEN
    IF TG_TABLE_NAME = 'production_orders' THEN
      SELECT COALESCE(MAX(number), 0) + 1 INTO NEW.number FROM public.production_orders WHERE clinic_id = NEW.clinic_id;
    ELSIF TG_TABLE_NAME = 'maintenance_orders' THEN
      SELECT COALESCE(MAX(number), 0) + 1 INTO NEW.number FROM public.maintenance_orders WHERE clinic_id = NEW.clinic_id;
    ELSIF TG_TABLE_NAME = 'orcamentos' THEN
      SELECT COALESCE(MAX(number), 0) + 1 INTO NEW.number FROM public.orcamentos WHERE clinic_id = NEW.clinic_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_number_orcamentos ON public.orcamentos;
CREATE TRIGGER trg_number_orcamentos
  BEFORE INSERT ON public.orcamentos
  FOR EACH ROW EXECUTE FUNCTION public.set_clinic_sequential_number();

-- ============================================================================
-- RLS (mesmo helper DRY do módulo Produção) + Realtime
-- ============================================================================
ALTER TABLE public.orcamentos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS orcamentos_access ON public.orcamentos;
CREATE POLICY orcamentos_access ON public.orcamentos AS PERMISSIVE FOR ALL TO public
  USING (has_clinic_access(clinic_id)) WITH CHECK (has_clinic_access(clinic_id));

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.orcamentos;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================================
-- production_orders: colunas p/ a Fase 2 (Gerar OP a partir de um orçamento) já nascerem
-- com idempotência — índice único parcial evita OP duplicada por clique repetido (bug já
-- existente em handleGenerateOP, LeadKanban.tsx). Sem uso ainda (frontend é Fase 2).
-- ============================================================================
ALTER TABLE public.production_orders ADD COLUMN IF NOT EXISTS orcamento_id uuid
  REFERENCES public.orcamentos(id) ON DELETE SET NULL;
ALTER TABLE public.production_orders ADD COLUMN IF NOT EXISTS orcamento_line_key text;

CREATE UNIQUE INDEX IF NOT EXISTS production_orders_orcamento_line_uidx
  ON public.production_orders (orcamento_id, orcamento_line_key)
  WHERE orcamento_id IS NOT NULL AND status <> 'cancelada';

-- ============================================================================
-- Helper: orçamento VIGENTE de um lead. Prioriza um 'aprovado' cujo approved_ticket_id
-- ainda é o ticket ABERTO atual do lead (venda válida do ciclo corrente); senão, o mais
-- recente por created_at. Usado pelo Kanban (gates legados) e pela Central (Fase 1).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_orcamento_vigente(p_lead_id uuid)
RETURNS public.orcamentos
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT o.*
  FROM public.orcamentos o
  WHERE o.lead_id = p_lead_id
  ORDER BY
    (o.status = 'aprovado'
      AND o.approved_ticket_id = (
        SELECT t.id FROM public.tickets t WHERE t.lead_id = p_lead_id AND t.status = 'open' LIMIT 1
      )
    ) DESC,
    o.created_at DESC
  LIMIT 1;
$$;

-- ============================================================================
-- RPC: salvar orçamento (criar ou editar). ÚNICO ponto de escrita — grava o cabeçalho e
-- espelha em tickets.quote_data/notes (do ticket ABERTO atual, não do ticket_id do payload)
-- e em leads.estimated_value, p/ o Kanban/ProductionOrderModal legados continuarem
-- funcionando durante a transição (o espelho é aposentado na Fase 3).
-- Trava edição após aprovado: evita sobrescrever total/número de uma venda já fechada.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.save_orcamento(
  p_id             uuid,
  p_clinic_id      uuid,
  p_lead_id        uuid,
  p_status         text DEFAULT 'rascunho',
  p_client_name    text DEFAULT NULL,
  p_client_doc     text DEFAULT NULL,
  p_client_address text DEFAULT NULL,
  p_subtotal       numeric DEFAULT NULL,
  p_desconto       numeric DEFAULT NULL,
  p_frete          numeric DEFAULT NULL,
  p_total          numeric DEFAULT 0,
  p_validade       date DEFAULT NULL,
  p_vencimento     date DEFAULT NULL,
  p_pagamento      text DEFAULT NULL,
  p_notes          text DEFAULT NULL,
  p_snapshot       jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id          uuid;
  v_number      integer;
  v_cur_status  text;
  v_open_ticket uuid;
BEGIN
  IF NOT has_clinic_access(p_clinic_id) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;
  IF p_status NOT IN ('rascunho', 'enviado') THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'invalid_status');
  END IF;

  IF p_id IS NOT NULL THEN
    SELECT status INTO v_cur_status FROM public.orcamentos WHERE id = p_id AND clinic_id = p_clinic_id FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error_code', 'not_found');
    END IF;
    IF v_cur_status NOT IN ('rascunho', 'enviado') THEN
      RETURN jsonb_build_object('success', false, 'error_code', 'locked_after_approval', 'status', v_cur_status);
    END IF;

    UPDATE public.orcamentos SET
      lead_id        = p_lead_id,
      client_name    = p_client_name,
      client_doc     = p_client_doc,
      client_address = p_client_address,
      subtotal       = p_subtotal,
      desconto       = p_desconto,
      frete          = p_frete,
      total          = p_total,
      validade       = p_validade,
      vencimento     = p_vencimento,
      pagamento      = p_pagamento,
      notes          = p_notes,
      snapshot       = p_snapshot,
      -- só promove rascunho->enviado; nunca rebaixa um já 'enviado' de volta a rascunho.
      status         = CASE WHEN status = 'rascunho' THEN p_status ELSE status END,
      sent_at        = CASE WHEN status = 'rascunho' AND p_status = 'enviado' THEN now() ELSE sent_at END
    WHERE id = p_id
    RETURNING id, number INTO v_id, v_number;
  ELSE
    INSERT INTO public.orcamentos (
      clinic_id, lead_id, status, client_name, client_doc, client_address,
      subtotal, desconto, frete, total, validade, vencimento, pagamento, notes, snapshot,
      created_by, sent_at
    ) VALUES (
      p_clinic_id, p_lead_id, p_status, p_client_name, p_client_doc, p_client_address,
      p_subtotal, p_desconto, p_frete, p_total, p_validade, p_vencimento, p_pagamento, p_notes, p_snapshot,
      auth.uid(), CASE WHEN p_status = 'enviado' THEN now() ELSE NULL END
    )
    RETURNING id, number INTO v_id, v_number;
  END IF;

  IF p_lead_id IS NOT NULL THEN
    SELECT id INTO v_open_ticket FROM public.tickets WHERE lead_id = p_lead_id AND status = 'open' LIMIT 1;
    IF v_open_ticket IS NOT NULL THEN
      UPDATE public.tickets SET quote_data = p_snapshot, notes = COALESCE(p_notes, notes) WHERE id = v_open_ticket;
    END IF;
    UPDATE public.leads SET estimated_value = p_total WHERE id = p_lead_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'id', v_id, 'number', v_number);
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_orcamento(uuid, uuid, uuid, text, text, text, text, numeric, numeric, numeric, numeric, date, date, text, text, jsonb) TO authenticated;

-- ============================================================================
-- RPC: transições simples de status (enviado explícito / recusado / expirado). Aprovar
-- tem RPC própria (close_sale_from_orcamento) por causa dos efeitos colaterais de venda.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.update_orcamento_status(
  p_orcamento_id uuid,
  p_status       text,
  p_reason       text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_orc public.orcamentos%ROWTYPE;
BEGIN
  IF p_status NOT IN ('enviado', 'recusado', 'expirado') THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'invalid_status');
  END IF;

  SELECT * INTO v_orc FROM public.orcamentos WHERE id = p_orcamento_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'not_found');
  END IF;
  IF NOT has_clinic_access(v_orc.clinic_id) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;
  IF v_orc.status NOT IN ('rascunho', 'enviado') THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'already_processed', 'status', v_orc.status);
  END IF;

  UPDATE public.orcamentos SET
    status        = p_status,
    sent_at       = CASE WHEN p_status = 'enviado' THEN COALESCE(sent_at, now()) ELSE sent_at END,
    rejected_at   = CASE WHEN p_status = 'recusado' THEN now() ELSE rejected_at END,
    reject_reason = CASE WHEN p_status = 'recusado' THEN p_reason ELSE reject_reason END
  WHERE id = p_orcamento_id;

  RETURN jsonb_build_object('success', true, 'id', p_orcamento_id, 'status', p_status);
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_orcamento_status(uuid, text, text) TO authenticated;

-- ============================================================================
-- RPC: Aprovar = fechar a venda (decisão do usuário). Espelha em SQL, numa única
-- transação, o que o GanhoModal faz hoje no client (patient -> financial_transactions ->
-- conversions -> finalize_ticket), e REUSA finalize_ticket() em vez de duplicar a lógica
-- de outcome/estágio. Resolve sempre o ticket ABERTO ATUAL do lead (nunca um ticket_id
-- stale). Idempotente: reaprovar (ou aprovar um 2º orçamento do mesmo ciclo já vendido)
-- não duplica receita.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.close_sale_from_orcamento(
  p_orcamento_id   uuid,
  p_payment_method text DEFAULT 'pix',
  p_payment_status text DEFAULT 'pago',
  p_payment_date   date DEFAULT CURRENT_DATE,
  p_category       text DEFAULT 'Venda de produto'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_orc      public.orcamentos%ROWTYPE;
  v_ticket   RECORD;
  v_lead     RECORD;
  v_patient  uuid;
  v_tx_id    uuid;
  v_finalize jsonb;
BEGIN
  SELECT * INTO v_orc FROM public.orcamentos WHERE id = p_orcamento_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'orcamento_not_found');
  END IF;
  IF NOT has_clinic_access(v_orc.clinic_id) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;
  -- Claim atômico: só aprova a partir de rascunho/enviado. Cobre duplo-clique e reprocesso.
  IF v_orc.status NOT IN ('rascunho', 'enviado') THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'already_processed', 'status', v_orc.status);
  END IF;
  IF v_orc.lead_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'no_lead_linked');
  END IF;

  -- Ticket ABERTO ATUAL do lead (nunca o ticket_id gravado no orçamento — fica stale a
  -- cada novo ciclo). Invariante "1 ticket aberto por lead" garante no máximo 1 aqui.
  SELECT id, outcome, status INTO v_ticket
  FROM public.tickets WHERE lead_id = v_orc.lead_id AND status = 'open'
  FOR UPDATE LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'no_open_ticket');
  END IF;
  IF v_ticket.outcome = 'perdido' THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'ticket_perdido');
  END IF;

  -- Já ganho (outro orçamento do mesmo lead fechou este ticket antes): não duplica
  -- receita/conversão — só alinha o status deste orçamento. A UI avisa o usuário.
  IF v_ticket.outcome = 'ganho' THEN
    UPDATE public.orcamentos SET status = 'aprovado', approved_at = now(), approved_ticket_id = v_ticket.id
    WHERE id = p_orcamento_id;
    RETURN jsonb_build_object('success', true, 'already_sold', true, 'ticket_id', v_ticket.id);
  END IF;

  SELECT converted_patient_id, name, phone INTO v_lead FROM public.leads WHERE id = v_orc.lead_id;

  -- Garante paciente ANTES de fechar o ticket (mesma ordem do GanhoModal): sem isso a
  -- receita nasce órfã do Faturamento Real com filtro de coorte. Fazer isso com o ticket
  -- AINDA aberto/sem outcome evita que fn_auto_create_lead_on_patient abra um ticket novo
  -- (o trigger só cria ticket se não achar nenhum aberto — e este já está aberto agora).
  v_patient := v_lead.converted_patient_id;
  IF v_patient IS NULL THEN
    INSERT INTO public.patients (clinic_id, name, phone)
    VALUES (v_orc.clinic_id, v_lead.name, v_lead.phone)
    RETURNING id INTO v_patient;
    UPDATE public.leads SET converted_patient_id = v_patient WHERE id = v_orc.lead_id AND converted_patient_id IS NULL;
  END IF;

  -- Receita PRIMEIRO, p/ vincular a conversão a ela (financial_transaction_id) — mesmo
  -- vínculo confiável que reopen_ticket/fn_purge_ticket_sale usam p/ limpar sem órfãos.
  INSERT INTO public.financial_transactions (
    clinic_id, patient_id, type, category, amount, description, payment_method, status, date
  ) VALUES (
    v_orc.clinic_id, v_patient, 'receita', p_category, v_orc.total,
    'Orçamento #' || v_orc.number, p_payment_method, p_payment_status, p_payment_date
  )
  RETURNING id INTO v_tx_id;

  INSERT INTO public.conversions (
    clinic_id, lead_id, ticket_id, value, description, payment_method, converted_at, financial_transaction_id
  ) VALUES (
    v_orc.clinic_id, v_orc.lead_id, v_ticket.id, v_orc.total,
    'Orçamento #' || v_orc.number, p_payment_method,
    (p_payment_date::timestamp + interval '12 hour'), v_tx_id
  );

  -- Reusa a RPC canônica de desfecho (a mesma que o GanhoModal chama via closeTicket):
  -- atômica p/ outcome + outcome_at + estágio terminal. p_resolve:false mantém o card
  -- aberto no Kanban (pipeline de vendas) — "Resolver" fecha depois, igual ao fluxo manual.
  SELECT public.finalize_ticket(v_ticket.id, 'ganho', NULL, NULL, false) INTO v_finalize;
  IF NOT COALESCE((v_finalize->>'success')::boolean, false) THEN
    RAISE EXCEPTION 'finalize_ticket falhou ao aprovar orçamento %: %', p_orcamento_id, v_finalize->>'error_code';
  END IF;

  UPDATE public.orcamentos SET status = 'aprovado', approved_at = now(), approved_ticket_id = v_ticket.id
  WHERE id = p_orcamento_id;

  RETURN jsonb_build_object(
    'success', true,
    'ticket_id', v_ticket.id,
    'financial_transaction_id', v_tx_id,
    'patient_id', v_patient
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.close_sale_from_orcamento(uuid, text, text, date, text) TO authenticated;

-- ============================================================================
-- Trigger de sync reversa: se a venda sai de 'ganho' por QUALQUER caminho (reopen_ticket
-- = "Cancelar venda" zera outcome; arraste explícito ganho->perdido), o orçamento aprovado
-- correspondente volta para 'enviado' — nunca fica "aprovado" apontando p/ uma venda que
-- não existe mais. approved_at fica como histórico (quando FOI aprovado); approved_ticket_id
-- é limpo (o vínculo deixou de ser válido).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_orcamento_revert_on_sale_lost()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.outcome = 'ganho' AND NEW.outcome IS DISTINCT FROM 'ganho' THEN
    UPDATE public.orcamentos
      SET status = 'enviado', approved_ticket_id = NULL
      WHERE approved_ticket_id = OLD.id AND status = 'aprovado';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orcamento_revert_on_sale_lost ON public.tickets;
CREATE TRIGGER trg_orcamento_revert_on_sale_lost
AFTER UPDATE ON public.tickets
FOR EACH ROW
EXECUTE FUNCTION public.fn_orcamento_revert_on_sale_lost();

-- ============================================================================
-- Backfill: importa os quote_data já existentes (só clínicas 'outro', decisão do usuário).
-- number sequencial explícito por clínica (respeitado pelo trigger, que só numera quando
-- NEW.number é nulo/0). Enriquecido com o outcome atual do ticket: venda já ganha vira
-- 'aprovado' retroativamente (histórico correto na nova Central); demais entram 'enviado'
-- (não há como saber se foram de fato enviadas ao cliente).
-- ============================================================================
INSERT INTO public.orcamentos (
  clinic_id, number, lead_id, ticket_id, status, client_name, total, snapshot,
  created_at, sent_at, approved_at, approved_ticket_id
)
SELECT
  t.clinic_id,
  row_number() OVER (PARTITION BY t.clinic_id ORDER BY t.created_at),
  t.lead_id,
  t.id,
  CASE WHEN t.outcome = 'ganho' THEN 'aprovado' ELSE 'enviado' END,
  l.name,
  COALESCE(l.estimated_value, 0),
  t.quote_data,
  t.created_at,
  t.created_at,
  CASE WHEN t.outcome = 'ganho' THEN t.outcome_at ELSE NULL END,
  CASE WHEN t.outcome = 'ganho' THEN t.id ELSE NULL END
FROM public.tickets t
JOIN public.leads l ON l.id = t.lead_id
JOIN public.clinics c ON c.id = t.clinic_id AND c.category = 'outro'
WHERE t.quote_data IS NOT NULL;
