-- 20260624062452_commercial_dashboard_cross_3_calendars
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

DO $do$
DECLARE src text;
BEGIN
  src := pg_get_functiondef('public.get_commercial_dashboard(uuid,date,date,date,date,text,text,text,date,date)'::regprocedure);

  -- Blocos com a.date (byStatus, realizadas, total): corrige guard (p_conv->p_appt) e adiciona a.created_at∈Agenda(p_conv)
  src := regexp_replace(src,
    $re$\(p_conv_from IS NULL OR a\.date >= p_appt_from\)\s+AND\s+\(p_conv_to\s+IS NULL OR a\.date <= p_appt_to\)$re$,
    $rp$(p_appt_from IS NULL OR a.date >= p_appt_from)
    AND (p_appt_to IS NULL OR a.date <= p_appt_to)
    AND (p_conv_from IS NULL OR a.created_at::date >= p_conv_from)
    AND (p_conv_to IS NULL OR a.created_at::date <= p_conv_to)$rp$, 'g');

  -- Bloco ap.date (faturamento real): idem com ap.created_at
  src := regexp_replace(src,
    $re$\(p_conv_from IS NULL OR ap\.date >= p_appt_from\)\s+AND\s+\(p_conv_to\s+IS NULL OR ap\.date <= p_appt_to\)$re$,
    $rp$(p_appt_from IS NULL OR ap.date >= p_appt_from)
    AND (p_appt_to IS NULL OR ap.date <= p_appt_to)
    AND (p_conv_from IS NULL OR ap.created_at::date >= p_conv_from)
    AND (p_conv_to IS NULL OR ap.created_at::date <= p_conv_to)$rp$, 'g');

  -- Geradas (a.created_at∈Agenda): adiciona Conversão(a.date) e Entrada
  src := regexp_replace(src,
    $re$(INTO v_appt_generated[\s\S]*?AND \(p_conv_to\s+IS NULL OR a\.created_at::date <= p_conv_to\))$re$,
    $rp$\1
    AND (p_appt_from IS NULL OR a.date >= p_appt_from)
    AND (p_appt_to IS NULL OR a.date <= p_appt_to)
    AND (p_entry_from IS NULL OR l.created_at::date >= p_entry_from)
    AND (p_entry_to IS NULL OR l.created_at::date <= p_entry_to)$rp$);

  EXECUTE src;
END $do$;
