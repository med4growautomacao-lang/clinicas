-- Fase 2 (Ordem de Pedido): RPC dedicada p/ preencher/editar os campos "cosméticos" do
-- documento impresso (client_doc/client_address/vencimento) — dados que não afetam a venda
-- em si, então, ao contrário de save_orcamento, NÃO trava depois de 'aprovado' (a Ordem de
-- Pedido só é gerada de um orçamento já aprovado, quando esses campos costumam ser
-- preenchidos/confirmados pela primeira vez).
CREATE OR REPLACE FUNCTION public.set_orcamento_print_info(
  p_orcamento_id   uuid,
  p_client_doc     text DEFAULT NULL,
  p_client_address text DEFAULT NULL,
  p_vencimento     date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clinic_id uuid;
BEGIN
  SELECT clinic_id INTO v_clinic_id FROM public.orcamentos WHERE id = p_orcamento_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'orcamento_not_found');
  END IF;
  IF NOT has_clinic_access(v_clinic_id) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;

  UPDATE public.orcamentos SET
    client_doc     = COALESCE(p_client_doc, client_doc),
    client_address = COALESCE(p_client_address, client_address),
    vencimento     = COALESCE(p_vencimento, vencimento)
  WHERE id = p_orcamento_id;

  RETURN jsonb_build_object('success', true, 'id', p_orcamento_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_orcamento_print_info(uuid, text, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_orcamento_print_info(uuid, text, text, date) TO authenticated;
