-- 3º calendário "Agenda" (data da consulta = appointments.date) no painel Comercial.
-- Separa a ótica de REALIZAÇÃO (a.date) da de GERAÇÃO (a.created_at, que fica no
-- calendário de Conversão). get_commercial_dashboard ganha p_appt_from/to (default
-- NULL = sem filtro). Roteamento:
--   - byStatus, consultas realizadas, faturamento real (a.date/ap.date) -> Agenda
--   - v_appt_total ("agendados na agenda", a.date) -> Agenda (soma do byStatus fecha)
--   - v_appt_generated (Geradas, a.created_at) -> permanece em Conversão
--   - ft.date (receita-fallback), investimento, ganhos, mensagens, etc. -> Conversão (inalterados)
-- Clínicas com agenda via funil (h.changed_at) ficam fora desta leva.
DO $do$
DECLARE src text;
BEGIN
  src := pg_get_functiondef('public.get_commercial_dashboard(uuid,date,date,date,date,text,text,text)'::regprocedure);

  src := replace(src, $x$p_channel text DEFAULT 'todos'::text)$x$, $x$p_channel text DEFAULT 'todos'::text, p_appt_from date DEFAULT NULL, p_appt_to date DEFAULT NULL)$x$);

  src := replace(src, 'a.date >= p_conv_from',  'a.date >= p_appt_from');
  src := replace(src, 'a.date <= p_conv_to',    'a.date <= p_appt_to');
  src := replace(src, 'ap.date >= p_conv_from', 'ap.date >= p_appt_from');
  src := replace(src, 'ap.date <= p_conv_to',   'ap.date <= p_appt_to');

  src := regexp_replace(src,
    $re$(INTO v_appt_ia, v_appt_manual, v_appt_total[\s\S]*?)a\.created_at::date >= p_conv_from([\s\S]*?)a\.created_at::date <= p_conv_to$re$,
    $rp$\1a.date >= p_appt_from\2a.date <= p_appt_to$rp$);

  EXECUTE src;
END $do$;

DROP FUNCTION IF EXISTS public.get_commercial_dashboard(uuid,date,date,date,date,text,text,text);
