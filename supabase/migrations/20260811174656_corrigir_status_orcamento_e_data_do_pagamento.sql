-- Corrigir o status do orcamento na mao + data do pagamento (decisao do dono, 11/08).
--
-- 📌 DUAS COISAS:
-- 1. `pago_at`: a data em que o cliente pagou, informada por quem registra. Mesmo motivo da entrega:
--    o registro costuma ser feito dias depois, e assumir "hoje" joga o dinheiro no dia errado.
-- 2. `corrigir_status_orcamento`: permite voltar atras num clique errado (pago -> aprovado,
--    enviado -> rascunho) sem refazer a proposta.
--
-- ⚠️ A TRAVA que mantem isto honesto: sair de 'aprovado'/'pago' para um status ABERTO significa
-- desfazer uma venda. Se ainda existe conversao ligada (`conversion_id`), a funcao RECUSA e manda
-- usar o "Cancelar venda" no Kanban, que sabe apagar a conversao E o lancamento financeiro juntos.
-- Sem essa trava, corrigir status na tela deixaria receita orfa no financeiro, em silencio.
--
-- ⚠️ E o contrario tambem e barrado: SUBIR para aprovado/pago por correcao devolve `use_aprovar`.
-- Aprovar de verdade e pelo botao Aprovar, que lanca conversao, receita e ordem de producao; um
-- status carimbado a mao criaria "venda" sem dinheiro nenhum atras.
--
-- 📌 Toda correcao acende na Central: e intervencao manual em dado que alimenta faturamento.
--
-- PROVADO em transacao revertida (11/08), na Metaltres:
--   enviado -> rascunho (sem venda): ok;
--   corrigir para aprovado: RECUSADO (use_aprovar);
--   marcar pago com data de 5 dias atras: pago_at = 06/08 12:00;
--   pago -> enviado com venda lancada: RECUSADO (tem_venda_lancada);
--   pago -> aprovado (desfazer so o pagamento): ok, e pago_at volta a ser nulo.

ALTER TABLE public.orcamentos ADD COLUMN IF NOT EXISTS pago_at timestamptz;

COMMENT ON COLUMN public.orcamentos.pago_at IS
  'Quando o cliente PAGOU (informado por quem registra, nao a hora do clique). NULL = ainda nao pago.';

CREATE OR REPLACE FUNCTION public.corrigir_status_orcamento(
  p_orcamento_id uuid,
  p_status text,
  p_pago_em date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_orc    public.orcamentos%ROWTYPE;
  v_fechado constant text[] := ARRAY['aprovado','pago'];
BEGIN
  IF p_status NOT IN ('rascunho','enviado','aprovado','pago','recusado','expirado','substituido') THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'invalid_status');
  END IF;

  SELECT * INTO v_orc FROM public.orcamentos WHERE id = p_orcamento_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'not_found');
  END IF;
  IF NOT has_clinic_access(v_orc.clinic_id) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;
  IF v_orc.status = p_status AND p_pago_em IS NULL THEN
    RETURN jsonb_build_object('success', true, 'sem_mudanca', true);
  END IF;

  -- ⚠️ Desfazer venda NAO se faz por aqui: existe conversao e lancamento financeiro ligados, e
  -- mexer so no status deixaria receita orfa. O caminho e "Cancelar venda" no Kanban.
  IF v_orc.status = ANY(v_fechado) AND NOT (p_status = ANY(v_fechado)) AND v_orc.conversion_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'tem_venda_lancada');
  END IF;

  -- Entrar em 'aprovado'/'pago' por correcao NAO lanca venda: aprovar de verdade e pelo botao
  -- Aprovar, que cria conversao, receita e ordem de producao. Aqui so se CORRIGE o rotulo, e por
  -- isso o caminho de subir para aprovado sem venda fica barrado.
  IF NOT (v_orc.status = ANY(v_fechado)) AND p_status = ANY(v_fechado) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'use_aprovar');
  END IF;

  UPDATE public.orcamentos SET
    status  = p_status,
    -- pago_at só existe enquanto o status for 'pago'.
    pago_at = CASE WHEN p_status = 'pago'
                   THEN COALESCE(p_pago_em::timestamp + interval '12 hour', pago_at, now())
                   ELSE NULL END,
    sent_at = CASE WHEN p_status = 'enviado' THEN COALESCE(sent_at, now()) ELSE sent_at END
  WHERE id = p_orcamento_id;

  PERFORM log_system_error(
    'orcamento', 'status_corrigido',
    'Status do orçamento alterado à mão',
    'info', v_orc.clinic_id,
    jsonb_build_object('orcamento_id', p_orcamento_id, 'numero', v_orc.number,
                       'de', v_orc.status, 'para', p_status, 'pago_em', p_pago_em), false);

  RETURN jsonb_build_object('success', true, 'id', p_orcamento_id, 'status', p_status);
END;
$function$;

REVOKE ALL ON FUNCTION public.corrigir_status_orcamento(uuid, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.corrigir_status_orcamento(uuid, text, date) TO authenticated, service_role;

-- "Marcar pago" tambem passa a gravar a data informada. Mantida a regra: so sai de 'aprovado'.
CREATE OR REPLACE FUNCTION public.update_orcamento_status(p_orcamento_id uuid, p_status text, p_reason text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_orc public.orcamentos%ROWTYPE;
BEGIN
  IF p_status NOT IN ('enviado', 'recusado', 'expirado', 'substituido', 'pago') THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'invalid_status');
  END IF;

  SELECT * INTO v_orc FROM public.orcamentos WHERE id = p_orcamento_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'not_found');
  END IF;
  IF NOT has_clinic_access(v_orc.clinic_id) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;

  IF p_status = 'pago' THEN
    IF v_orc.status <> 'aprovado' THEN
      RETURN jsonb_build_object('success', false, 'error_code', 'so_aprovado_vira_pago', 'status', v_orc.status);
    END IF;
  ELSIF v_orc.status NOT IN ('rascunho', 'enviado') THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'already_processed', 'status', v_orc.status);
  END IF;

  UPDATE public.orcamentos SET
    status        = p_status,
    -- Sem data informada aqui: quem quer escolher o dia usa `corrigir_status_orcamento`.
    pago_at       = CASE WHEN p_status = 'pago' THEN COALESCE(pago_at, now()) ELSE pago_at END,
    sent_at       = CASE WHEN p_status = 'enviado' THEN COALESCE(sent_at, now()) ELSE sent_at END,
    rejected_at   = CASE WHEN p_status = 'recusado' THEN now() ELSE rejected_at END,
    reject_reason = CASE WHEN p_status IN ('recusado','substituido') THEN p_reason ELSE reject_reason END
  WHERE id = p_orcamento_id;

  RETURN jsonb_build_object('success', true, 'id', p_orcamento_id, 'status', p_status);
END;
$function$;
