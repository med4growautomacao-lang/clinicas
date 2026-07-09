-- Lead-time deixa de ser um número de dias fixo por SKU e passa a ser CALCULADO:
--   horas = (tempo_setup, SE a máquina não estiver rodando o mesmo modelo AGORA) + área/taxa
--   dias  = ceil(horas / jornada_de_trabalho_da_clinica)
-- "Mesmo modelo" = mesma combinação malha+fio (products.base_product_id), qualquer altura — trocar
-- de altura é só cortar diferente, não reconfigura a máquina; trocar de malha/fio SIM conta setup.
-- Taxa em M²/HORA (não metro linear): fisicamente constante entre alturas do mesmo modelo (a máquina
-- tece a mesma área por hora), então não precisa recadastrar por altura — o SKU já guarda sua própria
-- altura (inventory_items.altura), usada para converter comprimento (m linear, unidade do estoque)
-- em área na hora do cálculo. Enquanto a taxa não for cadastrada (0/null), cai no fallback antigo
-- (lead_time_producao em dias) — não quebra os SKUs placeholder existentes.
--
-- O cálculo roda 1x, na CRIAÇÃO da OP (trigger), e fica congelado em production_orders.due_date
-- (só preenche se vier NULL — não sobrescreve prazo do cliente nem OP editada manualmente).

ALTER TABLE public.inventory_items ADD COLUMN IF NOT EXISTS taxa_producao_m2_hora numeric;
ALTER TABLE public.inventory_items ADD COLUMN IF NOT EXISTS tempo_setup_horas numeric NOT NULL DEFAULT 0;
ALTER TABLE public.clinics ADD COLUMN IF NOT EXISTS horas_uteis_producao_dia numeric NOT NULL DEFAULT 8;

CREATE OR REPLACE FUNCTION public.fn_estimate_production_due_date()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item        inventory_items%ROWTYPE;
  v_base        uuid;
  v_em_andamento boolean;
  v_area        numeric;
  v_horas       numeric;
  v_horasdia    numeric;
  v_dias        int;
BEGIN
  IF NEW.due_date IS NOT NULL OR NEW.product_item_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_item FROM public.inventory_items WHERE id = NEW.product_item_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  SELECT COALESCE(base_product_id, id) INTO v_base FROM public.products WHERE id = v_item.product_id;
  IF v_base IS NULL THEN v_base := v_item.product_id; END IF;

  -- "Em andamento" = existe OP em_producao do MESMO modelo (mesma malha+fio, qualquer altura).
  -- Modelo diferente (malha/fio diferente) não bate aqui -> setup é contado normalmente.
  v_em_andamento := v_base IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.production_orders po2
    JOIN public.inventory_items ii2 ON ii2.id = po2.product_item_id
    JOIN public.products p2 ON p2.id = ii2.product_id
    WHERE po2.status = 'em_producao'
      AND po2.clinic_id = NEW.clinic_id
      AND COALESCE(p2.base_product_id, p2.id) = v_base
  );

  IF COALESCE(v_item.taxa_producao_m2_hora, 0) > 0 THEN
    -- comprimento (m linear, unidade do estoque) x altura do próprio SKU = área (m²).
    v_area  := NEW.qty_planned * COALESCE(NULLIF(v_item.altura, 0), 1);
    v_horas := (CASE WHEN v_em_andamento THEN 0 ELSE COALESCE(v_item.tempo_setup_horas, 0) END) + v_area / v_item.taxa_producao_m2_hora;
    SELECT COALESCE(horas_uteis_producao_dia, 8) INTO v_horasdia FROM public.clinics WHERE id = NEW.clinic_id;
    v_dias := GREATEST(1, CEIL(v_horas / NULLIF(v_horasdia, 0)));
  ELSE
    -- Taxa ainda não cadastrada: fallback ao placeholder em dias (comportamento anterior).
    v_dias := COALESCE(v_item.lead_time_producao, 0);
  END IF;

  NEW.due_date := CURRENT_DATE + v_dias;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_estimate_production_due_date ON public.production_orders;
CREATE TRIGGER trg_estimate_production_due_date
  BEFORE INSERT ON public.production_orders
  FOR EACH ROW EXECUTE FUNCTION public.fn_estimate_production_due_date();
