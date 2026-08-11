-- PROJETO no orcamento (decisao do dono, 11/08).
--
-- ⚠️ O QUE ISTO RESOLVE: o sistema tinha DOIS niveis, cliente e orcamento, e por isso nao sabia
-- distinguir "outra VERSAO da mesma proposta" de "OUTRO negocio do mesmo cliente". Sem essa
-- distincao, somar os orcamentos vivos infla (o cliente com 7 propostas da mesma negociacao somava
-- R$ 19.968 quando valia uma so) e contar so o ultimo perde negocio de verdade. A saida era o dono
-- marcar "substituido" na mao em cada proposta trocada.
--
-- 📌 A REGRA que o campo destrava, e que passa a valer sozinha:
--    propostas do MESMO projeto  -> sao versoes: vale a mais recente viva, as outras sao historico;
--    projetos DIFERENTES         -> somam, porque sao negocios que podem fechar os dois.
--
-- PROVADO em transacao revertida (11/08): 3 propostas no mesmo card, 10.000 e 8.000 na "Obra Rua X"
-- (versoes) e 25.000 no "Galpao" (outro negocio). Valor do card = 33.000 (a versao mais nova da
-- obra + o galpao). A soma crua seria 43.000, inflada.
--
-- 📌 Texto livre de proposito, com sugestao dos projetos que o cliente ja tem (a tela oferece um
-- datalist). Virar cadastro proprio e a fase B, combinada para quando o sistema de ticket for
-- refatorado; ai cada nome distinto vira uma linha e nada do que foi digitado se perde.
--
-- ⚠️ DROP + CREATE, nunca CREATE OR REPLACE: a lista de argumentos muda, e `CREATE OR REPLACE` com
-- assinatura diferente NAO substitui, cria uma SEGUNDA overload. Foi o erro que custou um evento de
-- venda do CRM em 10/08 (migration 20260810194132). DDL no Postgres e transacional, entao nao
-- existe janela sem a funcao. Conferido depois: 1 overload, anon sem EXECUTE.

ALTER TABLE public.orcamentos ADD COLUMN IF NOT EXISTS projeto text;

COMMENT ON COLUMN public.orcamentos.projeto IS
  'Nome do projeto/obra a que esta proposta pertence. Propostas do MESMO projeto sao versoes (vale a mais recente viva); projetos diferentes somam no funil. NULL = legado ou cliente com um negocio so.';

-- Consulta da tela: propostas de um cliente agrupadas por projeto.
CREATE INDEX IF NOT EXISTS ix_orcamentos_lead_projeto
  ON public.orcamentos(lead_id, projeto) WHERE projeto IS NOT NULL;

DROP FUNCTION IF EXISTS public.save_orcamento(uuid, uuid, uuid, text, text, text, text, numeric, numeric, numeric, numeric, date, date, text, text, jsonb, uuid);

CREATE FUNCTION public.save_orcamento(
  p_id uuid,
  p_clinic_id uuid,
  p_lead_id uuid,
  p_status text DEFAULT 'rascunho'::text,
  p_client_name text DEFAULT NULL::text,
  p_client_doc text DEFAULT NULL::text,
  p_client_address text DEFAULT NULL::text,
  p_subtotal numeric DEFAULT NULL::numeric,
  p_desconto numeric DEFAULT NULL::numeric,
  p_frete numeric DEFAULT NULL::numeric,
  p_total numeric DEFAULT 0,
  p_validade date DEFAULT NULL::date,
  p_vencimento date DEFAULT NULL::date,
  p_pagamento text DEFAULT NULL::text,
  p_notes text DEFAULT NULL::text,
  p_snapshot jsonb DEFAULT NULL::jsonb,
  p_ticket_id uuid DEFAULT NULL::uuid,
  p_projeto text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id          uuid;
  v_number      integer;
  v_cur_status  text;
  v_open_ticket uuid;
  v_entrega     date := NULLIF(p_snapshot->>'dataEntrega', '')::date;
  v_projeto     text := NULLIF(btrim(p_projeto), '');
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
      -- ⚠️ COALESCE: salvar sem informar o projeto NAO apaga o que ja estava la. Mesmo cuidado que
      -- o resto da funcao tem com doc/endereco: campo em branco na tela nao e ordem de limpar.
      projeto        = COALESCE(v_projeto, projeto),
      client_name    = p_client_name,
      client_doc     = COALESCE(p_client_doc, client_doc),
      client_address = COALESCE(p_client_address, client_address),
      subtotal       = COALESCE(p_subtotal, subtotal),
      desconto       = COALESCE(p_desconto, desconto),
      frete          = COALESCE(p_frete, frete),
      total          = p_total,
      validade       = COALESCE(p_validade, validade),
      vencimento     = COALESCE(p_vencimento, vencimento),
      pagamento      = COALESCE(p_pagamento, pagamento),
      notes          = p_notes,
      snapshot       = p_snapshot,
      data_entrega_prevista = v_entrega,
      status         = CASE WHEN status = 'rascunho' THEN p_status ELSE status END,
      sent_at        = CASE WHEN status = 'rascunho' AND p_status = 'enviado' THEN now() ELSE sent_at END
    WHERE id = p_id
    RETURNING id, number INTO v_id, v_number;
  ELSE
    INSERT INTO public.orcamentos (
      clinic_id, lead_id, ticket_id, projeto, status, client_name, client_doc, client_address,
      subtotal, desconto, frete, total, validade, vencimento, pagamento, notes, snapshot,
      data_entrega_prevista, created_by, sent_at
    ) VALUES (
      p_clinic_id, p_lead_id, p_ticket_id, v_projeto, p_status, p_client_name, p_client_doc, p_client_address,
      p_subtotal, p_desconto, p_frete, p_total, p_validade, p_vencimento, p_pagamento, p_notes, p_snapshot,
      v_entrega, auth.uid(), CASE WHEN p_status = 'enviado' THEN now() ELSE NULL END
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

  RETURN jsonb_build_object('success', true, 'id', v_id, 'number', v_number, 'projeto', v_projeto);
END;
$function$;

REVOKE ALL ON FUNCTION public.save_orcamento(uuid, uuid, uuid, text, text, text, text, numeric, numeric, numeric, numeric, date, date, text, text, jsonb, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_orcamento(uuid, uuid, uuid, text, text, text, text, numeric, numeric, numeric, numeric, date, date, text, text, jsonb, uuid, text) TO authenticated, service_role;
