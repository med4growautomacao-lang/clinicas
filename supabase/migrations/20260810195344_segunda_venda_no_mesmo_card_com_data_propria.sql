-- ETAPA 3 de 6 do plano "varias vendas no mesmo card" (decisao do dono, 10/08).
-- Esta e a etapa que ABRE A PORTA. As etapas 1 e 2 (data congelada e cancelamento com alvo) ja
-- estao no ar e sao pre-requisito: sem elas, a 2a venda reescreveria a data da 1a e cancelar uma
-- apagaria todas.
--
-- ⚠️ O ATALHO QUE SUMIA COM DINHEIRO: quando o card ja estava como venda, `close_sale_from_orcamento`
-- carimbava o orcamento como 'aprovado', devolvia success:true e NAO lancava receita, NAO lancava no
-- financeiro e NAO chamava `provision_orcamento` (a fabrica nem ficava sabendo do pedido). E o painel
-- Comercial do WakeDesk soma o valor de todo orcamento aprovado, entao a tela mostraria faturamento
-- que o financeiro nao tem. Nunca rodou (0 orcamentos aprovados de 87), mas empilhar orcamento
-- transformaria esse caminho no caminho normal.
--
-- O atalho existia por causa do indice `conversions_one_per_ticket` (uma receita por card): sem ele,
-- a 2a venda estouraria com erro cru. O dono decidiu (10/08) que "nao pode somar num valor so, cada
-- venda entra em uma data diferente", entao a trava sai e cada venda vira sua propria linha, com sua
-- propria data.
--
-- ⚠️ NAO mexe em `v_kpi_wins`: a contagem de VENDAS continua sendo por card, ou seja, conta CLIENTES
-- QUE COMPRARAM. Faturamento (`v_kpi_sales_value`) sai de `conversions` por `converted_at`, entao ele
-- ja fica certo por periodo sozinho. Mexer na contagem contaminaria funil, ciclo de vendas, taxa de
-- conversao e atribuicao IA x humano de uma vez; a decisao do dono foi trocar o ROTULO (etapa 6).
--
-- ⚠️ O monitor da Central NAO vigia este indice (confirmado em `run_system_monitors`: vigia o
-- `uq_tickets_one_open_per_lead`, nao este), entao derrubar nao acende alarme falso.
-- 📌 E NAO recriar este indice em outra sessao: recriar por engano faz a 2a venda voltar a falhar.
--
-- PROVADO em transacao revertida (10/08), num card real da Metaltres que ja era venda:
--   aprovacao devolveu success=true (antes: already_sold sem lancar nada);
--   vendas no card 1 -> 2; a nova entrou com a data de HOJE;
--   a venda antiga (05/05) e a data do card (08/05) ficaram INTACTAS;
--   orcamento virou 'aprovado' com vinculo para a venda; lancamento financeiro criado.

DROP INDEX IF EXISTS public.conversions_one_per_ticket;

