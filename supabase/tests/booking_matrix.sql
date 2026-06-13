-- Matriz de testes do agendamento consolidado.
-- Roda numa transacao com ROLLBACK no final -> NAO deixa residuo (seguro em branch ou prod).
-- Pressupoe as migrations 20260613000001..3 aplicadas.
-- Sucesso = executa sem erro (todas as ASSERT passam). Falha = excecao com a mensagem do caso.
--
-- Como rodar (via MCP, numa branch Supabase):
--   mcp__supabase__execute_sql(project_id=<branch>, query=<conteudo deste arquivo>)

BEGIN;
DO $$
DECLARE
  v_clinic   uuid;
  v_doctor   uuid;
  v_ct       uuid;
  v_res      jsonb;
  v_res2     jsonb;
  v_req      uuid := gen_random_uuid();
  v_phone_a  text := '5599' || lpad((floor(random()*100000000))::int::text, 8, '0');
  v_phone_d  text := '5598' || lpad((floor(random()*100000000))::int::text, 8, '0');
  v_phone_e  text := '5597' || lpad((floor(random()*100000000))::int::text, 8, '0');
  v_phone_f  text := '5596' || lpad((floor(random()*100000000))::int::text, 8, '0');
  v_p2       uuid;
  v_l3       uuid;
  v_lead     uuid;
  v_ticket   uuid;
  v_apt      uuid;
  v_d        date := current_date + 30;
  v_cnt      int;
  v_slug     text;
