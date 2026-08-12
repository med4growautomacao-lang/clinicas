-- 20260516005227_triggers_activate_ai_on_resolve_and_followup_on_appointment
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- ============================================================
-- Trigger 1: ao RESOLVER (fechar) um ticket → reativa IA do lead
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_activate_ai_on_ticket_resolved()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Só age quando o ticket passa para 'closed' (resolvido)
  IF NEW.status = 'closed'
     AND OLD.status IS DISTINCT FROM 'closed'
     AND NEW.lead_id IS NOT NULL THEN
    UPDATE leads
      SET ai_enabled = true
      WHERE id = NEW.lead_id
        AND ai_enabled = false;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_activate_ai_on_ticket_resolved ON public.tickets;
CREATE TRIGGER trg_activate_ai_on_ticket_resolved
  AFTER UPDATE ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.fn_activate_ai_on_ticket_resolved();

-- ============================================================
-- Trigger 2: ao criar AGENDAMENTO → ativa followup do lead
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_enable_followup_on_appointment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_lead_id uuid;
BEGIN
  -- Lead via ticket (ticket_id já setado pelo trigger BEFORE INSERT)
  IF NEW.ticket_id IS NOT NULL THEN
    SELECT lead_id INTO v_lead_id FROM tickets WHERE id = NEW.ticket_id;
  END IF;

  -- Fallback: lead via telefone do paciente
  IF v_lead_id IS NULL AND NEW.patient_id IS NOT NULL THEN
    SELECT l.id INTO v_lead_id
    FROM leads l
    JOIN patients p ON p.clinic_id = l.clinic_id AND p.phone = l.phone
    WHERE p.id = NEW.patient_id
    LIMIT 1;
  END IF;

  -- Ativa followup se ainda não estiver ativo
  IF v_lead_id IS NOT NULL THEN
    UPDATE leads
      SET followup_enabled = true
      WHERE id = v_lead_id
        AND followup_enabled = false;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_enable_followup_on_appointment ON public.appointments;
CREATE TRIGGER trg_enable_followup_on_appointment
  AFTER INSERT ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.fn_enable_followup_on_appointment();
