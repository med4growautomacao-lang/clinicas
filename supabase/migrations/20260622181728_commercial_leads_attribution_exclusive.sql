-- 20260622181728_commercial_leads_attribution_exclusive
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

DO $do$
DECLARE src text;
BEGIN
  src := pg_get_functiondef('public.get_commercial_dashboard(uuid,date,date,date,date,text,text)'::regprocedure);

  src := replace(src,
$d_old$  v_total_leads int; v_new_leads int;$d_old$,
$d_new$  v_total_leads int; v_new_leads int; v_leads_not_attended int;$d_new$);

  src := replace(src,
$lt_old$  SELECT
    COUNT(DISTINCT cm.lead_id) FILTER (WHERE cm.sender = 'ai'),
    COUNT(DISTINCT cm.lead_id) FILTER (WHERE cm.sender = 'human' AND cm.direction = 'outbound')
  INTO v_ia_leads_touched, v_human_leads_touched
  FROM chat_messages cm JOIN leads l ON l.id = cm.lead_id
  WHERE cm.clinic_id = p_clinic_id
    AND (p_conv_from IS NULL OR cm.created_at::date >= p_conv_from)
    AND (p_conv_to   IS NULL OR cm.created_at::date <= p_conv_to)
    AND (p_entry_from IS NULL OR l.created_at::date >= p_entry_from)
    AND (p_entry_to   IS NULL OR l.created_at::date <= p_entry_to)
    AND (p_origin = 'todos'
      OR (p_origin = 'meta' AND l.source = 'meta_ads')
      OR (p_origin = 'google' AND l.source = 'google_ads')
      OR (p_origin = 'sem_origem' AND (l.source IS NULL OR l.source NOT IN ('meta_ads', 'google_ads'))));$lt_old$,
$lt_new$  WITH per_lead AS (
    SELECT cm.lead_id,
      bool_or(cm.sender = 'ai') AS got_ia,
      bool_or(cm.sender = 'human' AND cm.direction = 'outbound') AS got_human
    FROM chat_messages cm JOIN leads l ON l.id = cm.lead_id
    WHERE cm.clinic_id = p_clinic_id
      AND (p_conv_from IS NULL OR cm.created_at::date >= p_conv_from)
      AND (p_conv_to   IS NULL OR cm.created_at::date <= p_conv_to)
      AND (p_entry_from IS NULL OR l.created_at::date >= p_entry_from)
      AND (p_entry_to   IS NULL OR l.created_at::date <= p_entry_to)
      AND (p_origin = 'todos'
        OR (p_origin = 'meta' AND l.source = 'meta_ads')
        OR (p_origin = 'google' AND l.source = 'google_ads')
        OR (p_origin = 'sem_origem' AND (l.source IS NULL OR l.source NOT IN ('meta_ads', 'google_ads'))))
    GROUP BY cm.lead_id
  )
  SELECT
    COUNT(*) FILTER (WHERE got_ia),
    COUNT(*) FILTER (WHERE got_human AND NOT got_ia)
  INTO v_ia_leads_touched, v_human_leads_touched
  FROM per_lead;

  v_leads_not_attended := GREATEST(COALESCE(v_new_leads,0) - COALESCE(v_ia_leads_touched,0) - COALESCE(v_human_leads_touched,0), 0);$lt_new$);

  src := replace(src,
$r_old$'newLeads', COALESCE(v_new_leads,0),$r_old$,
$r_new$'newLeads', COALESCE(v_new_leads,0), 'leadsNotAttended', COALESCE(v_leads_not_attended,0),$r_new$);

  EXECUTE src;
END $do$;