BEGIN
  -- ---- Fixtures ----
  -- Clinica REAL com etapa 'agendado' (join com clinics evita etapas-template de clinic_id zerado)
  SELECT fs.clinic_id INTO v_clinic
  FROM funnel_stages fs JOIN clinics c ON c.id = fs.clinic_id
  WHERE fs.slug = 'agendado' ORDER BY c.created_at LIMIT 1;
  ASSERT v_clinic IS NOT NULL, 'fixture: nenhuma clinica real com etapa agendado';

  -- Expediente fixo 09:00-12:00 todos os dias (slot_step 30) -> slots deterministicos p/ T8
  INSERT INTO doctors (clinic_id, name, is_active, consultation_duration, slot_step, working_hours)
  VALUES (v_clinic, 'ZZ Test Doctor', true, 30, 30,
    '{"0":[{"start":"09:00","end":"12:00"}],"1":[{"start":"09:00","end":"12:00"}],"2":[{"start":"09:00","end":"12:00"}],"3":[{"start":"09:00","end":"12:00"}],"4":[{"start":"09:00","end":"12:00"}],"5":[{"start":"09:00","end":"12:00"}],"6":[{"start":"09:00","end":"12:00"}]}'::jsonb)
  RETURNING id INTO v_doctor;

  INSERT INTO consultation_types (clinic_id, doctor_id, slug, name, modality, is_active, consultation_duration)
  VALUES (v_clinic, v_doctor, 'presencial', 'Presencial', 'presencial', true, 30) RETURNING id INTO v_ct;

  -- ===== T1: telefone invalido (IA) -> invalid_phone, sem appointment =====
  v_res := book_appointment(v_clinic, v_doctor, v_d, '09:00', 'Teste A', 'nao informado',
            p_source => 'ia', p_consultation_type_id => v_ct, p_validate_availability => false);
  ASSERT v_res->>'error_code' = 'invalid_phone', 'T1 esperava invalid_phone, veio: ' || v_res::text;

  -- ===== T2: telefone valido, identidade nova (IA) -> cria paciente+lead+ticket agendado =====
  v_res := book_appointment(v_clinic, v_doctor, v_d, '09:00', 'Teste B', v_phone_a,
            p_source => 'ia', p_consultation_type_id => v_ct, p_request_id => v_req,
            p_validate_availability => false);
  ASSERT (v_res->>'success')::boolean, 'T2 falhou: ' || v_res::text;
  v_apt    := (v_res->>'appointment_id')::uuid;
  v_lead   := (v_res->>'lead_id')::uuid;
  v_ticket := (v_res->>'ticket_id')::uuid;

  SELECT count(*) INTO v_cnt FROM patients
    WHERE clinic_id = v_clinic AND normalize_br_phone(phone) = normalize_br_phone(v_phone_a);
  ASSERT v_cnt = 1, 'T2 paciente nao criado/unico';

  SELECT fs.slug INTO v_slug FROM tickets t JOIN funnel_stages fs ON fs.id = t.stage_id WHERE t.id = v_ticket;
  ASSERT v_slug = 'agendado', 'T2 ticket nao esta em agendado: ' || COALESCE(v_slug,'(null)');

  SELECT ticket_id INTO v_ticket FROM appointments WHERE id = v_apt;
  ASSERT v_ticket = (v_res->>'ticket_id')::uuid, 'T2 appointment nao vinculado ao ticket resolvido';

  -- ===== T3: idempotencia (mesmo request_id) -> 1 appointment =====
  v_res2 := book_appointment(v_clinic, v_doctor, v_d, '09:00', 'Teste B', v_phone_a,
             p_source => 'ia', p_consultation_type_id => v_ct, p_request_id => v_req,
             p_validate_availability => false);
  ASSERT (v_res2->>'idempotent')::boolean IS TRUE, 'T3 nao retornou idempotent';
  ASSERT v_res2->>'appointment_id' = v_res->>'appointment_id', 'T3 appointment_id divergente';

  -- ===== T4: conflito de slot (mesmo doctor/date/time, outra identidade) -> slot_conflict =====
  v_res := book_appointment(v_clinic, v_doctor, v_d, '09:00', 'Teste C', v_phone_d,
            p_source => 'ia', p_consultation_type_id => v_ct, p_validate_availability => false);
  ASSERT v_res->>'error_code' = 'slot_conflict', 'T4 esperava slot_conflict, veio: ' || v_res::text;

  -- ===== T5: manual por patient_id -> reusa paciente, cria lead+ticket agendado =====
  INSERT INTO patients (clinic_id, name, phone) VALUES (v_clinic, 'Teste D', v_phone_d) RETURNING id INTO v_p2;
  v_res := book_appointment(v_clinic, v_doctor, v_d, '10:00', NULL, NULL,
            p_source => 'manual', p_consultation_type_id => v_ct, p_patient_id => v_p2,
            p_validate_availability => false);
  ASSERT (v_res->>'success')::boolean, 'T5 falhou: ' || v_res::text;
  ASSERT (v_res->>'patient_id')::uuid = v_p2, 'T5 nao reusou o paciente';
  SELECT count(*) INTO v_cnt FROM patients
    WHERE clinic_id = v_clinic AND normalize_br_phone(phone) = normalize_br_phone(v_phone_d);
  ASSERT v_cnt = 1, 'T5 duplicou paciente';
  SELECT fs.slug INTO v_slug FROM tickets t JOIN funnel_stages fs ON fs.id=t.stage_id WHERE t.id=(v_res->>'ticket_id')::uuid;
  ASSERT v_slug = 'agendado', 'T5 ticket nao agendado';

  -- ===== T6: Kanban por lead_id (wrapper convert_lead_to_appointment) =====
  INSERT INTO leads (clinic_id, name, phone, source, capture_channel, ai_enabled)
  VALUES (v_clinic, 'Teste E', v_phone_e, 'manual', 'manual', false) RETURNING id INTO v_l3;
  v_res := convert_lead_to_appointment(v_clinic, v_l3, v_doctor, v_d, '11:00',
            p_consultation_type_id => v_ct);
  ASSERT (v_res->>'success')::boolean, 'T6 falhou: ' || v_res::text;
  ASSERT (v_res->>'lead_id')::uuid = v_l3, 'T6 nao reusou o lead';
  SELECT fs.slug INTO v_slug FROM tickets t JOIN funnel_stages fs ON fs.id=t.stage_id WHERE t.id=(v_res->>'ticket_id')::uuid;
  ASSERT v_slug = 'agendado', 'T6 ticket nao agendado';

  -- ===== T7: invariantes (1 ticket aberto / 1 agendamento ativo por ticket) =====
  -- v_p2 ja tem agendamento ativo (T5). 2o book REUSA o ticket e e barrado pela constraint
  -- appointments_one_active_per_ticket -> error_code limpo, sem orfao, sem 2o ticket.
  v_res := book_appointment(v_clinic, v_doctor, v_d, '12:00', NULL, NULL,
            p_source => 'manual', p_consultation_type_id => v_ct, p_patient_id => v_p2,
            p_validate_availability => false);
  ASSERT v_res->>'error_code' = 'ticket_has_active_appointment', 'T7 esperava ticket_has_active_appointment: ' || v_res::text;
  SELECT count(*) INTO v_cnt FROM tickets t JOIN leads l ON l.id=t.lead_id
    WHERE l.clinic_id=v_clinic AND normalize_br_phone(l.phone)=normalize_br_phone(v_phone_d) AND t.status='open';
  ASSERT v_cnt = 1, 'T7 lead ficou com >1 ticket aberto (qtd=' || v_cnt || ')';

  -- Tentativa direta de 2o ticket aberto -> deve violar o indice unico
  BEGIN
    INSERT INTO tickets (clinic_id, lead_id, stage_id, status, opened_at)
    SELECT v_clinic, l.id, (SELECT id FROM funnel_stages WHERE clinic_id=v_clinic AND slug='whatsapp' LIMIT 1), 'open', now()
    FROM leads l WHERE l.clinic_id=v_clinic AND normalize_br_phone(l.phone)=normalize_br_phone(v_phone_d) LIMIT 1;
    RAISE EXCEPTION 'T7 indice unico NAO bloqueou 2o ticket aberto';
  EXCEPTION
    WHEN unique_violation THEN NULL;  -- esperado
  END;

  -- ===== T8: gate de disponibilidade (expediente 09:00-12:00), identidade nova =====
  -- T8a: validacao ligada + horario FORA do expediente (08:00) -> slot_unavailable (antes de criar identidade)
  v_res := book_appointment(v_clinic, v_doctor, v_d + 1, '08:00', 'Teste F', v_phone_f,
            p_source => 'ia', p_consultation_type_id => v_ct, p_validate_availability => true);
  ASSERT v_res->>'error_code' = 'slot_unavailable', 'T8a esperava slot_unavailable, veio: ' || v_res::text;
  -- T8b: validacao ligada + horario DENTRO do expediente e livre (09:00) -> passa
  v_res := book_appointment(v_clinic, v_doctor, v_d + 1, '09:00', 'Teste F', v_phone_f,
            p_source => 'ia', p_consultation_type_id => v_ct, p_validate_availability => true);
  ASSERT (v_res->>'success')::boolean, 'T8b deveria passar (slot valido): ' || v_res::text;

  -- ===== T9: reschedule =====
  -- encaixe forcado (p_force) -> sucesso e horario muda
  v_res := reschedule_appointment(v_apt, v_doctor, v_d + 2, '15:30', p_consultation_type_id => v_ct, p_force => true);
  ASSERT (v_res->>'success')::boolean, 'T9 reschedule falhou: ' || v_res::text;
  SELECT count(*) INTO v_cnt FROM appointments WHERE id=v_apt AND date=v_d+2 AND time='15:30';
  ASSERT v_cnt = 1, 'T9 reschedule nao atualizou data/hora';
  -- sem force, horario fora do expediente (16:00) -> slot_unavailable
  v_res := reschedule_appointment(v_apt, v_doctor, v_d + 3, '16:00', p_consultation_type_id => v_ct, p_force => false);
  ASSERT v_res->>'error_code' = 'slot_unavailable', 'T9 sem force esperava slot_unavailable';

  -- ===== T10/T11: identidade explicita inexistente -> erro limpo (sem orfao/FK cru) =====
  v_res := book_appointment(v_clinic, v_doctor, v_d + 5, '09:00', NULL, NULL,
            p_source => 'manual', p_consultation_type_id => v_ct, p_lead_id => gen_random_uuid(), p_validate_availability => false);
  ASSERT v_res->>'error_code' = 'lead_not_found', 'T10 esperava lead_not_found: ' || v_res::text;
  v_res := book_appointment(v_clinic, v_doctor, v_d + 5, '09:00', NULL, NULL,
            p_source => 'manual', p_consultation_type_id => v_ct, p_patient_id => gen_random_uuid(), p_validate_availability => false);
  ASSERT v_res->>'error_code' = 'patient_not_found', 'T11 esperava patient_not_found: ' || v_res::text;

  RAISE NOTICE 'BOOKING MATRIX: todos os casos passaram.';
