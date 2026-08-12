-- Corrige fn_auto_create_lead_on_patient (trigger AFTER INSERT em patients) para casar o
-- lead por normalize_br_phone em vez de igualdade EXATA. Antes: criar um paciente cujo
-- telefone normalizado difere da forma crua (com 9o digito) de um lead existente gerava
-- um lead DUPLICADO + um ticket na 1a etapa (reengajavel) -> mesma classe dos bugs de 12/06.
-- (NEW.phone ja vem normalizado pelo BEFORE trigger tr_sanitize_patient_phone.)
CREATE OR REPLACE FUNCTION public.fn_auto_create_lead_on_patient()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_lead_id uuid;
  v_first_stage_id uuid;
BEGIN
  IF NEW.phone IS NULL OR NEW.phone = '' THEN RETURN NEW; END IF;

  SELECT id INTO v_lead_id FROM leads
  WHERE clinic_id = NEW.clinic_id
    AND normalize_br_phone(phone) = normalize_br_phone(NEW.phone)
  LIMIT 1;

  IF v_lead_id IS NULL THEN
    INSERT INTO leads (clinic_id, name, phone, source, capture_channel, ai_enabled, converted_patient_id)
    VALUES (NEW.clinic_id, NEW.name, NEW.phone, 'manual', 'manual', false, NEW.id)
    RETURNING id INTO v_lead_id;
  ELSE
    UPDATE leads SET converted_patient_id = NEW.id
    WHERE id = v_lead_id AND converted_patient_id IS NULL;
  END IF;

  -- Garante 1 ticket aberto
  IF NOT EXISTS (SELECT 1 FROM tickets WHERE lead_id = v_lead_id AND status = 'open') THEN
    SELECT id INTO v_first_stage_id FROM funnel_stages
    WHERE clinic_id = NEW.clinic_id ORDER BY position LIMIT 1;

    INSERT INTO tickets (clinic_id, lead_id, stage_id, status, opened_at)
    VALUES (NEW.clinic_id, v_lead_id, v_first_stage_id, 'open', now());
  END IF;

  RETURN NEW;
END;
$function$;
