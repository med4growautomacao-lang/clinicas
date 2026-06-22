-- Painel Comercial — lead AGENDADO nunca cai em "Não atendidos".
--
-- Refina a atribuição: quando o lead teve agendamento mas NÃO há resposta de saída até a criação dele
-- (ex.: agendamento manual sem conversa prévia), atribui pela ORIGEM do agendamento:
--   appointments.source = 'ia'  -> IA
--   appointments.source <> 'ia' -> Humano  (manual)
-- Quem teve conversa segue pela MAIORIA de mensagens até a marcação. "Não atendidos" passa a ser só
-- quem entrou, NÃO agendou e ninguém respondeu.
--
-- Implementação: o bloco passa a partir da COORTE de leads (entrada+origem) com LEFT JOIN em mensagens
-- e no primeiro agendamento (DISTINCT ON p/ pegar created_at + source), garantindo 1 linha por lead.
DO $do$
DECLARE src text;
BEGIN
  src := pg_get_functiondef('public.get_commercial_dashboard(uuid,date,date,date,date,text,text)'::regprocedure);

  src := replace(src,
$old$  WITH appt_cut AS (
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
  )
  SELECT
    COUNT(*) FILTER (WHERE (ai_out + human_out) > 0 AND ai_out >= human_out),
    COUNT(*) FILTER (WHERE human_out > ai_out)
  INTO v_ia_leads_touched, v_human_leads_touched
  FROM per_lead;$old$,
$new$  WITH appt_cut AS (
    SELECT DISTINCT ON (t.lead_id) t.lead_id, ap.created_at AS cutoff, ap.source AS appt_source
    FROM appointments ap JOIN tickets t ON t.id = ap.ticket_id
    WHERE ap.clinic_id = p_clinic_id
    ORDER BY t.lead_id, ap.created_at
  ),
  cohort AS (
    SELECT l.id AS lead_id
    FROM leads l
    WHERE l.clinic_id = p_clinic_id
      AND (p_entry_from IS NULL OR l.created_at::date >= p_entry_from)
      AND (p_entry_to   IS NULL OR l.created_at::date <= p_entry_to)
      AND (p_origin = 'todos'
        OR (p_origin = 'meta' AND l.source = 'meta_ads')
        OR (p_origin = 'google' AND l.source = 'google_ads')
        OR (p_origin = 'sem_origem' AND (l.source IS NULL OR l.source NOT IN ('meta_ads', 'google_ads'))))
  ),
  per_lead AS (
    SELECT c.lead_id, ac.cutoff, ac.appt_source,
      COUNT(cm.id) FILTER (WHERE cm.sender = 'ai') AS ai_out,
      COUNT(cm.id) FILTER (WHERE cm.sender = 'human' AND cm.direction = 'outbound') AS human_out
    FROM cohort c
    LEFT JOIN appt_cut ac ON ac.lead_id = c.lead_id
    LEFT JOIN chat_messages cm ON cm.lead_id = c.lead_id
      AND cm.clinic_id = p_clinic_id
      AND (p_conv_from IS NULL OR cm.created_at::date >= p_conv_from)
      AND (p_conv_to   IS NULL OR cm.created_at::date <= p_conv_to)
      AND (ac.cutoff IS NULL OR cm.created_at <= ac.cutoff)
    GROUP BY c.lead_id, ac.cutoff, ac.appt_source
  )
  SELECT
    COUNT(*) FILTER (WHERE CASE WHEN (ai_out + human_out) > 0 THEN ai_out >= human_out
                               WHEN appt_source IS NOT NULL THEN appt_source = 'ia'
                               ELSE false END),
    COUNT(*) FILTER (WHERE CASE WHEN (ai_out + human_out) > 0 THEN human_out > ai_out
                               WHEN appt_source IS NOT NULL THEN appt_source <> 'ia'
                               ELSE false END)
  INTO v_ia_leads_touched, v_human_leads_touched
  FROM per_lead;$new$);

  EXECUTE src;
END $do$;
