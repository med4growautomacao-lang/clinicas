-- Editar uma VENDA ja lancada (valor, data, forma de pagamento, descricao).
--
-- ⚠️ O BURACO que isto fecha: desde hoje da para editar um orcamento ganho e o valor arrasta a
-- venda junto. Mas venda lancada A MAO pelo Kanban (a maioria: 44 das 46 vendas dos ultimos 30 dias
-- na Metaltres) nao tinha edicao nenhuma. So dava para apagar e refazer, e apagar passa pelo
-- "Cancelar venda", que ate hoje falhava mudo em card com mais de uma venda.
-- A propria tela de Editar Lead denuncia isso: mostra "2 vendas lancadas neste card · R$ 4.272,00"
-- com o aviso "Alterar este campo nao muda venda ja lancada".
--
-- 📌 A venda e a receita andam SEMPRE juntas: sao o mesmo dinheiro visto do funil e do financeiro.
-- Editar so um lado e a origem classica de painel discordando do caixa.
--
-- ⚠️ O que esta funcao NAO faz, de proposito:
--   - nao mexe no `total` do ORCAMENTO ligado: aquele e o documento que o cliente recebeu, e
--     reescreve-lo por aqui faria o papel do cliente mudar sozinho. Quem quer mudar a proposta
--     edita a proposta (`save_orcamento`), que ai sim arrasta a venda.
--   - nao mexe em estoque nem producao: valor de venda nao muda o que a fabrica tem de produzir.
--   - nao muda o desfecho do card: cancelar venda continua sendo o "Cancelar venda" do Kanban.
--
-- 📌 `p_converted_at` importa: e o eixo de data do faturamento (`v_kpi_sales_value.converted_at`).
-- Corrigir o valor sem poder corrigir a data deixaria a venda no mes errado para sempre.
-- Grava com 12h, o mesmo meio-dia que os dois caminhos de criacao usam, para nao virar o dia.
--
-- PROVADO em transacao revertida (11/08), na venda de R$ 750 da mychelle leal:
--   750 -> 1638 com data de hoje: a receita do financeiro acompanhou para 1638;
--   valor zero: recusado (valor_invalido).

CREATE OR REPLACE FUNCTION public.update_conversion_sale(
  p_conversion_id uuid,
  p_value numeric DEFAULT NULL,
  p_converted_at date DEFAULT NULL,
  p_payment_method text DEFAULT NULL,
  p_description text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_conv  public.conversions%ROWTYPE;
  v_novo  numeric;
  v_data  timestamp;
BEGIN
  SELECT * INTO v_conv FROM public.conversions WHERE id = p_conversion_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'venda_nao_encontrada');
  END IF;
  IF NOT has_clinic_access(v_conv.clinic_id) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;
  IF p_value IS NOT NULL AND p_value <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'valor_invalido');
  END IF;

  v_novo := COALESCE(p_value, v_conv.value);
  v_data := CASE WHEN p_converted_at IS NULL THEN v_conv.converted_at
                 ELSE (p_converted_at::timestamp + interval '12 hour') END;

  UPDATE public.conversions SET
    value          = v_novo,
    converted_at   = v_data,
    payment_method = COALESCE(p_payment_method, payment_method),
    description    = COALESCE(p_description, description)
  WHERE id = p_conversion_id;

  -- O financeiro acompanha. `date` la e `date` puro, sem hora.
  IF v_conv.financial_transaction_id IS NOT NULL THEN
    UPDATE public.financial_transactions SET
      amount         = v_novo,
      date           = COALESCE(p_converted_at, date),
      payment_method = COALESCE(p_payment_method, payment_method),
      description    = COALESCE(p_description, description)
    WHERE id = v_conv.financial_transaction_id;
  END IF;

  IF v_novo IS DISTINCT FROM v_conv.value OR v_data IS DISTINCT FROM v_conv.converted_at THEN
    PERFORM log_system_error(
      'venda', 'venda_editada',
      'Venda lançada foi editada à mão (valor e/ou data); a receita acompanhou',
      'warn', v_conv.clinic_id,
      jsonb_build_object('conversion_id', p_conversion_id, 'ticket_id', v_conv.ticket_id,
                         'valor_de', v_conv.value, 'valor_para', v_novo,
                         'data_de', v_conv.converted_at, 'data_para', v_data,
                         'financial_transaction_id', v_conv.financial_transaction_id), false);
  END IF;

  RETURN jsonb_build_object('success', true, 'conversion_id', p_conversion_id,
                            'value', v_novo, 'converted_at', v_data);
END;
$function$;

REVOKE ALL ON FUNCTION public.update_conversion_sale(uuid, numeric, date, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_conversion_sale(uuid, numeric, date, text, text) TO authenticated, service_role;
