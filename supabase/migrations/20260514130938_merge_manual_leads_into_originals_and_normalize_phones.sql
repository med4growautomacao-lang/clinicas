-- 20260514130938_merge_manual_leads_into_originals_and_normalize_phones
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- =====================================================================
-- Fase 1: Snapshot de auditoria (tabela permanente para rollback)
-- =====================================================================
CREATE TABLE IF NOT EXISTS merge_audit_2026_05_14 AS
SELECT
  p.id          AS patient_id,
  p.clinic_id,
  c.name        AS clinic_name,
  p.phone       AS patient_phone_raw,
  normalize_br_phone(p.phone) AS patient_phone_norm,
  l_manual.id   AS lead_manual_id,
  l_orig.id     AS lead_original_id,
  t_manual.id   AS ticket_manual_id,
  t_manual.stage_id   AS manual_stage_id,
  t_manual.outcome    AS manual_outcome,
  t_manual.outcome_at AS manual_outcome_at,
  (SELECT t.id FROM tickets t
    WHERE t.lead_id = l_orig.id AND t.status = 'open'
    ORDER BY t.opened_at DESC LIMIT 1) AS ticket_original_id,
  now() AS captured_at
FROM patients p
JOIN clinics c ON c.id = p.clinic_id
JOIN leads l_orig
  ON l_orig.clinic_id = p.clinic_id
 AND l_orig.phone     = normalize_br_phone(p.phone)
 AND (l_orig.source IS NULL OR l_orig.source <> 'manual')
JOIN leads l_manual
  ON l_manual.clinic_id = p.clinic_id
 AND l_manual.phone     = p.phone
 AND l_manual.source    = 'manual'
JOIN tickets t_manual ON t_manual.lead_id = l_manual.id
WHERE c.name IN ('Lorena Barros','Vaz','Teste','Clínica Demo Med4Grow')
  AND p.phone IS NOT NULL AND p.phone <> '';

-- =====================================================================
-- Fase 2: Merge — lead_manual → lead_original (1 ticket por jornada)
-- =====================================================================
DO $$
DECLARE
  audit RECORD;
  v_apt_ativo_count int;
  v_skipped int := 0;
  v_merged  int := 0;
BEGIN
  FOR audit IN SELECT * FROM merge_audit_2026_05_14 LOOP
    -- Pular se lead_original não tem ticket aberto (caso de borda)
    IF audit.ticket_original_id IS NULL THEN
      RAISE NOTICE 'SKIP patient=% : lead_original=% sem ticket aberto',
        audit.patient_id, audit.lead_original_id;
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- Verificar conflito de apt ativo no ticket_original
    SELECT COUNT(*) INTO v_apt_ativo_count
    FROM appointments
    WHERE ticket_id = audit.ticket_original_id
      AND status NOT IN ('cancelado','faltou');

    IF v_apt_ativo_count > 0 THEN
      RAISE NOTICE 'SKIP patient=% : ticket_original=% já tem % apt(s) ativo(s)',
        audit.patient_id, audit.ticket_original_id, v_apt_ativo_count;
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- 1) Avançar ticket original para a stage/outcome do ticket manual
    UPDATE tickets
      SET stage_id   = audit.manual_stage_id,
          outcome    = audit.manual_outcome,
          outcome_at = audit.manual_outcome_at
      WHERE id = audit.ticket_original_id;

    -- 2) Mover appointments
    UPDATE appointments
      SET ticket_id = audit.ticket_original_id
      WHERE ticket_id = audit.ticket_manual_id;

    -- 3) Mover conversions
    UPDATE conversions
      SET lead_id   = audit.lead_original_id,
          ticket_id = audit.ticket_original_id
      WHERE lead_id = audit.lead_manual_id;

    -- 4) Marcar converted_patient_id no lead original
    UPDATE leads
      SET converted_patient_id = audit.patient_id
      WHERE id = audit.lead_original_id
        AND converted_patient_id IS NULL;

    -- 5) Apagar ticket manual (sem appointments/conversions agora)
    DELETE FROM tickets WHERE id = audit.ticket_manual_id;

    -- 6) Apagar lead manual (sem tickets/conversions/chat_messages)
    DELETE FROM leads WHERE id = audit.lead_manual_id;

    v_merged := v_merged + 1;
  END LOOP;

  RAISE NOTICE 'MERGE done. merged=% skipped=%', v_merged, v_skipped;
END $$;

-- =====================================================================
-- Fase 3: Normalizar phones em patients e leads remanescentes
-- =====================================================================
UPDATE patients SET phone = normalize_br_phone(phone)
WHERE phone IS NOT NULL AND phone <> ''
  AND phone <> normalize_br_phone(phone)
  AND clinic_id IN (
    SELECT id FROM clinics
    WHERE name IN ('Lorena Barros','Vaz','Clínica Demo Med4Grow','Teste')
  );

UPDATE leads SET phone = normalize_br_phone(phone)
WHERE source = 'manual'
  AND phone IS NOT NULL AND phone <> ''
  AND phone <> normalize_br_phone(phone)
  AND clinic_id IN (
    SELECT id FROM clinics
    WHERE name IN ('Lorena Barros','Vaz','Clínica Demo Med4Grow','Teste')
  );
