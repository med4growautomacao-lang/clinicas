-- Ajuste em finance.revenueScoped: a janela de Conversão deve usar a DATA DA CONSULTA
-- (appointment.date), não a data do pagamento (ft.date), para ficar consistente com
-- "Consultas Realizadas" (que conta por appointment.date). Sem isso, um pagamento lançado
-- em data diferente da consulta fazia divergir (ex.: 0 consultas no recorte, mas R$600 de
-- faturamento porque o pagamento caiu na janela). Receita sem consulta ligada cai em ft.date.
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
