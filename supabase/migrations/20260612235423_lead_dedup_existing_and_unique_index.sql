-- 20260612235423_lead_dedup_existing_and_unique_index
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

DO $$
DECLARE g RECORD; v_keeper uuid; l RECORD;
BEGIN
  FOR g IN
    SELECT clinic_id, normalize_br_phone(phone) np
    FROM leads WHERE phone IS NOT NULL AND length(normalize_br_phone(phone))>=12
    GROUP BY 1,2 HAVING count(*)>1
  LOOP
    SELECT l2.id INTO v_keeper FROM leads l2
      WHERE l2.clinic_id=g.clinic_id AND normalize_br_phone(l2.phone)=g.np
      ORDER BY (SELECT count(*) FROM chat_messages m WHERE m.lead_id=l2.id) DESC, l2.created_at ASC LIMIT 1;
    FOR l IN SELECT id FROM leads WHERE clinic_id=g.clinic_id AND normalize_br_phone(phone)=g.np AND id<>v_keeper LOOP
      UPDATE chat_messages      SET lead_id=v_keeper WHERE lead_id=l.id;
      UPDATE automation_logs    SET lead_id=v_keeper WHERE lead_id=l.id;
      UPDATE conversions        SET lead_id=v_keeper WHERE lead_id=l.id;
      UPDATE lead_stage_history SET lead_id=v_keeper WHERE lead_id=l.id;
      UPDATE tickets SET status='closed', closed_at=now(),
        notes=COALESCE(notes||' | ','')||'merge lead duplicado (variante 9digito) 13/06'
        WHERE lead_id=l.id AND status='open';
      UPDATE tickets SET lead_id=v_keeper WHERE lead_id=l.id;
      DELETE FROM leads WHERE id=l.id;
    END LOOP;
    UPDATE leads SET phone=normalize_br_phone(phone) WHERE id=v_keeper AND phone IS DISTINCT FROM normalize_br_phone(phone);
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_leads_normalized_phone
  ON public.leads (clinic_id, normalize_br_phone(phone))
  WHERE phone IS NOT NULL AND length(normalize_br_phone(phone)) >= 12;
