-- Simulação de disponibilidade + prazo (read-only) para o botão "Verificar disponibilidade" do
-- orçamento. NÃO reserva estoque nem cria OP — só calcula e devolve, para o vendedor sugerir a data
-- de entrega. Reusa as mesmas regras da produção:
--   * por linha: disponível = saldo − reservas ativas; se cobre → "em estoque"; senão produz a falta.
--   * tempo de produção = área(falta × altura) / taxa_m2_hora; setup contado 1× por MODELO (malha+fio),
--     pulado se já existe OP em_producao do mesmo modelo (máquina configurada).
--   * altura inédita (sem SKU) empresta taxa/setup de outra altura do mesmo modelo.
--   * dias = ceil(horas / jornada) + expedição; data sugerida = hoje + dias (corridos).
-- Simplificações v1 (a data é uma SUGESTÃO ajustável): não considera a fila de outras OPs já
-- pendentes nem lotes de reposição já programados — é o "se começar agora".
CREATE OR REPLACE FUNCTION public.simulate_production_eta(p_clinic_id uuid, p_lines jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rec       record;
  v_prod      uuid;
  v_comp      numeric;
  v_altln     numeric;
  v_baseprod  public.products%ROWTYPE;
  v_item      public.inventory_items%ROWTYPE;
  v_found     boolean;
  v_base      uuid;
  v_altura    numeric;
  v_taxa      numeric;
  v_setup     numeric;
  v_disp      numeric;
  v_reserv    numeric;
  v_falta     numeric;
  v_label     text;
  v_running   boolean;
  v_horas     numeric;
  v_lines     jsonb := '[]'::jsonb;
  v_total_horas numeric := 0;
  v_jornada   numeric;
  v_exp       int;
  v_dias_prod int;
  v_dias_total int;
  v_any_sem   boolean := false;
BEGIN
  IF NOT has_clinic_access(p_clinic_id) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;

  FOR v_rec IN
    SELECT (elem->>'productId') AS pid,
           NULLIF(replace(COALESCE(elem->>'qty',''), ',', '.'), '')::numeric AS qty,
           NULLIF(replace(COALESCE(elem->>'altura',''), ',', '.'), '')::numeric AS altura
    FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) elem
  LOOP
    IF v_rec.pid IS NULL OR left(v_rec.pid, 2) <> 'p:' THEN CONTINUE; END IF;
    v_prod  := substring(v_rec.pid FROM 3)::uuid;
    v_comp  := COALESCE(v_rec.qty, 0);
    v_altln := v_rec.altura;
    IF v_comp <= 0 THEN CONTINUE; END IF;

    SELECT * INTO v_baseprod FROM public.products WHERE id = v_prod;
    IF NOT FOUND THEN CONTINUE; END IF;

    v_found := false; v_base := NULL; v_altura := NULL; v_taxa := NULL; v_setup := 0; v_disp := 0; v_label := NULL;

    IF v_baseprod.altura IS NOT NULL THEN
      -- SKU concreto (altura fixa)
      SELECT * INTO v_item FROM public.inventory_items
        WHERE clinic_id = p_clinic_id AND product_id = v_prod AND kind = 'produto_acabado' AND is_active LIMIT 1;
      IF FOUND THEN
        v_found := true; v_base := COALESCE(v_baseprod.base_product_id, v_baseprod.id);
        v_altura := v_baseprod.altura; v_taxa := v_item.taxa_producao_m2_hora; v_setup := COALESCE(v_item.tempo_setup_horas, 0);
        v_label := v_item.name;
        SELECT COALESCE(SUM(qty), 0) INTO v_reserv FROM public.stock_reservations WHERE item_id = v_item.id AND status = 'ativa';
        v_disp := v_item.current_qty - v_reserv;
      END IF;
    ELSIF COALESCE(v_altln, 0) > 0 AND EXISTS (SELECT 1 FROM public.products ch WHERE ch.base_product_id = v_prod) THEN
      -- Modelo base + altura: resolve o SKU daquela altura ou empresta de um irmão (altura inédita)
      SELECT ii.* INTO v_item FROM public.inventory_items ii JOIN public.products p ON p.id = ii.product_id
        WHERE ii.clinic_id = p_clinic_id AND p.base_product_id = v_prod AND p.altura = v_altln
          AND p.is_active AND ii.kind = 'produto_acabado' AND ii.is_active LIMIT 1;
      IF FOUND THEN
        v_found := true; v_base := v_prod; v_altura := v_altln; v_taxa := v_item.taxa_producao_m2_hora; v_setup := COALESCE(v_item.tempo_setup_horas, 0);
        v_label := v_item.name;
        SELECT COALESCE(SUM(qty), 0) INTO v_reserv FROM public.stock_reservations WHERE item_id = v_item.id AND status = 'ativa';
        v_disp := v_item.current_qty - v_reserv;
      ELSE
        -- altura inédita: sem estoque; empresta taxa/setup de outra altura do mesmo modelo
        v_found := true; v_base := v_prod; v_altura := v_altln; v_disp := 0;
        SELECT ii.taxa_producao_m2_hora, COALESCE(ii.tempo_setup_horas, 0) INTO v_taxa, v_setup
          FROM public.inventory_items ii JOIN public.products p ON p.id = ii.product_id
          WHERE p.base_product_id = v_prod AND ii.is_active AND ii.taxa_producao_m2_hora IS NOT NULL
          ORDER BY ii.taxa_producao_m2_hora LIMIT 1;
        v_label := v_baseprod.name || ' — ' || replace(rtrim(rtrim(v_altln::text, '0'), '.'), '.', ',') || 'm (sob medida)';
      END IF;
    ELSE
      -- produto normal (não-tela)
      SELECT * INTO v_item FROM public.inventory_items
        WHERE clinic_id = p_clinic_id AND product_id = v_prod AND kind = 'produto_acabado' AND is_active LIMIT 1;
      IF FOUND THEN
        v_found := true; v_base := v_prod; v_altura := COALESCE(v_item.altura, 1); v_taxa := v_item.taxa_producao_m2_hora; v_setup := COALESCE(v_item.tempo_setup_horas, 0);
        v_label := v_item.name;
        SELECT COALESCE(SUM(qty), 0) INTO v_reserv FROM public.stock_reservations WHERE item_id = v_item.id AND status = 'ativa';
        v_disp := v_item.current_qty - v_reserv;
      END IF;
    END IF;

    IF NOT v_found THEN
      v_lines := v_lines || jsonb_build_object('label', COALESCE(v_baseprod.name, '?'), 'qty', v_comp,
        'disponivel', 0, 'em_estoque', false, 'falta', v_comp, 'sem_estimativa', true);
      v_any_sem := true;
      CONTINUE;
    END IF;

    v_falta := GREATEST(0, v_comp - GREATEST(v_disp, 0));
    v_running := EXISTS (
      SELECT 1 FROM public.production_orders po
      JOIN public.inventory_items ii2 ON ii2.id = po.product_item_id
      JOIN public.products p2 ON p2.id = ii2.product_id
      WHERE po.clinic_id = p_clinic_id AND po.status = 'em_producao' AND COALESCE(p2.base_product_id, p2.id) = v_base);

    IF v_falta > 0 AND COALESCE(v_taxa, 0) > 0 THEN
      v_horas := (v_falta * COALESCE(NULLIF(v_altura, 0), 1)) / v_taxa;
    ELSE
      v_horas := 0;
    END IF;
    IF v_falta > 0 AND COALESCE(v_taxa, 0) = 0 THEN v_any_sem := true; END IF;

    v_lines := v_lines || jsonb_build_object(
      'label', v_label, 'qty', v_comp, 'disponivel', GREATEST(v_disp, 0), 'em_estoque', (v_disp >= v_comp),
      'falta', v_falta, 'base', v_base, 'altura', v_altura, 'taxa', v_taxa, 'setup', v_setup,
      'running', v_running, 'horas', round(v_horas, 2), 'sem_estimativa', (v_falta > 0 AND COALESCE(v_taxa, 0) = 0)
    );
  END LOOP;

  -- Resumo: setup 1× por MODELO (se não estiver em andamento) + Σ horas de produção das faltas.
  SELECT COALESCE(SUM(prod_h), 0) + COALESCE(SUM(CASE WHEN running THEN 0 ELSE setup END), 0)
  INTO v_total_horas
  FROM (
    SELECT (elem->>'base') AS base,
           bool_or(COALESCE((elem->>'running')::boolean, false)) AS running,
           MAX(COALESCE((elem->>'setup')::numeric, 0)) AS setup,
           SUM(COALESCE((elem->>'horas')::numeric, 0)) AS prod_h
    FROM jsonb_array_elements(v_lines) elem
    WHERE COALESCE((elem->>'falta')::numeric, 0) > 0 AND (elem->>'base') IS NOT NULL
    GROUP BY (elem->>'base')
  ) g;

  SELECT COALESCE(horas_uteis_producao_dia, 8), COALESCE(lead_time_expedicao_dias, 0)
    INTO v_jornada, v_exp FROM public.clinics WHERE id = p_clinic_id;
  IF COALESCE(v_jornada, 0) <= 0 THEN v_jornada := 8; END IF;

  v_dias_prod  := CASE WHEN v_total_horas > 0 THEN CEIL(v_total_horas / v_jornada) ELSE 0 END;
  v_dias_total := v_dias_prod + COALESCE(v_exp, 0);

  RETURN jsonb_build_object(
    'success', true,
    'linhas', v_lines,
    'resumo', jsonb_build_object(
      'tudo_em_estoque', (v_total_horas = 0 AND NOT v_any_sem AND jsonb_array_length(v_lines) > 0),
      'horas_producao', round(v_total_horas, 1),
      'dias_producao', v_dias_prod,
      'dias_expedicao', COALESCE(v_exp, 0),
      'dias_total', v_dias_total,
      'data_sugerida', (CURRENT_DATE + v_dias_total),
      'sem_estimativa', v_any_sem
    )
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.simulate_production_eta(uuid, jsonb) FROM PUBLIC, anon;
