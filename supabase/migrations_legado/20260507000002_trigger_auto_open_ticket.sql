CREATE OR REPLACE FUNCTION fn_auto_open_ticket()
RETURNS TRIGGER AS $$
DECLARE
  v_ticket_id UUID;
  v_clinic_id UUID;
  v_stage_id  UUID;
BEGIN
  -- Só age em mensagens inbound com lead associado
  IF NEW.direction <> 'inbound' OR NEW.lead_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Busca ticket aberto mais recente do lead
  SELECT id INTO v_ticket_id
  FROM tickets
  WHERE lead_id = NEW.lead_id
    AND status = 'open'
  ORDER BY opened_at DESC
  LIMIT 1;

  IF v_ticket_id IS NOT NULL THEN
    -- Reutiliza ticket existente
    NEW.ticket_id := v_ticket_id;
  ELSE
    -- Busca clinic_id e stage_id atual do lead
    SELECT clinic_id, stage_id INTO v_clinic_id, v_stage_id
    FROM leads
    WHERE id = NEW.lead_id;

    -- Abre novo ticket
    INSERT INTO tickets (clinic_id, lead_id, stage_id, status, opened_at)
    VALUES (v_clinic_id, NEW.lead_id, v_stage_id, 'open', NOW())
    RETURNING id INTO v_ticket_id;

    NEW.ticket_id := v_ticket_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_auto_open_ticket
  BEFORE INSERT ON chat_messages
  FOR EACH ROW EXECUTE FUNCTION fn_auto_open_ticket();
