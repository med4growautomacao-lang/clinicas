-- 20260610030615_auto_open_ticket_forms
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

CREATE OR REPLACE FUNCTION fn_auto_open_ticket_forms()
RETURNS TRIGGER AS $$
DECLARE
  v_stage_id UUID;
BEGIN
  -- Só leads de formulário entram aqui
  IF NEW.capture_channel IS DISTINCT FROM 'forms' THEN
    RETURN NEW;
  END IF;

  -- Já tem ticket aberto? não cria outro
  IF EXISTS (SELECT 1 FROM tickets WHERE lead_id = NEW.id AND status = 'open') THEN
    RETURN NEW;
  END IF;

  -- Etapa de entrada do forms: 'forms' se existir, senão 'sincronizacao',
  -- senão a primeira do funil (menor position).
  SELECT id INTO v_stage_id FROM funnel_stages
  WHERE clinic_id = NEW.clinic_id AND slug = 'forms'
  ORDER BY position LIMIT 1;

  IF v_stage_id IS NULL THEN
    SELECT id INTO v_stage_id FROM funnel_stages
    WHERE clinic_id = NEW.clinic_id AND slug = 'sincronizacao'
    ORDER BY position LIMIT 1;
  END IF;

  IF v_stage_id IS NULL THEN
    SELECT id INTO v_stage_id FROM funnel_stages
    WHERE clinic_id = NEW.clinic_id
    ORDER BY position LIMIT 1;
  END IF;

  -- Clínica sem funil configurado: não força ticket
  IF v_stage_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO tickets (clinic_id, lead_id, stage_id, status, opened_at)
  VALUES (NEW.clinic_id, NEW.id, v_stage_id, 'open', NOW());

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_auto_open_ticket_forms ON leads;
CREATE TRIGGER trg_auto_open_ticket_forms
  AFTER INSERT ON leads
  FOR EACH ROW EXECUTE FUNCTION fn_auto_open_ticket_forms();
