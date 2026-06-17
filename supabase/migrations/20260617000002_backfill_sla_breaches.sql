-- Backfill único do histórico de estouros para sla_breaches: recomputa os ciclos de resposta
-- (inbound -> próxima resposta) por clínica, usando o ai_config (sla_minutes + business_hours)
-- de cada uma, e insere onde minutos úteis > meta. Mesma régua do trigger go-forward.
-- Em banco novo (sem chat_messages) não insere nada — seguro.
INSERT INTO public.sla_breaches
  (clinic_id, lead_id, ticket_id, inbound_at, breached_at, business_minutes, overshoot_min, wait_raw_min, sla_minutes, sender)
WITH cfg AS (
  SELECT clinic_id, sla_minutes,
    SPLIT_PART(business_hours->>'start',':',1)::int AS sh,
    COALESCE(NULLIF(SPLIT_PART(business_hours->>'start',':',2),''),'0')::int AS sm,
    SPLIT_PART(business_hours->>'end',':',1)::int AS eh,
    COALESCE(NULLIF(SPLIT_PART(business_hours->>'end',':',2),''),'0')::int AS em,
    (SELECT array_agg(d::int) FROM jsonb_array_elements_text(business_hours->'days') d) AS days
  FROM ai_config
  WHERE sla_minutes IS NOT NULL AND sla_minutes > 0 AND business_hours IS NOT NULL
    AND (business_hours ? 'start') AND (business_hours ? 'end') AND (business_hours ? 'days')
),
ordered AS (
  SELECT cm.clinic_id, cm.lead_id, cm.created_at, cm.sender, cm.direction,
    LAG(cm.direction)   OVER (PARTITION BY cm.lead_id ORDER BY cm.created_at) AS prev_dir,
    LAG(cm.created_at)  OVER (PARTITION BY cm.lead_id ORDER BY cm.created_at) AS prev_at
  FROM chat_messages cm
  JOIN cfg ON cfg.clinic_id = cm.clinic_id
  WHERE cm.lead_id IS NOT NULL
),
cyc AS (
  SELECT o.clinic_id, o.lead_id, o.prev_at AS inbound_at, o.created_at AS breached_at, o.sender,
    calc_business_minutes(o.prev_at, o.created_at, c.sh, c.sm, c.eh, c.em, c.days) AS biz,
    EXTRACT(EPOCH FROM (o.created_at - o.prev_at)) / 60.0 AS wait_raw,
    c.sla_minutes AS sla
  FROM ordered o JOIN cfg c ON c.clinic_id = o.clinic_id
  WHERE o.direction = 'outbound' AND o.prev_dir = 'inbound'
)
SELECT clinic_id, lead_id, NULL::uuid, inbound_at, breached_at, biz, biz - sla, wait_raw, sla, sender
FROM cyc
WHERE biz > sla;
