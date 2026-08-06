-- ============================================================================================
-- ESTADO ATUAL das funcoes de painel, em 06/08/2026. Este arquivo NAO introduz mudanca nenhuma:
-- foi gerado a partir do que ja esta rodando em producao e reaplica exatamente o mesmo texto.
--
-- 📌 SEMPRE EDITE O ARQUIVO estado_atual_das_funcoes_de_painel MAIS RECENTE. Varias migrations
-- de 06/08/2026 alteraram estas funcoes por SUBSTITUICAO DE TEXTO (pg_get_functiondef + replace),
-- entao os arquivos que trazem corpo completo envelhecem a cada nova cirurgia. Quem editar um
-- arquivo antigo e reaplicar apaga as correcoes posteriores DE UMA VEZ, sem erro e sem diff para
-- revisar. E o risco que o CLAUDE.md secao 3 descreve: "create or replace posterior sobrescreve
-- o anterior sem rastro no arquivo velho (um fix ja foi revertido assim sem ninguem notar)".
--
-- Este arquivo supera 20260806212628, que ficou sem: filtro de agente nas clinicas com
-- agenda_via_funil, Novos Pacientes sem duplicar pessoa, fn_lead_origin_bucket e o
-- curto-circuito de fn_lead_matches_agent.
--
-- ⚠️ Continua valendo: afirmacao sobre o banco se prova NO BANCO VIVO (pg_get_functiondef,
-- has_function_privilege), nunca lendo migration.
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.fn_lead_origin_bucket(p_source text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$
  select case p_source
           when 'meta_ads'   then 'meta'
           when 'google_ads' then 'google'
           when 'balcao'     then 'balcao'
           else 'sem_origem'
         end
$function$;

CREATE OR REPLACE FUNCTION public.close_sale_from_orcamento(p_orcamento_id uuid, p_payment_method text DEFAULT 'pix'::text, p_payment_status text DEFAULT 'pago'::text, p_payment_date date DEFAULT ((now() AT TIME ZONE 'America/Sao_Paulo'::text))::date, p_category text DEFAULT 'Venda de produto'::text, p_data_entrega date DEFAULT NULL::date, p_line_keys text[] DEFAULT NULL::text[], p_total numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_orc      public.orcamentos%ROWTYPE;
  v_ticket   RECORD;
  v_lead     RECORD;
  v_patient  uuid;
  v_tx_id    uuid;
  v_finalize jsonb;
  v_total    numeric;
BEGIN
  SELECT * INTO v_orc FROM public.orcamentos WHERE id = p_orcamento_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error_code', 'orcamento_not_found'); END IF;
  IF NOT has_clinic_access(v_orc.clinic_id) THEN RETURN jsonb_build_object('success', false, 'error_code', 'forbidden'); END IF;
  IF v_orc.status NOT IN ('rascunho', 'enviado') THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'already_processed', 'status', v_orc.status);
  END IF;
  IF v_orc.validade IS NOT NULL AND v_orc.validade < (now() at time zone 'America/Sao_Paulo')::date THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'orcamento_vencido', 'validade', v_orc.validade);
  END IF;
  IF v_orc.lead_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error_code', 'no_lead_linked'); END IF;
  IF p_line_keys IS NOT NULL AND array_length(p_line_keys, 1) IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'nenhum_item_selecionado');
  END IF;

  v_total := COALESCE(p_total, v_orc.total);

  SELECT id, outcome, status INTO v_ticket
  FROM public.tickets WHERE lead_id = v_orc.lead_id AND status = 'open' FOR UPDATE LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error_code', 'no_open_ticket'); END IF;
  IF v_ticket.outcome = 'perdido' THEN RETURN jsonb_build_object('success', false, 'error_code', 'ticket_perdido'); END IF;

  IF v_ticket.outcome = 'ganho' THEN
    UPDATE public.orcamentos SET status = 'aprovado', approved_at = now(), approved_ticket_id = v_ticket.id,
      data_entrega_prevista = COALESCE(p_data_entrega, data_entrega_prevista),
      approved_line_keys = COALESCE(p_line_keys, approved_line_keys),
      total = v_total
    WHERE id = p_orcamento_id;
    RETURN jsonb_build_object('success', true, 'already_sold', true, 'ticket_id', v_ticket.id);
  END IF;

  SELECT converted_patient_id, name, phone INTO v_lead FROM public.leads WHERE id = v_orc.lead_id;
  v_patient := v_lead.converted_patient_id;
  IF v_patient IS NULL THEN
    IF v_lead.phone IS NOT NULL THEN
      SELECT id INTO v_patient FROM public.patients
      WHERE clinic_id = v_orc.clinic_id AND phone IS NOT NULL AND normalize_br_phone(phone) = normalize_br_phone(v_lead.phone) LIMIT 1;
    END IF;
    IF v_patient IS NULL THEN
      INSERT INTO public.patients (clinic_id, name, phone) VALUES (v_orc.clinic_id, v_lead.name, v_lead.phone) RETURNING id INTO v_patient;
    END IF;
    UPDATE public.leads SET converted_patient_id = v_patient WHERE id = v_orc.lead_id AND converted_patient_id IS NULL;
  END IF;

  INSERT INTO public.financial_transactions (clinic_id, patient_id, type, category, amount, description, payment_method, status, date)
  VALUES (v_orc.clinic_id, v_patient, 'receita', p_category, v_total, 'Orçamento #' || v_orc.number, p_payment_method, p_payment_status, p_payment_date)
  RETURNING id INTO v_tx_id;

  INSERT INTO public.conversions (clinic_id, lead_id, ticket_id, value, description, payment_method, converted_at, financial_transaction_id)
  VALUES (v_orc.clinic_id, v_orc.lead_id, v_ticket.id, v_total, 'Orçamento #' || v_orc.number, p_payment_method, (p_payment_date::timestamp + interval '12 hour'), v_tx_id);

  SELECT public.finalize_ticket(v_ticket.id, 'ganho', NULL, NULL, false) INTO v_finalize;
  IF NOT COALESCE((v_finalize->>'success')::boolean, false) THEN
    RAISE EXCEPTION 'finalize_ticket falhou ao aprovar orçamento %: %', p_orcamento_id, v_finalize->>'error_code';
  END IF;

  UPDATE public.orcamentos SET status = 'aprovado', approved_at = now(), approved_ticket_id = v_ticket.id,
    data_entrega_prevista = COALESCE(p_data_entrega, data_entrega_prevista),
    approved_line_keys = COALESCE(p_line_keys, approved_line_keys),
    total = v_total
  WHERE id = p_orcamento_id;

  PERFORM public.provision_orcamento(p_orcamento_id);

  RETURN jsonb_build_object('success', true, 'ticket_id', v_ticket.id, 'financial_transaction_id', v_tx_id, 'patient_id', v_patient, 'total', v_total);
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_estimate_production_due_date()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  v_em_andamento := v_base IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.production_orders po2
    JOIN public.inventory_items ii2 ON ii2.id = po2.product_item_id
    JOIN public.products p2 ON p2.id = ii2.product_id
    WHERE po2.status = 'em_producao'
      AND po2.clinic_id = NEW.clinic_id
      AND COALESCE(p2.base_product_id, p2.id) = v_base
  );

  IF COALESCE(v_item.taxa_producao_m2_hora, 0) > 0 THEN
    v_area  := NEW.qty_planned * COALESCE(NULLIF(v_item.altura, 0), 1);
    v_horas := (CASE WHEN v_em_andamento THEN 0 ELSE COALESCE(v_item.tempo_setup_horas, 0) END) + v_area / v_item.taxa_producao_m2_hora;
    SELECT COALESCE(horas_uteis_producao_dia, 8) INTO v_horasdia FROM public.clinics WHERE id = NEW.clinic_id;
    v_dias := GREATEST(1, CEIL(v_horas / NULLIF(v_horasdia, 0)));
  ELSE
    v_dias := COALESCE(v_item.lead_time_producao, 0);
  END IF;

  NEW.due_date := (now() at time zone 'America/Sao_Paulo')::date + v_dias;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_commercial_dashboard_impl(p_clinic_id uuid, p_entry_from date, p_entry_to date, p_agenda_from date, p_agenda_to date, p_agent text DEFAULT 'todos'::text, p_origin text DEFAULT 'todos'::text, p_channel text DEFAULT 'todos'::text, p_conv_from date DEFAULT NULL::date, p_conv_to date DEFAULT NULL::date, p_outcome text DEFAULT 'ambos'::text, p_loss_reasons text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ganho_stage_id uuid;
  v_ia_msgs int; v_human_msgs int; v_inbound_msgs int; v_total_msgs int;
  v_ia_leads_touched int; v_human_leads_touched int;
  v_appt_ia int; v_appt_manual int; v_appt_total int; v_appt_generated int; v_appt_status jsonb;
  v_ia_enabled int; v_ia_autonomous int; v_handoffs int;
  v_auto jsonb;
  v_sla_breaches int; v_response_cycles int;
  v_median_first_response numeric; v_avg_response numeric; v_avg_over_breach numeric;
  v_sla_minutes int;
  v_bh jsonb; v_sh int; v_sm int; v_eh int; v_em int; v_days int[]; v_has_bh boolean;
  v_won int; v_lost int; v_loss_reasons jsonb;
  v_revenue numeric; v_revenue_scoped numeric; v_investment numeric; v_investment_total numeric;
  v_sales_cycle numeric; v_attended_consults int; v_converted_value numeric;
  v_default_ticket numeric;
  v_csat_type text; v_csat_answered int; v_csat_avg numeric; v_csat_dist jsonb;
  v_funnel jsonb; v_daily jsonb;
  v_total_leads int; v_new_leads int; v_leads_not_attended int;
  v_d_from date; v_d_to date;
  v_agenda_funil boolean; v_agendado_stage_id uuid; v_falta_stage_id uuid; v_falta_cnt int;
  -- ⚠️ CADA EIXO TEM DUAS VERSOES, e nao e redundancia: as colunas de data deste banco NAO sao
  -- do mesmo tipo (CLAUDE.md secao 3). Usar a versao errada nao da erro, devolve zero linha.
  --   _i/_f    -> timestamp SEM tz (ja em SP): leads.created_at, leads.handoff_triggered_at,
  --               chat_messages.created_at, sla_breaches.breached_at, appointments.created_at,
  --               automation_logs.triggered_at, lead_stage_history.changed_at
  --   _tzi/_tzf-> timestamptz: conversions.converted_at, tickets.outcome_at/closed_at,
  --               leads.csat_answered_at
  -- O corte do timestamptz e ancorado em America/Sao_Paulo, igual as views canonicas v_kpi_*.
  -- <col>::date cru usaria o TimeZone da sessao (UTC no PostgREST) e daria outro dia (06/08/2026).
  v_ent_i   timestamp   := p_entry_from::timestamp;
  v_ent_f   timestamp   := (p_entry_to + 1)::timestamp;
  v_agd_i   timestamp   := p_agenda_from::timestamp;
  v_agd_f   timestamp   := (p_agenda_to + 1)::timestamp;
  v_agd_tzi timestamptz := ((p_agenda_from::timestamp) at time zone 'America/Sao_Paulo');
  v_agd_tzf timestamptz := (((p_agenda_to + 1)::timestamp) at time zone 'America/Sao_Paulo');
  v_cnv_i   timestamp   := p_conv_from::timestamp;
  v_cnv_f   timestamp   := (p_conv_to + 1)::timestamp;
  v_cnv_tzi timestamptz := ((p_conv_from::timestamp) at time zone 'America/Sao_Paulo');
  v_cnv_tzf timestamptz := (((p_conv_to + 1)::timestamp) at time zone 'America/Sao_Paulo');
  -- Os do grafico diario sao atribuidos no corpo: dependem de v_d_from/v_d_to.
  v_dd_i timestamp; v_dd_f timestamp; v_dd_tzi timestamptz; v_dd_tzf timestamptz;
BEGIN
  SELECT id INTO v_ganho_stage_id FROM funnel_stages WHERE clinic_id = p_clinic_id AND slug = 'ganho' LIMIT 1;
  SELECT COALESCE((features->>'agenda_via_funil')::boolean, false) INTO v_agenda_funil FROM clinics WHERE id = p_clinic_id;
  IF v_agenda_funil THEN
    SELECT id INTO v_agendado_stage_id FROM funnel_stages WHERE clinic_id = p_clinic_id AND slug = 'agendado' LIMIT 1;
    SELECT id INTO v_falta_stage_id FROM funnel_stages WHERE clinic_id = p_clinic_id AND slug = 'faltou_cancelou' LIMIT 1;
  END IF;
  -- Janela padrão do gráfico diário: prefere Agendado (a maioria das séries do
  -- gráfico é atividade operacional), cai para Conversão, depois Entrada.
  v_d_from := COALESCE(p_agenda_from, p_conv_from, p_entry_from, (now() at time zone 'America/Sao_Paulo')::date - 29);
  v_d_to   := COALESCE(p_agenda_to,   p_conv_to,   p_entry_to,   (now() at time zone 'America/Sao_Paulo')::date);
  v_dd_i   := v_d_from::timestamp;
  v_dd_f   := (v_d_to + 1)::timestamp;
  v_dd_tzi := ((v_d_from::timestamp) at time zone 'America/Sao_Paulo');
  v_dd_tzf := (((v_d_to + 1)::timestamp) at time zone 'America/Sao_Paulo');

  SELECT COUNT(*) INTO v_total_leads FROM leads WHERE clinic_id = p_clinic_id AND COALESCE(is_not_lead, false) = false;

  -- ===== Eixo ENTRADA (leads.created_at) — sem mudança =====
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE ai_enabled),
    COUNT(*) FILTER (WHERE ai_enabled AND handoff_triggered_at IS NULL)
  INTO v_new_leads, v_ia_enabled, v_ia_autonomous
  FROM leads l
  WHERE clinic_id = p_clinic_id
    AND (p_entry_from IS NULL OR l.created_at >= v_ent_i)
    AND (p_entry_to   IS NULL OR l.created_at <  v_ent_f)
    AND COALESCE(l.is_not_lead, false) = false
    AND (p_origin = 'todos'
      OR public.fn_lead_origin_bucket(source) = ANY(string_to_array(p_origin, ','))) AND (p_channel = 'todos' OR capture_channel = ANY(string_to_array(p_channel, ',')));

  -- ===== Eixo AGENDADO (atividade operacional: mensagens/SLA/handoffs/automações/
  -- CSAT/investimento/agendamento gerado) — era o antigo p_conv (pill "Agenda"),
  -- comportamento preservado, só o nome do parâmetro mudou pra bater com o pill. =====
  SELECT COUNT(*) INTO v_handoffs FROM leads l
  WHERE clinic_id = p_clinic_id AND handoff_triggered_at IS NOT NULL
    AND (p_agenda_from IS NULL OR handoff_triggered_at >= v_agd_i)
    AND (p_agenda_to   IS NULL OR handoff_triggered_at <  v_agd_f)
    AND (p_entry_from IS NULL OR l.created_at >= v_ent_i)
    AND (p_entry_to   IS NULL OR l.created_at <  v_ent_f)
    AND COALESCE(l.is_not_lead, false) = false
    AND (p_origin = 'todos'
      OR public.fn_lead_origin_bucket(source) = ANY(string_to_array(p_origin, ','))) AND (p_channel = 'todos' OR capture_channel = ANY(string_to_array(p_channel, ',')));

  SELECT sla_minutes, business_hours, csat_type, default_ticket_value
    INTO v_sla_minutes, v_bh, v_csat_type, v_default_ticket
  FROM ai_config WHERE clinic_id = p_clinic_id LIMIT 1;

  v_has_bh := v_bh IS NOT NULL AND (v_bh ? 'start') AND (v_bh ? 'end') AND (v_bh ? 'days');
  IF v_has_bh THEN
    v_sh := SPLIT_PART(v_bh->>'start', ':', 1)::int;
    v_sm := COALESCE(NULLIF(SPLIT_PART(v_bh->>'start', ':', 2), ''), '0')::int;
    v_eh := SPLIT_PART(v_bh->>'end',   ':', 1)::int;
    v_em := COALESCE(NULLIF(SPLIT_PART(v_bh->>'end',   ':', 2), ''), '0')::int;
    SELECT array_agg(d::int) INTO v_days FROM jsonb_array_elements_text(v_bh->'days') d;
  END IF;

  WITH stream AS (
    SELECT cm.lead_id, cm.created_at, cm.seq, cm.sender,
      CASE
        WHEN cm.direction = 'inbound' THEN 'in'
        WHEN (p_agent = 'todos' AND cm.direction = 'outbound' AND cm.sender <> 'system')
          OR (p_agent = 'ia' AND cm.sender = 'ai')
          OR (p_agent = 'humano' AND cm.sender = 'human' AND cm.direction = 'outbound') THEN 'out'
        ELSE NULL
      END AS kind
    FROM chat_messages cm
    JOIN leads l ON l.id = cm.lead_id
    WHERE cm.clinic_id = p_clinic_id
      AND (p_agenda_from IS NULL OR cm.created_at >= v_agd_i)
      AND (p_agenda_to   IS NULL OR cm.created_at <  v_agd_f)
      AND (p_entry_from IS NULL OR l.created_at >= v_ent_i)
      AND (p_entry_to   IS NULL OR l.created_at <  v_ent_f)
      AND COALESCE(l.is_not_lead, false) = false
      AND (p_origin = 'todos'
        OR public.fn_lead_origin_bucket(l.source) = ANY(string_to_array(p_origin, ','))) AND (p_channel = 'todos' OR l.capture_channel = ANY(string_to_array(p_channel, ',')))
  ),
  lagged AS (
    SELECT lead_id, created_at, seq, sender, kind,
      LAG(kind)       OVER (PARTITION BY lead_id ORDER BY created_at, seq) AS prev_kind,
      LAG(created_at) OVER (PARTITION BY lead_id ORDER BY created_at, seq) AS prev_at
    FROM stream WHERE kind IS NOT NULL
  ),
  cyc AS (
    SELECT lead_id, prev_at AS in_at, created_at AS out_at, seq AS out_seq,
      GREATEST(0, EXTRACT(EPOCH FROM (created_at - prev_at)) / 60.0) AS raw_min
    FROM lagged
    WHERE kind = 'out' AND prev_kind = 'in'
      AND NOT (sender = 'ai' AND EXTRACT(EPOCH FROM (created_at - prev_at)) / 60.0 > 60)
  ),
  firsts AS (
    SELECT DISTINCT ON (lead_id) lead_id, raw_min FROM cyc ORDER BY lead_id, in_at, out_seq
  )
  SELECT
    COALESCE((SELECT AVG(raw_min) FROM firsts), 0),
    COALESCE((SELECT AVG(raw_min) FROM cyc), 0),
    COALESCE((SELECT COUNT(*) FROM cyc), 0)
  INTO v_median_first_response, v_avg_response, v_response_cycles;

  SELECT COUNT(*), COALESCE(AVG(sb.overshoot_min), 0)
  INTO v_sla_breaches, v_avg_over_breach
  FROM sla_breaches sb JOIN leads l ON l.id = sb.lead_id
  WHERE sb.clinic_id = p_clinic_id
    AND (p_agenda_from IS NULL OR sb.breached_at >= v_agd_i)
    AND (p_agenda_to   IS NULL OR sb.breached_at <  v_agd_f)
    AND (p_entry_from IS NULL OR l.created_at >= v_ent_i)
    AND (p_entry_to   IS NULL OR l.created_at <  v_ent_f)
    AND COALESCE(l.is_not_lead, false) = false
    AND (p_origin = 'todos'
      OR public.fn_lead_origin_bucket(l.source) = ANY(string_to_array(p_origin, ','))) AND (p_channel = 'todos' OR l.capture_channel = ANY(string_to_array(p_channel, ',')))
    AND (p_agent = 'todos' OR (p_agent = 'ia' AND sb.sender = 'ai') OR (p_agent = 'humano' AND sb.sender = 'human'))
    AND NOT (sb.sender = 'ai' AND sb.wait_raw_min > 60);

  SELECT
    COUNT(*) FILTER (WHERE cm.sender = 'ai'),
    COUNT(*) FILTER (WHERE cm.sender = 'human' AND cm.direction = 'outbound'),
    COUNT(*) FILTER (WHERE cm.direction = 'inbound'),
    COUNT(*)
  INTO v_ia_msgs, v_human_msgs, v_inbound_msgs, v_total_msgs
  FROM chat_messages cm LEFT JOIN leads l ON l.id = cm.lead_id
  WHERE cm.clinic_id = p_clinic_id
    AND (p_agenda_from IS NULL OR cm.created_at >= v_agd_i)
    AND (p_agenda_to   IS NULL OR cm.created_at <  v_agd_f)
    AND (p_entry_from IS NULL OR l.created_at >= v_ent_i)
    AND (p_entry_to   IS NULL OR l.created_at <  v_ent_f)
    AND COALESCE(l.is_not_lead, false) = false
    AND (p_origin = 'todos'
      OR public.fn_lead_origin_bucket(l.source) = ANY(string_to_array(p_origin, ','))) AND (p_channel = 'todos' OR l.capture_channel = ANY(string_to_array(p_channel, ',')));

  WITH cohort AS (
    SELECT l.id AS lead_id
    FROM leads l
    WHERE l.clinic_id = p_clinic_id
      AND (p_entry_from IS NULL OR l.created_at >= v_ent_i)
      AND (p_entry_to   IS NULL OR l.created_at <  v_ent_f)
      AND COALESCE(l.is_not_lead, false) = false
      AND (p_origin = 'todos'
        OR public.fn_lead_origin_bucket(l.source) = ANY(string_to_array(p_origin, ','))) AND (p_channel = 'todos' OR l.capture_channel = ANY(string_to_array(p_channel, ',')))
  )
  -- Atribuicao IA x Humano: regua canonica precomputada (vw_lead_agent_class ->
  -- lead_kpi_attribution), MESMA fonte da Visao Geral.
  SELECT
    COUNT(*) FILTER (WHERE v.agent = 'ia'),
    COUNT(*) FILTER (WHERE v.agent = 'humano')
  INTO v_ia_leads_touched, v_human_leads_touched
  FROM cohort c
  LEFT JOIN public.vw_lead_agent_class v ON v.lead_id = c.lead_id AND v.clinic_id = p_clinic_id;

  v_leads_not_attended := GREATEST(COALESCE(v_new_leads,0) - COALESCE(v_ia_leads_touched,0) - COALESCE(v_human_leads_touched,0), 0);

  -- Quem MARCOU o agendamento (booking attribution) — a.source é uma métrica
  -- DIFERENTE de propósito (quem literalmente marcou ESSA consulta), mantida
  -- assim de propósito: v_appt_ia/v_appt_manual continuam por a.source e NÃO
  -- são afetados pelo filtro p_agent (mostram o split real IA×Humano sempre).
  -- v_appt_total, por outro lado, alimenta o MESMO denominador que byStatus
  -- (cancelRate, faturamentoProjetado no frontend) — por isso agora usa a
  -- MESMA régua de lead (fn_lead_matches_agent) e o MESMO eixo Conversão que
  -- v_appt_generated, pra não virar numerador/denominador de populações
  -- diferentes sob filtro de Agente (achado de code-review 21/07).
  SELECT
    COUNT(*) FILTER (WHERE a.source = 'ia'),
    COUNT(*) FILTER (WHERE a.source = 'manual'),
    COUNT(*) FILTER (WHERE (p_agent = 'todos' OR public.fn_lead_matches_agent(l.id, p_clinic_id, p_agent)))
  INTO v_appt_ia, v_appt_manual, v_appt_total
  FROM appointments a
  JOIN tickets t ON t.id = a.ticket_id
  JOIN leads l ON l.id = t.lead_id
  WHERE a.clinic_id = p_clinic_id
    AND (p_agenda_from IS NULL OR a.created_at >= v_agd_i)
    AND (p_agenda_to   IS NULL OR a.created_at <  v_agd_f)
    AND (p_conv_from IS NULL OR a.date >= p_conv_from)
    AND (p_conv_to   IS NULL OR a.date <= p_conv_to)
    AND (p_entry_from IS NULL OR l.created_at >= v_ent_i)
    AND (p_entry_to   IS NULL OR l.created_at <  v_ent_f)
    AND COALESCE(l.is_not_lead, false) = false
    AND (p_origin = 'todos'
      OR public.fn_lead_origin_bucket(l.source) = ANY(string_to_array(p_origin, ','))) AND (p_channel = 'todos' OR l.capture_channel = ANY(string_to_array(p_channel, ',')));

  -- Agendamento GERADO — precisa bater os 3 calendários AO MESMO TEMPO (E, não
  -- OU): criado dentro de Agendado, consulta marcada pra dentro de Conversão,
  -- lead entrou dentro de Entrada. Por isso lê direto de appointments (não
  -- v_kpi_scheduled, que não guarda a.date) — perde os casos "só etapa, sem
  -- agendamento real" (raro), ganha bater exato com "Consultas" (byStatus) logo abaixo.
  -- JOIN (não LEFT JOIN): agendamento sem ticket/lead resolvido (FK ON DELETE
  -- SET NULL) não deve contar em métrica comercial nenhuma — a view antiga
  -- v_kpi_scheduled exigia isso via INNER JOIN; a leitura direta de
  -- appointments tinha perdido essa exclusão (achado de code-review 21/07).
  SELECT COUNT(*) INTO v_appt_generated
  FROM appointments a
  JOIN tickets t ON t.id = a.ticket_id
  JOIN leads l ON l.id = t.lead_id
  WHERE a.clinic_id = p_clinic_id
    AND (p_agenda_from IS NULL OR a.created_at >= v_agd_i)
    AND (p_agenda_to   IS NULL OR a.created_at <  v_agd_f)
    AND (p_conv_from IS NULL OR a.date >= p_conv_from)
    AND (p_conv_to   IS NULL OR a.date <= p_conv_to)
    AND (p_entry_from IS NULL OR l.created_at >= v_ent_i)
    AND (p_entry_to   IS NULL OR l.created_at <  v_ent_f)
    AND COALESCE(l.is_not_lead, false) = false
    AND (p_agent = 'todos' OR public.fn_lead_matches_agent(l.id, p_clinic_id, p_agent))
    AND (p_origin = 'todos' OR public.fn_lead_origin_bucket(l.source) = ANY(string_to_array(p_origin, ',')))
    AND (p_channel = 'todos' OR l.capture_channel = ANY(string_to_array(p_channel, ',')));

  SELECT COALESCE(jsonb_object_agg(type, cnt), '{}'::jsonb) INTO v_auto
  FROM (
    SELECT al.type, COUNT(*) AS cnt FROM automation_logs al LEFT JOIN leads l ON l.id = al.lead_id
    WHERE al.clinic_id = p_clinic_id AND al.status = 'sent'
      AND (p_agenda_from IS NULL OR al.triggered_at >= v_agd_i)
      AND (p_agenda_to   IS NULL OR al.triggered_at <  v_agd_f)
      AND (p_entry_from IS NULL OR l.created_at >= v_ent_i)
      AND (p_entry_to   IS NULL OR l.created_at <  v_ent_f)
      AND COALESCE(l.is_not_lead, false) = false
      AND (p_origin = 'todos'
        OR public.fn_lead_origin_bucket(l.source) = ANY(string_to_array(p_origin, ','))) AND (p_channel = 'todos' OR l.capture_channel = ANY(string_to_array(p_channel, ',')))
    GROUP BY al.type
  ) a;

  -- ⚠️ csat_answered_at e timestamptz (nao timestamp): janela _tz, nao a comum.
  SELECT COUNT(*), AVG(csat_score) INTO v_csat_answered, v_csat_avg FROM leads
  WHERE clinic_id = p_clinic_id AND csat_score IS NOT NULL
    AND (p_agenda_from IS NULL OR csat_answered_at >= v_agd_tzi)
    AND (p_agenda_to   IS NULL OR csat_answered_at <  v_agd_tzf)
    AND (p_entry_from IS NULL OR created_at >= v_ent_i)
    AND (p_entry_to   IS NULL OR created_at <  v_ent_f)
    AND COALESCE(is_not_lead, false) = false
    AND (p_origin = 'todos'
      OR public.fn_lead_origin_bucket(source) = ANY(string_to_array(p_origin, ','))) AND (p_channel = 'todos' OR capture_channel = ANY(string_to_array(p_channel, ',')));

  SELECT COALESCE(jsonb_agg(jsonb_build_object('score', score, 'count', cnt) ORDER BY score DESC), '[]'::jsonb) INTO v_csat_dist
  FROM (
    SELECT csat_score AS score, COUNT(*) AS cnt FROM leads
    WHERE clinic_id = p_clinic_id AND csat_score IS NOT NULL
      AND (p_agenda_from IS NULL OR csat_answered_at >= v_agd_tzi)
      AND (p_agenda_to   IS NULL OR csat_answered_at <  v_agd_tzf)
      AND (p_entry_from IS NULL OR created_at >= v_ent_i)
      AND (p_entry_to   IS NULL OR created_at <  v_ent_f)
      AND COALESCE(is_not_lead, false) = false
      AND (p_origin = 'todos'
        OR public.fn_lead_origin_bucket(source) = ANY(string_to_array(p_origin, ','))) AND (p_channel = 'todos' OR capture_channel = ANY(string_to_array(p_channel, ',')))
    GROUP BY csat_score
  ) d;

  SELECT COALESCE(SUM(investment), 0) INTO v_investment_total FROM v_kpi_investment
  WHERE clinic_id = p_clinic_id
    AND (p_agenda_from IS NULL OR day >= p_agenda_from) AND (p_agenda_to IS NULL OR day <= p_agenda_to);

  SELECT COALESCE(SUM(investment), 0) INTO v_investment FROM v_kpi_investment
  WHERE clinic_id = p_clinic_id
    AND (p_agenda_from IS NULL OR day >= p_agenda_from) AND (p_agenda_to IS NULL OR day <= p_agenda_to)
    AND (p_origin = 'todos' OR origin = ANY(string_to_array(p_origin, ',')))
    AND COALESCE(p_channel, 'todos') = 'todos' AND COALESCE(p_agent, 'todos') = 'todos';

  -- ===== Eixo CONVERSÃO (COALESCE(outcome_at,closed_at) + appointments.date) —
  -- era o antigo p_appt + metade do antigo p_conv. Toggle p_outcome
  -- ('ganho'|'perdido'|'ambos'). Ganho/Perdido/Faturamento usam SÓ Conversão+
  -- Entrada (não têm "quando foi criado" pra exigir Agendado). Já os blocos de
  -- CONSULTA (gerado/byStatus/realizadas, mais abaixo) exigem os 3 calendários
  -- AO MESMO TEMPO — Agendado (criação) E Conversão (data da consulta) E
  -- Entrada (coorte) — por pedido explícito do Pedro: "a condição é AND". =====
  SELECT
    COUNT(*) FILTER (WHERE t.outcome = 'ganho'),
    COUNT(*) FILTER (WHERE t.outcome = 'perdido')
  INTO v_won, v_lost
  FROM tickets t JOIN leads l ON l.id = t.lead_id
  WHERE t.clinic_id = p_clinic_id AND t.outcome IS NOT NULL
    AND (p_outcome = 'ambos' OR t.outcome = p_outcome)
    AND (p_conv_from IS NULL OR COALESCE(t.outcome_at, t.closed_at) >= v_cnv_tzi)
    AND (p_conv_to   IS NULL OR COALESCE(t.outcome_at, t.closed_at) <  v_cnv_tzf)
    AND (p_entry_from IS NULL OR l.created_at >= v_ent_i)
    AND (p_entry_to   IS NULL OR l.created_at <  v_ent_f)
    AND COALESCE(l.is_not_lead, false) = false
    -- Seletor de motivo (só aparece na tela com toggle=Perdido): não afeta Ganho.
    AND (p_loss_reasons IS NULL OR btrim(p_loss_reasons) = '' OR t.outcome <> 'perdido'
      OR COALESCE(NULLIF(t.loss_reason, ''), '(sem motivo registrado)') = ANY(string_to_array(p_loss_reasons, ',')))
    -- Faltava filtro de Agente aqui (achado de code-review 21/07) — Ganho/
    -- Perdido não respeitavam o filtro enquanto revenueScoped ao lado sim.
    AND (p_agent = 'todos' OR public.fn_lead_matches_agent(l.id, p_clinic_id, p_agent))
    AND (p_origin = 'todos'
      OR public.fn_lead_origin_bucket(l.source) = ANY(string_to_array(p_origin, ','))) AND (p_channel = 'todos' OR l.capture_channel = ANY(string_to_array(p_channel, ',')));

  -- Motivo de perda (novo — reaproveita v_kpi_outcomes, fonte única do dia de
  -- desfecho, em vez de recalcular COALESCE(outcome_at,closed_at) de novo).
  IF p_outcome IN ('perdido', 'ambos') THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('reason', reason, 'count', cnt) ORDER BY cnt DESC), '[]'::jsonb)
    INTO v_loss_reasons
    FROM (
      SELECT COALESCE(NULLIF(o.loss_reason, ''), '(sem motivo registrado)') AS reason, COUNT(*) AS cnt
      FROM public.v_kpi_outcomes o
      JOIN leads l ON l.id = o.lead_id
      WHERE o.clinic_id = p_clinic_id AND o.outcome = 'perdido'
        AND (p_conv_from IS NULL OR o.day >= p_conv_from)
        AND (p_conv_to   IS NULL OR o.day <= p_conv_to)
        AND (p_entry_from IS NULL OR l.created_at >= v_ent_i)
        AND (p_entry_to   IS NULL OR l.created_at <  v_ent_f)
        AND (p_agent = 'todos' OR public.fn_lead_matches_agent(l.id, p_clinic_id, p_agent))
        AND (p_origin = 'todos'
          OR public.fn_lead_origin_bucket(l.source) = ANY(string_to_array(p_origin, ','))) AND (p_channel = 'todos' OR l.capture_channel = ANY(string_to_array(p_channel, ',')))
      GROUP BY 1
    ) r;
  ELSE
    v_loss_reasons := '[]'::jsonb;
  END IF;

  SELECT COALESCE(SUM(c.value::numeric), 0) INTO v_revenue
  FROM conversions c
  LEFT JOIN leads l ON l.id = c.lead_id
  LEFT JOIN tickets t2 ON t2.id = c.ticket_id
  WHERE c.clinic_id = p_clinic_id AND c.description IS DISTINCT FROM 'Orçamento Enviado'
    AND (p_outcome = 'ambos' OR t2.outcome = p_outcome)
    AND (p_conv_from IS NULL OR c.converted_at >= v_cnv_tzi)
    AND (p_conv_to   IS NULL OR c.converted_at <  v_cnv_tzf)
    AND (l.id IS NULL OR COALESCE(l.is_not_lead, false) = false)
    AND ((p_entry_from IS NULL AND p_entry_to IS NULL)
      OR ((p_entry_from IS NULL OR l.created_at >= v_ent_i)
          AND (p_entry_to IS NULL OR l.created_at <  v_ent_f)));

  SELECT COALESCE(SUM(c.value::numeric), 0) INTO v_revenue_scoped
  FROM conversions c
  LEFT JOIN leads l ON l.id = c.lead_id
  LEFT JOIN tickets t2 ON t2.id = c.ticket_id
  WHERE c.clinic_id = p_clinic_id AND c.description IS DISTINCT FROM 'Orçamento Enviado'
    AND (p_outcome = 'ambos' OR t2.outcome = p_outcome)
    AND (p_conv_from IS NULL OR c.converted_at >= v_cnv_tzi)
    AND (p_conv_to   IS NULL OR c.converted_at <  v_cnv_tzf)
    AND (p_entry_from IS NULL OR l.created_at >= v_ent_i)
    AND (p_entry_to   IS NULL OR l.created_at <  v_ent_f)
    AND (l.id IS NULL OR COALESCE(l.is_not_lead, false) = false)
    AND (p_agent = 'todos' OR public.fn_lead_matches_agent(l.id, p_clinic_id, p_agent))
    AND (p_origin = 'todos'
      OR public.fn_lead_origin_bucket(l.source) = ANY(string_to_array(p_origin, ','))) AND (p_channel = 'todos' OR l.capture_channel = ANY(string_to_array(p_channel, ',')));

  -- Ciclo: até o Ganho por padrão; até a Perda quando o toggle está em 'perdido'.
  SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (t.outcome_at - l.created_at)) / 86400.0), 0) INTO v_sales_cycle
  FROM tickets t JOIN leads l ON l.id = t.lead_id
  WHERE t.clinic_id = p_clinic_id AND t.outcome = (CASE WHEN p_outcome = 'perdido' THEN 'perdido' ELSE 'ganho' END)
    AND (p_conv_from IS NULL OR t.outcome_at >= v_cnv_tzi)
    AND (p_conv_to   IS NULL OR t.outcome_at <  v_cnv_tzf)
    AND (p_entry_from IS NULL OR l.created_at >= v_ent_i)
    AND (p_entry_to   IS NULL OR l.created_at <  v_ent_f)
    AND COALESCE(l.is_not_lead, false) = false
    AND (p_loss_reasons IS NULL OR btrim(p_loss_reasons) = '' OR t.outcome <> 'perdido'
      OR COALESCE(NULLIF(t.loss_reason, ''), '(sem motivo registrado)') = ANY(string_to_array(p_loss_reasons, ',')))
    -- Faltava filtro de Agente aqui tambem (achado de code-review 21/07).
    AND (p_agent = 'todos' OR public.fn_lead_matches_agent(l.id, p_clinic_id, p_agent))
    AND (p_origin = 'todos'
      OR public.fn_lead_origin_bucket(l.source) = ANY(string_to_array(p_origin, ','))) AND (p_channel = 'todos' OR l.capture_channel = ANY(string_to_array(p_channel, ',')));

  -- Consultas realizadas: mesma regra de "casamento" dos 3 calendários do bloco
  -- acima (Agendado + Conversão + Entrada, todos ao mesmo tempo) + mesmos
  -- filtros de Agente/Origem/Canal do bloco irmão byStatus logo abaixo — antes
  -- não tinha NENHUM dos 3, então finance.attendedConsults divergia de
  -- byStatus.realizado sob qualquer filtro ativo (achado de code-review 21/07).
  -- JOIN (não LEFT JOIN): mesmo motivo do bloco "Agendamento GERADO" acima.
  SELECT COUNT(*) INTO v_attended_consults
  FROM appointments a
  JOIN tickets t ON t.id = a.ticket_id
  JOIN leads l ON l.id = t.lead_id
  WHERE a.clinic_id = p_clinic_id AND a.status IN ('realizado', 'compareceu')
    AND (p_conv_from IS NULL OR a.date >= p_conv_from)
    AND (p_conv_to   IS NULL OR a.date <= p_conv_to)
    AND (p_agenda_from IS NULL OR a.created_at >= v_agd_i)
    AND (p_agenda_to   IS NULL OR a.created_at <  v_agd_f)
    AND (p_entry_from IS NULL OR l.created_at >= v_ent_i)
    AND (p_entry_to   IS NULL OR l.created_at <  v_ent_f)
    AND COALESCE(l.is_not_lead, false) = false
    AND (p_agent = 'todos' OR public.fn_lead_matches_agent(l.id, p_clinic_id, p_agent))
    AND (p_origin = 'todos'
      OR public.fn_lead_origin_bucket(l.source) = ANY(string_to_array(p_origin, ','))) AND (p_channel = 'todos' OR l.capture_channel = ANY(string_to_array(p_channel, ',')));

  SELECT COALESCE(jsonb_object_agg(status, cnt), '{}'::jsonb) INTO v_appt_status
  FROM (
    SELECT COALESCE(a.status, 'indefinido') AS status, COUNT(*) AS cnt
    FROM appointments a
    JOIN tickets t ON t.id = a.ticket_id
    JOIN leads l ON l.id = t.lead_id
    WHERE a.clinic_id = p_clinic_id
      AND (p_conv_from IS NULL OR a.date >= p_conv_from)
      AND (p_conv_to   IS NULL OR a.date <= p_conv_to)
      AND (p_agenda_from IS NULL OR a.created_at >= v_agd_i)
      AND (p_agenda_to   IS NULL OR a.created_at <  v_agd_f)
      AND (p_entry_from IS NULL OR l.created_at >= v_ent_i)
      AND (p_entry_to   IS NULL OR l.created_at <  v_ent_f)
      AND COALESCE(l.is_not_lead, false) = false
      -- Mesma régua canônica de "Agendamentos Gerados" (lead como um todo, via
      -- vw_lead_agent_class) — era por a.source (quem marcou ESSA consulta),
      -- que divergia de "Gerados" quando o lead é da IA mas um humano marcou.
      AND (p_agent = 'todos' OR public.fn_lead_matches_agent(l.id, p_clinic_id, p_agent))
      AND (p_origin = 'todos'
        OR public.fn_lead_origin_bucket(l.source) = ANY(string_to_array(p_origin, ','))) AND (p_channel = 'todos' OR l.capture_channel = ANY(string_to_array(p_channel, ',')))
    GROUP BY 1
  ) s;

  IF v_agenda_funil THEN
    SELECT COUNT(DISTINCT h.ticket_id) INTO v_appt_total
    FROM lead_stage_history h JOIN leads l ON l.id = h.lead_id
    WHERE h.clinic_id = p_clinic_id AND h.new_stage_id = v_agendado_stage_id
      AND (p_agenda_from IS NULL OR h.changed_at >= v_agd_i)
      AND (p_agenda_to   IS NULL OR h.changed_at <  v_agd_f)
      AND (p_entry_from IS NULL OR l.created_at >= v_ent_i)
      AND (p_entry_to   IS NULL OR l.created_at <  v_ent_f)
      AND COALESCE(l.is_not_lead, false) = false
      AND (p_agent = 'todos' OR public.fn_lead_matches_agent(l.id, p_clinic_id, p_agent))
      AND (p_origin = 'todos'
        OR public.fn_lead_origin_bucket(l.source) = ANY(string_to_array(p_origin, ','))) AND (p_channel = 'todos' OR l.capture_channel = ANY(string_to_array(p_channel, ',')));
    v_appt_ia := 0; v_appt_manual := v_appt_total;
    -- appointments.generated ficava hard-travado em 0 pra clínicas com
    -- agenda_via_funil=true, já que o bloco padrão (acima) lê de `appointments`,
    -- tabela que essas clínicas não usam pra agendar (achado de code-review 21/07).
    v_appt_generated := v_appt_total;

    SELECT
      COUNT(DISTINCT h.ticket_id) FILTER (WHERE h.new_stage_id = v_ganho_stage_id),
      COUNT(DISTINCT h.ticket_id) FILTER (WHERE h.new_stage_id = v_falta_stage_id)
    INTO v_attended_consults, v_falta_cnt
    FROM lead_stage_history h JOIN leads l ON l.id = h.lead_id
    WHERE h.clinic_id = p_clinic_id AND h.new_stage_id IN (v_ganho_stage_id, v_falta_stage_id)
      AND (p_conv_from IS NULL OR h.changed_at >= v_cnv_i)
      AND (p_conv_to   IS NULL OR h.changed_at <  v_cnv_f)
      AND (p_entry_from IS NULL OR l.created_at >= v_ent_i)
      AND (p_entry_to   IS NULL OR l.created_at <  v_ent_f)
      AND COALESCE(l.is_not_lead, false) = false
      AND (p_agent = 'todos' OR public.fn_lead_matches_agent(l.id, p_clinic_id, p_agent))
      AND (p_origin = 'todos'
        OR public.fn_lead_origin_bucket(l.source) = ANY(string_to_array(p_origin, ','))) AND (p_channel = 'todos' OR l.capture_channel = ANY(string_to_array(p_channel, ',')));

    v_appt_status := jsonb_build_object('realizado', COALESCE(v_attended_consults, 0), 'faltou', COALESCE(v_falta_cnt, 0));
  END IF;

  -- Faltavam Agente/Origem/Canal aqui (achado de code-review 21/07) — sob
  -- qualquer um desses filtros, convertedValue continuava mostrando o total
  -- da clínica inteira enquanto o resto do financeiro encolhia pro recorte.
  SELECT COALESCE(SUM(c.value::numeric), 0) INTO v_converted_value
  FROM conversions c
  LEFT JOIN leads l ON l.id = c.lead_id
  LEFT JOIN tickets t2 ON t2.id = c.ticket_id
  WHERE c.clinic_id = p_clinic_id
    AND (p_outcome = 'ambos' OR t2.outcome = p_outcome)
    AND (p_conv_from IS NULL OR c.converted_at >= v_cnv_tzi)
    AND (p_conv_to   IS NULL OR c.converted_at <  v_cnv_tzf)
    AND (p_entry_from IS NULL OR l.created_at >= v_ent_i)
    AND (p_entry_to   IS NULL OR l.created_at <  v_ent_f)
    AND COALESCE(l.is_not_lead, false) = false
    AND (p_agent = 'todos' OR public.fn_lead_matches_agent(l.id, p_clinic_id, p_agent))
    AND (p_origin = 'todos'
      OR public.fn_lead_origin_bucket(l.source) = ANY(string_to_array(p_origin, ','))) AND (p_channel = 'todos' OR l.capture_channel = ANY(string_to_array(p_channel, ',')));

  -- ===== Funil por etapa — eixo Entrada (sem mudança) =====
  WITH entries AS (
    SELECT h.ticket_id, h.new_stage_id AS stage_id, MAX(h.changed_at) AS last_entry
    FROM lead_stage_history h JOIN leads l ON l.id = h.lead_id
    WHERE h.clinic_id = p_clinic_id AND h.new_stage_id IS NOT NULL AND h.ticket_id IS NOT NULL
      AND (p_entry_from IS NULL OR l.created_at >= v_ent_i)
      AND (p_entry_to   IS NULL OR l.created_at <  v_ent_f)
      AND COALESCE(l.is_not_lead, false) = false
      AND (p_origin = 'todos'
        OR public.fn_lead_origin_bucket(l.source) = ANY(string_to_array(p_origin, ','))) AND (p_channel = 'todos' OR l.capture_channel = ANY(string_to_array(p_channel, ',')))
    GROUP BY h.ticket_id, h.new_stage_id
  ),
  counts AS (SELECT stage_id, COUNT(*)::int AS leads FROM entries GROUP BY stage_id)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'stage_id', fs.id, 'name', fs.name, 'slug', fs.slug, 'position', fs.position,
    'is_conversion', fs.is_conversion, 'color', fs.color, 'leads', COALESCE(c.leads, 0)) ORDER BY fs.position), '[]'::jsonb)
  INTO v_funnel
  FROM funnel_stages fs LEFT JOIN counts c ON c.stage_id = fs.id
  WHERE fs.clinic_id = p_clinic_id;

  WITH dates AS (SELECT generate_series(v_d_from, v_d_to, interval '1 day')::date AS d),
  msgs AS (
    SELECT cm.created_at::date AS d,
      COUNT(*) FILTER (WHERE cm.sender = 'ai') AS ai_msgs,
      COUNT(*) FILTER (WHERE cm.sender = 'human' AND cm.direction = 'outbound') AS human_msgs
    FROM chat_messages cm LEFT JOIN leads l ON l.id = cm.lead_id
    WHERE cm.clinic_id = p_clinic_id AND cm.created_at >= v_dd_i AND cm.created_at < v_dd_f
      AND (p_entry_from IS NULL OR l.created_at >= v_ent_i)
      AND (p_entry_to   IS NULL OR l.created_at <  v_ent_f)
      AND COALESCE(l.is_not_lead, false) = false
      AND (p_origin = 'todos'
        OR public.fn_lead_origin_bucket(l.source) = ANY(string_to_array(p_origin, ','))) AND (p_channel = 'todos' OR l.capture_channel = ANY(string_to_array(p_channel, ',')))
    GROUP BY 1
  ),
  ld AS (
    SELECT created_at::date AS d, COUNT(*) AS leads FROM leads
    WHERE clinic_id = p_clinic_id AND created_at >= v_dd_i AND created_at < v_dd_f
      AND (p_entry_from IS NULL OR created_at >= v_ent_i)
      AND (p_entry_to   IS NULL OR created_at <  v_ent_f)
      AND COALESCE(is_not_lead, false) = false
      AND (p_origin = 'todos'
        OR public.fn_lead_origin_bucket(source) = ANY(string_to_array(p_origin, ','))) AND (p_channel = 'todos' OR capture_channel = ANY(string_to_array(p_channel, ',')))
    GROUP BY 1
  ),
  ap AS (
    -- Mesma régua de agente do card "Agendamentos Gerados" (fn_lead_matches_agent,
    -- não a.source) + eixo Conversão também, pra série diária somar com o card
    -- agregado (achados de code-review 21/07).
    SELECT a.created_at::date AS d,
      COUNT(*) AS appts,
      COUNT(*) FILTER (WHERE COALESCE(a.status, '') NOT IN ('cancelado', 'faltou')) AS valid_appts
    FROM appointments a
    JOIN tickets t ON t.id = a.ticket_id JOIN leads l ON l.id = t.lead_id
    WHERE a.clinic_id = p_clinic_id AND a.created_at >= v_dd_i AND a.created_at < v_dd_f
      AND (p_conv_from IS NULL OR a.date >= p_conv_from)
      AND (p_conv_to   IS NULL OR a.date <= p_conv_to)
      AND (p_entry_from IS NULL OR l.created_at >= v_ent_i)
      AND (p_entry_to   IS NULL OR l.created_at <  v_ent_f)
      AND COALESCE(l.is_not_lead, false) = false
      AND (p_agent = 'todos' OR public.fn_lead_matches_agent(l.id, p_clinic_id, p_agent))
      AND (p_origin = 'todos'
        OR public.fn_lead_origin_bucket(l.source) = ANY(string_to_array(p_origin, ','))) AND (p_channel = 'todos' OR l.capture_channel = ANY(string_to_array(p_channel, ',')))
    GROUP BY 1
  ),
  rz AS (
    SELECT a.date AS d, COUNT(*) AS realizadas FROM appointments a
    JOIN tickets t ON t.id = a.ticket_id JOIN leads l ON l.id = t.lead_id
    WHERE a.clinic_id = p_clinic_id AND a.status IN ('realizado', 'compareceu') AND a.date BETWEEN v_d_from AND v_d_to
      AND (p_agenda_from IS NULL OR a.created_at >= v_agd_i)
      AND (p_agenda_to   IS NULL OR a.created_at <  v_agd_f)
      AND (p_entry_from IS NULL OR l.created_at >= v_ent_i)
      AND (p_entry_to   IS NULL OR l.created_at <  v_ent_f)
      AND COALESCE(l.is_not_lead, false) = false
      AND (p_agent = 'todos' OR public.fn_lead_matches_agent(l.id, p_clinic_id, p_agent))
      AND (p_origin = 'todos'
        OR public.fn_lead_origin_bucket(l.source) = ANY(string_to_array(p_origin, ','))) AND (p_channel = 'todos' OR l.capture_channel = ANY(string_to_array(p_channel, ',')))
    GROUP BY 1
  ),
  rev AS (
    SELECT (c.converted_at at time zone 'America/Sao_Paulo')::date AS d, SUM(c.value::numeric) AS faturamento
    FROM conversions c
    LEFT JOIN leads l ON l.id = c.lead_id
    WHERE c.clinic_id = p_clinic_id AND c.description IS DISTINCT FROM 'Orçamento Enviado'
      AND c.converted_at >= v_dd_tzi AND c.converted_at < v_dd_tzf
      AND (p_entry_from IS NULL OR l.created_at >= v_ent_i)
      AND (p_entry_to   IS NULL OR l.created_at <  v_ent_f)
      AND COALESCE(l.is_not_lead, false) = false
      AND (p_agent = 'todos' OR public.fn_lead_matches_agent(l.id, p_clinic_id, p_agent))
      AND (p_origin = 'todos'
        OR public.fn_lead_origin_bucket(l.source) = ANY(string_to_array(p_origin, ','))) AND (p_channel = 'todos' OR l.capture_channel = ANY(string_to_array(p_channel, ','))) GROUP BY 1
  ),
  apf AS (
    SELECT h.changed_at::date AS d, COUNT(DISTINCT h.ticket_id) AS appts
    FROM lead_stage_history h JOIN leads l ON l.id = h.lead_id
    WHERE v_agenda_funil AND h.clinic_id = p_clinic_id AND h.new_stage_id = v_agendado_stage_id
      AND h.changed_at >= v_dd_i AND h.changed_at < v_dd_f
      AND (p_entry_from IS NULL OR l.created_at >= v_ent_i)
      AND (p_entry_to   IS NULL OR l.created_at <  v_ent_f)
      AND COALESCE(l.is_not_lead, false) = false
      AND (p_agent = 'todos' OR public.fn_lead_matches_agent(l.id, p_clinic_id, p_agent))
      AND (p_origin = 'todos'
        OR public.fn_lead_origin_bucket(l.source) = ANY(string_to_array(p_origin, ','))) AND (p_channel = 'todos' OR l.capture_channel = ANY(string_to_array(p_channel, ',')))
    GROUP BY 1
  ),
  rzf AS (
    SELECT h.changed_at::date AS d, COUNT(DISTINCT h.ticket_id) AS realizadas
    FROM lead_stage_history h JOIN leads l ON l.id = h.lead_id
    WHERE v_agenda_funil AND h.clinic_id = p_clinic_id AND h.new_stage_id = v_ganho_stage_id
      AND h.changed_at >= v_dd_i AND h.changed_at < v_dd_f
      AND (p_entry_from IS NULL OR l.created_at >= v_ent_i)
      AND (p_entry_to   IS NULL OR l.created_at <  v_ent_f)
      AND COALESCE(l.is_not_lead, false) = false
      AND (p_agent = 'todos' OR public.fn_lead_matches_agent(l.id, p_clinic_id, p_agent))
      AND (p_origin = 'todos'
        OR public.fn_lead_origin_bucket(l.source) = ANY(string_to_array(p_origin, ','))) AND (p_channel = 'todos' OR l.capture_channel = ANY(string_to_array(p_channel, ',')))
    GROUP BY 1
  ),
  wg AS (
    SELECT (COALESCE(t.outcome_at, t.closed_at) at time zone 'America/Sao_Paulo')::date AS d, COUNT(*) AS ganhos
    FROM tickets t JOIN leads l ON l.id = t.lead_id
    WHERE t.clinic_id = p_clinic_id AND t.outcome = 'ganho'
      AND COALESCE(t.outcome_at, t.closed_at) >= v_dd_tzi AND COALESCE(t.outcome_at, t.closed_at) < v_dd_tzf
      AND (p_entry_from IS NULL OR l.created_at >= v_ent_i)
      AND (p_entry_to   IS NULL OR l.created_at <  v_ent_f)
      AND COALESCE(l.is_not_lead, false) = false
      AND (p_agent = 'todos' OR public.fn_lead_matches_agent(l.id, p_clinic_id, p_agent))
      AND (p_origin = 'todos'
        OR public.fn_lead_origin_bucket(l.source) = ANY(string_to_array(p_origin, ','))) AND (p_channel = 'todos' OR l.capture_channel = ANY(string_to_array(p_channel, ',')))
    GROUP BY 1
  ),
  mkt AS (
    SELECT day AS d, SUM(investment) AS investment FROM v_kpi_investment
    WHERE clinic_id = p_clinic_id AND day BETWEEN v_d_from AND v_d_to
      AND (p_origin = 'todos' OR origin = ANY(string_to_array(p_origin, ',')))
      AND COALESCE(p_channel, 'todos') = 'todos' AND COALESCE(p_agent, 'todos') = 'todos'
    GROUP BY 1
  ),
  hd AS (
    SELECT handoff_triggered_at::date AS d, COUNT(*) AS handoffs FROM leads
    WHERE clinic_id = p_clinic_id AND handoff_triggered_at IS NOT NULL
      AND handoff_triggered_at >= v_dd_i AND handoff_triggered_at < v_dd_f
      AND (p_entry_from IS NULL OR created_at >= v_ent_i)
      AND (p_entry_to   IS NULL OR created_at <  v_ent_f)
      AND COALESCE(is_not_lead, false) = false
      AND (p_origin = 'todos'
        OR public.fn_lead_origin_bucket(source) = ANY(string_to_array(p_origin, ','))) AND (p_channel = 'todos' OR capture_channel = ANY(string_to_array(p_channel, ',')))
    GROUP BY 1
  ),
  fu AS (
    SELECT al.triggered_at::date AS d, COUNT(*) AS followups FROM automation_logs al LEFT JOIN leads l ON l.id = al.lead_id
    WHERE al.clinic_id = p_clinic_id AND al.type = 'followup' AND al.status = 'sent'
      AND al.triggered_at >= v_dd_i AND al.triggered_at < v_dd_f
      AND (p_entry_from IS NULL OR l.created_at >= v_ent_i)
      AND (p_entry_to   IS NULL OR l.created_at <  v_ent_f)
      AND COALESCE(l.is_not_lead, false) = false
    GROUP BY 1
  )
  SELECT jsonb_agg(jsonb_build_object(
    'date', to_char(dates.d, 'YYYY-MM-DD'),
    'aiMessages', COALESCE(m.ai_msgs, 0), 'humanMessages', COALESCE(m.human_msgs, 0),
    'leads', COALESCE(l.leads, 0),
    'appointments', CASE WHEN v_agenda_funil THEN COALESCE(apf.appts, 0) ELSE COALESCE(a.appts, 0) END,
    'realizadas', CASE WHEN v_agenda_funil THEN COALESCE(rzf.realizadas, 0) ELSE COALESCE(rz.realizadas, 0) END,
    'ganhos', COALESCE(wg.ganhos, 0),
    'faturamento', COALESCE(rev.faturamento, 0),
    'faturamentoProjetado', (CASE WHEN v_agenda_funil THEN COALESCE(apf.appts, 0) ELSE COALESCE(a.valid_appts, 0) END) * COALESCE(v_default_ticket, 0),
    'investment', COALESCE(mk.investment, 0),
    'handoffs', COALESCE(h.handoffs, 0), 'followups', COALESCE(f.followups, 0)) ORDER BY dates.d)
  INTO v_daily
  FROM dates
  LEFT JOIN msgs m ON m.d = dates.d LEFT JOIN ld l ON l.d = dates.d
  LEFT JOIN ap a ON a.d = dates.d LEFT JOIN rz ON rz.d = dates.d LEFT JOIN rev ON rev.d = dates.d
  LEFT JOIN apf ON apf.d = dates.d LEFT JOIN rzf ON rzf.d = dates.d
  LEFT JOIN wg ON wg.d = dates.d LEFT JOIN mkt mk ON mk.d = dates.d
  LEFT JOIN hd h ON h.d = dates.d LEFT JOIN fu f ON f.d = dates.d;

  RETURN jsonb_build_object(
    'entry', jsonb_build_object('from', p_entry_from, 'to', p_entry_to),
    'agenda', jsonb_build_object('from', p_agenda_from, 'to', p_agenda_to),
    'conv', jsonb_build_object('from', p_conv_from, 'to', p_conv_to),
    'outcomeFilter', COALESCE(p_outcome, 'ambos'),
    'agents', jsonb_build_object(
      'ia', jsonb_build_object('messagesOut', COALESCE(v_ia_msgs,0), 'leadsTouched', COALESCE(v_ia_leads_touched,0),
        'appointments', COALESCE(v_appt_ia,0), 'leadsEnabled', COALESCE(v_ia_enabled,0),
        'autonomous', COALESCE(v_ia_autonomous,0), 'handoffs', COALESCE(v_handoffs,0)),
      'humano', jsonb_build_object('messagesOut', COALESCE(v_human_msgs,0), 'leadsTouched', COALESCE(v_human_leads_touched,0),
        'appointments', COALESCE(v_appt_manual,0), 'handoffsReceived', COALESCE(v_handoffs,0)),
      'sistema', jsonb_build_object('automations', COALESCE(v_auto,'{}'::jsonb))
    ),
    'messages', jsonb_build_object('inbound', COALESCE(v_inbound_msgs,0), 'total', COALESCE(v_total_msgs,0)),
    'appointments', jsonb_build_object('total', COALESCE(v_appt_total,0), 'ia', COALESCE(v_appt_ia,0),
      'manual', COALESCE(v_appt_manual,0), 'byStatus', COALESCE(v_appt_status,'{}'::jsonb), 'generated', COALESCE(v_appt_generated,0)),
    'sla', jsonb_build_object(
      'firstResponseMin', ROUND(COALESCE(v_median_first_response,0),2),
      'responseMin', ROUND(COALESCE(v_avg_response,0),2),
      'breaches', COALESCE(v_sla_breaches,0),
      'overBreachMin', ROUND(COALESCE(v_avg_over_breach,0),1),
      'responseCycles', COALESCE(v_response_cycles,0),
      'slaMinutes', COALESCE(v_sla_minutes,0)),
    'finance', jsonb_build_object('revenue', COALESCE(v_revenue,0), 'revenueScoped', COALESCE(v_revenue_scoped,0), 'investment', COALESCE(v_investment,0),
      'investmentTotal', COALESCE(v_investment_total,0), 'convertedValue', COALESCE(v_converted_value,0),
      'salesCycleDays', ROUND(COALESCE(v_sales_cycle,0),1), 'attendedConsults', COALESCE(v_attended_consults,0),
      'defaultTicket', COALESCE(v_default_ticket,0)),
    'outcomes', jsonb_build_object('won', COALESCE(v_won,0), 'lost', COALESCE(v_lost,0), 'lossReasons', COALESCE(v_loss_reasons,'[]'::jsonb)),
    'csat', jsonb_build_object('type', COALESCE(v_csat_type,'csat'), 'answered', COALESCE(v_csat_answered,0),
      'avg', v_csat_avg, 'distribution', COALESCE(v_csat_dist,'[]'::jsonb)),
    'funnel', COALESCE(v_funnel,'[]'::jsonb), 'daily', COALESCE(v_daily,'[]'::jsonb),
    'totalLeads', COALESCE(v_total_leads,0), 'newLeads', COALESCE(v_new_leads,0), 'leadsNotAttended', COALESCE(v_leads_not_attended,0),
    'agendaViaFunil', COALESCE(v_agenda_funil, false)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_commercial_leads_impl(p_clinic_id uuid, p_entry_from date, p_entry_to date, p_conv_from date, p_conv_to date, p_agent text DEFAULT 'todos'::text, p_origin text DEFAULT 'todos'::text, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0, p_channel text DEFAULT 'todos'::text, p_metric text DEFAULT 'todos'::text, p_agenda_from date DEFAULT NULL::date, p_agenda_to date DEFAULT NULL::date, p_sort text DEFAULT 'entrada'::text, p_sort_dir text DEFAULT 'desc'::text, p_outcome text DEFAULT 'ambos'::text, p_loss_reasons text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_total int;
  v_rows jsonb;
  v_metric_count int;
  -- Mesma leitura que get_commercial_dashboard_impl faz: sem isto a lista le appointments
  -- numa clinica que nao usa appointments, e o drill-down do card abre vazio.
  v_agenda_funil boolean;
  v_agendado_stage_id uuid;
  v_ganho_stage_id uuid;
BEGIN
  SELECT COALESCE((features->>'agenda_via_funil')::boolean, false) INTO v_agenda_funil
    FROM clinics WHERE id = p_clinic_id;
  IF v_agenda_funil THEN
    SELECT id INTO v_agendado_stage_id FROM funnel_stages WHERE clinic_id = p_clinic_id AND slug = 'agendado' LIMIT 1;
    SELECT id INTO v_ganho_stage_id    FROM funnel_stages WHERE clinic_id = p_clinic_id AND slug = 'ganho'    LIMIT 1;
  END IF;
  WITH base AS (
    SELECT l.id, l.name, l.phone, l.source, l.estimated_value,
           l.created_at, l.last_message_at, l.ai_enabled, l.stage_id,
           ap.status AS appt_status, ap.date AS appt_date
    FROM leads l
    LEFT JOIN LATERAL (
      -- Consulta mais recente do lead dentro das janelas ativas (badge + ordenação)
      SELECT a.status, a.date
      FROM appointments a JOIN tickets t2 ON t2.id = a.ticket_id
      WHERE t2.lead_id = l.id AND a.clinic_id = p_clinic_id
        AND (p_conv_from   IS NULL OR a.date >= p_conv_from)
        AND (p_conv_to     IS NULL OR a.date <= p_conv_to)
        AND (p_agenda_from IS NULL OR a.created_at::date >= p_agenda_from)
        AND (p_agenda_to   IS NULL OR a.created_at::date <= p_agenda_to)
        AND (p_agent = 'todos' OR (p_agent = 'ia' AND a.source = 'ia') OR (p_agent = 'humano' AND a.source = 'manual'))
      ORDER BY a.date DESC
      LIMIT 1
    ) ap ON true
    WHERE l.clinic_id = p_clinic_id
      AND (p_entry_from IS NULL OR l.created_at::date >= p_entry_from)
      AND (p_entry_to   IS NULL OR l.created_at::date <= p_entry_to)
      AND COALESCE(l.is_not_lead, false) = false
      AND (p_origin = 'todos'
        OR public.fn_lead_origin_bucket(l.source) = ANY(string_to_array(p_origin, ',')))
      AND (p_channel = 'todos' OR l.capture_channel = ANY(string_to_array(p_channel, ',')))
      -- Agente: mesma régua canônica de get_commercial_dashboard (lead como um
      -- todo, via vw_lead_agent_class) — era EXISTS em chat_messages dentro da
      -- janela Agendado, que divergia da régua do dashboard e da lista mesmo
      -- depois do card "Gerados" já estar corrigido (achado ao validar 22/07).
      AND (p_agent = 'todos' OR public.fn_lead_matches_agent(l.id, p_clinic_id, p_agent))
      -- Toggle Ganho/Perdido/Ambos — eixo Conversão (outcome_at). Seletor de
      -- motivo (só ativo com p_outcome='perdido') recorta ainda mais.
      AND (p_outcome = 'ambos' OR EXISTS (
        SELECT 1 FROM tickets t3
        WHERE t3.lead_id = l.id AND t3.clinic_id = p_clinic_id AND t3.outcome = p_outcome
          AND (p_conv_from IS NULL OR (COALESCE(t3.outcome_at, t3.closed_at) at time zone 'America/Sao_Paulo')::date >= p_conv_from)
          AND (p_conv_to   IS NULL OR (COALESCE(t3.outcome_at, t3.closed_at) at time zone 'America/Sao_Paulo')::date <= p_conv_to)
          AND (p_loss_reasons IS NULL OR btrim(p_loss_reasons) = '' OR p_outcome <> 'perdido'
            OR COALESCE(NULLIF(t3.loss_reason, ''), '(sem motivo registrado)') = ANY(string_to_array(p_loss_reasons, ',')))
      ))
      -- Recorte por métrica de agendamento OU por perdido (drill-down das métricas do topo)
      AND (
        p_metric = 'todos'
        OR (p_metric = 'perdidos' AND EXISTS (
          SELECT 1 FROM tickets t4
          WHERE t4.lead_id = l.id AND t4.clinic_id = p_clinic_id AND t4.outcome = 'perdido'
            AND (p_conv_from IS NULL OR (COALESCE(t4.outcome_at, t4.closed_at) at time zone 'America/Sao_Paulo')::date >= p_conv_from)
            AND (p_conv_to   IS NULL OR (COALESCE(t4.outcome_at, t4.closed_at) at time zone 'America/Sao_Paulo')::date <= p_conv_to)
            AND (p_loss_reasons IS NULL OR btrim(p_loss_reasons) = ''
              OR COALESCE(NULLIF(t4.loss_reason, ''), '(sem motivo registrado)') = ANY(string_to_array(p_loss_reasons, ',')))
        ))
        OR (p_metric IN ('gerados', 'realizadas', 'marcados') AND NOT v_agenda_funil AND EXISTS (
          SELECT 1 FROM appointments a
          JOIN tickets t ON t.id = a.ticket_id
          WHERE t.lead_id = l.id AND a.clinic_id = p_clinic_id
            AND (p_conv_from   IS NULL OR a.date >= p_conv_from)
            AND (p_conv_to     IS NULL OR a.date <= p_conv_to)
            AND (p_agenda_from IS NULL OR a.created_at::date >= p_agenda_from)
            AND (p_agenda_to   IS NULL OR a.created_at::date <= p_agenda_to)
            -- Agente já filtrado pela CTE base (fn_lead_matches_agent acima) —
            -- não repete aqui.
            AND (p_metric = 'gerados'
              OR (p_metric = 'realizadas' AND a.status IN ('realizado','compareceu'))
              OR (p_metric = 'marcados'   AND a.status IN ('pendente','confirmado')))
        ))
        OR (p_metric IN ('gerados', 'realizadas') AND v_agenda_funil AND EXISTS (
          SELECT 1 FROM lead_stage_history h
          WHERE h.lead_id = l.id AND h.clinic_id = p_clinic_id AND h.ticket_id IS NOT NULL
            AND h.new_stage_id = (CASE WHEN p_metric = 'realizadas' THEN v_ganho_stage_id ELSE v_agendado_stage_id END)
            AND (CASE WHEN p_metric = 'realizadas'
                      THEN (p_conv_from   IS NULL OR h.changed_at >= p_conv_from::timestamp)
                       AND (p_conv_to     IS NULL OR h.changed_at <  (p_conv_to + 1)::timestamp)
                      ELSE (p_agenda_from IS NULL OR h.changed_at >= p_agenda_from::timestamp)
                       AND (p_agenda_to   IS NULL OR h.changed_at <  (p_agenda_to + 1)::timestamp) END)
        ))
      )
  ),
  ranked AS (
    SELECT b.*, COUNT(*) OVER() AS total_count,
      ROW_NUMBER() OVER (ORDER BY
        CASE WHEN p_sort = 'entrada'    AND p_sort_dir = 'asc'  THEN b.created_at      END ASC  NULLS LAST,
        CASE WHEN p_sort = 'entrada'    AND p_sort_dir = 'desc' THEN b.created_at      END DESC NULLS LAST,
        CASE WHEN p_sort = 'ultima_msg' AND p_sort_dir = 'asc'  THEN b.last_message_at END ASC  NULLS LAST,
        CASE WHEN p_sort = 'ultima_msg' AND p_sort_dir = 'desc' THEN b.last_message_at END DESC NULLS LAST,
        CASE WHEN p_sort = 'consulta'   AND p_sort_dir = 'asc'  THEN b.appt_date       END ASC  NULLS LAST,
        CASE WHEN p_sort = 'consulta'   AND p_sort_dir = 'desc' THEN b.appt_date       END DESC NULLS LAST,
        CASE WHEN p_sort = 'valor'      AND p_sort_dir = 'asc'  THEN b.estimated_value END ASC  NULLS LAST,
        CASE WHEN p_sort = 'valor'      AND p_sort_dir = 'desc' THEN b.estimated_value END DESC NULLS LAST,
        CASE WHEN p_sort = 'nome'       AND p_sort_dir = 'asc'  THEN lower(b.name)      END ASC  NULLS LAST,
        CASE WHEN p_sort = 'nome'       AND p_sort_dir = 'desc' THEN lower(b.name)      END DESC NULLS LAST,
        b.created_at DESC NULLS LAST
      ) AS rn
    FROM base b
  ),
  page AS (
    SELECT * FROM ranked ORDER BY rn LIMIT p_limit OFFSET p_offset
  )
  SELECT
    COALESCE(MAX(p.total_count), 0),
    COALESCE(jsonb_agg(jsonb_build_object(
      'id', p.id,
      'name', p.name,
      'phone', p.phone,
      'source', p.source,
      'estimatedValue', p.estimated_value,
      'createdAt', p.created_at,
      'lastMessageAt', p.last_message_at,
      'aiEnabled', p.ai_enabled,
      'stageName', fs.name,
      'stageColor', fs.color,
      'isConversion', fs.is_conversion,
      'outcome', tk.outcome,
      'apptStatus', p.appt_status,
      'apptDate', p.appt_date
    ) ORDER BY p.rn), '[]'::jsonb)
  INTO v_total, v_rows
  FROM page p
  LEFT JOIN funnel_stages fs ON fs.id = p.stage_id
  LEFT JOIN LATERAL (
    SELECT t.outcome FROM tickets t
    WHERE t.lead_id = p.id
    ORDER BY COALESCE(t.outcome_at, t.closed_at, t.created_at) DESC
    LIMIT 1
  ) tk ON true;

  -- Total por trás do recorte (reconcilia com o card clicado no dashboard).
  IF p_metric = 'todos' THEN
    v_metric_count := 0;
  ELSIF p_metric = 'perdidos' THEN
    -- COUNT(*), nao COUNT(DISTINCT lead): este numero fica ao lado da lista e tem que bater
    -- com o CARD clicado, que conta atendimento/consulta. A tela mostra os dois: "143 leads
    -- . 145 perdidos". Voltar para DISTINCT faz o card e a lista discordarem de novo.
    SELECT COUNT(*) INTO v_metric_count
    FROM leads l
    JOIN tickets t4 ON t4.lead_id = l.id AND t4.clinic_id = p_clinic_id AND t4.outcome = 'perdido'
    WHERE l.clinic_id = p_clinic_id
      AND (p_entry_from IS NULL OR l.created_at::date >= p_entry_from)
      AND (p_entry_to   IS NULL OR l.created_at::date <= p_entry_to)
      AND COALESCE(l.is_not_lead, false) = false
      AND (p_origin = 'todos'
        OR public.fn_lead_origin_bucket(l.source) = ANY(string_to_array(p_origin, ',')))
      AND (p_channel = 'todos' OR l.capture_channel = ANY(string_to_array(p_channel, ',')))
      AND (p_agent = 'todos' OR public.fn_lead_matches_agent(l.id, p_clinic_id, p_agent))
      AND (p_conv_from IS NULL OR (COALESCE(t4.outcome_at, t4.closed_at) at time zone 'America/Sao_Paulo')::date >= p_conv_from)
      AND (p_conv_to   IS NULL OR (COALESCE(t4.outcome_at, t4.closed_at) at time zone 'America/Sao_Paulo')::date <= p_conv_to)
      AND (p_loss_reasons IS NULL OR btrim(p_loss_reasons) = ''
        OR COALESCE(NULLIF(t4.loss_reason, ''), '(sem motivo registrado)') = ANY(string_to_array(p_loss_reasons, ',')));
  ELSIF NOT (v_agenda_funil AND p_metric IN ('gerados', 'realizadas')) THEN
    -- ⚠️ A guarda nao e enfeite: clinica que agenda pelo funil e resolvida no bloco de
    -- ETAPA logo abaixo. Sem ela, esta consulta de 3 tabelas roda no caminho quente da
    -- lista e o resultado e sobrescrito na linha seguinte.
    -- COUNT(*), nao COUNT(DISTINCT lead): este numero fica ao lado da lista e tem que bater
    -- com o CARD clicado, que conta atendimento/consulta. A tela mostra os dois: "143 leads
    -- . 145 perdidos". Voltar para DISTINCT faz o card e a lista discordarem de novo.
    SELECT COUNT(*) INTO v_metric_count
    FROM leads l
    JOIN tickets t ON t.lead_id = l.id
    JOIN appointments a ON a.ticket_id = t.id AND a.clinic_id = p_clinic_id
    WHERE l.clinic_id = p_clinic_id
      AND (p_entry_from IS NULL OR l.created_at::date >= p_entry_from)
      AND (p_entry_to   IS NULL OR l.created_at::date <= p_entry_to)
      AND COALESCE(l.is_not_lead, false) = false
      AND (p_origin = 'todos'
        OR public.fn_lead_origin_bucket(l.source) = ANY(string_to_array(p_origin, ',')))
      AND (p_channel = 'todos' OR l.capture_channel = ANY(string_to_array(p_channel, ',')))
      AND (p_agent = 'todos' OR public.fn_lead_matches_agent(l.id, p_clinic_id, p_agent))
      AND (p_conv_from   IS NULL OR a.date >= p_conv_from)
      AND (p_conv_to     IS NULL OR a.date <= p_conv_to)
      AND (p_agenda_from IS NULL OR a.created_at::date >= p_agenda_from)
      AND (p_agenda_to   IS NULL OR a.created_at::date <= p_agenda_to)
      AND (p_metric = 'gerados'
        OR (p_metric = 'realizadas' AND a.status IN ('realizado','compareceu'))
        OR (p_metric = 'marcados'   AND a.status IN ('pendente','confirmado')));
  END IF;

  -- Espelha o bloco IF v_agenda_funil de get_commercial_dashboard_impl, INCLUSIVE o filtro de
  -- agente: desde 06/08/2026 o card dessas clinicas tambem chama fn_lead_matches_agent, entao
  -- os dois usam a mesma regua e o rodape volta a bater com a lista.
  IF v_agenda_funil AND p_metric IN ('gerados', 'realizadas') THEN
    SELECT COUNT(DISTINCT h.ticket_id) INTO v_metric_count
    FROM lead_stage_history h JOIN leads l ON l.id = h.lead_id
    WHERE h.clinic_id = p_clinic_id
      AND h.new_stage_id = (CASE WHEN p_metric = 'realizadas' THEN v_ganho_stage_id ELSE v_agendado_stage_id END)
      AND (CASE WHEN p_metric = 'realizadas'
                THEN (p_conv_from   IS NULL OR h.changed_at >= p_conv_from::timestamp)
                 AND (p_conv_to     IS NULL OR h.changed_at <  (p_conv_to + 1)::timestamp)
                ELSE (p_agenda_from IS NULL OR h.changed_at >= p_agenda_from::timestamp)
                 AND (p_agenda_to   IS NULL OR h.changed_at <  (p_agenda_to + 1)::timestamp) END)
      AND (p_entry_from IS NULL OR l.created_at >= p_entry_from::timestamp)
      AND (p_entry_to   IS NULL OR l.created_at <  (p_entry_to + 1)::timestamp)
      AND COALESCE(l.is_not_lead, false) = false
      AND (p_agent = 'todos' OR public.fn_lead_matches_agent(l.id, p_clinic_id, p_agent))
      AND (p_origin = 'todos'
        OR public.fn_lead_origin_bucket(l.source) = ANY(string_to_array(p_origin, ',')))
      AND (p_channel = 'todos' OR l.capture_channel = ANY(string_to_array(p_channel, ',')));
  END IF;

  RETURN jsonb_build_object('total', COALESCE(v_total, 0), 'rows', COALESCE(v_rows, '[]'::jsonb), 'metricCount', COALESCE(v_metric_count, 0));
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_dashboard_stats_impl(p_clinic_id uuid, p_date_from date, p_date_to date, p_origin text DEFAULT 'todos'::text, p_channel text DEFAULT 'todos'::text, p_agent text DEFAULT 'todos'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_total_appointments int;
  v_total_revenue numeric;
  v_pending_revenue numeric;
  v_total_conversions_value numeric;
  v_total_leads int;
  v_new_patients int;
  v_total_sales int;
  v_total_investment numeric;
  v_total_sla_breaches int;
  v_avg_response_time numeric;
  v_avg_sales_cycle numeric;
  v_chart_data jsonb;
  -- ⚠️ SAO DUAS JANELAS, e nao e redundancia: as colunas de data deste banco NAO sao do mesmo
  -- tipo (CLAUDE.md secao 3). Usar a janela errada nao da erro, devolve zero linha, que na tela
  -- se parece com "a clinica nao vendeu nada".
  --   v_ini/v_fim     -> timestamp SEM tz (ja em SP): leads, patients, chat_messages, sla_breaches
  --   v_tzini/v_tzfim -> timestamptz: conversions.converted_at, tickets.outcome_at/closed_at
  -- O corte do timestamptz e ancorado em America/Sao_Paulo, igual as views canonicas v_kpi_*.
  -- <col>::date cru usaria o TimeZone da sessao (UTC no PostgREST) e daria outro dia (06/08/2026).
  -- Voltar para UTC aqui desloca 3h e faz o painel discordar da view canonica, em silencio.
  v_ini   timestamp   := p_date_from::timestamp;
  v_fim   timestamp   := (p_date_to + 1)::timestamp;
  v_tzini timestamptz := ((p_date_from::timestamp) at time zone 'America/Sao_Paulo');
  v_tzfim timestamptz := (((p_date_to + 1)::timestamp) at time zone 'America/Sao_Paulo');
BEGIN
  -- AGENDADOS: união agendamento∪etapa (v_kpi_scheduled), por data de virou-agendado.
  SELECT COUNT(*) INTO v_total_appointments
  FROM v_kpi_scheduled sc
  JOIN leads l ON l.id = sc.lead_id
  WHERE sc.clinic_id = p_clinic_id AND sc.day BETWEEN p_date_from AND p_date_to
    AND COALESCE(l.is_not_lead, false) = false
    AND (p_origin = 'todos'
      OR public.fn_lead_origin_bucket(l.source) = ANY(string_to_array(p_origin, ',')))
    AND (p_channel = 'todos' OR l.capture_channel = ANY(string_to_array(p_channel, ',')))
    AND (p_agent = 'todos' OR EXISTS (SELECT 1 FROM public.vw_lead_agent_class v WHERE v.lead_id = l.id AND v.clinic_id = p_clinic_id AND v.agent = p_agent));

  -- (mantido p/ compat/rollback) Recebido em caixa = financeiro pago.
  v_total_revenue := 0; -- financeiro desabilitado

  SELECT COALESCE((SELECT default_ticket_value FROM ai_config WHERE clinic_id = p_clinic_id LIMIT 1), 0)
       * (SELECT COUNT(*) FROM appointments a
          LEFT JOIN tickets t ON t.id = a.ticket_id
          LEFT JOIN leads l ON l.id = t.lead_id
          WHERE a.clinic_id = p_clinic_id AND a.date BETWEEN p_date_from AND p_date_to
            AND a.status IN ('pendente','confirmado','compareceu')
            AND COALESCE(l.is_not_lead, false) = false
            AND (p_origin = 'todos'
              OR public.fn_lead_origin_bucket(l.source) = ANY(string_to_array(p_origin, ',')))
    AND (p_channel = 'todos' OR l.capture_channel = ANY(string_to_array(p_channel, ',')))
    AND (p_agent = 'todos' OR EXISTS (SELECT 1 FROM public.vw_lead_agent_class v WHERE v.lead_id = l.id AND v.clinic_id = p_clinic_id AND v.agent = p_agent)))
    INTO v_pending_revenue;

  -- VENDAS LANÇADAS (faturamento canônico): conversions EXCLUINDO 'Orçamento Enviado'.
  SELECT COALESCE(SUM(c.value::numeric), 0) INTO v_total_conversions_value
  FROM conversions c LEFT JOIN leads l ON l.id = c.lead_id
  WHERE c.clinic_id = p_clinic_id AND c.converted_at >= v_tzini AND c.converted_at < v_tzfim
    AND c.description IS DISTINCT FROM 'Orçamento Enviado'
    AND COALESCE(l.is_not_lead, false) = false
    AND (p_origin = 'todos'
      OR public.fn_lead_origin_bucket(l.source) = ANY(string_to_array(p_origin, ',')))
    AND (p_channel = 'todos' OR l.capture_channel = ANY(string_to_array(p_channel, ',')))
    AND (p_agent = 'todos' OR EXISTS (SELECT 1 FROM public.vw_lead_agent_class v WHERE v.lead_id = l.id AND v.clinic_id = p_clinic_id AND v.agent = p_agent));

  SELECT COUNT(*) INTO v_total_leads FROM leads l
  WHERE l.clinic_id = p_clinic_id AND l.created_at >= v_ini AND l.created_at < v_fim
    AND COALESCE(l.is_not_lead, false) = false
    AND (p_origin = 'todos'
      OR public.fn_lead_origin_bucket(l.source) = ANY(string_to_array(p_origin, ',')))
    AND (p_channel = 'todos' OR l.capture_channel = ANY(string_to_array(p_channel, ',')))
    AND (p_agent = 'todos' OR EXISTS (SELECT 1 FROM public.vw_lead_agent_class v WHERE v.lead_id = l.id AND v.clinic_id = p_clinic_id AND v.agent = p_agent));

  -- COUNT(DISTINCT pt.id): o LEFT JOIN com leads emite uma linha por lead, e paciente
  -- alcancado por dois leads apareceria duas vezes no card.
  SELECT COUNT(DISTINCT pt.id) INTO v_new_patients
  FROM patients pt
  LEFT JOIN leads l ON l.converted_patient_id = pt.id AND l.clinic_id = pt.clinic_id
  WHERE pt.clinic_id = p_clinic_id AND pt.created_at >= v_ini AND pt.created_at < v_fim
    AND COALESCE(l.is_not_lead, false) = false
    AND (p_origin = 'todos'
      OR public.fn_lead_origin_bucket(l.source) = ANY(string_to_array(p_origin, ',')))
    AND (p_channel = 'todos' OR l.capture_channel = ANY(string_to_array(p_channel, ',')))
    AND (p_agent = 'todos' OR EXISTS (SELECT 1 FROM public.vw_lead_agent_class v WHERE v.lead_id = l.id AND v.clinic_id = p_clinic_id AND v.agent = p_agent));

  SELECT COUNT(*) INTO v_total_sales FROM tickets t
  JOIN leads l ON l.id = t.lead_id
  WHERE t.clinic_id = p_clinic_id AND t.outcome = 'ganho'
    AND COALESCE(t.outcome_at, t.closed_at) >= v_tzini AND COALESCE(t.outcome_at, t.closed_at) < v_tzfim
    AND COALESCE(l.is_not_lead, false) = false
    AND (p_origin = 'todos'
      OR public.fn_lead_origin_bucket(l.source) = ANY(string_to_array(p_origin, ',')))
    AND (p_channel = 'todos' OR l.capture_channel = ANY(string_to_array(p_channel, ',')))
    AND (p_agent = 'todos' OR EXISTS (SELECT 1 FROM public.vw_lead_agent_class v WHERE v.lead_id = l.id AND v.clinic_id = p_clinic_id AND v.agent = p_agent));

  -- INVESTIMENTO: só é atribuível sem filtro de canal/agente (gasto é por plataforma).
  -- Com canal ou agente ativo → NULL (o front exibe "—"). Lê a view mestra v_kpi_investment.
  IF p_channel = 'todos' AND p_agent = 'todos' THEN
    SELECT COALESCE(SUM(investment), 0) INTO v_total_investment FROM v_kpi_investment
    WHERE clinic_id = p_clinic_id AND day BETWEEN p_date_from AND p_date_to
      AND (p_origin = 'todos' OR origin = ANY(string_to_array(p_origin, ',')));
  ELSE
    v_total_investment := NULL;
  END IF;

  SELECT COUNT(*) INTO v_total_sla_breaches FROM sla_breaches sb
  LEFT JOIN leads l ON l.id = sb.lead_id
  WHERE sb.clinic_id = p_clinic_id
    AND sb.breached_at >= v_ini AND sb.breached_at < v_fim
    AND NOT (sb.sender = 'ai' AND sb.wait_raw_min > 60)
    AND COALESCE(l.is_not_lead, false) = false
    AND (p_origin = 'todos'
      OR public.fn_lead_origin_bucket(l.source) = ANY(string_to_array(p_origin, ',')))
    AND (p_channel = 'todos' OR l.capture_channel = ANY(string_to_array(p_channel, ',')))
    AND (p_agent = 'todos' OR EXISTS (SELECT 1 FROM public.vw_lead_agent_class v WHERE v.lead_id = l.id AND v.clinic_id = p_clinic_id AND v.agent = p_agent));

  SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (t.outcome_at - l.created_at)) / 86400.0), 0)
    INTO v_avg_sales_cycle
  FROM tickets t JOIN leads l ON l.id = t.lead_id
  WHERE t.clinic_id = p_clinic_id AND t.outcome = 'ganho'
    AND t.outcome_at >= v_tzini AND t.outcome_at < v_tzfim
    AND COALESCE(l.is_not_lead, false) = false
    AND (p_origin = 'todos'
      OR public.fn_lead_origin_bucket(l.source) = ANY(string_to_array(p_origin, ',')))
    AND (p_channel = 'todos' OR l.capture_channel = ANY(string_to_array(p_channel, ',')))
    AND (p_agent = 'todos' OR EXISTS (SELECT 1 FROM public.vw_lead_agent_class v WHERE v.lead_id = l.id AND v.clinic_id = p_clinic_id AND v.agent = p_agent));

  -- ⚠️ Este e o bloco que derrubava o painel: sem a janela sargavel ele varria TODA a conversa
  -- da clinica (61.175 mensagens no Metaltres) para calcular a media do mes (2.465). O indice
  -- que o sustenta e idx_chat_messages_clinic_created (clinic_id, created_at).
  WITH stream AS (
    SELECT cm.lead_id, cm.created_at, cm.seq, cm.sender,
      CASE WHEN cm.direction = 'inbound' THEN 'in'
           WHEN cm.direction = 'outbound' AND cm.sender <> 'system' THEN 'out'
           ELSE NULL END AS kind
    FROM chat_messages cm
    LEFT JOIN leads l ON l.id = cm.lead_id
    WHERE cm.clinic_id = p_clinic_id
      AND cm.created_at >= v_ini AND cm.created_at < v_fim
      AND COALESCE(l.is_not_lead, false) = false
      AND (p_origin = 'todos'
        OR public.fn_lead_origin_bucket(l.source) = ANY(string_to_array(p_origin, ',')))
    AND (p_channel = 'todos' OR l.capture_channel = ANY(string_to_array(p_channel, ',')))
    AND (p_agent = 'todos' OR EXISTS (SELECT 1 FROM public.vw_lead_agent_class v WHERE v.lead_id = l.id AND v.clinic_id = p_clinic_id AND v.agent = p_agent))
  ),
  lagged AS (
    SELECT lead_id, created_at, seq, sender, kind,
      LAG(kind)       OVER (PARTITION BY lead_id ORDER BY created_at, seq) AS prev_kind,
      LAG(created_at) OVER (PARTITION BY lead_id ORDER BY created_at, seq) AS prev_at
    FROM stream WHERE kind IS NOT NULL
  ),
  cyc AS (
    SELECT lead_id, prev_at AS in_at, seq AS out_seq,
      GREATEST(0, EXTRACT(EPOCH FROM (created_at - prev_at)) / 60.0) AS raw_min
    FROM lagged
    WHERE kind = 'out' AND prev_kind = 'in'
      AND NOT (sender = 'ai' AND EXTRACT(EPOCH FROM (created_at - prev_at)) / 60.0 > 60)
  ),
  firsts AS (SELECT DISTINCT ON (lead_id) lead_id, raw_min FROM cyc ORDER BY lead_id, in_at, out_seq)
  SELECT COALESCE((SELECT AVG(raw_min) FROM firsts), 0) INTO v_avg_response_time;

  WITH dates AS (SELECT generate_series(p_date_from, p_date_to, interval '1 day')::date AS d),
  apts AS (SELECT sc.day AS date, COUNT(*) as qty FROM v_kpi_scheduled sc
    JOIN leads l ON l.id = sc.lead_id
    WHERE sc.clinic_id = p_clinic_id AND sc.day BETWEEN p_date_from AND p_date_to
      AND COALESCE(l.is_not_lead, false) = false
      AND (p_origin = 'todos'
        OR public.fn_lead_origin_bucket(l.source) = ANY(string_to_array(p_origin, ',')))
    AND (p_channel = 'todos' OR l.capture_channel = ANY(string_to_array(p_channel, ',')))
    AND (p_agent = 'todos' OR EXISTS (SELECT 1 FROM public.vw_lead_agent_class v WHERE v.lead_id = l.id AND v.clinic_id = p_clinic_id AND v.agent = p_agent))
    GROUP BY sc.day),
  revenue AS (SELECT (c.converted_at at time zone 'America/Sao_Paulo')::date AS date, SUM(c.value::numeric) as total FROM conversions c
    LEFT JOIN leads l ON l.id = c.lead_id
    WHERE c.clinic_id = p_clinic_id AND c.description IS DISTINCT FROM 'Orçamento Enviado'
      AND c.converted_at >= v_tzini AND c.converted_at < v_tzfim
      AND COALESCE(l.is_not_lead, false) = false
      AND (p_origin = 'todos'
        OR public.fn_lead_origin_bucket(l.source) = ANY(string_to_array(p_origin, ',')))
    AND (p_channel = 'todos' OR l.capture_channel = ANY(string_to_array(p_channel, ',')))
    AND (p_agent = 'todos' OR EXISTS (SELECT 1 FROM public.vw_lead_agent_class v WHERE v.lead_id = l.id AND v.clinic_id = p_clinic_id AND v.agent = p_agent))
    GROUP BY (c.converted_at at time zone 'America/Sao_Paulo')::date),
  leads_d AS (SELECT l.created_at::date AS date, COUNT(*) as qty FROM leads l
    WHERE l.clinic_id = p_clinic_id AND l.created_at >= v_ini AND l.created_at < v_fim
      AND COALESCE(l.is_not_lead, false) = false
      AND (p_origin = 'todos'
        OR public.fn_lead_origin_bucket(l.source) = ANY(string_to_array(p_origin, ',')))
    AND (p_channel = 'todos' OR l.capture_channel = ANY(string_to_array(p_channel, ',')))
    AND (p_agent = 'todos' OR EXISTS (SELECT 1 FROM public.vw_lead_agent_class v WHERE v.lead_id = l.id AND v.clinic_id = p_clinic_id AND v.agent = p_agent))
    GROUP BY l.created_at::date),
  sales_d AS (SELECT (COALESCE(t.outcome_at, t.closed_at) at time zone 'America/Sao_Paulo')::date AS date, COUNT(*) as qty
    FROM tickets t JOIN leads l ON l.id = t.lead_id
    WHERE t.clinic_id = p_clinic_id AND t.outcome = 'ganho'
      AND COALESCE(t.outcome_at, t.closed_at) >= v_tzini AND COALESCE(t.outcome_at, t.closed_at) < v_tzfim
      AND COALESCE(l.is_not_lead, false) = false
      AND (p_origin = 'todos'
        OR public.fn_lead_origin_bucket(l.source) = ANY(string_to_array(p_origin, ',')))
    AND (p_channel = 'todos' OR l.capture_channel = ANY(string_to_array(p_channel, ',')))
    AND (p_agent = 'todos' OR EXISTS (SELECT 1 FROM public.vw_lead_agent_class v WHERE v.lead_id = l.id AND v.clinic_id = p_clinic_id AND v.agent = p_agent))
    GROUP BY (COALESCE(t.outcome_at, t.closed_at) at time zone 'America/Sao_Paulo')::date),
  invest_d AS (SELECT day AS date, SUM(investment) as total FROM v_kpi_investment
    WHERE clinic_id = p_clinic_id AND day BETWEEN p_date_from AND p_date_to
      AND p_channel = 'todos' AND p_agent = 'todos'
      AND (p_origin = 'todos' OR origin = ANY(string_to_array(p_origin, ',')))
    GROUP BY day)
  SELECT jsonb_agg(
    jsonb_build_object('date', to_char(d, 'YYYY-MM-DD'),
      'agendamentos', COALESCE(a.qty, 0), 'faturamento', COALESCE(r.total, 0),
      'leads', COALESCE(l.qty, 0), 'vendas', COALESCE(s.qty, 0),
      'investimento', COALESCE(i.total, 0)) ORDER BY d)
  INTO v_chart_data
  FROM dates LEFT JOIN apts a ON a.date = dates.d
  LEFT JOIN revenue r ON r.date = dates.d LEFT JOIN leads_d l ON l.date = dates.d
  LEFT JOIN sales_d s ON s.date = dates.d LEFT JOIN invest_d i ON i.date = dates.d;

  RETURN jsonb_build_object(
    'totalAppointments', v_total_appointments, 'totalRevenue', v_total_revenue,
    'salesValue', v_total_conversions_value,
    'pendingRevenue', v_pending_revenue, 'totalConversionsValue', v_total_conversions_value,
    'totalLeads', v_total_leads, 'newPatients', v_new_patients,
    'totalSales', v_total_sales, 'totalInvestment', v_total_investment,
    'totalSlaBreaches', v_total_sla_breaches, 'avgResponseTime', v_avg_response_time,
    'avgSalesCycle', v_avg_sales_cycle,
    'defaultTicket', COALESCE((SELECT default_ticket_value FROM ai_config WHERE clinic_id = p_clinic_id LIMIT 1), 0),
    'chartData', COALESCE(v_chart_data, '[]'::jsonb)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_org_clinics_metrics(p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'clinicId', m.id,
    'clinicName', m.name,
    'logoUrl', m.logo_url,
    'isActive', COALESCE(m.is_active, true),
    'category', m.category,
    'leads', m.leads,
    'patientsCaptured', m.patients_captured,
    'sales', m.sales,
    'lost', m.lost,
    'revenue', m.revenue,
    'investment', m.investment,
    'ticketMedio', m.ticket_medio
  ) ORDER BY m.name), '[]'::jsonb)
  FROM (
    SELECT c.id, c.name, c.logo_url, c.is_active, c.category,
      ld.qty AS leads,
      GREATEST(COALESCE(ap.qty, 0), COALESCE(fn.qty, 0)) AS patients_captured,
      sl.ganhos AS sales, sl.perdidos AS lost,
      rv.total AS revenue, iv.total AS investment,
      ac.default_ticket_value AS ticket_medio
    FROM clinics c
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS qty FROM leads l
      WHERE l.clinic_id = c.id
        AND (p_date_from IS NULL OR l.created_at::date >= p_date_from)
        AND (p_date_to IS NULL OR l.created_at::date <= p_date_to)
        AND COALESCE(l.is_not_lead, false) = false
    ) ld ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS qty
      FROM appointments a
      LEFT JOIN tickets t ON t.id = a.ticket_id
      LEFT JOIN leads l ON l.id = t.lead_id
      WHERE a.clinic_id = c.id
        AND (p_date_from IS NULL OR a.date >= p_date_from)
        AND (p_date_to IS NULL OR a.date <= p_date_to)
        AND COALESCE(l.is_not_lead, false) = false
    ) ap ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS qty FROM (
        SELECT h.ticket_id, max(h.changed_at) AS last_entry
        FROM lead_stage_history h
        JOIN leads l ON l.id = h.lead_id
        JOIN funnel_stages fs ON fs.id = h.new_stage_id AND fs.clinic_id = c.id AND fs.slug = 'agendado'
        WHERE h.clinic_id = c.id
          AND h.ticket_id IS NOT NULL
          AND COALESCE(l.is_not_lead, false) = false
        GROUP BY h.ticket_id
      ) x
      WHERE (p_date_from IS NULL OR x.last_entry::date >= p_date_from)
        AND (p_date_to IS NULL OR x.last_entry::date <= p_date_to)
    ) fn ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*) FILTER (WHERE t.outcome = 'ganho') AS ganhos,
             COUNT(*) FILTER (WHERE t.outcome = 'perdido') AS perdidos
      FROM tickets t
      JOIN leads l ON l.id = t.lead_id
      WHERE t.clinic_id = c.id
        AND t.outcome IN ('ganho', 'perdido')
        AND (p_date_from IS NULL OR (COALESCE(t.outcome_at, t.closed_at) at time zone 'America/Sao_Paulo')::date >= p_date_from)
        AND (p_date_to IS NULL OR (COALESCE(t.outcome_at, t.closed_at) at time zone 'America/Sao_Paulo')::date <= p_date_to)
        AND COALESCE(l.is_not_lead, false) = false
    ) sl ON true
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(cv.value::numeric), 0) AS total
      FROM conversions cv
      LEFT JOIN leads l ON l.id = cv.lead_id
      WHERE cv.clinic_id = c.id
        AND cv.description IS DISTINCT FROM 'Orçamento Enviado'
        AND (p_date_from IS NULL OR (cv.converted_at at time zone 'America/Sao_Paulo')::date >= p_date_from)
        AND (p_date_to IS NULL OR (cv.converted_at at time zone 'America/Sao_Paulo')::date <= p_date_to)
        AND (l.id IS NULL OR COALESCE(l.is_not_lead, false) = false)
    ) rv ON true
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(md.investment), 0) AS total
      FROM marketing_data md
      WHERE md.clinic_id = c.id
        AND (p_date_from IS NULL OR md.date >= p_date_from)
        AND (p_date_to IS NULL OR md.date <= p_date_to)
    ) iv ON true
    LEFT JOIN LATERAL (
      SELECT default_ticket_value FROM ai_config WHERE clinic_id = c.id LIMIT 1
    ) ac ON true
    WHERE is_super_admin()
       OR EXISTS (
         SELECT 1 FROM org_users ou
         WHERE ou.organization_id = c.organization_id AND ou.user_id = auth.uid()
       )
  ) m;
