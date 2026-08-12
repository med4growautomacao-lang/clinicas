-- 20260513000956_auto_agendado_always_moves
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

CREATE OR REPLACE FUNCTION public.fn_auto_move_lead_to_agendado()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_ticket_id uuid;
  v_target_stage_id uuid;
BEGIN
  v_ticket_id := NEW.ticket_id;
  IF v_ticket_id IS NULL THEN
    SELECT t.id INTO v_ticket_id
    FROM tickets t
    JOIN leads l ON l.id = t.lead_id
    JOIN patients p ON p.phone = l.phone AND p.clinic_id = l.clinic_id
    WHERE p.id = NEW.patient_id AND l.clinic_id = NEW.clinic_id AND t.status = 'open'
    LIMIT 1;
  END IF;
  IF v_ticket_id IS NULL THEN RETURN NEW; END IF;

  SELECT id INTO v_target_stage_id
  FROM funnel_stages
  WHERE clinic_id = NEW.clinic_id AND slug = 'agendado' LIMIT 1;
  IF v_target_stage_id IS NULL THEN RETURN NEW; END IF;

  -- Toda vez que cria appointment ativo (status != cancelado/faltou, filtrado pelo trigger WHEN),
  -- o ticket vai pra "Agendado" — sem condicional de posição.
  -- Limpa outcome se vinha de estado encerrado (ressurreição, novo ciclo).
  UPDATE tickets
    SET stage_id = v_target_stage_id,
        outcome = NULL,
        outcome_at = NULL
  WHERE id = v_ticket_id
    AND stage_id IS DISTINCT FROM v_target_stage_id;

  RETURN NEW;
END;
$$;
