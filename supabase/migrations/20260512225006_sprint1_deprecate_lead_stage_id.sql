-- 20260512225006_sprint1_deprecate_lead_stage_id
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- ============================================================
-- SPRINT 1: ticket.stage_id vira a ÚNICA fonte da verdade
-- ============================================================

-- 1. VIEW: atalho de leitura "etapa atual do lead"
CREATE OR REPLACE VIEW public.vw_lead_active_stage AS
SELECT l.id AS lead_id,
       t.id AS active_ticket_id,
       t.stage_id AS stage_id
FROM leads l
LEFT JOIN LATERAL (
  SELECT id, stage_id FROM tickets
  WHERE lead_id = l.id AND status = 'open'
  ORDER BY opened_at DESC LIMIT 1
) t ON true;

-- 2. TRIGGER: registrar mudança de etapa no histórico, agora a partir do TICKET
CREATE OR REPLACE FUNCTION public.fn_log_ticket_stage_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.lead_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' OR OLD.stage_id IS DISTINCT FROM NEW.stage_id THEN
    INSERT INTO lead_stage_history (clinic_id, lead_id, old_stage_id, new_stage_id, changed_at)
    VALUES (NEW.clinic_id, NEW.lead_id,
            CASE WHEN TG_OP = 'UPDATE' THEN OLD.stage_id ELSE NULL END,
            NEW.stage_id, now());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_ticket_stage_change ON public.tickets;
CREATE TRIGGER trg_log_ticket_stage_change
  AFTER INSERT OR UPDATE OF stage_id ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.fn_log_ticket_stage_change();

-- Trigger antigo em leads desativado (history agora vem do ticket)
DROP TRIGGER IF EXISTS trg_log_lead_stage_change ON public.leads;

-- 3. RPC: criar lead + ticket aberto atomicamente
CREATE OR REPLACE FUNCTION public.create_lead_with_ticket(
  p_clinic_id uuid,
  p_name text,
  p_phone text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_source text DEFAULT 'manual',
  p_capture_channel text DEFAULT 'manual',
  p_stage_id uuid DEFAULT NULL,
  p_estimated_value numeric DEFAULT NULL,
  p_avatar_url text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_lead_id uuid;
  v_ticket_id uuid;
  v_stage_id uuid := p_stage_id;
BEGIN
  IF v_stage_id IS NULL THEN
    SELECT id INTO v_stage_id FROM funnel_stages
    WHERE clinic_id = p_clinic_id ORDER BY position LIMIT 1;
  END IF;

  INSERT INTO leads (clinic_id, name, phone, email, source, capture_channel, estimated_value, avatar_url)
  VALUES (p_clinic_id, p_name, p_phone, p_email, p_source, p_capture_channel, p_estimated_value, p_avatar_url)
  RETURNING id INTO v_lead_id;

  INSERT INTO tickets (clinic_id, lead_id, stage_id, status, opened_at)
  VALUES (p_clinic_id, v_lead_id, v_stage_id, 'open', now())
  RETURNING id INTO v_ticket_id;

  RETURN jsonb_build_object(
    'success', true,
    'lead_id', v_lead_id,
    'ticket_id', v_ticket_id,
    'stage_id', v_stage_id
  );
END;
$$;

-- 4. Refatorar funções: parar de mexer em leads.stage_id

-- 4a. move_lead_stage: só ticket
CREATE OR REPLACE FUNCTION public.move_lead_stage(
  p_ticket_id uuid,
  p_new_stage_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_ticket RECORD;
BEGIN
  SELECT id, lead_id, stage_id, clinic_id INTO v_ticket
  FROM tickets WHERE id = p_ticket_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'ticket_not_found');
  END IF;

  UPDATE tickets SET stage_id = p_new_stage_id WHERE id = p_ticket_id;

  RETURN jsonb_build_object('success', true, 'ticket_id', p_ticket_id, 'new_stage_id', p_new_stage_id);
END;
$$;

-- 4b. finalize_ticket: só ticket (trigger ticket alimenta history)
CREATE OR REPLACE FUNCTION public.finalize_ticket(
  p_ticket_id uuid,
  p_outcome text,
  p_loss_reason text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_ticket RECORD;
  v_target_stage_id uuid;
BEGIN
  IF p_outcome NOT IN ('ganho', 'perdido') THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'invalid_outcome');
  END IF;

  SELECT id, lead_id, stage_id, clinic_id INTO v_ticket
  FROM tickets WHERE id = p_ticket_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'ticket_not_found');
  END IF;

  SELECT id INTO v_target_stage_id FROM funnel_stages
  WHERE clinic_id = v_ticket.clinic_id AND slug = p_outcome LIMIT 1;

  UPDATE tickets SET
    status = 'closed',
    outcome = p_outcome,
    outcome_at = now(),
    closed_at = COALESCE(closed_at, now()),
    loss_reason = CASE WHEN p_outcome = 'perdido' THEN p_loss_reason ELSE loss_reason END,
    notes = COALESCE(p_notes, notes),
    stage_id = COALESCE(v_target_stage_id, stage_id)
  WHERE id = p_ticket_id;

  RETURN jsonb_build_object(
    'success', true,
    'ticket_id', p_ticket_id,
    'lead_id', v_ticket.lead_id,
    'outcome', p_outcome,
    'new_stage_id', v_target_stage_id
  );
END;
$$;

