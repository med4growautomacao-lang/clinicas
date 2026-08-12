-- 20260622183532_commercial_attribution_cutoff_at_booking
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

DO $do$
DECLARE src text;
BEGIN
  src := pg_get_functiondef('public.get_commercial_dashboard(uuid,date,date,date,date,text,text)'::regprocedure);

  src := replace(src,
$old$  WITH per_lead AS (
    SELECT cm.lead_id,
      COUNT(*) FILTER (WHERE cm.sender = 'ai') AS ai_out,
      COUNT(*) FILTER (WHERE cm.sender = 'human' AND cm.direction = 'outbound') AS human_out
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
  )$old$,
$new$  WITH appt_cut AS (
    SELECT t.lead_id, MIN(ap.created_at) AS cutoff
    FROM appointments ap JOIN tickets t ON t.id = ap.ticket_id
    WHERE ap.clinic_id = p_clinic_id
    GROUP BY t.lead_id
  ),
  per_lead AS (
    SELECT cm.lead_id,
      COUNT(*) FILTER (WHERE cm.sender = 'ai') AS ai_out,
      COUNT(*) FILTER (WHERE cm.sender = 'human' AND cm.direction = 'outbound') AS human_out
    FROM chat_messages cm JOIN leads l ON l.id = cm.lead_id
    LEFT JOIN appt_cut ac ON ac.lead_id = cm.lead_id
    WHERE cm.clinic_id = p_clinic_id
      AND (p_conv_from IS NULL OR cm.created_at::date >= p_conv_from)
      AND (p_conv_to   IS NULL OR cm.created_at::date <= p_conv_to)
      AND (p_entry_from IS NULL OR l.created_at::date >= p_entry_from)
      AND (p_entry_to   IS NULL OR l.created_at::date <= p_entry_to)
      AND (p_origin = 'todos'
        OR (p_origin = 'meta' AND l.source = 'meta_ads')
        OR (p_origin = 'google' AND l.source = 'google_ads')
        OR (p_origin = 'sem_origem' AND (l.source IS NULL OR l.source NOT IN ('meta_ads', 'google_ads'))))
      AND (ac.cutoff IS NULL OR cm.created_at <= ac.cutoff)
    GROUP BY cm.lead_id
  )$new$);

  EXECUTE src;
END $do$;
