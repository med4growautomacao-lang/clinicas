-- 20260512215901_fix_auto_move_lead_to_agendado_also_moves_ticket
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

CREATE OR REPLACE FUNCTION public.fn_auto_move_lead_to_agendado()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_lead_id uuid;
  v_target_stage_id uuid;
  v_target_position int;
  v_current_position int;
BEGIN
  IF NEW.ticket_id IS NOT NULL THEN
    SELECT lead_id INTO v_lead_id FROM tickets WHERE id = NEW.ticket_id;
  END IF;
  IF v_lead_id IS NULL THEN
    SELECT l.id INTO v_lead_id
    FROM leads l
    JOIN patients p ON p.phone = l.phone AND p.clinic_id = l.clinic_id
    WHERE p.id = NEW.patient_id AND l.clinic_id = NEW.clinic_id
    LIMIT 1;
  END IF;
  IF v_lead_id IS NULL THEN RETURN NEW; END IF;

  SELECT id, position INTO v_target_stage_id, v_target_position
  FROM funnel_stages
  WHERE clinic_id = NEW.clinic_id AND slug = 'agendado'
  LIMIT 1;
  IF v_target_stage_id IS NULL THEN RETURN NEW; END IF;

  SELECT fs.position INTO v_current_position
  FROM leads l JOIN funnel_stages fs ON fs.id = l.stage_id
  WHERE l.id = v_lead_id;

  IF v_current_position IS NULL OR v_current_position < v_target_position THEN
    UPDATE leads SET stage_id = v_target_stage_id WHERE id = v_lead_id;

    -- Move TAMBÉM o ticket vinculado (o kanban renderiza por ticket.stage_id)
    IF NEW.ticket_id IS NOT NULL THEN
      UPDATE tickets SET stage_id = v_target_stage_id WHERE id = NEW.ticket_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Fix retroativo: move o ticket do Pedro pra Agendado
UPDATE tickets
SET stage_id = (SELECT id FROM funnel_stages WHERE clinic_id = '7f030e9a-7209-47d4-8130-78c013f808ca' AND slug = 'agendado')
WHERE id = '47bbfc58-a24e-4f34-a7d5-0f53dad4801b';