END $$;
ROLLBACK;

-- ============================================================================
-- MATRIZ ESTENDIDA (cenarios adversariais / integracao / regressoes de 13/06)
-- ============================================================================
BEGIN;
DO $$
DECLARE
  v_cA uuid; v_doc uuid; v_doc2 uuid; v_ctP uuid; v_ctO uuid; v_ct2 uuid;
  v_wa uuid; v_perdido uuid;
  v_res jsonb; v_cnt int; v_elig boolean; v_fu boolean; v_dur int; v_mod text; v_slug text;
  v_d date := current_date + 120;
  v_base text := '7'||lpad((floor(random()*10000000))::int::text,7,'0');
  v_v13 text; v_v12 text;
  v_L uuid; v_TW uuid; v_PF uuid; v_apt uuid; v_Tclosed uuid;
  v_ph2 text := '5582'||lpad((floor(random()*100000000))::int::text,8,'0');
  v_phF text := '5583'||lpad((floor(random()*100000000))::int::text,8,'0');
  v_ph13a text := '5584'||lpad((floor(random()*100000000))::int::text,8,'0');
  v_ph13b text := '5585'||lpad((floor(random()*100000000))::int::text,8,'0');
  v_phR text := '5586'||lpad((floor(random()*100000000))::int::text,8,'0');
  v_wh jsonb := '{"0":[{"start":"09:00","end":"17:00"}],"1":[{"start":"09:00","end":"17:00"}],"2":[{"start":"09:00","end":"17:00"}],"3":[{"start":"09:00","end":"17:00"}],"4":[{"start":"09:00","end":"17:00"}],"5":[{"start":"09:00","end":"17:00"}],"6":[{"start":"09:00","end":"17:00"}]}'::jsonb;
