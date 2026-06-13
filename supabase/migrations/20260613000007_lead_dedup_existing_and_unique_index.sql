-- Saneia os leads duplicados por variante de 9o digito ja existentes e cria indice unico
-- por telefone NORMALIZADO (trava a duplicidade no banco). Roda APOS 20260613000006.
--
-- Para cada grupo (clinica, telefone normalizado) com >1 lead: keeper = o com mais
-- mensagens (depois mais antigo); move chat_messages/automation_logs/conversions/
-- lead_stage_history p/ o keeper; fecha o ticket aberto do loser e re-aponta os tickets;
-- deleta o loser (sem perder conversa, pois ja foi movida). FKs p/ leads sao CASCADE
-- (chat_messages/automation_logs/lead_stage_history/conversions) e SET NULL (tickets) -
-- por isso a ordem importa: mover antes de deletar.

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
