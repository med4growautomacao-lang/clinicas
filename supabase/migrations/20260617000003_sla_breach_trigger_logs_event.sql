-- Aumenta o trigger de SLA: além de incrementar leads.sla_breach_count (mantido p/ o badge do
-- Kanban — decisão "Opção A"), grava um EVENTO em sla_breaches no momento do estouro, com
-- sender/overshoot/wait_raw — fonte única dos dashboards.
CREATE OR REPLACE FUNCTION public.fn_track_sla_breach()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sla_minutes  INTEGER;
  v_bh           JSONB;
  v_sh INTEGER; v_sm INTEGER;
  v_eh INTEGER; v_em INTEGER;
  v_days         INTEGER[];
  v_biz_mins     INTEGER;
  v_sender       TEXT;
  v_ticket       UUID;
BEGIN
  IF NEW.last_outbound_at IS NULL THEN RETURN NEW; END IF;
  IF OLD.last_outbound_at IS NOT DISTINCT FROM NEW.last_outbound_at THEN RETURN NEW; END IF;
  IF NEW.last_message_at IS NULL THEN RETURN NEW; END IF;
  IF NEW.last_outbound_at <= NEW.last_message_at THEN RETURN NEW; END IF;
  IF OLD.last_outbound_at IS NOT NULL AND OLD.last_outbound_at >= NEW.last_message_at THEN RETURN NEW; END IF;

  SELECT a.sla_minutes, a.business_hours INTO v_sla_minutes, v_bh
  FROM ai_config a WHERE a.clinic_id = NEW.clinic_id LIMIT 1;
  IF v_sla_minutes IS NULL OR v_sla_minutes <= 0 OR v_bh IS NULL THEN RETURN NEW; END IF;

  v_sh := SPLIT_PART(v_bh->>'start', ':', 1)::INTEGER;
  v_sm := COALESCE(NULLIF(SPLIT_PART(v_bh->>'start', ':', 2), ''), '0')::INTEGER;
  v_eh := SPLIT_PART(v_bh->>'end',   ':', 1)::INTEGER;
  v_em := COALESCE(NULLIF(SPLIT_PART(v_bh->>'end',   ':', 2), ''), '0')::INTEGER;
  SELECT ARRAY_AGG(d::INTEGER) INTO v_days FROM JSONB_ARRAY_ELEMENTS_TEXT(v_bh->'days') d;

  v_biz_mins := calc_business_minutes(NEW.last_message_at, NEW.last_outbound_at, v_sh, v_sm, v_eh, v_em, v_days);

  IF v_biz_mins > v_sla_minutes THEN
    -- contador mantido (badge do Kanban)
    NEW.sla_breach_count := COALESCE(NEW.sla_breach_count, 0) + 1;

    -- autor da resposta que fechou o ciclo (p/ IA × Humano e teto da IA)
    SELECT cm.sender INTO v_sender
    FROM chat_messages cm
    WHERE cm.lead_id = NEW.id AND cm.created_at = NEW.last_outbound_at
    ORDER BY cm.created_at DESC LIMIT 1;

    SELECT t.id INTO v_ticket
    FROM tickets t WHERE t.lead_id = NEW.id AND t.status = 'open'
    ORDER BY t.created_at DESC LIMIT 1;

    INSERT INTO public.sla_breaches
      (clinic_id, lead_id, ticket_id, inbound_at, breached_at, business_minutes, overshoot_min, wait_raw_min, sla_minutes, sender)
    VALUES
      (NEW.clinic_id, NEW.id, v_ticket, NEW.last_message_at, NEW.last_outbound_at,
       v_biz_mins, v_biz_mins - v_sla_minutes,
       EXTRACT(EPOCH FROM (NEW.last_outbound_at - NEW.last_message_at)) / 60.0,
       v_sla_minutes, v_sender);
  END IF;

  RETURN NEW;
END;
$function$;
