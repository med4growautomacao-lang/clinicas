-- RPC do onboarding: importa as conversas do store da uazapi para a etapa Sincronização.
--
-- - Trava de acesso: super admin OU admin da clínica.
-- - Liga o "interruptor de silêncio" (app.onboarding_import='on') para os 9 gatilhos guardados
--   não dispararem (nada de enviar/mover card/enfileirar IA/mexer em atribuição na importação).
-- - Puxa o que JÁ está no store da uazapi (os ~7 dias automáticos + o que o history-sync trouxe);
--   a varredura chat-a-chat até 30 dias é peça separada.
-- - Idempotente: dedup por wa_message_id, lead achado por telefone normalizado, 1 ticket aberto
--   por lead na Sincronização. Reexecutar não duplica.
-- - Casa mensagem->chat por wa_chatid OU wa_chatlid (senão perde ~60% das msgs, chaveadas por @lid).
-- - Falha registra na Central de Erros (log_system_error).

CREATE OR REPLACE FUNCTION public.onboarding_import_conversations(p_clinic_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
-- 'extensions' no path: a chamada HTTP síncrona (http/http_header/http_request) mora lá.
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_tok       text;
  v_stage     uuid;
  v_chats     jsonb;
  v_msgs      jsonb;
  rec         record;
  v_lead      uuid;
  v_ticket    uuid;
  v_cut       timestamptz := now() - interval '30 days';
  v_new_leads int := 0;
  v_new_msgs  int := 0;
  v_rc        int;
BEGIN
  IF NOT (is_super_admin() OR is_clinic_admin(p_clinic_id)) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;

  SELECT id INTO v_stage FROM funnel_stages
   WHERE clinic_id = p_clinic_id AND slug = 'sincronizacao' LIMIT 1;
  IF v_stage IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'no_sincronizacao_stage');
  END IF;

  SELECT api_token INTO v_tok FROM whatsapp_instances
   WHERE clinic_id = p_clinic_id AND api_token IS NOT NULL
   ORDER BY (status = 'connected') DESC NULLS LAST LIMIT 1;
  IF v_tok IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'no_whatsapp_instance');
  END IF;

  PERFORM set_config('app.onboarding_import', 'on', true);   -- interruptor de silêncio (transação)

  SELECT (http(('POST', 'https://med4growautomacao.uazapi.com/chat/find',
     ARRAY[http_header('token', v_tok)], 'application/json',
     '{"operator":"AND","sort":"-wa_lastMsgTimestamp","limit":400,"offset":0}')::http_request)).content::jsonb -> 'chats'
    INTO v_chats;
  SELECT (http(('POST', 'https://med4growautomacao.uazapi.com/message/find',
     ARRAY[http_header('token', v_tok)], 'application/json',
     '{"operator":"AND","sort":"messageTimestamp","limit":8000,"offset":0}')::http_request)).content::jsonb -> 'messages'
    INTO v_msgs;

  IF v_chats IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'uazapi_no_chats');
  END IF;

  CREATE TEMP TABLE _imp_msgs ON COMMIT DROP AS
  SELECT m->>'chatid' AS chatid, m->>'messageid' AS messageid,
         (m->>'fromMe')::boolean AS from_me,
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
    SELECT id INTO v_lead FROM leads
     WHERE clinic_id = p_clinic_id AND normalize_br_phone(phone) = rec.nphone LIMIT 1;

    IF v_lead IS NULL THEN
      INSERT INTO leads (clinic_id, name, phone, source, capture_channel, ai_enabled, followup_enabled, avatar_url, created_at, updated_at)
      VALUES (p_clinic_id, rec.nome, rec.nphone, NULL, 'whatsapp', false, false, rec.foto,
              coalesce((SELECT min(created_sp) FROM _imp_msgs WHERE chatid = rec.chatid OR (rec.chatlid IS NOT NULL AND chatid = rec.chatlid)),
                       now() AT TIME ZONE 'America/Sao_Paulo'),
              now() AT TIME ZONE 'America/Sao_Paulo')
      RETURNING id INTO v_lead;
      v_new_leads := v_new_leads + 1;
    ELSE
      UPDATE leads SET
        name = CASE WHEN name IS NULL OR name = '' OR name LIKE 'Lead %' THEN rec.nome ELSE name END,
        avatar_url = coalesce(avatar_url, rec.foto)
      WHERE id = v_lead;
    END IF;

    SELECT id INTO v_ticket FROM tickets
     WHERE lead_id = v_lead AND status = 'open' ORDER BY opened_at DESC LIMIT 1;
    IF v_ticket IS NULL THEN
      INSERT INTO tickets (clinic_id, lead_id, stage_id, status, opened_at)
      VALUES (p_clinic_id, v_lead, v_stage, 'open', now()) RETURNING id INTO v_ticket;
    END IF;

    INSERT INTO chat_messages (clinic_id, lead_id, ticket_id, phone, direction, sender, wa_message_id, message, created_at)
    SELECT p_clinic_id, v_lead, v_ticket, rec.nphone,
           CASE WHEN mm.from_me THEN 'outbound' ELSE 'inbound' END,
           'human', mm.messageid,
           jsonb_build_object('type','human','content',mm.content,'additional_kwargs','{}'::jsonb,'response_metadata','{}'::jsonb),
           mm.created_sp
    FROM _imp_msgs mm
    WHERE (mm.chatid = rec.chatid OR (rec.chatlid IS NOT NULL AND mm.chatid = rec.chatlid))
      AND NOT EXISTS (SELECT 1 FROM chat_messages x WHERE x.clinic_id = p_clinic_id AND x.wa_message_id = mm.messageid)
    ORDER BY mm.created_sp;
    GET DIAGNOSTICS v_rc = ROW_COUNT;
    v_new_msgs := v_new_msgs + v_rc;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'new_leads', v_new_leads,
    'new_messages', v_new_msgs,
    'total_leads', (SELECT count(*) FROM leads WHERE clinic_id = p_clinic_id),
    'total_messages', (SELECT count(*) FROM chat_messages WHERE clinic_id = p_clinic_id),
    'tickets_sincronizacao', (SELECT count(*) FROM tickets t JOIN funnel_stages fs ON fs.id = t.stage_id
                              WHERE t.clinic_id = p_clinic_id AND fs.slug = 'sincronizacao')
  );

EXCEPTION WHEN OTHERS THEN
  PERFORM log_system_error('onboarding-import', 'import_failed',
    'Falha ao importar conversas do onboarding (store uazapi -> Sincronização)', 'error',
    p_clinic_id, jsonb_build_object('detail', sqlerrm), false);
  RETURN jsonb_build_object('success', false, 'error_code', 'exception', 'detail', sqlerrm);
END;
$function$;

-- Só admin da clínica / super admin chamam (a própria função revalida por dentro).
REVOKE ALL ON FUNCTION public.onboarding_import_conversations(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.onboarding_import_conversations(uuid) TO authenticated;
