-- 20260514124624_extend_auto_link_ticket_create_lead
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

CREATE OR REPLACE FUNCTION public.fn_auto_link_ticket_on_appointment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ticket_id uuid;
  v_lead_id   uuid;
  v_phone     text;
  v_name      text;
  v_stage_id  uuid;
BEGIN
  -- 1) Já veio com ticket_id: respeita
  IF NEW.ticket_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- 2) Pega phone + name do paciente
  SELECT phone, name INTO v_phone, v_name
  FROM patients WHERE id = NEW.patient_id;

  IF v_phone IS NULL OR v_phone = '' THEN
    RETURN NEW;
  END IF;

  -- 3) Procura ticket aberto via lead com mesmo phone
  SELECT t.id INTO v_ticket_id
  FROM tickets t
  JOIN leads l ON l.id = t.lead_id
  WHERE l.clinic_id = NEW.clinic_id
    AND l.phone     = v_phone
    AND t.status    = 'open'
  ORDER BY t.opened_at DESC
  LIMIT 1;

  IF v_ticket_id IS NOT NULL THEN
    NEW.ticket_id := v_ticket_id;
    RETURN NEW;
  END IF;

  -- 4) Não achou: cria lead (se necessário) + ticket
  SELECT id INTO v_lead_id
  FROM leads
  WHERE clinic_id = NEW.clinic_id AND phone = v_phone
  LIMIT 1;

  IF v_lead_id IS NULL THEN
    INSERT INTO leads (clinic_id, name, phone, source, capture_channel, ai_enabled, converted_patient_id)
    VALUES (NEW.clinic_id, COALESCE(v_name, 'Paciente'), v_phone, 'manual', 'manual', false, NEW.patient_id)
    RETURNING id INTO v_lead_id;
  ELSE
    UPDATE leads
       SET converted_patient_id = COALESCE(converted_patient_id, NEW.patient_id)
     WHERE id = v_lead_id;
  END IF;

  -- 5) Stage 'agendado' da clínica
  SELECT id INTO v_stage_id
  FROM funnel_stages
  WHERE clinic_id = NEW.clinic_id AND slug = 'agendado'
  LIMIT 1;

  IF v_stage_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- 6) Cria ticket
  INSERT INTO tickets (clinic_id, lead_id, stage_id, status, opened_at)
  VALUES (NEW.clinic_id, v_lead_id, v_stage_id, 'open', now())
  RETURNING id INTO NEW.ticket_id;

  RETURN NEW;
END;
$function$;
