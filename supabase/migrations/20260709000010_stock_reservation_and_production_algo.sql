-- Passos 2+3 do motor de produção (WakeDesk/telas): reserva de estoque por SKU + algoritmo de
-- decisão 2.2 na CONFIRMAÇÃO do pedido (aprovação do orçamento). Tudo em metro linear, por SKU
-- (flatten por altura). Ver [[production-engine-plan]].
--
-- Ciclo da reserva: reservar na aprovação (FOR UPDATE) → liberar no cancelamento → baixar no
-- Resolver (entrega). O algoritmo: reserva o disponível e gera OP do que falta + estoque mínimo,
-- descontando a produção livre (OPs de REPOSIÇÃO abertas; vinculadas têm dono), arredondado ao lote.

-- ============ coluna tipo na OP (vinculada = tem dono; reposicao = livre) ============
ALTER TABLE public.production_orders ADD COLUMN IF NOT EXISTS tipo text;
DO $$ BEGIN
  ALTER TABLE public.production_orders ADD CONSTRAINT production_orders_tipo_chk CHECK (tipo IN ('vinculada','reposicao'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============ tabela de reservas ============
CREATE TABLE IF NOT EXISTS public.stock_reservations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id    uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  item_id      uuid NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  orcamento_id uuid REFERENCES public.orcamentos(id) ON DELETE SET NULL,
  qty          numeric NOT NULL CHECK (qty > 0),          -- metro linear
  status       text NOT NULL DEFAULT 'ativa' CHECK (status IN ('ativa','liberada','baixada')),
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  released_at  timestamptz,
  settled_at   timestamptz
);
CREATE INDEX IF NOT EXISTS stock_reservations_clinic_idx ON public.stock_reservations (clinic_id);
CREATE INDEX IF NOT EXISTS stock_reservations_item_ativa_idx ON public.stock_reservations (item_id) WHERE status = 'ativa';
CREATE INDEX IF NOT EXISTS stock_reservations_orc_idx ON public.stock_reservations (orcamento_id);

ALTER TABLE public.stock_reservations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stock_reservations_access ON public.stock_reservations;
CREATE POLICY stock_reservations_access ON public.stock_reservations AS PERMISSIVE FOR ALL TO public
  USING (has_clinic_access(clinic_id)) WITH CHECK (has_clinic_access(clinic_id));
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.stock_reservations;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============ view: disponível = saldo − reservas ativas (por SKU) ============
CREATE OR REPLACE VIEW public.vw_inventory_available
WITH (security_invoker = true) AS
SELECT ii.*,
  COALESCE((SELECT SUM(r.qty) FROM public.stock_reservations r WHERE r.item_id = ii.id AND r.status = 'ativa'), 0) AS reserved_qty,
  ii.current_qty - COALESCE((SELECT SUM(r.qty) FROM public.stock_reservations r WHERE r.item_id = ii.id AND r.status = 'ativa'), 0) AS available_qty
FROM public.inventory_items ii;

-- ============ provision: reserva + algoritmo 2.2, por linha do orçamento ============
-- Chamada de dentro de close_sale_from_orcamento (na aprovação), atômica com a venda.
CREATE OR REPLACE FUNCTION public.provision_orcamento(p_orcamento_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_orc     public.orcamentos%ROWTYPE;
  v_rec     record;
  v_prod    uuid;
  v_item    public.inventory_items%ROWTYPE;
  v_comp    numeric;      -- comprimento pedido (metro linear)
  v_reserv  numeric;      -- já reservado ativo do SKU
  v_disp    numeric;      -- disponível = saldo − reservado
  v_livre   numeric;      -- produção livre (OPs de reposição abertas)
  v_projpos numeric;      -- projetado pós-venda
  v_tores   numeric;      -- a reservar
  v_nec     numeric;      -- necessidade
  v_qtdop   numeric;      -- qtd da OP
  v_tipoop  text;
  v_reserved numeric := 0;
  v_ops     int := 0;
BEGIN
  SELECT * INTO v_orc FROM public.orcamentos WHERE id = p_orcamento_id;
  IF NOT FOUND OR NOT has_clinic_access(v_orc.clinic_id) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;

  FOR v_rec IN
    SELECT (elem->>'productId') AS pid,
           NULLIF(replace(COALESCE(elem->>'qty',''), ',', '.'), '')::numeric AS qty,
           ord
    FROM jsonb_array_elements(COALESCE(v_orc.snapshot->'lines', '[]'::jsonb)) WITH ORDINALITY AS t(elem, ord)
  LOOP
    -- só produtos (p:<uuid>); protocolos/serviços não produzem
    IF v_rec.pid IS NULL OR left(v_rec.pid, 2) <> 'p:' THEN CONTINUE; END IF;
    v_prod := substring(v_rec.pid FROM 3)::uuid;
    v_comp := COALESCE(v_rec.qty, 0);
    IF v_comp <= 0 THEN CONTINUE; END IF;

    -- resolve o SKU de estoque (produto acabado) e TRAVA a linha do saldo
    SELECT * INTO v_item FROM public.inventory_items
      WHERE clinic_id = v_orc.clinic_id AND product_id = v_prod AND kind = 'produto_acabado' AND is_active = true
      LIMIT 1 FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;   -- produto sem item de estoque → ignora (serviço, etc.)

    -- SOB MEDIDA: produz a quantidade exata, sem reservar nem arredondar
    IF v_item.tipo = 'sob_medida' THEN
      INSERT INTO public.production_orders
        (clinic_id, product_item_id, product_label, qty_planned, altura, tipo, orcamento_id, orcamento_line_key, ticket_id, lead_id, client_name, created_by)
      VALUES
        (v_orc.clinic_id, v_item.id, v_item.name, v_comp, v_item.altura, 'vinculada', p_orcamento_id, 'L'||v_rec.ord, v_orc.approved_ticket_id, v_orc.lead_id, v_orc.client_name, auth.uid());
      v_ops := v_ops + 1;
      CONTINUE;
    END IF;

    -- PADRÃO — grandezas em metro linear
    SELECT COALESCE(SUM(qty), 0) INTO v_reserv FROM public.stock_reservations WHERE item_id = v_item.id AND status = 'ativa';
    v_disp := v_item.current_qty - v_reserv;
    SELECT COALESCE(SUM(qty_planned), 0) INTO v_livre FROM public.production_orders
      WHERE product_item_id = v_item.id AND tipo = 'reposicao' AND status IN ('planejada', 'em_producao');
    v_projpos := (v_disp + v_livre) - v_comp;

    -- reserva o disponível (min do pedido, nunca negativo)
    v_tores := LEAST(v_comp, GREATEST(v_disp, 0));
    IF v_tores > 0 THEN
      INSERT INTO public.stock_reservations (clinic_id, item_id, orcamento_id, qty, created_by)
      VALUES (v_orc.clinic_id, v_item.id, p_orcamento_id, v_tores, auth.uid());
      v_reserved := v_reserved + v_tores;
    END IF;

    -- decisão de OP: cobre falta + mínimo − andamento, arredondado ao lote
    IF v_projpos >= COALESCE(v_item.min_qty, 0) THEN CONTINUE; END IF;   -- projetado já supre o mínimo
    v_nec := COALESCE(v_item.min_qty, 0) - v_projpos;
    IF COALESCE(v_item.lote_minimo, 0) > 0 THEN
      v_qtdop := ceil(v_nec / v_item.lote_minimo) * v_item.lote_minimo;
    ELSE
      v_qtdop := v_nec;
    END IF;
    v_tipoop := CASE WHEN v_projpos < 0 THEN 'vinculada' ELSE 'reposicao' END;

    INSERT INTO public.production_orders
      (clinic_id, product_item_id, product_label, qty_planned, altura, tipo, orcamento_id, orcamento_line_key, ticket_id, lead_id, client_name, created_by)
    VALUES
      (v_orc.clinic_id, v_item.id, v_item.name, v_qtdop, v_item.altura, v_tipoop,
       CASE WHEN v_tipoop = 'vinculada' THEN p_orcamento_id ELSE NULL END,
       'L'||v_rec.ord, v_orc.approved_ticket_id, v_orc.lead_id, v_orc.client_name, auth.uid());
    v_ops := v_ops + 1;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'reserved', v_reserved, 'ops', v_ops);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.provision_orcamento(uuid) FROM PUBLIC, anon;

-- ============ liga o algoritmo + guard de vencido no close_sale ============
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
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error_code', 'orcamento_not_found'); END IF;
  IF NOT has_clinic_access(v_orc.clinic_id) THEN RETURN jsonb_build_object('success', false, 'error_code', 'forbidden'); END IF;
  IF v_orc.status NOT IN ('rascunho', 'enviado') THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'already_processed', 'status', v_orc.status);
  END IF;
  -- Orçamento vencido não converte: recalcula preço antes.
  IF v_orc.validade IS NOT NULL AND v_orc.validade < CURRENT_DATE THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'orcamento_vencido', 'validade', v_orc.validade);
  END IF;
  IF v_orc.lead_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error_code', 'no_lead_linked'); END IF;

  SELECT id, outcome, status INTO v_ticket
  FROM public.tickets WHERE lead_id = v_orc.lead_id AND status = 'open' FOR UPDATE LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error_code', 'no_open_ticket'); END IF;
  IF v_ticket.outcome = 'perdido' THEN RETURN jsonb_build_object('success', false, 'error_code', 'ticket_perdido'); END IF;

  IF v_ticket.outcome = 'ganho' THEN
    UPDATE public.orcamentos SET status = 'aprovado', approved_at = now(), approved_ticket_id = v_ticket.id WHERE id = p_orcamento_id;
    RETURN jsonb_build_object('success', true, 'already_sold', true, 'ticket_id', v_ticket.id);
  END IF;

  SELECT converted_patient_id, name, phone INTO v_lead FROM public.leads WHERE id = v_orc.lead_id;
  v_patient := v_lead.converted_patient_id;
  IF v_patient IS NULL THEN
    IF v_lead.phone IS NOT NULL THEN
      SELECT id INTO v_patient FROM public.patients
      WHERE clinic_id = v_orc.clinic_id AND phone IS NOT NULL AND normalize_br_phone(phone) = normalize_br_phone(v_lead.phone) LIMIT 1;
    END IF;
    IF v_patient IS NULL THEN
      INSERT INTO public.patients (clinic_id, name, phone) VALUES (v_orc.clinic_id, v_lead.name, v_lead.phone) RETURNING id INTO v_patient;
    END IF;
    UPDATE public.leads SET converted_patient_id = v_patient WHERE id = v_orc.lead_id AND converted_patient_id IS NULL;
  END IF;

  INSERT INTO public.financial_transactions (clinic_id, patient_id, type, category, amount, description, payment_method, status, date)
  VALUES (v_orc.clinic_id, v_patient, 'receita', p_category, v_orc.total, 'Orçamento #' || v_orc.number, p_payment_method, p_payment_status, p_payment_date)
  RETURNING id INTO v_tx_id;

  INSERT INTO public.conversions (clinic_id, lead_id, ticket_id, value, description, payment_method, converted_at, financial_transaction_id)
  VALUES (v_orc.clinic_id, v_orc.lead_id, v_ticket.id, v_orc.total, 'Orçamento #' || v_orc.number, p_payment_method, (p_payment_date::timestamp + interval '12 hour'), v_tx_id);

  SELECT public.finalize_ticket(v_ticket.id, 'ganho', NULL, NULL, false) INTO v_finalize;
  IF NOT COALESCE((v_finalize->>'success')::boolean, false) THEN
    RAISE EXCEPTION 'finalize_ticket falhou ao aprovar orçamento %: %', p_orcamento_id, v_finalize->>'error_code';
  END IF;

  UPDATE public.orcamentos SET status = 'aprovado', approved_at = now(), approved_ticket_id = v_ticket.id WHERE id = p_orcamento_id;

  -- reserva estoque + gera OPs (algoritmo 2.2), atômico com a venda
  PERFORM public.provision_orcamento(p_orcamento_id);

  RETURN jsonb_build_object('success', true, 'ticket_id', v_ticket.id, 'financial_transaction_id', v_tx_id, 'patient_id', v_patient);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.close_sale_from_orcamento(uuid, text, text, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_sale_from_orcamento(uuid, text, text, date, text) TO authenticated;

-- ============ liberar reservas quando a venda é cancelada (sai de ganho) ============
CREATE OR REPLACE FUNCTION public.fn_orcamento_revert_on_sale_lost()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.outcome = 'ganho' AND NEW.outcome IS DISTINCT FROM 'ganho' THEN
    UPDATE public.stock_reservations SET status = 'liberada', released_at = now()
    WHERE status = 'ativa'
      AND orcamento_id IN (SELECT id FROM public.orcamentos WHERE approved_ticket_id = OLD.id AND status = 'aprovado');
    UPDATE public.orcamentos SET status = 'enviado', approved_ticket_id = NULL
    WHERE approved_ticket_id = OLD.id AND status = 'aprovado';
  END IF;
  RETURN NEW;
END;
$$;

-- ============ baixar reservas na ENTREGA (Resolver = ticket open→closed mantendo ganho) ============
CREATE OR REPLACE FUNCTION public.fn_settle_reservations_on_resolve()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status = 'open' AND NEW.status = 'closed' AND NEW.outcome = 'ganho' THEN
    -- saída de estoque (o trigger apply_inventory_movement abate current_qty)
    INSERT INTO public.inventory_movements (clinic_id, item_id, type, qty, reason, created_by)
    SELECT r.clinic_id, r.item_id, 'saida', r.qty, 'venda', auth.uid()
    FROM public.stock_reservations r
    JOIN public.orcamentos o ON o.id = r.orcamento_id
    WHERE r.status = 'ativa' AND o.approved_ticket_id = NEW.id;

    UPDATE public.stock_reservations r SET status = 'baixada', settled_at = now()
    FROM public.orcamentos o
    WHERE r.orcamento_id = o.id AND r.status = 'ativa' AND o.approved_ticket_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_settle_reservations_on_resolve ON public.tickets;
CREATE TRIGGER trg_settle_reservations_on_resolve
AFTER UPDATE ON public.tickets
FOR EACH ROW EXECUTE FUNCTION public.fn_settle_reservations_on_resolve();
