-- O import do onboarding parou de reimportar as mensagens que o PROPRIO sistema mandou.
--
-- ⚠️ ARQUEOLOGIA: esta versao foi SUBSTITUIDA ~5 minutos depois pela migration
-- 20260730120842_import_trava3_so_compara_com_linha_nossa, na mesma sessao. A trava (3) aqui
-- comparava com QUALQUER linha outbound do lead e por isso podia descartar mensagem historica
-- curta de verdade (uma mensagem antiga "Ok" e achada dentro de outra maior ja importada, dentro
-- dos 90s). O recorte `y.sender in ('ai','system')` que conserta isso esta na proxima migration.
-- O arquivo fica porque migration e historia: o estado final e o da migration seguinte.
--
-- Defeito (medido em 30/07/2026, Lorena): o deep-sync roda a cada 2 min e chama este import em
-- TODA rodada, lendo o store da uazapi sem limite superior de data. Ele pegava a resposta que o
-- Emissor tinha acabado de entregar e gravava de novo com sender='human' fixo: na tela, a fala da
-- IA aparecia DUPLICADA e como se um atendente tivesse escrito. 45 linhas em 7 leads, 45 de 45
-- casando com um envio nosso. Isso tambem empurra a regua IA x Humano (maioria de mensagens)
-- para Humano, porque cada fala da IA ganhava um gemeo "humano".
--
-- O dedup por wa_message_id nao pegava por DOIS motivos:
--   1) o Emissor grava `provider_message_id` = '<jid_da_clinica>:<messageid>' e o import compara
--      com o messageid PURO;
--   2) a resposta do agente (saveAiResponse) entra na conversa com wa_message_id NULL, porque o
--      worker grava UMA linha consolidada e o Emissor entrega N baloes: nao existe 1 para 1 entre
--      a linha da conversa e o id do provedor, logo nao ha id nenhum para comparar.
create or replace function public._onboarding_import_run(p_clinic_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
DECLARE
  v_tok text; v_stage uuid; v_chats jsonb; v_msgs jsonb; rec record;
  v_lead uuid; v_ticket uuid; v_cut timestamptz := _onboarding_import_window(p_clinic_id);
  v_new_leads int := 0; v_new_msgs int := 0; v_rc int;
  v_lim_chats  constant int := 400;
  v_lim_msgs   constant int := 8000;
  v_n_chats int; v_n_msgs int;
BEGIN
  SELECT id INTO v_stage FROM funnel_stages WHERE clinic_id = p_clinic_id AND slug = 'sincronizacao' LIMIT 1;
  IF v_stage IS NULL THEN RETURN jsonb_build_object('success', false, 'error_code', 'no_sincronizacao_stage'); END IF;

  SELECT api_token INTO v_tok FROM whatsapp_instances
   WHERE clinic_id = p_clinic_id AND api_token IS NOT NULL
   ORDER BY (status = 'connected') DESC NULLS LAST LIMIT 1;
  IF v_tok IS NULL THEN RETURN jsonb_build_object('success', false, 'error_code', 'no_whatsapp_instance'); END IF;

  PERFORM set_config('app.onboarding_import', 'on', true);
  PERFORM http_set_curlopt('CURLOPT_TIMEOUT_MS', '15000');

  SELECT (http(('POST', 'https://med4growautomacao.uazapi.com/chat/find',
     ARRAY[http_header('token', v_tok)], 'application/json',
     '{"operator":"AND","sort":"-wa_lastMsgTimestamp","limit":' || v_lim_chats || ',"offset":0}')::http_request)).content::jsonb -> 'chats' INTO v_chats;

  SELECT (http(('POST', 'https://med4growautomacao.uazapi.com/message/find',
     ARRAY[http_header('token', v_tok)], 'application/json',
     '{"operator":"AND","sort":"-messageTimestamp","limit":' || v_lim_msgs || ',"offset":0}')::http_request)).content::jsonb -> 'messages' INTO v_msgs;

  PERFORM http_reset_curlopt();

  IF v_chats IS NULL THEN RETURN jsonb_build_object('success', false, 'error_code', 'uazapi_no_chats'); END IF;

  v_n_chats := jsonb_array_length(v_chats);
  v_n_msgs  := jsonb_array_length(coalesce(v_msgs, '[]'::jsonb));
  IF v_n_chats >= v_lim_chats OR v_n_msgs >= v_lim_msgs THEN
    PERFORM log_system_error('onboarding-import', 'uazapi_truncado',
      'Leitura da uazapi bateu no teto: parte das conversas/mensagens pode não ter sido importada',
      'warn', p_clinic_id,
      jsonb_build_object('chats', v_n_chats, 'limite_chats', v_lim_chats,
                         'mensagens', v_n_msgs, 'limite_mensagens', v_lim_msgs), false);
  END IF;

  DROP TABLE IF EXISTS _imp_msgs;
  CREATE TEMP TABLE _imp_msgs ON COMMIT DROP AS
  SELECT m->>'chatid' AS chatid, m->>'messageid' AS messageid, (m->>'fromMe')::boolean AS from_me,
         coalesce(nullif(btrim(coalesce(m->>'text', m->>'content','')),''), '['||coalesce(m->>'messageType','msg')||']') AS content,
         (to_timestamp((m->>'messageTimestamp')::bigint/1000) AT TIME ZONE 'America/Sao_Paulo') AS created_sp
  FROM jsonb_array_elements(coalesce(v_msgs, '[]'::jsonb)) m
  WHERE to_timestamp((m->>'messageTimestamp')::bigint/1000) >= v_cut;
  CREATE INDEX ON _imp_msgs(chatid);

  -- Trava (2): ids que SAIRAM daqui. Montado UMA vez por clinica (dentro da janela) para nao
  -- pagar um LIKE '%:'||id por mensagem candidata, que nao usa indice.
  DROP TABLE IF EXISTS _imp_meus;
  CREATE TEMP TABLE _imp_meus ON COMMIT DROP AS
  SELECT DISTINCT split_part(x.wa_message_id, ':', 2) AS messageid
    FROM chat_messages x
   WHERE x.clinic_id = p_clinic_id
     AND x.wa_message_id LIKE '%:%'
     AND x.created_at >= (v_cut AT TIME ZONE 'America/Sao_Paulo')
  UNION
  SELECT DISTINCT coalesce(nullif(split_part(om.provider_message_id, ':', 2), ''), om.provider_message_id)
    FROM outbound_messages om
   WHERE om.clinic_id = p_clinic_id AND nullif(btrim(coalesce(om.provider_message_id,'')),'') IS NOT NULL;
  CREATE INDEX ON _imp_meus(messageid);

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
      UPDATE leads SET name = CASE WHEN name IS NULL OR name = '' OR name LIKE 'Lead %' THEN rec.nome ELSE name END
       WHERE id = v_lead;
    END IF;

    SELECT id INTO v_ticket FROM tickets WHERE lead_id = v_lead AND status = 'open' ORDER BY opened_at DESC LIMIT 1;
    IF v_ticket IS NULL THEN
      IF EXISTS (SELECT 1 FROM tickets WHERE lead_id = v_lead) THEN
        SELECT id INTO v_ticket FROM tickets WHERE lead_id = v_lead ORDER BY opened_at DESC LIMIT 1;
      ELSE
        INSERT INTO tickets (clinic_id, lead_id, stage_id, status, opened_at)
        VALUES (p_clinic_id, v_lead, v_stage, 'open', now()) RETURNING id INTO v_ticket;
      END IF;
    END IF;

    INSERT INTO chat_messages (clinic_id, lead_id, ticket_id, phone, direction, sender, wa_message_id, message, created_at)
    SELECT p_clinic_id, v_lead, v_ticket, rec.nphone,
           CASE WHEN mm.from_me THEN 'outbound' ELSE 'inbound' END, 'human', mm.messageid,
           jsonb_build_object('type','human','content',mm.content,'additional_kwargs','{}'::jsonb,'response_metadata','{}'::jsonb),
           mm.created_sp
    FROM _imp_msgs mm
    WHERE (mm.chatid = rec.chatid OR (rec.chatlid IS NOT NULL AND mm.chatid = rec.chatlid))
      -- (1) mesmo id
      AND NOT EXISTS (SELECT 1 FROM chat_messages x WHERE x.clinic_id = p_clinic_id AND x.wa_message_id = mm.messageid)
      -- (2) id que saiu daqui (Emissor grava com prefixo '<jid>:')
      AND NOT EXISTS (SELECT 1 FROM _imp_meus mine WHERE mine.messageid = mm.messageid)
      -- (3) texto que ja saiu daqui: balao do agente e TRECHO da linha consolidada da conversa
      AND NOT (mm.from_me AND EXISTS (
            SELECT 1 FROM chat_messages y
             WHERE y.clinic_id = p_clinic_id AND y.lead_id = v_lead
               AND y.direction = 'outbound'
               AND y.created_at BETWEEN mm.created_sp - interval '90 seconds'
                                    AND mm.created_sp + interval '90 seconds'
               AND btrim(coalesce(y.message->>'content','')) <> ''
               AND position(btrim(mm.content) in btrim(coalesce(y.message->>'content',''))) > 0))
    ORDER BY mm.created_sp;
    GET DIAGNOSTICS v_rc = ROW_COUNT;
    v_new_msgs := v_new_msgs + v_rc;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'new_leads', v_new_leads, 'new_messages', v_new_msgs,
    'truncado', (v_n_chats >= v_lim_chats OR v_n_msgs >= v_lim_msgs),
    'total_leads', (SELECT count(*) FROM leads WHERE clinic_id = p_clinic_id),
    'total_messages', (SELECT count(*) FROM chat_messages WHERE clinic_id = p_clinic_id),
    'tickets_sincronizacao', (SELECT count(*) FROM tickets t JOIN funnel_stages fs ON fs.id = t.stage_id
                              WHERE t.clinic_id = p_clinic_id AND fs.slug = 'sincronizacao' AND t.status = 'open'));
EXCEPTION WHEN OTHERS THEN
  BEGIN PERFORM http_reset_curlopt(); EXCEPTION WHEN OTHERS THEN NULL; END;
  PERFORM log_system_error('onboarding-import', 'import_failed',
    'Falha ao importar conversas do onboarding (store uazapi -> Sincronização)', 'error',
    p_clinic_id, jsonb_build_object('detail', sqlerrm), false);
  RETURN jsonb_build_object('success', false, 'error_code', 'exception', 'detail', sqlerrm);
END; $function$;
