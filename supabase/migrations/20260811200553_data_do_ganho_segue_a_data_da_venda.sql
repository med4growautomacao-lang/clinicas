-- A data do GANHO do card passa a seguir a data da PRIMEIRA VENDA dele, sempre.
-- Decisao do dono (11/08): "tem que contar na data da venda, a data de lancamento e so pra controle".
--
-- ⚠️ O PROBLEMA: existem tres datas e duas estavam brigando.
--   `conversions.converted_at`  = quando o cliente comprou  -> manda no FATURAMENTO (v_kpi_sales_value)
--   `tickets.outcome_at`        = quando o card foi ganho   -> manda na CONTAGEM de vendas (v_kpi_wins)
--   `created_at`                = quando alguem digitou     -> auditoria, nenhum painel usa
-- Como `finalize_ticket` gravava `outcome_at = now()`, toda venda lancada RETROATIVA nascia torta:
-- o dinheiro ia para o dia real e a contagem ficava no dia da digitacao. Medido na Metaltres em
-- 11/08: 20 cards contados em agosto com o dinheiro em julho (agosto aparecia com 30 vendas para
-- R$ 20.896, um ticket medio de R$ 700 que nao era o negocio, era o efeito do lancamento).
--
-- 📌 A REGRA: card ganho com venda lancada tem `outcome_at` = a MENOR `converted_at` das vendas
-- dele. Em card com uma venda so as duas ficam identicas, que e o que o dono espera. Em card com
-- varias (permitido desde 10/08), a data do card e quando aquele cliente comprou pela PRIMEIRA vez,
-- e cada venda mantem a sua.
--
-- ⚠️ SAO DOIS GATILHOS porque a ordem de criacao varia e um so nao cobre tudo:
--   1. em `tickets`, BEFORE UPDATE OF outcome: pega o caminho em que a venda ja existe quando o
--      card vira ganho (e o caso de `close_sale_from_orcamento`, que insere a conversao ANTES de
--      chamar `finalize_ticket`).
--   2. em `conversions`, AFTER INSERT/UPDATE/DELETE: pega o caminho inverso (venda criada depois do
--      card ja estar ganho, que e o Kanban), a EDICAO da data de uma venda, e o cancelamento de UMA
--      venda num card com varias.
--
-- ⚠️ Card ganho SEM nenhuma venda lancada mantem o `outcome_at` que tem: nao ha data melhor, e
-- zera-lo tiraria o card da contagem.
--
-- ⚠️ O gatilho 2 escreve em `tickets`, o que acorda os AFTER UPDATE de la. Conferido em 11/08 que
-- nenhum deles age quando o `outcome` nao muda (um alinhamento manual de 21 cards nao gerou uma
-- mensagem nem uma notificacao). Ainda assim o UPDATE so acontece quando o valor MUDA, para nao
-- acordar ninguem a toa.
--
-- PROVADO em transacao revertida (11/08), com lead de simulacao:
--   venda de 15/06 lancada e card virando ganho hoje -> card ficou em 15/06;
--   entra 2a venda, de 10/05                          -> card foi para 10/05;
--   edita essa venda para 01/04                       -> card foi para 01/04;
--   cancela a de 01/04                                -> card voltou para 15/06;
--   apagadas todas as vendas                          -> card MANTEVE 15/06 (nao zera).

CREATE OR REPLACE FUNCTION public.fn_outcome_at_segue_primeira_venda()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_primeira timestamptz;
BEGIN
  IF NEW.outcome = 'ganho' THEN
    SELECT min(cv.converted_at) INTO v_primeira
      FROM public.conversions cv WHERE cv.ticket_id = NEW.id;
    -- Sem venda lancada nao ha data melhor: mantem o que veio.
    IF v_primeira IS NOT NULL THEN
      NEW.outcome_at := v_primeira;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- ⚠️ Depois do `trg_enforce_ticket_resolution` (ordem alfabetica do nome decide, e 'z' garante que
-- este roda por ultimo): assim ele escreve sobre um `outcome` ja normalizado pelo guard.
DROP TRIGGER IF EXISTS zz_trg_outcome_at_segue_venda ON public.tickets;
CREATE TRIGGER zz_trg_outcome_at_segue_venda
  BEFORE INSERT OR UPDATE OF outcome ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.fn_outcome_at_segue_primeira_venda();

-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_sync_outcome_at_from_conversions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ticket   uuid := COALESCE(NEW.ticket_id, OLD.ticket_id);
  v_primeira timestamptz;
BEGIN
  IF v_ticket IS NULL THEN RETURN NULL; END IF;

  SELECT min(cv.converted_at) INTO v_primeira
    FROM public.conversions cv WHERE cv.ticket_id = v_ticket;
  IF v_primeira IS NULL THEN RETURN NULL; END IF;

  -- So escreve se MUDAR: update a toa acordaria os AFTER UPDATE de `tickets` sem motivo.
  UPDATE public.tickets t
     SET outcome_at = v_primeira
   WHERE t.id = v_ticket AND t.outcome = 'ganho' AND t.outcome_at IS DISTINCT FROM v_primeira;

  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS zz_trg_conversions_sync_outcome_at ON public.conversions;
CREATE TRIGGER zz_trg_conversions_sync_outcome_at
  AFTER INSERT OR DELETE OR UPDATE OF converted_at, ticket_id ON public.conversions
  FOR EACH ROW EXECUTE FUNCTION public.fn_sync_outcome_at_from_conversions();