-- 4c. fn_auto_move_lead_to_agendado: só ticket
CREATE OR REPLACE FUNCTION public.fn_auto_move_lead_to_agendado()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_ticket_id uuid;
  v_target_stage_id uuid;
  v_target_position int;
  v_current_position int;
BEGIN
  v_ticket_id := NEW.ticket_id;
  IF v_ticket_id IS NULL THEN
    -- Tenta achar ticket aberto via phone do paciente
    SELECT t.id INTO v_ticket_id
    FROM tickets t
    JOIN leads l ON l.id = t.lead_id
    JOIN patients p ON p.phone = l.phone AND p.clinic_id = l.clinic_id
    WHERE p.id = NEW.patient_id AND l.clinic_id = NEW.clinic_id AND t.status = 'open'
    LIMIT 1;
  END IF;
  IF v_ticket_id IS NULL THEN RETURN NEW; END IF;

  SELECT id, position INTO v_target_stage_id, v_target_position
  FROM funnel_stages
  WHERE clinic_id = NEW.clinic_id AND slug = 'agendado' LIMIT 1;
  IF v_target_stage_id IS NULL THEN RETURN NEW; END IF;

  SELECT fs.position INTO v_current_position
  FROM tickets t JOIN funnel_stages fs ON fs.id = t.stage_id
  WHERE t.id = v_ticket_id;

  IF v_current_position IS NULL OR v_current_position < v_target_position THEN
    UPDATE tickets SET stage_id = v_target_stage_id WHERE id = v_ticket_id;
  END IF;

  RETURN NEW;
END;
$$;

-- 4d. fn_auto_move_lead_on_status_change: só ticket
CREATE OR REPLACE FUNCTION public.fn_auto_move_lead_on_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_ticket_id uuid;
  v_target_slug text;
  v_target_stage_id uuid;
  v_target_position int;
  v_current_position int;
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;

  v_target_slug := CASE NEW.status
    WHEN 'compareceu' THEN 'compareceu'
    WHEN 'realizado'  THEN 'ganho'
    WHEN 'cancelado'  THEN 'faltou_cancelou'
    WHEN 'faltou'     THEN 'faltou_cancelou'
    ELSE NULL
  END;
  IF v_target_slug IS NULL THEN RETURN NEW; END IF;

  v_ticket_id := NEW.ticket_id;
  IF v_ticket_id IS NULL THEN
    SELECT t.id INTO v_ticket_id
    FROM tickets t
    JOIN leads l ON l.id = t.lead_id
    JOIN patients p ON p.phone = l.phone AND p.clinic_id = l.clinic_id
    WHERE p.id = NEW.patient_id AND l.clinic_id = NEW.clinic_id
    ORDER BY (t.status = 'open') DESC, t.opened_at DESC
    LIMIT 1;
  END IF;
  IF v_ticket_id IS NULL THEN RETURN NEW; END IF;

  SELECT id, position INTO v_target_stage_id, v_target_position
  FROM funnel_stages WHERE clinic_id = NEW.clinic_id AND slug = v_target_slug LIMIT 1;
  IF v_target_stage_id IS NULL THEN RETURN NEW; END IF;

  SELECT fs.position INTO v_current_position
  FROM tickets t JOIN funnel_stages fs ON fs.id = t.stage_id
  WHERE t.id = v_ticket_id;

  IF NEW.status IN ('cancelado', 'faltou')
     OR v_current_position IS NULL
     OR v_current_position < v_target_position THEN
    UPDATE tickets
      SET stage_id = v_target_stage_id,
          outcome = CASE WHEN NEW.status = 'realizado' THEN 'ganho'
                         WHEN NEW.status IN ('cancelado', 'faltou') THEN 'perdido'
                         ELSE outcome END,
          outcome_at = CASE WHEN NEW.status IN ('realizado', 'cancelado', 'faltou') THEN now() ELSE outcome_at END
      WHERE id = v_ticket_id;
  END IF;

  RETURN NEW;
END;
$$;

-- 4e. finalize_appointment: não toca em leads.stage_id mais (já estava OK no ticket via trigger)
-- Apenas remove o UPDATE que poderia tocar lead — mas finalize_appointment já só atualizava tickets.
-- Mantém igual, já está correto.

-- 4f. fn_auto_create_lead_on_patient: cria lead SEM stage_id; ticket recebe o default
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
  IF NEW.phone IS NULL OR NEW.phone = '' THEN RETURN NEW; END IF;

  SELECT id INTO v_lead_id FROM leads
  WHERE clinic_id = NEW.clinic_id AND phone = NEW.phone LIMIT 1;

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
$$;

-- 5. Aposentar fn_set_default_lead_stage (lead não tem mais default — ticket sim)
DROP TRIGGER IF EXISTS trg_set_default_lead_stage ON public.leads;

-- 6. BACKFILL: criar ticket aberto pra cada lead com stage_id mas sem ticket aberto
INSERT INTO tickets (clinic_id, lead_id, stage_id, status, opened_at)
SELECT l.clinic_id, l.id, l.stage_id, 'open', COALESCE(l.created_at::timestamptz, now())
FROM leads l
LEFT JOIN funnel_stages fs ON fs.id = l.stage_id
WHERE l.stage_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM tickets t WHERE t.lead_id = l.id AND t.status = 'open')
  AND COALESCE(fs.slug, '') NOT IN ('perdido', 'ganho');
