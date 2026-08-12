-- 20260724061428_20260724180000_onboarding_broaden_guard
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Quem pode rodar o onboarding: super-admin, admin de org (is_clinic_admin) OU gestor/médico-gestor
-- da própria clínica (clinic_users). is_clinic_admin sozinho excluía o gestor de clínica.
CREATE OR REPLACE FUNCTION public.fn_can_onboard(p_clinic_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT is_super_admin()
      OR is_clinic_admin(p_clinic_id)
      OR EXISTS (
        SELECT 1 FROM public.clinic_users
        WHERE id = auth.uid() AND clinic_id = p_clinic_id
          AND role IN ('gestor', 'medico_gestor') AND coalesce(is_active, true)
      );
$function$;

-- Troca a trava das duas RPCs (só o guard muda; corpo idêntico ao já aplicado).
CREATE OR REPLACE FUNCTION public.onboarding_import_conversations(p_clinic_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_tok text; v_stage uuid; v_chats jsonb; v_msgs jsonb; rec record;
  v_lead uuid; v_ticket uuid; v_cut timestamptz := now() - interval '30 days';
  v_new_leads int := 0; v_new_msgs int := 0; v_rc int;
BEGIN
  IF NOT fn_can_onboard(p_clinic_id) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;

  SELECT id INTO v_stage FROM funnel_stages WHERE clinic_id = p_clinic_id AND slug = 'sincronizacao' LIMIT 1;
  IF v_stage IS NULL THEN RETURN jsonb_build_object('success', false, 'error_code', 'no_sincronizacao_stage'); END IF;

  SELECT api_token INTO v_tok FROM whatsapp_instances
   WHERE clinic_id = p_clinic_id AND api_token IS NOT NULL
   ORDER BY (status = 'connected') DESC NULLS LAST LIMIT 1;
  IF v_tok IS NULL THEN RETURN jsonb_build_object('success', false, 'error_code', 'no_whatsapp_instance'); END IF;

  PERFORM set_config('app.onboarding_import', 'on', true);

  SELECT (http(('POST', 'https://med4growautomacao.uazapi.com/chat/find',
     ARRAY[http_header('token', v_tok)], 'application/json',
     '{"operator":"AND","sort":"-wa_lastMsgTimestamp","limit":400,"offset":0}')::http_request)).content::jsonb -> 'chats' INTO v_chats;
  SELECT (http(('POST', 'https://med4growautomacao.uazapi.com/message/find',
     ARRAY[http_header('token', v_tok)], 'application/json',
     '{"operator":"AND","sort":"messageTimestamp","limit":8000,"offset":0}')::http_request)).content::jsonb -> 'messages' INTO v_msgs;

  IF v_chats IS NULL THEN RETURN jsonb_build_object('success', false, 'error_code', 'uazapi_no_chats'); END IF;

  CREATE TEMP TABLE _imp_msgs ON COMMIT DROP AS
  SELECT m->>'chatid' AS chatid, m->>'messageid' AS messageid, (m->>'fromMe')::boolean AS from_me,
         coalesce(nullif(btrim(coalesce(m->>'text', m->>'content','')),''), '['||coalesce(m->>'messageType','msg')||']') AS content,
         (to_timestamp((m->>'messageTimestamp')::bigint/1000) AT TIME ZONE 'America/Sao_Paulo') AS created_sp
  FROM jsonb_array_elements(coalesce(v_msgs, '[]'::jsonb)) m
  WHERE to_timestamp((m->>'messageTimestamp')::bigint/1000) >= v_cut;
  CREATE INDEX ON _imp_msgs(chatid);

  FOR rec IN
    SELECT c->>'wa_chatid' AS chatid, nullif(btrim(c->>'wa_chatlid'),'') AS chatlid,
           normalize_br_phone(c->>'phone') AS nphone,
           coalesce(nullif(btrim(c->>'wa_name'),''), nullif(btrim(c->>'name'),''), nullif(btrim(c->>'wa_contactName'),''), 'Lead') AS nome,
           nullif(btrim(c->>'imagePreview'),'') AS foto
    FROM jsonb_array_elements(v_chats) c
    WHERE (c->>'wa_isGroup')::boolean IS NOT TRUE
      AND nullif(c->>'wa_lastMsgTimestamp','0') IS NOT NULL
      AND to_timestamp((c->>'wa_lastMsgTimestamp')::bigint/1000) >= v_cut
      AND length(coalesce(normalize_br_phone(c->>'phone'),'')) >= 12
  LOOP
    SELECT id INTO v_lead FROM leads WHERE clinic_id = p_clinic_id AND normalize_br_phone(phone) = rec.nphone LIMIT 1;
    IF v_lead IS NULL THEN
      INSERT INTO leads (clinic_id, name, phone, source, capture_channel, ai_enabled, followup_enabled, avatar_url, created_at, updated_at)
      VALUES (p_clinic_id, rec.nome, rec.nphone, NULL, 'whatsapp', false, false, rec.foto,
              coalesce((SELECT min(created_sp) FROM _imp_msgs WHERE chatid = rec.chatid OR (rec.chatlid IS NOT NULL AND chatid = rec.chatlid)),
                       now() AT TIME ZONE 'America/Sao_Paulo'),
              now() AT TIME ZONE 'America/Sao_Paulo')
      RETURNING id INTO v_lead;
      v_new_leads := v_new_leads + 1;
    ELSE
      UPDATE leads SET name = CASE WHEN name IS NULL OR name = '' OR name LIKE 'Lead %' THEN rec.nome ELSE name END,
             avatar_url = coalesce(avatar_url, rec.foto) WHERE id = v_lead;
    END IF;

    SELECT id INTO v_ticket FROM tickets WHERE lead_id = v_lead AND status = 'open' ORDER BY opened_at DESC LIMIT 1;
    IF v_ticket IS NULL THEN
      INSERT INTO tickets (clinic_id, lead_id, stage_id, status, opened_at)
      VALUES (p_clinic_id, v_lead, v_stage, 'open', now()) RETURNING id INTO v_ticket;
    END IF;

    INSERT INTO chat_messages (clinic_id, lead_id, ticket_id, phone, direction, sender, wa_message_id, message, created_at)
    SELECT p_clinic_id, v_lead, v_ticket, rec.nphone,
           CASE WHEN mm.from_me THEN 'outbound' ELSE 'inbound' END, 'human', mm.messageid,
           jsonb_build_object('type','human','content',mm.content,'additional_kwargs','{}'::jsonb,'response_metadata','{}'::jsonb),
           mm.created_sp
    FROM _imp_msgs mm
    WHERE (mm.chatid = rec.chatid OR (rec.chatlid IS NOT NULL AND mm.chatid = rec.chatlid))
      AND NOT EXISTS (SELECT 1 FROM chat_messages x WHERE x.clinic_id = p_clinic_id AND x.wa_message_id = mm.messageid)
    ORDER BY mm.created_sp;
    GET DIAGNOSTICS v_rc = ROW_COUNT;
    v_new_msgs := v_new_msgs + v_rc;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'new_leads', v_new_leads, 'new_messages', v_new_msgs,
    'total_leads', (SELECT count(*) FROM leads WHERE clinic_id = p_clinic_id),
    'total_messages', (SELECT count(*) FROM chat_messages WHERE clinic_id = p_clinic_id),
    'tickets_sincronizacao', (SELECT count(*) FROM tickets t JOIN funnel_stages fs ON fs.id = t.stage_id
                              WHERE t.clinic_id = p_clinic_id AND fs.slug = 'sincronizacao'));
EXCEPTION WHEN OTHERS THEN
  PERFORM log_system_error('onboarding-import', 'import_failed',
    'Falha ao importar conversas do onboarding (store uazapi -> Sincronização)', 'error',
    p_clinic_id, jsonb_build_object('detail', sqlerrm), false);
  RETURN jsonb_build_object('success', false, 'error_code', 'exception', 'detail', sqlerrm);
END;
$function$;

CREATE OR REPLACE FUNCTION public.onboarding_audit_apply(
  p_ticket_id uuid, p_not_patient boolean DEFAULT false, p_in_conversation boolean DEFAULT false,
  p_last_appt_date date DEFAULT NULL, p_resolve_past boolean DEFAULT true, p_next_appt_date date DEFAULT NULL,
  p_ai_enabled boolean DEFAULT false, p_followup_enabled boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_lead uuid; v_clinic uuid; v_status text; v_ganho uuid; v_agendado uuid; v_wa uuid;
  v_past_status text; v_past_ticket uuid; v_action text;
BEGIN
  SELECT lead_id, clinic_id, status INTO v_lead, v_clinic, v_status FROM tickets WHERE id = p_ticket_id;
  IF v_lead IS NULL THEN RETURN jsonb_build_object('success', false, 'error_code', 'ticket_not_found'); END IF;
  IF NOT fn_can_onboard(v_clinic) THEN RETURN jsonb_build_object('success', false, 'error_code', 'forbidden'); END IF;

  PERFORM set_config('app.onboarding_import', 'on', true);
  PERFORM set_config('app.stage_source', 'onboarding', true);

  IF p_not_patient THEN
    UPDATE leads SET is_not_lead = true, ai_enabled = false, followup_enabled = false, not_lead_at = now() WHERE id = v_lead;
    UPDATE tickets SET status = 'closed', closed_at = coalesce(closed_at, now()) WHERE id = p_ticket_id AND status <> 'closed';
    RETURN jsonb_build_object('success', true, 'action', 'not_patient', 'lead_id', v_lead);
  END IF;

  IF p_last_appt_date IS NOT NULL AND NOT p_resolve_past AND (p_next_appt_date IS NOT NULL OR p_in_conversation) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'resolve_past_required_with_open_current');
  END IF;

  UPDATE leads SET ai_enabled = p_ai_enabled, followup_enabled = p_followup_enabled, is_not_lead = false WHERE id = v_lead;

  v_past_status := CASE
    WHEN p_last_appt_date IS NULL THEN NULL
    WHEN (p_next_appt_date IS NOT NULL OR p_in_conversation) THEN 'closed'
    WHEN p_resolve_past THEN 'closed' ELSE 'open' END;

  IF v_past_status = 'open' THEN
    UPDATE tickets SET status = 'closed', closed_at = coalesce(closed_at, now()) WHERE id = p_ticket_id AND status <> 'closed';
  END IF;

  IF p_last_appt_date IS NOT NULL THEN
    SELECT id INTO v_ganho FROM funnel_stages WHERE clinic_id = v_clinic AND slug = 'ganho' LIMIT 1;
    INSERT INTO tickets (clinic_id, lead_id, stage_id, status, outcome, opened_at, closed_at, outcome_at, notes)
    VALUES (v_clinic, v_lead, v_ganho, v_past_status, 'ganho',
            (p_last_appt_date::timestamp) AT TIME ZONE 'America/Sao_Paulo',
            CASE WHEN v_past_status = 'closed' THEN (p_last_appt_date::timestamp) AT TIME ZONE 'America/Sao_Paulo' END,
            (p_last_appt_date::timestamp) AT TIME ZONE 'America/Sao_Paulo',
            'Atendimento anterior em ' || to_char(p_last_appt_date, 'DD/MM/YYYY') || ' (onboarding)')
    RETURNING id INTO v_past_ticket;
  END IF;

  IF EXISTS (SELECT 1 FROM tickets WHERE id = p_ticket_id AND status = 'open') THEN
    IF p_next_appt_date IS NOT NULL THEN
      SELECT id INTO v_agendado FROM funnel_stages WHERE clinic_id = v_clinic AND slug = 'agendado' LIMIT 1;
      UPDATE tickets SET stage_id = v_agendado,
             notes = 'Próximo agendamento em ' || to_char(p_next_appt_date, 'DD/MM/YYYY') || ' (onboarding)' WHERE id = p_ticket_id;
      v_action := 'agendado';
    ELSIF p_in_conversation THEN
      SELECT id INTO v_wa FROM funnel_stages WHERE clinic_id = v_clinic AND slug = 'whatsapp' LIMIT 1;
      UPDATE tickets SET stage_id = v_wa WHERE id = p_ticket_id;
      v_action := 'em_conversa';
    ELSIF p_last_appt_date IS NOT NULL AND v_past_status = 'closed' THEN
      UPDATE tickets SET status = 'closed', closed_at = coalesce(closed_at, now()) WHERE id = p_ticket_id;
      v_action := 'passado_resolvido';
    ELSE v_action := 'mantido_na_sincronizacao'; END IF;
  ELSE v_action := 'passado_aberto'; END IF;

  RETURN jsonb_build_object('success', true, 'action', v_action, 'lead_id', v_lead, 'past_ticket', v_past_ticket, 'past_status', v_past_status);
EXCEPTION WHEN OTHERS THEN
  PERFORM log_system_error('onboarding-audit', 'audit_apply_failed', 'Falha ao aplicar auditoria de onboarding', 'error',
    v_clinic, jsonb_build_object('ticket_id', p_ticket_id, 'detail', sqlerrm), false);
  RETURN jsonb_build_object('success', false, 'error_code', 'exception', 'detail', sqlerrm);
END;
$function$;