$function$;

CREATE OR REPLACE FUNCTION public.marketing_campaign_investment_impl(p_clinic_id uuid, p_start date, p_end date)
 RETURNS TABLE(campaign_name text, adset_name text, ad_name text, platform text, investment numeric, leads bigint, wins bigint, losses bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with spend as (
    select
      case when b.platform = 'meta_ads' then 'meta_ads' else 'google_ads' end as platform,
      lower(regexp_replace(b.campaign_name, '[^[:alnum:]]+', '', 'g')) as k_campaign,
      lower(regexp_replace(coalesce(nullif(b.adset_name, ''), ''), '[^[:alnum:]]+', '', 'g')) as k_adset,
      lower(regexp_replace(coalesce(nullif(b.ad_name, ''), ''), '[^[:alnum:]]+', '', 'g')) as k_ad,
      max(b.campaign_name) as campaign_name,
      max(nullif(b.adset_name, '')) as adset_name,
      max(nullif(b.ad_name, '')) as ad_name,
      sum(b.investment) as investment
    from public.marketing_spend_breakdown b
    where b.clinic_id = p_clinic_id
      and b.date between p_start and p_end
      and b.campaign_name <> ''
    group by 1, 2, 3, 4
  ),
  -- Mapas ID -> chave canônica (do lado do GASTO, que é a fonte de verdade do nome).
  -- Escopo: a clínica inteira, não só o período — o lead pode ter entrado antes da janela.
  kc as (
    select b.campaign_id as id, min(lower(regexp_replace(b.campaign_name, '[^[:alnum:]]+', '', 'g'))) as k
    from public.marketing_spend_breakdown b
    where b.clinic_id = p_clinic_id and nullif(b.campaign_id, '') is not null and b.campaign_name <> ''
    group by 1
  ),
  ks as (
    select b.adset_id as id, min(lower(regexp_replace(b.adset_name, '[^[:alnum:]]+', '', 'g'))) as k
    from public.marketing_spend_breakdown b
    where b.clinic_id = p_clinic_id and nullif(b.adset_id, '') is not null and coalesce(b.adset_name,'') <> ''
    group by 1
  ),
  ka as (
    select b.ad_id as id, min(lower(regexp_replace(b.ad_name, '[^[:alnum:]]+', '', 'g'))) as k
    from public.marketing_spend_breakdown b
    where b.clinic_id = p_clinic_id and nullif(b.ad_id, '') is not null and coalesce(b.ad_name,'') <> ''
    group by 1
  ),
  leads_agg as (
    select
      case when l.source = 'meta_ads' then 'meta_ads' when l.source = 'google_ads' then 'google_ads' else null end as platform,
      -- ID manda quando existir e for conhecido no gasto; senão, nome normalizado (como antes).
      coalesce(kc.k, lower(regexp_replace(coalesce(nullif(l.fb_campaign_name, ''), nullif(l.g_campaign_name, '')), '[^[:alnum:]]+', '', 'g'))) as k_campaign,
      coalesce(ks.k, lower(regexp_replace(coalesce(nullif(l.fb_adset_name, ''), nullif(l.g_adset_name, ''), ''), '[^[:alnum:]]+', '', 'g'))) as k_adset,
      coalesce(ka.k, lower(regexp_replace(coalesce(nullif(l.fb_ad_name, ''), nullif(l.g_ad_name, ''), ''), '[^[:alnum:]]+', '', 'g'))) as k_ad,
      max(coalesce(nullif(l.fb_campaign_name, ''), nullif(l.g_campaign_name, ''))) as campaign_name,
      max(coalesce(nullif(l.fb_adset_name, ''), nullif(l.g_adset_name, ''))) as adset_name,
      max(coalesce(nullif(l.fb_ad_name, ''), nullif(l.g_ad_name, ''))) as ad_name,
      count(*) as leads,
      count(*) filter (where t.outcome = 'ganho') as wins,
      count(*) filter (where t.outcome = 'perdido') as losses
    from public.leads l
    left join public.tickets t on t.lead_id = l.id
    left join kc on kc.id = coalesce(nullif(l.fb_campaign_id, ''), nullif(l.g_campaign_id, ''))
    left join ks on ks.id = coalesce(nullif(l.fb_adset_id, ''),    nullif(l.g_adset_id, ''))
    left join ka on ka.id = coalesce(nullif(l.fb_ad_id, ''),       nullif(l.g_ad_id, ''))
    where l.clinic_id = p_clinic_id
      and l.created_at >= p_start::timestamp and l.created_at < (p_end + 1)::timestamp
      and coalesce(l.is_not_lead, false) = false
      and coalesce(nullif(l.fb_campaign_name, ''), nullif(l.g_campaign_name, '')) is not null
      and l.source in ('meta_ads', 'google_ads')
    group by 1, 2, 3, 4
  ),
  joined as (
    select
      coalesce(s.platform, la.platform) as platform,
      coalesce(s.k_campaign, la.k_campaign) as k_campaign,
      coalesce(s.k_adset, la.k_adset) as k_adset,
      coalesce(s.k_ad, la.k_ad) as k_ad,
      coalesce(s.campaign_name, la.campaign_name) as campaign_name,
      coalesce(s.adset_name, la.adset_name) as adset_name,
      coalesce(s.ad_name, la.ad_name) as ad_name,
      s.investment,
      coalesce(la.leads, 0) as leads,
      coalesce(la.wins, 0) as wins,
      coalesce(la.losses, 0) as losses
    from spend s
    full outer join leads_agg la
      on la.platform = s.platform
     and la.k_campaign = s.k_campaign
     and la.k_adset is not distinct from s.k_adset
     and la.k_ad is not distinct from s.k_ad
  )
  select
    first_value(campaign_name) over (
      partition by platform, k_campaign
      order by (investment is not null) desc, campaign_name
    ) as campaign_name,
    first_value(adset_name) over (
      partition by platform, k_campaign, k_adset
      order by (investment is not null) desc, adset_name
    ) as adset_name,
    first_value(ad_name) over (
      partition by platform, k_campaign, k_adset, k_ad
      order by (investment is not null) desc, ad_name
    ) as ad_name,
    platform,
    investment,
    leads,
    wins,
    losses
  from joined
  order by investment desc nulls last;
$function$;

CREATE OR REPLACE FUNCTION public.marketing_loss_reasons_impl(p_clinic_id uuid, p_start date, p_end date)
 RETURNS TABLE(campaign_name text, platform text, loss_reason text, losses bigint, campaign_investment numeric, campaign_leads bigint, campaign_losses bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with campaign_spend as (
    select
      case when b.platform = 'meta_ads' then 'meta_ads' else 'google_ads' end as platform,
      b.campaign_name,
      sum(b.investment) as investment
    from public.marketing_spend_breakdown b
    where b.clinic_id = p_clinic_id
      and b.date between p_start and p_end
      and b.campaign_name <> ''
    group by 1, 2
  ),
  campaign_totals as (
    select
      case when l.source = 'meta_ads' then 'meta_ads' when l.source = 'google_ads' then 'google_ads' else null end as platform,
      coalesce(nullif(l.fb_campaign_name, ''), nullif(l.g_campaign_name, '')) as campaign_name,
      count(*) as leads,
      count(*) filter (where t.outcome = 'perdido') as losses
    from public.leads l
    left join public.tickets t on t.lead_id = l.id
    where l.clinic_id = p_clinic_id
      and l.created_at >= p_start::timestamp and l.created_at < (p_end + 1)::timestamp
      and coalesce(l.is_not_lead, false) = false
      and coalesce(nullif(l.fb_campaign_name, ''), nullif(l.g_campaign_name, '')) is not null
      and l.source in ('meta_ads', 'google_ads')
    group by 1, 2
  ),
  loss_reasons as (
    select
      case when l.source = 'meta_ads' then 'meta_ads' when l.source = 'google_ads' then 'google_ads' else null end as platform,
      coalesce(nullif(l.fb_campaign_name, ''), nullif(l.g_campaign_name, '')) as campaign_name,
      coalesce(nullif(t.loss_reason, ''), '(sem motivo registrado)') as loss_reason,
      count(*) as losses
    from public.leads l
    join public.tickets t on t.lead_id = l.id
    where l.clinic_id = p_clinic_id
      and l.created_at >= p_start::timestamp and l.created_at < (p_end + 1)::timestamp
      and coalesce(l.is_not_lead, false) = false
      and coalesce(nullif(l.fb_campaign_name, ''), nullif(l.g_campaign_name, '')) is not null
      and l.source in ('meta_ads', 'google_ads')
      and t.outcome = 'perdido'
    group by 1, 2, 3
  )
  select
    r.campaign_name,
    r.platform,
    r.loss_reason,
    r.losses,
    cs.investment as campaign_investment,
    coalesce(ct.leads, 0) as campaign_leads,
    coalesce(ct.losses, 0) as campaign_losses
  from loss_reasons r
  left join campaign_spend cs on cs.campaign_name = r.campaign_name and cs.platform = r.platform
  left join campaign_totals ct on ct.campaign_name = r.campaign_name and ct.platform = r.platform
  order by r.losses desc;
$function$;

CREATE OR REPLACE FUNCTION public.simulate_production_eta(p_clinic_id uuid, p_lines jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      SELECT ii.* INTO v_item FROM public.inventory_items ii JOIN public.products p ON p.id = ii.product_id
        WHERE ii.clinic_id = p_clinic_id AND p.base_product_id = v_prod AND p.altura = v_altln
          AND p.is_active AND ii.kind = 'produto_acabado' AND ii.is_active LIMIT 1;
      IF FOUND THEN
        v_found := true; v_base := v_prod; v_altura := v_altln; v_taxa := v_item.taxa_producao_m2_hora; v_setup := COALESCE(v_item.tempo_setup_horas, 0);
        v_label := v_item.name;
        SELECT COALESCE(SUM(qty), 0) INTO v_reserv FROM public.stock_reservations WHERE item_id = v_item.id AND status = 'ativa';
        v_disp := v_item.current_qty - v_reserv;
      ELSE
        v_found := true; v_base := v_prod; v_altura := v_altln; v_disp := 0;
        SELECT ii.taxa_producao_m2_hora, COALESCE(ii.tempo_setup_horas, 0) INTO v_taxa, v_setup
          FROM public.inventory_items ii JOIN public.products p ON p.id = ii.product_id
          WHERE p.base_product_id = v_prod AND ii.is_active AND ii.taxa_producao_m2_hora IS NOT NULL
          ORDER BY ii.taxa_producao_m2_hora LIMIT 1;
        v_label := v_baseprod.name || ' — ' || replace(rtrim(rtrim(v_altln::text, '0'), '.'), '.', ',') || 'm (sob medida)';
      END IF;
    ELSE
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
      'data_sugerida', ((now() at time zone 'America/Sao_Paulo')::date + v_dias_total),
      'sem_estimativa', v_any_sem
    )
  );
END;
$function$;

-- O grant vem por DOIS caminhos e revogar um so nao fecha nada (CLAUDE.md secao 1). As _impl e o
-- helper nunca sao chamados pelo PostgREST: quem carrega o assert_clinic_access e o wrapper. As
-- demais funcoes nao aparecem aqui de proposito: create or replace preserva o ACL da migration
-- que as criou, e mexer nisso as escondidas e como o vazamento de 17h aconteceu.
revoke all on function public.fn_lead_origin_bucket(text) from public, anon, authenticated;
revoke all on function public.get_commercial_dashboard_impl(uuid,date,date,date,date,text,text,text,date,date,text,text) from public, anon, authenticated;
revoke all on function public.get_commercial_leads_impl(uuid,date,date,date,date,text,text,integer,integer,text,text,date,date,text,text,text,text) from public, anon, authenticated;
revoke all on function public.get_dashboard_stats_impl(uuid,date,date,text,text,text) from public, anon, authenticated;
revoke all on function public.marketing_campaign_investment_impl(uuid,date,date) from public, anon, authenticated;
revoke all on function public.marketing_loss_reasons_impl(uuid,date,date) from public, anon, authenticated;
