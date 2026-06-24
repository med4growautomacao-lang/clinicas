-- Painel Comercial: TODAS as métricas de consulta passam a cruzar os 3 calendários
-- simultaneamente: created_at∈Agenda(p_conv) E date∈Conversão(p_appt) E lead∈Entrada(p_entry).
-- Também corrige bug herdado da migration 8: os guards de NULL de a.date/ap.date
-- checavam p_conv em vez de p_appt (Agenda=Todos desligava o filtro de Conversão).
--
-- Blocos afetados: byStatus, realizadas (v_attended_consults), total (v_appt_ia/manual/total),
-- faturamento real (v_revenue_scoped), e Geradas (v_appt_generated, que ganha Conversão+Entrada).
-- Consequência: Geradas (a.created_at) e total (a.date) ficam idênticos (mesmos 3 filtros).
DO $do$
DECLARE src text;
BEGIN
  src := pg_get_functiondef('public.get_commercial_dashboard(uuid,date,date,date,date,text,text,text,date,date)'::regprocedure);

  src := regexp_replace(src,
    $re$\(p_conv_from IS NULL OR a\.date >= p_appt_from\)\s+AND\s+\(p_conv_to\s+IS NULL OR a\.date <= p_appt_to\)$re$,
    $rp$(p_appt_from IS NULL OR a.date >= p_appt_from)
    AND (p_appt_to IS NULL OR a.date <= p_appt_to)
    AND (p_conv_from IS NULL OR a.created_at::date >= p_conv_from)
    AND (p_conv_to IS NULL OR a.created_at::date <= p_conv_to)$rp$, 'g');

  src := regexp_replace(src,
    $re$\(p_conv_from IS NULL OR ap\.date >= p_appt_from\)\s+AND\s+\(p_conv_to\s+IS NULL OR ap\.date <= p_appt_to\)$re$,
    $rp$(p_appt_from IS NULL OR ap.date >= p_appt_from)
    AND (p_appt_to IS NULL OR ap.date <= p_appt_to)
    AND (p_conv_from IS NULL OR ap.created_at::date >= p_conv_from)
    AND (p_conv_to IS NULL OR ap.created_at::date <= p_conv_to)$rp$, 'g');

  src := regexp_replace(src,
    $re$(INTO v_appt_generated[\s\S]*?AND \(p_conv_to\s+IS NULL OR a\.created_at::date <= p_conv_to\))$re$,
    $rp$\1
    AND (p_appt_from IS NULL OR a.date >= p_appt_from)
    AND (p_appt_to IS NULL OR a.date <= p_appt_to)
    AND (p_entry_from IS NULL OR l.created_at::date >= p_entry_from)
    AND (p_entry_to IS NULL OR l.created_at::date <= p_entry_to)$rp$);

  EXECUTE src;
END $do$;
