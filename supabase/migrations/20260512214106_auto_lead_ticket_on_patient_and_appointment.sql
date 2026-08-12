-- 20260512214106_auto_lead_ticket_on_patient_and_appointment
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- ============================================================
-- 1. Auto-criar lead + ticket quando paciente é criado manualmente
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_auto_create_lead_on_patient()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_lead_id uuid;
  v_first_stage_id uuid;
BEGIN
  -- Sem phone, não dá pra fazer lead (chave de match)
  IF NEW.phone IS NULL OR NEW.phone = '' THEN
    RETURN NEW;
  END IF;

  -- Reaproveita lead existente com mesmo phone na clínica
  SELECT id INTO v_lead_id
  FROM leads
  WHERE clinic_id = NEW.clinic_id AND phone = NEW.phone
  LIMIT 1;

  IF v_lead_id IS NULL THEN
    -- Primeira etapa do funil
    SELECT id INTO v_first_stage_id
    FROM funnel_stages
    WHERE clinic_id = NEW.clinic_id
    ORDER BY position ASC
    LIMIT 1;

    INSERT INTO leads (
      clinic_id, name, phone, stage_id, source, converted_patient_id,
      capture_channel, ai_enabled
    )
    VALUES (
      NEW.clinic_id, NEW.name, NEW.phone, v_first_stage_id,
      'manual', NEW.id, 'manual', false
    )
    RETURNING id INTO v_lead_id;
  ELSE
    -- Lead já existe — só atualiza converted_patient_id se vazio
    UPDATE leads
    SET converted_patient_id = NEW.id
    WHERE id = v_lead_id AND converted_patient_id IS NULL;
  END IF;

  -- Garante 1 ticket aberto pro lead
  IF NOT EXISTS (
    SELECT 1 FROM tickets WHERE lead_id = v_lead_id AND status = 'open'
  ) THEN
    INSERT INTO tickets (clinic_id, lead_id, stage_id, status, opened_at)
    VALUES (
      NEW.clinic_id, v_lead_id,
      (SELECT stage_id FROM leads WHERE id = v_lead_id),
      'open', NOW()
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS auto_create_lead_on_patient_trg ON public.patients;
CREATE TRIGGER auto_create_lead_on_patient_trg
  AFTER INSERT ON public.patients
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_auto_create_lead_on_patient();


-- ============================================================
-- 2. Auto-vincular ticket aberto ao appointment (qualquer fluxo)
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_auto_link_ticket_on_appointment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_ticket_id uuid;
  v_phone text;
BEGIN
  -- Se já veio com ticket_id, respeita
  IF NEW.ticket_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Phone do paciente
  SELECT phone INTO v_phone FROM patients WHERE id = NEW.patient_id;
  IF v_phone IS NULL OR v_phone = '' THEN
    RETURN NEW;
  END IF;

  -- Busca ticket aberto via lead com mesmo phone
  SELECT t.id INTO v_ticket_id
  FROM tickets t
  JOIN leads l ON l.id = t.lead_id
  WHERE l.clinic_id = NEW.clinic_id
    AND l.phone = v_phone
    AND t.status = 'open'
  ORDER BY t.opened_at DESC
  LIMIT 1;

  IF v_ticket_id IS NOT NULL THEN
    NEW.ticket_id := v_ticket_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS auto_link_ticket_on_appointment_trg ON public.appointments;
CREATE TRIGGER auto_link_ticket_on_appointment_trg
  BEFORE INSERT ON public.appointments
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_auto_link_ticket_on_appointment();
