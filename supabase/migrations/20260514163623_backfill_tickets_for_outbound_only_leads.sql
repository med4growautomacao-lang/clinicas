-- 20260514163623_backfill_tickets_for_outbound_only_leads
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

DO $$
DECLARE
  r RECORD;
  v_stage_id uuid;
  v_ticket_id uuid;
  v_created int := 0;
BEGIN
  FOR r IN
    SELECT l.id AS lead_id, l.clinic_id, l.stage_id AS lead_stage
    FROM leads l
    WHERE
      -- Tem outbound, sem inbound, sem ticket
      EXISTS (SELECT 1 FROM chat_messages cm WHERE cm.lead_id = l.id AND cm.direction = 'outbound')
      AND NOT EXISTS (SELECT 1 FROM chat_messages cm WHERE cm.lead_id = l.id AND cm.direction = 'inbound')
      AND NOT EXISTS (SELECT 1 FROM tickets t WHERE t.lead_id = l.id)
  LOOP
    -- Stage: usa lead.stage_id se existir, senão primeira stage do funil
    v_stage_id := r.lead_stage;
    IF v_stage_id IS NULL THEN
      SELECT id INTO v_stage_id
      FROM funnel_stages
      WHERE clinic_id = r.clinic_id
      ORDER BY position
      LIMIT 1;
    END IF;

    IF v_stage_id IS NULL THEN
      CONTINUE; -- sem stage configurada, pula
    END IF;

    INSERT INTO tickets (clinic_id, lead_id, stage_id, status, opened_at)
    VALUES (r.clinic_id, r.lead_id, v_stage_id, 'open', NOW())
    RETURNING id INTO v_ticket_id;

    -- Vincula chat_messages outbound desse lead ao ticket (que não tinham ticket_id)
    UPDATE chat_messages
      SET ticket_id = v_ticket_id
      WHERE lead_id = r.lead_id AND ticket_id IS NULL;

    v_created := v_created + 1;
  END LOOP;

  RAISE NOTICE 'Tickets criados no backfill: %', v_created;
END $$;
