-- Aba "Métricas" da Gestão Organizacional: visão agregada por clínica.
-- Uma linha por clínica da organização do usuário logado (super admin vê todas),
-- com contas alinhadas ao get_dashboard_stats: leads por created_at excluindo
-- is_not_lead; venda = ticket outcome='ganho' por COALESCE(outcome_at, closed_at);
-- faturamento = financial_transactions receita/pago por ft.date; agendamentos
-- por a.date; investimento = marketing_data.
CREATE OR REPLACE FUNCTION public.get_org_clinics_metrics(p_date_from date, p_date_to date)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'clinicId', m.id,
    'clinicName', m.name,
    'logoUrl', m.logo_url,
    'isActive', COALESCE(m.is_active, true),
    'category', m.category,
    'leads', m.leads,
    'appointments', m.appointments,
    'sales', m.sales,
    'lost', m.lost,
    'revenue', m.revenue,
    'investment', m.investment
  ) ORDER BY m.name), '[]'::jsonb)
  FROM (
    SELECT c.id, c.name, c.logo_url, c.is_active, c.category,
      ld.qty AS leads, ap.qty AS appointments, sl.ganhos AS sales, sl.perdidos AS lost,
      rv.total AS revenue, iv.total AS investment
    FROM clinics c
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS qty FROM leads l
      WHERE l.clinic_id = c.id
        AND l.created_at::date BETWEEN p_date_from AND p_date_to
        AND COALESCE(l.is_not_lead, false) = false
    ) ld ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS qty
      FROM appointments a
      LEFT JOIN tickets t ON t.id = a.ticket_id
      LEFT JOIN leads l ON l.id = t.lead_id
      WHERE a.clinic_id = c.id
        AND a.date BETWEEN p_date_from AND p_date_to
        AND COALESCE(l.is_not_lead, false) = false
    ) ap ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*) FILTER (WHERE t.outcome = 'ganho') AS ganhos,
             COUNT(*) FILTER (WHERE t.outcome = 'perdido') AS perdidos
      FROM tickets t
      JOIN leads l ON l.id = t.lead_id
      WHERE t.clinic_id = c.id
        AND t.outcome IN ('ganho', 'perdido')
        AND COALESCE(t.outcome_at, t.closed_at)::date BETWEEN p_date_from AND p_date_to
        AND COALESCE(l.is_not_lead, false) = false
    ) sl ON true
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(ft.amount), 0) AS total
      FROM financial_transactions ft
      LEFT JOIN leads l ON l.converted_patient_id = ft.patient_id AND l.clinic_id = ft.clinic_id
      WHERE ft.clinic_id = c.id AND ft.type = 'receita' AND ft.status = 'pago'
        AND ft.date BETWEEN p_date_from AND p_date_to
        AND COALESCE(l.is_not_lead, false) = false
    ) rv ON true
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(md.investment), 0) AS total
      FROM marketing_data md
      WHERE md.clinic_id = c.id AND md.date BETWEEN p_date_from AND p_date_to
    ) iv ON true
    WHERE is_super_admin()
       OR EXISTS (
         SELECT 1 FROM org_users ou
         WHERE ou.organization_id = c.organization_id AND ou.user_id = auth.uid()
       )
  ) m;
$$;
