-- 20260512213831_auto_move_lead_to_agendado
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- 1. Popula slug "agendado" e "qualificado" onde está NULL (identifica etapas por slug, não por nome)
UPDATE funnel_stages SET slug = 'agendado'
 WHERE slug IS NULL AND lower(name) LIKE 'agendad%';
UPDATE funnel_stages SET slug = 'qualificado'
 WHERE slug IS NULL AND lower(name) LIKE 'qualificad%';

-- 2. Função: ao criar appointment, move o lead pra etapa "agendado" da clínica
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
  -- 2a. Acha o lead: prioriza via ticket vinculado; fallback via patient.phone → leads.phone
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

  IF v_lead_id IS NULL THEN
    RETURN NEW; -- sem lead, nada a fazer
  END IF;

  -- 2b. Etapa "agendado" da clínica
  SELECT id, position INTO v_target_stage_id, v_target_position
  FROM funnel_stages
  WHERE clinic_id = NEW.clinic_id AND slug = 'agendado'
  LIMIT 1;

  IF v_target_stage_id IS NULL THEN
    RETURN NEW; -- clínica não tem etapa agendado configurada
  END IF;

  -- 2c. Posição atual do lead — só avança se está numa etapa anterior
  SELECT fs.position INTO v_current_position
  FROM leads l
  JOIN funnel_stages fs ON fs.id = l.stage_id
  WHERE l.id = v_lead_id;

  IF v_current_position IS NULL OR v_current_position < v_target_position THEN
    UPDATE leads SET stage_id = v_target_stage_id WHERE id = v_lead_id;
  END IF;

  RETURN NEW;
END;
$$;

-- 3. Trigger: dispara após INSERT em appointments
DROP TRIGGER IF EXISTS auto_move_lead_to_agendado_trg ON public.appointments;
CREATE TRIGGER auto_move_lead_to_agendado_trg
  AFTER INSERT ON public.appointments
  FOR EACH ROW
  WHEN (NEW.status NOT IN ('cancelado', 'faltou'))
  EXECUTE FUNCTION public.fn_auto_move_lead_to_agendado();

-- 4. Fix retroativo: move o lead do Pedro pra "Agendado"
UPDATE leads SET stage_id = (
  SELECT id FROM funnel_stages
  WHERE clinic_id = '7f030e9a-7209-47d4-8130-78c013f808ca' AND slug = 'agendado'
)
WHERE id = 'ca3373e6-d499-4215-a637-45f418f14044';