BEGIN
  v_v13 := '55219'||v_base; v_v12 := '5521'||v_base;
  SELECT fs.clinic_id INTO v_cA FROM funnel_stages fs JOIN clinics c ON c.id=fs.clinic_id
   WHERE fs.slug='agendado' AND EXISTS(SELECT 1 FROM funnel_stages w WHERE w.clinic_id=fs.clinic_id AND w.slug='whatsapp') ORDER BY c.created_at LIMIT 1;
  SELECT id INTO v_wa FROM funnel_stages WHERE clinic_id=v_cA AND slug='whatsapp' LIMIT 1;
  SELECT id INTO v_perdido FROM funnel_stages WHERE clinic_id=v_cA AND slug='perdido' LIMIT 1;
  INSERT INTO doctors (clinic_id,name,is_active,consultation_duration,slot_step,working_hours) VALUES (v_cA,'ZZ DocX',true,30,30,v_wh) RETURNING id INTO v_doc;
  INSERT INTO doctors (clinic_id,name,is_active,consultation_duration,slot_step,working_hours,days_off,blocked_times)
    VALUES (v_cA,'ZZ DocX2',true,60,30,v_wh, jsonb_build_array((v_d+2)::text), jsonb_build_array(jsonb_build_object('date',(v_d+3)::text,'start','09:00','end','12:00','name','Bloq')))
    RETURNING id INTO v_doc2;
  INSERT INTO consultation_types (clinic_id,doctor_id,slug,name,modality,is_active,consultation_duration) VALUES (v_cA,v_doc,'presencial','P','presencial',true,30) RETURNING id INTO v_ctP;
  INSERT INTO consultation_types (clinic_id,doctor_id,slug,name,modality,is_active,consultation_duration) VALUES (v_cA,v_doc,'online','O','online',true,60) RETURNING id INTO v_ctO;
  INSERT INTO consultation_types (clinic_id,doctor_id,slug,name,modality,is_active,consultation_duration) VALUES (v_cA,v_doc2,'presencial','P2','presencial',true,60) RETURNING id INTO v_ct2;

  -- X1: reuso por 9o digito + sem duplicar lead (regressao do trigger auto_create_lead normalizado)
  INSERT INTO leads (clinic_id,name,phone,source,capture_channel,ai_enabled) VALUES (v_cA,'L9',v_v13,'whatsapp','whatsapp',true) RETURNING id INTO v_L;
  INSERT INTO tickets (clinic_id,lead_id,stage_id,status,opened_at) VALUES (v_cA,v_L,v_wa,'open',now()) RETURNING id INTO v_TW;
  v_res := book_appointment(v_cA,v_doc,v_d,'09:00','L9',v_v12, p_source=>'ia', p_consultation_type_id=>v_ctP, p_validate_availability=>false);
  ASSERT (v_res->>'ticket_id')::uuid=v_TW, 'X1 nao reusou ticket por 9digito';
  SELECT count(*) INTO v_cnt FROM leads WHERE clinic_id=v_cA AND normalize_br_phone(phone)=normalize_br_phone(v_v12);
  ASSERT v_cnt=1, 'X1 duplicou lead='||v_cnt;

  -- X2: criar paciente nao duplica lead existente (normalize no trigger de patients)
  INSERT INTO leads (clinic_id,name,phone,source,capture_channel,ai_enabled) VALUES (v_cA,'L2','55219'||substr(v_ph2,5),'whatsapp','whatsapp',true) RETURNING id INTO v_L;
  INSERT INTO patients (clinic_id,name,phone) VALUES (v_cA,'P2',v_ph2);
  SELECT count(*) INTO v_cnt FROM leads WHERE clinic_id=v_cA AND normalize_br_phone(phone)=normalize_br_phone(v_ph2);
  ASSERT v_cnt=1, 'X2 patient trigger duplicou lead='||v_cnt;

  -- X3: cancelar libera slot
  v_res := book_appointment(v_cA,v_doc,v_d,'10:00','C3a','5587'||lpad((floor(random()*100000000))::int::text,8,'0'), p_source=>'ia', p_consultation_type_id=>v_ctP, p_validate_availability=>false);
  UPDATE appointments SET status='cancelado' WHERE id=(v_res->>'appointment_id')::uuid;
  v_res := book_appointment(v_cA,v_doc,v_d,'10:00','C3b','5588'||lpad((floor(random()*100000000))::int::text,8,'0'), p_source=>'ia', p_consultation_type_id=>v_ctP, p_validate_availability=>false);
  ASSERT (v_res->>'success')::boolean, 'X3 cancelar nao liberou slot';

  -- X4: cancelar libera ticket (1 ativo/ticket)
  INSERT INTO patients (clinic_id,name,phone) VALUES (v_cA,'PF',v_phF) RETURNING id INTO v_PF;
  v_res := book_appointment(v_cA,v_doc,v_d,'11:00',NULL,NULL, p_source=>'manual', p_consultation_type_id=>v_ctP, p_patient_id=>v_PF, p_validate_availability=>false);
  UPDATE appointments SET status='cancelado' WHERE id=(v_res->>'appointment_id')::uuid;
  v_res := book_appointment(v_cA,v_doc,v_d,'11:30',NULL,NULL, p_source=>'manual', p_consultation_type_id=>v_ctP, p_patient_id=>v_PF, p_validate_availability=>false);
  ASSERT (v_res->>'success')::boolean, 'X4 cancelar nao liberou ticket';

  -- X5: sobreposicao de duracoes (online 60 vs presencial 30)
  v_res := book_appointment(v_cA,v_doc,v_d+1,'09:00','O5',v_ph13a, p_source=>'ia', p_consultation_type_id=>v_ctO, p_validate_availability=>false);
  ASSERT (v_res->>'success')::boolean, 'X5 online: '||v_res::text;
  v_res := book_appointment(v_cA,v_doc,v_d+1,'09:30','P5',v_ph13b, p_source=>'ia', p_consultation_type_id=>v_ctP, p_validate_availability=>false);
  ASSERT v_res->>'error_code'='slot_conflict', 'X5 nao detectou sobreposicao: '||v_res::text;

  -- X6: days_off e blocked_times respeitados (validate)
  v_res := book_appointment(v_cA,v_doc2,v_d+2,'09:00','Off','5589'||lpad((floor(random()*100000000))::int::text,8,'0'), p_source=>'ia', p_consultation_type_id=>v_ct2, p_validate_availability=>true);
  ASSERT v_res->>'error_code'='slot_unavailable', 'X6 days_off: '||v_res::text;
  v_res := book_appointment(v_cA,v_doc2,v_d+3,'09:00','Blk','5590'||lpad((floor(random()*100000000))::int::text,8,'0'), p_source=>'ia', p_consultation_type_id=>v_ct2, p_validate_availability=>true);
  ASSERT v_res->>'error_code'='slot_unavailable', 'X6 blocked: '||v_res::text;

  -- X7: reschedule trocando medico recalcula duracao (30 -> 60)
  v_res := book_appointment(v_cA,v_doc,v_d+4,'09:00','R7',v_phR, p_source=>'ia', p_consultation_type_id=>v_ctP, p_validate_availability=>false);
  v_apt := (v_res->>'appointment_id')::uuid;
  v_res := reschedule_appointment(v_apt, v_doc2, v_d+4, '14:00', p_consultation_type_id=>v_ct2, p_force=>true);
  ASSERT (v_res->>'success')::boolean, 'X7 reschedule: '||v_res::text;
  SELECT duration_minutes INTO v_dur FROM appointments WHERE id=v_apt;
  ASSERT v_dur=60, 'X7 duracao nao recalculada='||v_dur;

  -- X8: ticket so FECHADO -> cria novo aberto em agendado
  INSERT INTO leads (clinic_id,name,phone,source,capture_channel,ai_enabled) VALUES (v_cA,'LC','5591'||lpad((floor(random()*100000000))::int::text,8,'0'),'whatsapp','whatsapp',true) RETURNING id INTO v_L;
  INSERT INTO tickets (clinic_id,lead_id,stage_id,status,opened_at,closed_at) VALUES (v_cA,v_L,v_perdido,'closed',now(),now()) RETURNING id INTO v_Tclosed;
  v_res := convert_lead_to_appointment(v_cA,v_L,v_doc,v_d,'12:00', p_consultation_type_id=>v_ctP);
  ASSERT (v_res->>'ticket_id')::uuid <> v_Tclosed, 'X8 reusou ticket fechado';

  -- X9 (REGRESSAO DO BUG ORIGINAL): lead com agendamento futuro NAO e elegivel ao reengajamento
  INSERT INTO leads (clinic_id,name,phone,source,capture_channel,ai_enabled,followup_enabled) VALUES (v_cA,'LR','5592'||lpad((floor(random()*100000000))::int::text,8,'0'),'whatsapp','whatsapp',true,false) RETURNING id INTO v_L;
  INSERT INTO tickets (clinic_id,lead_id,stage_id,status,opened_at) VALUES (v_cA,v_L,v_wa,'open',now()) RETURNING id INTO v_TW;
  SELECT phone INTO v_slug FROM leads WHERE id=v_L;
  v_res := book_appointment(v_cA,v_doc,v_d,'13:00','LR',v_slug, p_source=>'ia', p_consultation_type_id=>v_ctP, p_validate_availability=>false);
  ASSERT (v_res->>'ticket_id')::uuid=v_TW, 'X9 nao reusou ticket do lead';
  SELECT EXISTS (SELECT 1 FROM tickets t JOIN funnel_stages fs ON fs.id=t.stage_id
     WHERE t.lead_id=v_L AND t.status='open' AND COALESCE(fs.slug,'') NOT IN ('agendado','compareceu','ganho','perdido')) INTO v_elig;
  ASSERT v_elig IS FALSE, 'X9 BUG: lead agendado ainda elegivel ao reengajamento';
  -- e o follow-up foi habilitado pelo trigger de appointment
  SELECT followup_enabled INTO v_fu FROM leads WHERE id=v_L;
  ASSERT v_fu IS TRUE, 'X9 followup nao habilitado';

  RAISE NOTICE 'MATRIZ ESTENDIDA: todos os casos passaram.';
