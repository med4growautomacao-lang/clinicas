-- 20260410122903_merge_duplicate_leads_remove_9th_digit
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

DO $$
DECLARE
  r RECORD;
BEGIN
  -- Para cada par conflitante: lead_com_9 (original) + lead_sem_9 (duplicata de hoje)
  FOR r IN
    SELECT l1.id AS id_com_9, l2.id AS id_sem_9
    FROM leads l1
    JOIN leads l2 ON l1.clinic_id = l2.clinic_id
      AND substring(l1.phone, 1, 4) || substring(l1.phone, 6) = l2.phone
    WHERE l1.phone ~ '^55[0-9]{2}9[0-9]{8}$'
      AND l2.phone !~ '^55[0-9]{2}9[0-9]{8}$'
  LOOP
    -- Transfere mensagens do duplicado para o original
    UPDATE chat_messages SET lead_id = r.id_com_9 WHERE lead_id = r.id_sem_9;
    -- Transfere logs de automação
    UPDATE automation_logs SET lead_id = r.id_com_9 WHERE lead_id = r.id_sem_9;
    -- Transfere histórico de stage
    UPDATE lead_stage_history SET lead_id = r.id_com_9 WHERE lead_id = r.id_sem_9;
    -- Apaga o duplicado sem 9
    DELETE FROM leads WHERE id = r.id_sem_9;
  END LOOP;
END;
$$;

-- Agora remove o 9 de todos os leads restantes
UPDATE leads
SET phone = substring(phone, 1, 4) || substring(phone, 6)
WHERE phone ~ '^55[0-9]{2}9[0-9]{8}$';

-- clinics.phone
UPDATE clinics
SET phone = substring(phone, 1, 4) || substring(phone, 6)
WHERE phone ~ '^55[0-9]{2}9[0-9]{8}$';

-- ai_config.phone
UPDATE ai_config
SET phone = substring(phone, 1, 4) || substring(phone, 6)
WHERE phone ~ '^55[0-9]{2}9[0-9]{8}$';

-- whatsapp_instances.phone_number
UPDATE whatsapp_instances
SET phone_number = substring(phone_number, 1, 4) || substring(phone_number, 6)
WHERE phone_number ~ '^55[0-9]{2}9[0-9]{8}$';

-- chat_messages.phone
UPDATE chat_messages
SET phone = substring(phone, 1, 4) || substring(phone, 6)
WHERE phone ~ '^55[0-9]{2}9[0-9]{8}$';

-- chat_messages.session_id (formato: 13chars clínica + 13chars lead)
-- Remove 9 do primeiro número (posição 5) se necessário
-- Remove 9 do segundo número (posição 18) se necessário
UPDATE chat_messages
SET session_id =
  CASE WHEN substring(session_id, 1, 13) ~ '^55[0-9]{2}9[0-9]{8}$'
       THEN substring(session_id, 1, 4) || substring(session_id, 6, 8)
       ELSE substring(session_id, 1, 12)
  END ||
  CASE WHEN substring(session_id, 14, 13) ~ '^55[0-9]{2}9[0-9]{8}$'
       THEN substring(session_id, 14, 4) || substring(session_id, 19)
       ELSE substring(session_id, 14)
  END
WHERE session_id ~ '55[0-9]{2}9[0-9]{8}';
