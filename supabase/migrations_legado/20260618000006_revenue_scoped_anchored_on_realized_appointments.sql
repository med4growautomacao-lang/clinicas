-- Faturamento Real (revenueScoped) = receita das CONSULTAS REALIZADAS no recorte.
-- Antes, o cálculo partia de financial_transactions (com fallback ft.date e lead via
-- converted_patient_id), o que (a) contava venda avulsa sem consulta (ex.: ganho sem
-- appointment, como a Maria) e (b) podia usar um lead diferente do ticket da consulta.
-- Resultado: divergia de "Consultas Realizadas" (ex.: 1 consulta porém R$1.200).
--
-- Agora ancora nas MESMAS consultas que "Consultas Realizadas": parte de appointments
-- (status realizado/compareceu), soma a receita ligada (financial_transactions.appointment_id,
-- receita/pago), e usa o MESMO lead (ticket->lead) para origem/coorte. Janela de Conversão
-- pela data da consulta (ap.date). Assim faturamento real e consultas realizadas batem sempre.
DO $do$
DECLARE src text;
BEGIN
  src := pg_get_functiondef('public.get_commercial_dashboard(uuid,date,date,date,date,text,text)'::regprocedure);

  src := replace(src,
$old$  SELECT COALESCE(SUM(ft.amount), 0) INTO v_revenue_scoped
  FROM financial_transactions ft
  LEFT JOIN appointments ap ON ap.id = ft.appointment_id
  LEFT JOIN leads l ON l.converted_patient_id = ft.patient_id AND l.clinic_id = ft.clinic_id
  WHERE ft.clinic_id = p_clinic_id AND ft.type = 'receita' AND ft.status = 'pago'
    AND (p_conv_from IS NULL OR COALESCE(ap.date, ft.date) >= p_conv_from)
    AND (p_conv_to   IS NULL OR COALESCE(ap.date, ft.date) <= p_conv_to)
    AND ((p_entry_from IS NULL AND p_entry_to IS NULL)
      OR ((p_entry_from IS NULL OR l.created_at::date >= p_entry_from)
          AND (p_entry_to IS NULL OR l.created_at::date <= p_entry_to)))
    AND (p_agent = 'todos' OR (p_agent = 'ia' AND ap.source = 'ia') OR (p_agent = 'humano' AND ap.source = 'manual'))
    AND (p_origin = 'todos'
      OR (p_origin = 'meta' AND l.source = 'meta_ads')
      OR (p_origin = 'google' AND l.source = 'google_ads')
      OR (p_origin = 'sem_origem' AND (l.source IS NULL OR l.source NOT IN ('meta_ads', 'google_ads'))));$old$,
$new$  SELECT COALESCE(SUM(ft.amount), 0) INTO v_revenue_scoped
  FROM appointments ap
  JOIN financial_transactions ft ON ft.appointment_id = ap.id AND ft.type = 'receita' AND ft.status = 'pago'
  LEFT JOIN tickets t ON t.id = ap.ticket_id
  LEFT JOIN leads l ON l.id = t.lead_id
  WHERE ap.clinic_id = p_clinic_id AND ap.status IN ('realizado','compareceu')
    AND (p_conv_from IS NULL OR ap.date >= p_conv_from)
    AND (p_conv_to   IS NULL OR ap.date <= p_conv_to)
    AND (p_entry_from IS NULL OR l.created_at::date >= p_entry_from)
    AND (p_entry_to   IS NULL OR l.created_at::date <= p_entry_to)
    AND (p_agent = 'todos' OR (p_agent = 'ia' AND ap.source = 'ia') OR (p_agent = 'humano' AND ap.source = 'manual'))
    AND (p_origin = 'todos'
      OR (p_origin = 'meta' AND l.source = 'meta_ads')
      OR (p_origin = 'google' AND l.source = 'google_ads')
      OR (p_origin = 'sem_origem' AND (l.source IS NULL OR l.source NOT IN ('meta_ads', 'google_ads'))));$new$);

  EXECUTE src;
END $do$;
