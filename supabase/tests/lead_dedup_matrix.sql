-- Matriz de regressao da deduplicacao de lead (robustez ao 9o digito).
-- Roda em transacao com ROLLBACK (sem residuo). Pressupoe migrations 20260613000006/7.
-- Sucesso = sem erro (ASSERTs passam).

BEGIN;
DO $$
DECLARE
  v_cA uuid; v_res jsonb; v_cnt int; v_lead uuid; v_chatlead uuid; v_pstored text; v_b uuid; v_err boolean := false;
  v_base text := '8'||lpad((floor(random()*10000000))::int::text,7,'0');
  v_canon text; v_with9 text;
BEGIN
  v_canon := '5521'||v_base; v_with9 := '55219'||v_base;
  SELECT fs.clinic_id INTO v_cA FROM funnel_stages fs JOIN clinics c ON c.id=fs.clinic_id WHERE fs.slug='agendado' ORDER BY c.created_at LIMIT 1;

  -- L1: guarda canonicaliza o telefone do lead ao inserir (grava sem o 9o digito)
  INSERT INTO leads(clinic_id,name,phone,source,capture_channel) VALUES (v_cA,'G',v_with9,'manual','manual') RETURNING id INTO v_lead;
  SELECT phone INTO v_pstored FROM leads WHERE id=v_lead;
  ASSERT v_pstored = v_canon, 'L1 guarda nao canonicalizou: '||v_pstored;

  -- L2: create_lead_with_ticket com a variante sem-9 REUSA o lead (sem duplicar, ticket com lead)
  v_res := create_lead_with_ticket(v_cA,'App',v_canon);
  ASSERT (v_res->>'lead_id')::uuid = v_lead, 'L2 nao reusou lead';
  ASSERT (SELECT lead_id FROM tickets WHERE id=(v_res->>'ticket_id')::uuid) = v_lead, 'L2 ticket sem lead';
  SELECT count(*) INTO v_cnt FROM leads WHERE clinic_id=v_cA AND normalize_br_phone(phone)=v_canon; ASSERT v_cnt=1, 'L2 duplicou='||v_cnt;

  -- L3: create_lead_with_ticket com telefone NOVO -> 1 lead + 1 ticket (com lead)
  v_res := create_lead_with_ticket(v_cA,'Novo','5577'||lpad((floor(random()*100000000))::int::text,8,'0'));
  ASSERT (v_res->>'lead_id') IS NOT NULL AND (SELECT lead_id FROM tickets WHERE id=(v_res->>'ticket_id')::uuid) IS NOT NULL, 'L3 ticket sem lead';

  -- L4: WhatsApp (master_logic) com variante com-9 -> resolve p/ o lead existente (sem orfao, sem dup)
  INSERT INTO chat_messages(clinic_id, phone, message, direction, sender)
    VALUES (v_cA, v_with9, '{"role":"user","content":"oi"}'::jsonb, 'inbound','human') RETURNING lead_id INTO v_chatlead;
  ASSERT v_chatlead = v_lead, 'L4 WhatsApp orfao/dup: '||COALESCE(v_chatlead::text,'null');
  SELECT count(*) INTO v_cnt FROM leads WHERE clinic_id=v_cA AND normalize_br_phone(phone)=v_canon; ASSERT v_cnt=1, 'L4 duplicou='||v_cnt;

  -- L5: WhatsApp com numero novo -> cria lead e seta chat.lead_id (nunca orfao)
  INSERT INTO chat_messages(clinic_id, phone, message, direction, sender)
    VALUES (v_cA, '5566'||lpad((floor(random()*100000000))::int::text,8,'0'), '{"role":"user","content":"oi"}'::jsonb, 'inbound','human') RETURNING lead_id INTO v_chatlead;
  ASSERT v_chatlead IS NOT NULL, 'L5 WhatsApp novo nao setou lead_id';

  -- L6: indice unico normalizado bloqueia colisao por variante (via UPDATE, que nao passa pela guarda)
  INSERT INTO leads(clinic_id,name,phone,source,capture_channel) VALUES (v_cA,'B','5588'||v_base,'manual','manual') RETURNING id INTO v_b;
  BEGIN
    UPDATE leads SET phone='55219'||v_base WHERE id=v_b;  -- normaliza p/ o mesmo canonico de v_lead
    RAISE EXCEPTION 'L6 indice normalize NAO bloqueou';
  EXCEPTION WHEN unique_violation THEN v_err := true; END;
  ASSERT v_err, 'L6 esperava unique_violation';

  RAISE NOTICE 'LEAD DEDUP MATRIX: todos os casos passaram.';
END $$;
ROLLBACK;
