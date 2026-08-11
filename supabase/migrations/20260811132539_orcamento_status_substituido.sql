-- Estado novo do orcamento: SUBSTITUIDO (decisao do dono, 10/08).
--
-- ⚠️ O PROBLEMA: desde que o mesmo card passou a empilhar orcamentos, a Central virou uma lista que
-- so cresce. Medido hoje: 87 orcamentos, TODOS em 'enviado', somando R$ 517 mil "em aberto". Um
-- unico cliente (Pedro Naves) tem 9, sendo 8 em 'enviado'. Na pratica a maioria foi trocada durante
-- a negociacao, mas a tela mostra como se a clinica estivesse esperando 8 respostas da mesma pessoa.
--
-- 📌 'substituido' e DIFERENTE de 'recusado' e de 'expirado':
--    recusado   = o CLIENTE disse nao (entra na taxa de aprovacao, e resposta de verdade);
--    expirado   = passou da validade;
--    substituido = VOCE trocou a proposta por outra do mesmo negocio (nao e resposta do cliente,
--                  entao continua FORA da taxa de aprovacao, junto com o que ainda esta em aberto).
--
-- ⚠️ NAO e automatico, e isso e decisao de produto: agora que o mesmo cliente pode ter negocios
-- DIFERENTES em aberto, o sistema nao tem como saber se o orcamento novo troca o anterior ou e
-- outro negocio. Marcar sozinho apagaria da fila uma proposta que ainda estava viva. Quem decide
-- e quem negociou.
--
-- O ganho e a fila de trabalho voltar a significar alguma coisa: "Enviado" passa a querer dizer
-- "esperando resposta", e o total em aberto para de somar proposta que ja morreu.
--
-- PROVADO em transacao revertida: marcar 'substituido' funciona a partir de 'enviado', e depois de
-- marcado o orcamento fica travado (`already_processed`), igual ao recusado.

ALTER TABLE public.orcamentos DROP CONSTRAINT IF EXISTS orcamentos_status_check;
ALTER TABLE public.orcamentos ADD CONSTRAINT orcamentos_status_check
  CHECK (status = ANY (ARRAY['rascunho','enviado','aprovado','recusado','expirado','substituido']));

-- A RPC ja tinha a trava certa (so sai de rascunho/enviado, e nunca mexe em aprovado): o novo
-- estado entra na mesma porta, sem afrouxar nada.
CREATE OR REPLACE FUNCTION public.update_orcamento_status(p_orcamento_id uuid, p_status text, p_reason text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_orc public.orcamentos%ROWTYPE;
BEGIN
  IF p_status NOT IN ('enviado', 'recusado', 'expirado', 'substituido') THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'invalid_status');
  END IF;

  SELECT * INTO v_orc FROM public.orcamentos WHERE id = p_orcamento_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'not_found');
  END IF;
  IF NOT has_clinic_access(v_orc.clinic_id) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;
  -- ⚠️ Orcamento APROVADO nao volta por aqui: ele tem venda e receita lancadas, e desfazer isso e
  -- pelo "Cancelar venda" no Kanban, que sabe apagar a conversao e o lancamento financeiro.
  IF v_orc.status NOT IN ('rascunho', 'enviado') THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'already_processed', 'status', v_orc.status);
  END IF;

  UPDATE public.orcamentos SET
    status        = p_status,
    sent_at       = CASE WHEN p_status = 'enviado' THEN COALESCE(sent_at, now()) ELSE sent_at END,
    rejected_at   = CASE WHEN p_status = 'recusado' THEN now() ELSE rejected_at END,
    reject_reason = CASE WHEN p_status IN ('recusado','substituido') THEN p_reason ELSE reject_reason END
  WHERE id = p_orcamento_id;

  RETURN jsonb_build_object('success', true, 'id', p_orcamento_id, 'status', p_status);
END;
$function$;
