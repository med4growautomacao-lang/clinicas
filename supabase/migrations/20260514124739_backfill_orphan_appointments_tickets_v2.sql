-- 20260514124739_backfill_orphan_appointments_tickets_v2
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

DO $$
DECLARE
  r RECORD;
  v_lead_id    uuid;
  v_ticket_id  uuid;
  v_stage_id   uuid;
  v_slug       text;
  v_outcome    text;
  v_outcome_at timestamptz;
  v_ft_id      uuid;
BEGIN
  -- 1 ticket por appointment órfão (respeitando constraint UNIQUE ticket_id por apt ativo)
  FOR r IN
    SELECT
      a.id          AS appointment_id,
      a.clinic_id,
      a.patient_id,
      a.status      AS apt_status,
      a.date        AS apt_date,
      p.phone       AS phone,
      p.name        AS pname
    FROM appointments a
    JOIN patients p ON p.id = a.patient_id
    WHERE a.ticket_id IS NULL
      AND p.phone IS NOT NULL AND p.phone <> ''
    ORDER BY a.clinic_id, a.patient_id, a.created_at
  LOOP
    -- Stage destino por status do appointment
    v_slug := CASE r.apt_status
      WHEN 'realizado'  THEN 'ganho'
      WHEN 'compareceu' THEN 'compareceu'
      WHEN 'pendente'   THEN 'agendado'
      WHEN 'confirmado' THEN 'agendado'
      WHEN 'cancelado'  THEN 'faltou_cancelou'
      WHEN 'faltou'     THEN 'faltou_cancelou'
      ELSE                   'agendado'
    END;

    -- Lead: 1 por (clinic_id, phone)
    SELECT id INTO v_lead_id
    FROM leads WHERE clinic_id = r.clinic_id AND phone = r.phone
    LIMIT 1;

    IF v_lead_id IS NULL THEN
      INSERT INTO leads (clinic_id, name, phone, source, capture_channel, ai_enabled, converted_patient_id)
      VALUES (r.clinic_id, COALESCE(r.pname, 'Paciente'), r.phone, 'manual', 'manual', false, r.patient_id)
      RETURNING id INTO v_lead_id;
    ELSE
      UPDATE leads
         SET converted_patient_id = COALESCE(converted_patient_id, r.patient_id)
       WHERE id = v_lead_id;
    END IF;

    -- Stage_id da clinic para slug
    SELECT id INTO v_stage_id
    FROM funnel_stages WHERE clinic_id = r.clinic_id AND slug = v_slug
    LIMIT 1;

    IF v_stage_id IS NULL THEN
      SELECT id INTO v_stage_id
      FROM funnel_stages WHERE clinic_id = r.clinic_id AND slug = 'agendado'
      LIMIT 1;
    END IF;

    IF v_stage_id IS NULL THEN
      CONTINUE;
    END IF;

    -- Outcome
    IF v_slug = 'ganho' THEN
      v_outcome := 'ganho';    v_outcome_at := now();
    ELSIF v_slug = 'faltou_cancelou' THEN
      v_outcome := 'perdido';  v_outcome_at := now();
    ELSE
      v_outcome := NULL;       v_outcome_at := NULL;
    END IF;

    -- Cria ticket
    INSERT INTO tickets (clinic_id, lead_id, stage_id, status, opened_at, outcome, outcome_at)
    VALUES (r.clinic_id, v_lead_id, v_stage_id, 'open', now(), v_outcome, v_outcome_at)
    RETURNING id INTO v_ticket_id;

    -- Vincula este appointment ao ticket
    UPDATE appointments SET ticket_id = v_ticket_id WHERE id = r.appointment_id;

    -- Para 'realizado': cria financial_transaction (R$600) + conversion
    IF r.apt_status = 'realizado' THEN
      INSERT INTO financial_transactions
        (clinic_id, patient_id, appointment_id, type, category, amount, status, date, description)
      VALUES
        (r.clinic_id, r.patient_id, r.appointment_id, 'receita', 'Consulta', 600, 'pago',
         r.apt_date::date, 'Backfill — consulta realizada')
      RETURNING id INTO v_ft_id;

      INSERT INTO conversions
        (clinic_id, lead_id, ticket_id, value, description, converted_at, financial_transaction_id)
      VALUES
        (r.clinic_id, v_lead_id, v_ticket_id, 600, 'Backfill — consulta realizada',
         now(), v_ft_id);
    END IF;
  END LOOP;
END $$;
