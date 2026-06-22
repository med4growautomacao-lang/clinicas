-- Painel Comercial — atribuição IA/Humano conta mensagens só ATÉ a criação do agendamento.
--
-- Regra: para decidir quem atendeu (maioria de volume), se o lead teve agendamento, contam apenas
-- as mensagens enviadas até a CRIAÇÃO do primeiro agendamento (appointments.created_at, o momento da
-- marcação). Assim a atribuição reflete quem fez o trabalho que LEVOU ao agendamento — confirmações e
-- lembretes pós-marcação (geralmente da IA) não distorcem. Sem agendamento, conta a janela inteira.
--
-- Fuso OK: appointments.created_at e chat_messages.created_at são ambos 'timestamp without time zone'
-- (mesmo relógio), então a comparação é direta. Cutoff = MIN(ap.created_at) por lead (via ticket).
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
