-- 20260618062117_commercial_dashboard_revenue_scoped_by_appt_date
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- revenueScoped (Faturamento Real escopado) deve respeitar a janela de Conversão pela
-- DATA DA CONSULTA (appointment.date), não pela data do pagamento (ft.date) — assim fica
-- consistente com "Consultas Realizadas". Para receita sem consulta ligada, cai em ft.date.
DO $do$
DECLARE src text;
BEGIN
  src := pg_get_functiondef('public.get_commercial_dashboard(uuid,date,date,date,date,text,text)'::regprocedure);

  src := replace(src,
$a$  LEFT JOIN appointments ap ON ap.id = ft.appointment_id
  LEFT JOIN leads l ON l.converted_patient_id = ft.patient_id AND l.clinic_id = ft.clinic_id
  WHERE ft.clinic_id = p_clinic_id AND ft.type = 'receita' AND ft.status = 'pago'
    AND (p_conv_from IS NULL OR ft.date >= p_conv_from)
    AND (p_conv_to   IS NULL OR ft.date <= p_conv_to)$a$,
$a$  LEFT JOIN appointments ap ON ap.id = ft.appointment_id
  LEFT JOIN leads l ON l.converted_patient_id = ft.patient_id AND l.clinic_id = ft.clinic_id
  WHERE ft.clinic_id = p_clinic_id AND ft.type = 'receita' AND ft.status = 'pago'
    AND (p_conv_from IS NULL OR COALESCE(ap.date, ft.date) >= p_conv_from)
    AND (p_conv_to   IS NULL OR COALESCE(ap.date, ft.date) <= p_conv_to)$a$);

  EXECUTE src;
END $do$;
