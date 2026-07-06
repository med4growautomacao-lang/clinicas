-- 20260706000003_enforce_conversion_follows_ganho.sql
--
-- Invariante: uma conversão (registro de venda) só existe enquanto o ticket está 'ganho'.
-- Se o ticket SAI de 'ganho' (para nulo/ativo OU para 'perdido') por QUALQUER caminho
-- (arraste comum, gatilho, finalize_ticket, etc.), a conversão + a receita ligada a ela
-- devem ser removidas — senão fica órfão (conversão pendurada + receita no Financeiro).
--
-- Contexto do bug: o modal "Cancelar venda" (reopen_ticket) já limpa isso, mas um ARRASTE
-- comum de um card ganho para Perdido (ou o vai-e-volta ganho->perdido->orçamento) apenas
-- vira o outcome via fn_enforce_ticket_resolution_consistency e deixava a conversão/receita
-- para trás. Este gatilho fecha o furo para todos os caminhos.
--
-- Receita: removida apenas pelo VÍNCULO CONFIÁVEL conversion.financial_transaction_id
-- (preenchido pelo GanhoModal a partir de agora). NÃO faz "melhor-esforço" por
-- paciente+valor+data aqui (é automático e silencioso — não pode arriscar apagar um
-- lançamento manual legítimo do Financeiro). O botão "Cancelar venda" (reopen_ticket)
-- mantém o melhor-esforço, pois é ação explícita do usuário.
--
-- Também: ao mover um ticket para uma etapa ATIVA, limpa loss_reason (um ticket ativo não
-- deve carregar motivo de perda) — 1 registro por ticket, coerente com o estado.

-- ============ helper: purga a venda de um ticket ============
CREATE OR REPLACE FUNCTION public.fn_purge_ticket_sale(p_ticket_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tx_ids uuid[];
BEGIN
  -- receitas ligadas de forma CONFIÁVEL à(s) conversão(ões) deste ticket
  SELECT array_agg(c.financial_transaction_id) INTO v_tx_ids
  FROM conversions c
  WHERE c.ticket_id = p_ticket_id AND c.financial_transaction_id IS NOT NULL;

  DELETE FROM conversions WHERE ticket_id = p_ticket_id;

  IF v_tx_ids IS NOT NULL AND array_length(v_tx_ids, 1) > 0 THEN
    DELETE FROM financial_transactions WHERE id = ANY(v_tx_ids);
  END IF;
END;
$function$;

-- ============ gatilho: ticket saiu de 'ganho' ============
CREATE OR REPLACE FUNCTION public.fn_ticket_left_ganho()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- AFTER UPDATE em qualquer coluna (não "OF outcome": o outcome costuma ser zerado pelo
  -- trigger BEFORE fn_enforce_... mesmo quando o UPDATE só mexe em stage_id — e "OF outcome"
  -- não dispararia nesse caso). Aqui olhamos a transição real OLD->NEW.
  IF OLD.outcome = 'ganho' AND NEW.outcome IS DISTINCT FROM 'ganho' THEN
    PERFORM public.fn_purge_ticket_sale(OLD.id);
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_ticket_left_ganho ON public.tickets;
CREATE TRIGGER trg_ticket_left_ganho
AFTER UPDATE ON public.tickets
FOR EACH ROW
EXECUTE FUNCTION public.fn_ticket_left_ganho();

-- ============ enforce: limpar loss_reason ao virar ativo ============
-- (mantém toda a lógica existente; única adição: NEW.loss_reason := NULL no ramo de etapa ativa)
CREATE OR REPLACE FUNCTION public.fn_enforce_ticket_resolution_consistency()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_slug text;
  v_stage_changed boolean;
  v_outcome_changed boolean;
  v_term_stage_id uuid;
BEGIN
  SELECT slug INTO v_slug FROM funnel_stages WHERE id = NEW.stage_id;

  IF TG_OP = 'INSERT' THEN
    v_stage_changed := true;
    v_outcome_changed := (NEW.outcome IS NOT NULL);
  ELSE
    v_stage_changed := NEW.stage_id IS DISTINCT FROM OLD.stage_id;
    v_outcome_changed := NEW.outcome IS DISTINCT FROM OLD.outcome;
  END IF;

  IF v_outcome_changed AND NEW.outcome IS NOT NULL THEN
    IF NEW.outcome = 'ganho' AND v_slug IS DISTINCT FROM 'ganho' THEN
      SELECT id INTO v_term_stage_id FROM funnel_stages WHERE clinic_id = NEW.clinic_id AND slug = 'ganho' LIMIT 1;
      IF v_term_stage_id IS NOT NULL THEN NEW.stage_id := v_term_stage_id; END IF;
    ELSIF NEW.outcome = 'perdido' AND v_slug IS DISTINCT FROM 'perdido' AND v_slug IS DISTINCT FROM 'faltou_cancelou' THEN
      SELECT id INTO v_term_stage_id FROM funnel_stages WHERE clinic_id = NEW.clinic_id AND slug = 'perdido' LIMIT 1;
      IF v_term_stage_id IS NOT NULL THEN NEW.stage_id := v_term_stage_id; END IF;
    END IF;
    NEW.outcome_at := COALESCE(NEW.outcome_at, now());

  ELSIF v_stage_changed AND NOT v_outcome_changed THEN
    IF v_slug = 'ganho' THEN
      NEW.outcome := 'ganho';
      NEW.outcome_at := COALESCE(NEW.outcome_at, now());
    ELSIF v_slug = 'perdido' THEN
      NEW.outcome := 'perdido';
      NEW.outcome_at := COALESCE(NEW.outcome_at, now());
    ELSE
      NEW.outcome := NULL;
      NEW.outcome_at := NULL;
      NEW.loss_reason := NULL;  -- etapa ativa: não carrega motivo de perda
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
