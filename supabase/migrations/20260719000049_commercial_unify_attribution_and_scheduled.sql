-- Fase 4 da unificação: get_commercial_dashboard passa a usar as MESMAS fontes
-- canônicas da Visão Geral (fecha as duas últimas divergências VG × Comercial).
--   (a) agents.leadsTouched: cálculo inline (maioria de mensagens, varria
--       chat_messages ao vivo) -> vw_lead_agent_class (precompute lead_kpi_attribution).
--       Bônus: elimina o scan caro de chat_messages por chamada.
--   (b) appointments.generated: appointments.created_at -> v_kpi_scheduled (união
--       consulta∪etapa, 1×/ticket), com filtro de agente por atribuição canônica.
-- Validado (Vaz, julho): VG leads_ia 49 = Comercial ia.leadsTouched 49; humano 16=16;
-- generated 23 = VG totalAppointments 23. Método seguro: replace ancorado + asserts.
-- (Aplicada em produção via MCP como 'commercial_unify_attribution_and_scheduled'.)
DO $mig$
DECLARE v_def text; v_new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public' AND p.proname='get_commercial_dashboard';
  v_new := v_def;

  -- (a) leadsTouched: substitui todo o statement WITH appt_cut/cohort/per_lead ... SELECT INTO
  v_new := regexp_replace(v_new,
    $p1$WITH appt_cut AS \([\s\S]*?FROM per_lead;$p1$,
$r1$WITH cohort AS (
    SELECT l.id AS lead_id
    FROM leads l
    WHERE l.clinic_id = p_clinic_id
      AND (p_entry_from IS NULL OR l.created_at::date >= p_entry_from)
      AND (p_entry_to   IS NULL OR l.created_at::date <= p_entry_to)
      AND COALESCE(l.is_not_lead, false) = false
      AND (p_origin = 'todos'
        OR (CASE WHEN l.source = 'meta_ads' THEN 'meta' WHEN l.source = 'google_ads' THEN 'google' WHEN l.source = 'balcao' THEN 'balcao' ELSE 'sem_origem' END) = ANY(string_to_array(p_origin, ','))) AND (p_channel = 'todos' OR l.capture_channel = ANY(string_to_array(p_channel, ',')))
  )
  -- Atribuicao IA x Humano: regua canonica precomputada (vw_lead_agent_class ->
  -- lead_kpi_attribution), MESMA fonte da Visao Geral. Antes era inline por maioria
  -- de mensagens (varria chat_messages ao vivo e divergia da VG).
  SELECT
    COUNT(*) FILTER (WHERE v.agent = 'ia'),
    COUNT(*) FILTER (WHERE v.agent = 'humano')
  INTO v_ia_leads_touched, v_human_leads_touched
  FROM cohort c
  LEFT JOIN public.vw_lead_agent_class v ON v.lead_id = c.lead_id AND v.clinic_id = p_clinic_id;$r1$);

  -- (b) appointments.generated: appointments.created_at -> v_kpi_scheduled (uniao)
  v_new := regexp_replace(v_new,
    $p2$SELECT COUNT\(\*\) INTO v_appt_generated[\s\S]*?p_channel, ','\)\)\);$p2$,
$r2$SELECT COUNT(*) INTO v_appt_generated
  FROM v_kpi_scheduled sc
  JOIN leads l ON l.id = sc.lead_id
  WHERE sc.clinic_id = p_clinic_id
    AND (p_conv_from IS NULL OR sc.day >= p_conv_from)
    AND (p_conv_to   IS NULL OR sc.day <= p_conv_to)
    AND (p_entry_from IS NULL OR l.created_at::date >= p_entry_from)
    AND (p_entry_to   IS NULL OR l.created_at::date <= p_entry_to)
    AND COALESCE(l.is_not_lead, false) = false
    AND (p_agent = 'todos' OR EXISTS (SELECT 1 FROM public.vw_lead_agent_class v WHERE v.lead_id = l.id AND v.clinic_id = p_clinic_id AND v.agent = p_agent))
    AND (p_origin = 'todos' OR (CASE WHEN l.source = 'meta_ads' THEN 'meta' WHEN l.source = 'google_ads' THEN 'google' WHEN l.source = 'balcao' THEN 'balcao' ELSE 'sem_origem' END) = ANY(string_to_array(p_origin, ',')))
    AND (p_channel = 'todos' OR l.capture_channel = ANY(string_to_array(p_channel, ',')));$r2$);

  IF v_new = v_def THEN RAISE EXCEPTION 'nenhuma substituicao aplicada'; END IF;
  IF position('LEFT JOIN public.vw_lead_agent_class v ON v.lead_id = c.lead_id' in v_new) = 0 THEN RAISE EXCEPTION 'leadsTouched nao unificado'; END IF;
  IF position('per_lead AS (' in v_new) > 0 THEN RAISE EXCEPTION 'per_lead ainda presente'; END IF;
  IF position('FROM v_kpi_scheduled sc' in v_new) = 0 THEN RAISE EXCEPTION 'generated nao unificado'; END IF;
  IF position('INTO v_appt_generated' in v_new) = 0 THEN RAISE EXCEPTION 'v_appt_generated sumiu'; END IF;

  EXECUTE v_new;
END $mig$;
