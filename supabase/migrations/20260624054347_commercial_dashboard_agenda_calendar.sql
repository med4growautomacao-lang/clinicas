-- 20260624054347_commercial_dashboard_agenda_calendar
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

DO $do$
DECLARE src text;
BEGIN
  src := pg_get_functiondef('public.get_commercial_dashboard(uuid,date,date,date,date,text,text,text)'::regprocedure);

  -- 1) assinatura: 3º calendário "Agenda" (a.date)
  src := replace(src, $x$p_channel text DEFAULT 'todos'::text)$x$, $x$p_channel text DEFAULT 'todos'::text, p_appt_from date DEFAULT NULL, p_appt_to date DEFAULT NULL)$x$);

  -- 2) realização (byStatus, realizadas, faturamento real) -> eixo Agenda
  src := replace(src, 'a.date >= p_conv_from',  'a.date >= p_appt_from');
  src := replace(src, 'a.date <= p_conv_to',    'a.date <= p_appt_to');
  src := replace(src, 'ap.date >= p_conv_from', 'ap.date >= p_appt_from');
  src := replace(src, 'ap.date <= p_conv_to',   'ap.date <= p_appt_to');

  -- 3) v_appt_total = "agendados na agenda" (a.date), pra fechar com byStatus.
  --    (apenas o bloco do INTO v_appt_ia/manual/total; v_appt_generated segue created_at∈conv)
  src := regexp_replace(src,
    $re$(INTO v_appt_ia, v_appt_manual, v_appt_total[\s\S]*?)a\.created_at::date >= p_conv_from([\s\S]*?)a\.created_at::date <= p_conv_to$re$,
    $rp$\1a.date >= p_appt_from\2a.date <= p_appt_to$rp$);

  EXECUTE src;
END $do$;

-- remove a sobrecarga antiga (8 args) pra evitar ambiguidade com a nova (10 args, defaults)
DROP FUNCTION IF EXISTS public.get_commercial_dashboard(uuid,date,date,date,date,text,text,text);