END $$;
ROLLBACK;

-- ============================================================================
-- CICLO DE VIDA / RETORNO (migrations 20260613000008/9)
-- ============================================================================
BEGIN;
DO $$
DECLARE
  v_cA uuid; v_doc uuid; v_ct uuid; v_res jsonb; v_p uuid; v_T1 uuid; v_T2 uuid; v_A uuid;
  v_ph text := '5521'||lpad((floor(random()*100000000))::int::text,8,'0');
  v_d date := current_date + 160;
  v_wh jsonb := '{"0":[{"start":"09:00","end":"17:00"}],"1":[{"start":"09:00","end":"17:00"}],"2":[{"start":"09:00","end":"17:00"}],"3":[{"start":"09:00","end":"17:00"}],"4":[{"start":"09:00","end":"17:00"}],"5":[{"start":"09:00","end":"17:00"}],"6":[{"start":"09:00","end":"17:00"}]}'::jsonb;
BEGIN
  SELECT fs.clinic_id INTO v_cA FROM funnel_stages fs JOIN clinics c ON c.id=fs.clinic_id
   WHERE fs.slug='agendado' AND EXISTS(SELECT 1 FROM funnel_stages w WHERE w.clinic_id=fs.clinic_id AND w.slug='ganho') ORDER BY c.created_at LIMIT 1;
  INSERT INTO doctors (clinic_id,name,is_active,consultation_duration,slot_step,working_hours) VALUES (v_cA,'ZZ DocLC',true,30,30,v_wh) RETURNING id INTO v_doc;
  INSERT INTO consultation_types (clinic_id,doctor_id,slug,name,modality,is_active,consultation_duration) VALUES (v_cA,v_doc,'presencial','P','presencial',true,30) RETURNING id INTO v_ct;
  INSERT INTO patients (clinic_id,name,phone) VALUES (v_cA,'Ciclo',v_ph) RETURNING id INTO v_p;

  -- LC1: finalize com valor > 0 funciona (regressao do bug ON CONFLICT x indice parcial de conversions)
  v_res := book_appointment(v_cA,v_doc,v_d,'09:00',NULL,NULL, p_source=>'manual', p_consultation_type_id=>v_ct, p_patient_id=>v_p, p_validate_availability=>false);
  v_T1 := (v_res->>'ticket_id')::uuid; v_A := (v_res->>'appointment_id')::uuid;
  v_res := finalize_appointment(v_A, 150, 'pix', 'pago', 'Consulta', ARRAY[]::uuid[], v_T1);
  ASSERT (v_res->>'success')::boolean AND (v_res->>'transaction_id') IS NOT NULL AND (v_res->>'conversion_id') IS NOT NULL, 'LC1 finalize pago: '||v_res::text;
  v_res := finalize_appointment(v_A, 150, 'pix', 'pago', 'Consulta', ARRAY[]::uuid[], v_T1);
  ASSERT (v_res->>'idempotent')::boolean IS TRUE, 'LC1 idempotente';

  -- LC2: RETORNO com ticket em ganho/aberto -> auto-resolve (fecha) + jornada nova em agendado
  v_res := book_appointment(v_cA,v_doc,v_d+7,'09:00',NULL,NULL, p_source=>'manual', p_consultation_type_id=>v_ct, p_patient_id=>v_p, p_validate_availability=>false);
  ASSERT (v_res->>'success')::boolean, 'LC2 retorno: '||v_res::text;
  v_T2 := (v_res->>'ticket_id')::uuid;
  ASSERT v_T2 <> v_T1, 'LC2 reusou ticket ganho';
  ASSERT (SELECT status FROM tickets WHERE id=v_T1)='closed', 'LC2 antigo nao fechou';

  -- LC3: agendamento PENDENTE continua bloqueando o 2o (invariante correto)
  v_res := book_appointment(v_cA,v_doc,v_d+8,'09:00',NULL,NULL, p_source=>'manual', p_consultation_type_id=>v_ct, p_patient_id=>v_p, p_validate_availability=>false);
  ASSERT v_res->>'error_code'='ticket_has_active_appointment', 'LC3: '||v_res::text;

  -- LC4 (regra final 13/06, migration 0015): consulta ACONTECIDA (realizado OU compareceu)
  --      destrava o reagendamento: jornada antiga fecha, nova abre; a pendencia de
  --      finalizacao do compareceu fica INTACTA (consulta segue 'compareceu' p/ a secretaria)
  UPDATE appointments SET status='compareceu' WHERE ticket_id=v_T2 AND status='pendente';
  v_res := book_appointment(v_cA,v_doc,v_d+9,'09:00',NULL,NULL, p_source=>'manual', p_consultation_type_id=>v_ct, p_patient_id=>v_p, p_validate_availability=>false);
  ASSERT (v_res->>'success')::boolean AND (v_res->>'ticket_id')::uuid <> v_T2, 'LC4: '||v_res::text;
  ASSERT (SELECT status FROM tickets WHERE id=v_T2)='closed', 'LC4 antiga nao fechou';
  ASSERT (SELECT count(*) FROM appointments WHERE ticket_id=v_T2 AND status='compareceu')=1, 'LC4 pendencia compareceu sumiu';

  -- LC5 (regra 13/06): consulta ATRASADA (ontem, pendente, sem desfecho) tambem BLOQUEIA
  --      com awaiting_finalization (a secretaria da o desfecho antes de reagendar)
  DECLARE v_pS uuid;
    v_phS text := '5524'||lpad((floor(random()*100000000))::int::text,8,'0');
  BEGIN
    INSERT INTO patients (clinic_id,name,phone) VALUES (v_cA,'Atrasado',v_phS) RETURNING id INTO v_pS;
    v_res := book_appointment(v_cA,v_doc,current_date-1,'09:00',NULL,NULL, p_source=>'manual', p_consultation_type_id=>v_ct, p_patient_id=>v_pS, p_validate_availability=>false);
    v_res := book_appointment(v_cA,v_doc,v_d+14,'09:00',NULL,NULL, p_source=>'manual', p_consultation_type_id=>v_ct, p_patient_id=>v_pS, p_validate_availability=>false);
    ASSERT v_res->>'error_code'='ticket_has_active_appointment' AND v_res->>'reason'='awaiting_finalization', 'LC5: '||v_res::text;
  END;

  -- LC6: consulta de HOJE pendente -> continua bloqueando
  DECLARE v_pH uuid;
    v_phH text := '5525'||lpad((floor(random()*100000000))::int::text,8,'0');
  BEGIN
    INSERT INTO patients (clinic_id,name,phone) VALUES (v_cA,'Hoje',v_phH) RETURNING id INTO v_pH;
    v_res := book_appointment(v_cA,v_doc,current_date,'16:45',NULL,NULL, p_source=>'manual', p_consultation_type_id=>v_ct, p_patient_id=>v_pH, p_validate_availability=>false);
    ASSERT (v_res->>'success')::boolean, 'LC6 book hoje: '||v_res::text;
    v_res := book_appointment(v_cA,v_doc,v_d+15,'09:00',NULL,NULL, p_source=>'manual', p_consultation_type_id=>v_ct, p_patient_id=>v_pH, p_validate_availability=>false);
    ASSERT v_res->>'error_code'='ticket_has_active_appointment', 'LC6: '||v_res::text;
  END;

  RAISE NOTICE 'CICLO DE VIDA: todos os casos passaram.';
END $$;
ROLLBACK;
