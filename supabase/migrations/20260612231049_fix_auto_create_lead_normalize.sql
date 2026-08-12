-- 20260612231049_fix_auto_create_lead_normalize
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

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

  IF NOT EXISTS (SELECT 1 FROM tickets WHERE lead_id = v_lead_id AND status = 'open') THEN
    SELECT id INTO v_first_stage_id FROM funnel_stages
    WHERE clinic_id = NEW.clinic_id ORDER BY position LIMIT 1;

    INSERT INTO tickets (clinic_id, lead_id, stage_id, status, opened_at)
    VALUES (NEW.clinic_id, v_lead_id, v_first_stage_id, 'open', now());
  END IF;

  RETURN NEW;
END;
$function$;