-- Substitui por um indice NAO unico: as consultas por card continuam rapidas.
CREATE INDEX IF NOT EXISTS ix_conversions_ticket
  ON public.conversions(ticket_id) WHERE ticket_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.close_sale_from_orcamento(p_orcamento_id uuid, p_payment_method text DEFAULT 'pix'::text, p_payment_status text DEFAULT 'pago'::text, p_payment_date date DEFAULT ((now() AT TIME ZONE 'America/Sao_Paulo'::text))::date, p_category text DEFAULT 'Venda de produto'::text, p_data_entrega date DEFAULT NULL::date, p_line_keys text[] DEFAULT NULL::text[], p_total numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_orc      public.orcamentos%ROWTYPE;
  v_ticket   RECORD;
  v_lead     RECORD;
  v_patient  uuid;
  v_tx_id    uuid;
  v_conv_id  uuid;
  v_finalize jsonb;
  v_prov     jsonb;
  v_total    numeric;
BEGIN
  SELECT * INTO v_orc FROM public.orcamentos WHERE id = p_orcamento_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error_code', 'orcamento_not_found'); END IF;
  IF NOT has_clinic_access(v_orc.clinic_id) THEN RETURN jsonb_build_object('success', false, 'error_code', 'forbidden'); END IF;

  -- 📌 §0.5: toda recusa acende na Central. Antes, a tela recebia o codigo e o banco esquecia, entao
  -- "aprovei o orcamento e nao aconteceu nada" nao deixava rastro em lugar nenhum.
  IF v_orc.status NOT IN ('rascunho', 'enviado') THEN
    PERFORM log_system_error('orcamento', 'aprovacao_recusada',
      'Aprovação de orçamento recusada: já processado', 'warn', v_orc.clinic_id,
      jsonb_build_object('orcamento_id', p_orcamento_id, 'status', v_orc.status), false);
    RETURN jsonb_build_object('success', false, 'error_code', 'already_processed', 'status', v_orc.status);
  END IF;
  IF v_orc.validade IS NOT NULL AND v_orc.validade < (now() at time zone 'America/Sao_Paulo')::date THEN
    PERFORM log_system_error('orcamento', 'aprovacao_recusada',
      'Aprovação de orçamento recusada: orçamento vencido', 'warn', v_orc.clinic_id,
      jsonb_build_object('orcamento_id', p_orcamento_id, 'validade', v_orc.validade), false);
    RETURN jsonb_build_object('success', false, 'error_code', 'orcamento_vencido', 'validade', v_orc.validade);
  END IF;
  IF v_orc.lead_id IS NULL THEN
    PERFORM log_system_error('orcamento', 'aprovacao_recusada',
      'Aprovação de orçamento recusada: orçamento sem cliente vinculado', 'error', v_orc.clinic_id,
      jsonb_build_object('orcamento_id', p_orcamento_id), false);
    RETURN jsonb_build_object('success', false, 'error_code', 'no_lead_linked');
  END IF;
  IF p_line_keys IS NOT NULL AND array_length(p_line_keys, 1) IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'nenhum_item_selecionado');
  END IF;

  v_total := COALESCE(p_total, v_orc.total);

  SELECT id, outcome, status INTO v_ticket
  FROM public.tickets WHERE lead_id = v_orc.lead_id AND status = 'open' FOR UPDATE LIMIT 1;
  IF NOT FOUND THEN
    -- ⚠️ Card ja FECHADO e o caso mais comum de "cliente voltou meses depois" (768 cards ganhos
    -- fechados hoje). NAO reabrimos por conta propria: o certo e abrir card novo, que e o caminho
    -- que o sistema ja faz bem. Aqui so garantimos que a recusa deixe rastro em vez de sumir.
    PERFORM log_system_error('orcamento', 'aprovacao_sem_card_aberto',
      'Aprovação de orçamento recusada: o cliente não tem card aberto (abra um card novo)',
      'warn', v_orc.clinic_id,
      jsonb_build_object('orcamento_id', p_orcamento_id, 'lead_id', v_orc.lead_id), false);
    RETURN jsonb_build_object('success', false, 'error_code', 'no_open_ticket');
  END IF;
  IF v_ticket.outcome = 'perdido' THEN
    PERFORM log_system_error('orcamento', 'aprovacao_recusada',
      'Aprovação de orçamento recusada: o card está marcado como perdido', 'warn', v_orc.clinic_id,
      jsonb_build_object('orcamento_id', p_orcamento_id, 'ticket_id', v_ticket.id), false);
    RETURN jsonb_build_object('success', false, 'error_code', 'ticket_perdido');
  END IF;

  -- ⚠️ AQUI MORAVA O ATALHO. Card ja ganho agora segue o MESMO caminho: lanca receita, lanca no
  -- financeiro, cria a venda com data propria e manda para a producao. `finalize_ticket` preserva
  -- a data da venda anterior desde a etapa 1.

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
  VALUES (v_orc.clinic_id, v_patient, 'receita', p_category, v_total, 'Orçamento #' || v_orc.number, p_payment_method, p_payment_status, p_payment_date)
  RETURNING id INTO v_tx_id;

  -- Cada venda com a SUA data: e o pedido do dono e o que faz o faturamento por periodo bater.
  INSERT INTO public.conversions (clinic_id, lead_id, ticket_id, value, description, payment_method, converted_at, financial_transaction_id)
  VALUES (v_orc.clinic_id, v_orc.lead_id, v_ticket.id, v_total, 'Orçamento #' || v_orc.number, p_payment_method, (p_payment_date::timestamp + interval '12 hour'), v_tx_id)
  RETURNING id INTO v_conv_id;

  SELECT public.finalize_ticket(v_ticket.id, 'ganho', NULL, NULL, false) INTO v_finalize;
  IF NOT COALESCE((v_finalize->>'success')::boolean, false) THEN
    RAISE EXCEPTION 'finalize_ticket falhou ao aprovar orçamento %: %', p_orcamento_id, v_finalize->>'error_code';
  END IF;

  -- `conversion_id` e o que permite cancelar UMA venda e reverter SO o orcamento dela (etapa 2).
  UPDATE public.orcamentos SET status = 'aprovado', approved_at = now(), approved_ticket_id = v_ticket.id,
    conversion_id = v_conv_id,
    data_entrega_prevista = COALESCE(p_data_entrega, data_entrega_prevista),
    approved_line_keys = COALESCE(p_line_keys, approved_line_keys),
    total = v_total
  WHERE id = p_orcamento_id;

  -- ⚠️ Antes era PERFORM: o retorno era jogado fora, entao "venda entrou, fabrica nao soube" era
  -- invisivel. A venda NAO e desfeita se o provisionamento falhar (o dinheiro entrou de verdade),
  -- mas agora acende na Central e a tela recebe o aviso.
  v_prov := public.provision_orcamento(p_orcamento_id);
  IF NOT COALESCE((v_prov->>'success')::boolean, true) THEN
    PERFORM log_system_error('orcamento', 'provisionamento_falhou',
      'Venda lançada, mas a produção/estoque não foi provisionada', 'error', v_orc.clinic_id,
      jsonb_build_object('orcamento_id', p_orcamento_id, 'ticket_id', v_ticket.id,
                         'erro', v_prov->>'error_code'), false);
  END IF;

  RETURN jsonb_build_object('success', true, 'ticket_id', v_ticket.id, 'financial_transaction_id', v_tx_id,
    'conversion_id', v_conv_id, 'patient_id', v_patient, 'total', v_total,
    'provisionamento', v_prov);
END;
$function$;
