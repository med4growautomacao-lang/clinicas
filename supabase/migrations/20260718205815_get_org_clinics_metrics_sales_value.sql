-- 20260718205815_get_org_clinics_metrics_sales_value
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Aba Métricas da Gestão Organizacional (espelha a VG): faturamento passa de financeiro
-- (financial_transactions pago) p/ VENDAS LANÇADAS (conversions sem 'Orçamento Enviado'),
-- pra não divergir da Visão Geral já unificada. Chave 'revenue' mantida (front não muda).
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
        AND (p_date_from IS NULL OR COALESCE(t.outcome_at, t.closed_at)::date >= p_date_from)
        AND (p_date_to IS NULL OR COALESCE(t.outcome_at, t.closed_at)::date <= p_date_to)
        AND COALESCE(l.is_not_lead, false) = false
    ) sl ON true
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(cv.value::numeric), 0) AS total
      FROM conversions cv
      LEFT JOIN leads l ON l.id = cv.lead_id
      WHERE cv.clinic_id = c.id
        AND cv.description IS DISTINCT FROM 'Orçamento Enviado'
        AND (p_date_from IS NULL OR cv.converted_at::date >= p_date_from)
        AND (p_date_to IS NULL OR cv.converted_at::date <= p_date_to)
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
