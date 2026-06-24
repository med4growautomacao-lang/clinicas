-- Nova métrica "Consultas Geradas" no painel Comercial: consultas CRIADAS
-- (appointments.created_at) dentro do range de CONVERSÃO, SEM o filtro de Entrada
-- (coorte). Respeita agente/origem/canal. Exposta em appointments.generated.
-- A métrica "Consultas (realizadas/previstas)" continua intacta.
DO $do$
DECLARE src text;
BEGIN
  src := pg_get_functiondef('public.get_commercial_dashboard(uuid,date,date,date,date,text,text,text)'::regprocedure);

  src := replace(src, 'v_appt_total int; v_appt_status jsonb;', 'v_appt_total int; v_appt_generated int; v_appt_status jsonb;');

  src := replace(src,
    $a$  SELECT COALESCE(jsonb_object_agg(status, cnt), '{}'::jsonb) INTO v_appt_status$a$,
    $a$  SELECT COUNT(*) INTO v_appt_generated
  FROM appointments a
  LEFT JOIN tickets t ON t.id = a.ticket_id
  LEFT JOIN leads l ON l.id = t.lead_id
  WHERE a.clinic_id = p_clinic_id
    AND (p_conv_from IS NULL OR a.created_at::date >= p_conv_from)
    AND (p_conv_to   IS NULL OR a.created_at::date <= p_conv_to)
    AND COALESCE(l.is_not_lead, false) = false
    AND (p_agent = 'todos' OR (p_agent = 'ia' AND a.source = 'ia') OR (p_agent = 'humano' AND a.source = 'manual'))
    AND (p_origin = 'todos' OR (CASE WHEN l.source = 'meta_ads' THEN 'meta' WHEN l.source = 'google_ads' THEN 'google' WHEN l.source = 'balcao' THEN 'balcao' ELSE 'sem_origem' END) = ANY(string_to_array(p_origin, ',')))
    AND (p_channel = 'todos' OR l.capture_channel = ANY(string_to_array(p_channel, ',')));

  SELECT COALESCE(jsonb_object_agg(status, cnt), '{}'::jsonb) INTO v_appt_status$a$);

  src := replace(src, $r$'byStatus', COALESCE(v_appt_status,'{}'::jsonb))$r$, $r$'byStatus', COALESCE(v_appt_status,'{}'::jsonb), 'generated', COALESCE(v_appt_generated,0))$r$);

  EXECUTE src;
END $do$;
