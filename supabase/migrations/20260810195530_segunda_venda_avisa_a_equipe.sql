-- ETAPA 4 de 6 do plano "varias vendas no mesmo card" (decisao do dono, 10/08).
--
-- ⚠️ O PROBLEMA: `fn_notify_venda` mora em `tickets` e tem a guarda
-- `if TG_OP='UPDATE' and OLD.outcome is not distinct from 'ganho' then return NEW`. Ela existe para
-- nao avisar duas vezes a mesma venda, e esta certa. So que, num card que ja e venda, a SEGUNDA
-- venda nao muda o desfecho (continua 'ganho'), entao o sino nunca toca: a equipe nao fica sabendo.
--
-- 📌 A SOLUCAO nao e mexer na guarda do ticket, e avisar por VENDA LANCADA, que e uma linha em
-- `conversions`. O gatilho novo so fala da SEGUNDA em diante (`count > 1`), entao a primeira venda
-- continua sendo avisada pelo caminho de sempre e ninguem recebe aviso em dobro.
--
-- ⚠️ O criterio e `count(*) > 1` de proposito, e nao "o card ja estava ganho": os caminhos gravam em
-- ordens diferentes (o orcamento cria a venda ANTES de fechar o card, a agenda tambem, e a tela pode
-- fazer o contrario). Contar as vendas do card e o unico criterio que independe da ordem.
--
-- ⚠️ NAO tocar em `trg_ticket_finish_message`: aquela e a mensagem de encerramento para o CLIENTE e
-- tem que continuar saindo uma vez so. Esta aqui e aviso interno para a equipe.

CREATE OR REPLACE FUNCTION public.fn_notify_venda_adicional()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_qtd int;
  v_lead record;
begin
  IF NEW.ticket_id IS NULL OR NEW.lead_id IS NULL THEN RETURN NEW; END IF;
  IF coalesce(current_setting('app.onboarding_import', true), '') = 'on' THEN RETURN NEW; END IF;

  SELECT count(*) INTO v_qtd FROM public.conversions WHERE ticket_id = NEW.ticket_id;
  IF v_qtd <= 1 THEN RETURN NEW; END IF;   -- 1a venda: quem avisa e o gatilho do ticket

  SELECT name, phone INTO v_lead FROM public.leads WHERE id = NEW.lead_id;

  PERFORM notify_ops(
    NEW.clinic_id, 'venda', 'Nova venda para o mesmo cliente! 🎉',
    coalesce(nullif(btrim(v_lead.name), ''), v_lead.phone)
      || ' · ' || to_char(NEW.value, 'FM999G999G990D00')
      || ' · ' || v_qtd::text || 'ª venda',
    'success', NEW.lead_id, NEW.ticket_id, null, null, '{}'::jsonb, true, null
  );
  RETURN NEW;
exception when others then
  PERFORM log_system_error('venda-notify','notify_adicional_failed',
    'Falha ao notificar venda adicional','error', NEW.clinic_id,
    jsonb_build_object('conversion_id', NEW.id, 'detail', sqlerrm), false);
  RETURN NEW;
end;
$function$;

REVOKE ALL ON FUNCTION public.fn_notify_venda_adicional() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notify_venda_adicional ON public.conversions;
CREATE TRIGGER trg_notify_venda_adicional
AFTER INSERT ON public.conversions
FOR EACH ROW EXECUTE FUNCTION public.fn_notify_venda_adicional();
