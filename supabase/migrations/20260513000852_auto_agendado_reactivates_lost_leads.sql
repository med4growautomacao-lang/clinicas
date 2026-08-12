-- 20260513000852_auto_agendado_reactivates_lost_leads
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
  v_target_position int;
  v_current_position int;
  v_current_slug text;
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

  SELECT id, position INTO v_target_stage_id, v_target_position
  FROM funnel_stages
  WHERE clinic_id = NEW.clinic_id AND slug = 'agendado' LIMIT 1;
  IF v_target_stage_id IS NULL THEN RETURN NEW; END IF;

  SELECT fs.slug, fs.position INTO v_current_slug, v_current_position
  FROM tickets t JOIN funnel_stages fs ON fs.id = t.stage_id
  WHERE t.id = v_ticket_id;

  -- Move se:
  --  (a) avanço linear (etapa atual antes de "agendado"), OU
  --  (b) reativação: estava em "faltou_cancelou" ou "perdido" e voltou a marcar
  IF v_current_position IS NULL
     OR v_current_position < v_target_position
     OR v_current_slug IN ('faltou_cancelou', 'perdido') THEN

    UPDATE tickets
      SET stage_id = v_target_stage_id,
          -- Limpa outcome se era um ticket "encerrado funcionalmente"
          outcome = CASE WHEN v_current_slug IN ('faltou_cancelou', 'perdido') THEN NULL ELSE outcome END,
          outcome_at = CASE WHEN v_current_slug IN ('faltou_cancelou', 'perdido') THEN NULL ELSE outcome_at END
      WHERE id = v_ticket_id;
  END IF;

  RETURN NEW;
END;
$$;
