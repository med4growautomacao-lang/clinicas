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
