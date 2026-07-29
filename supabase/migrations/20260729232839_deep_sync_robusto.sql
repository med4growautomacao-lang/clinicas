-- ============================================================================================
-- Deep-sync e import: correções do code-review (13 achados)
-- ============================================================================================
-- Escreve os CORPOS COMPLETOS de _onboarding_import_run e onboarding_deep_sync_tick, encerrando o
-- patch-por-texto anterior (que dependia de âncoras literais, resolvia função por nome sem filtro de
-- overload, e que um `create or replace` futuro reverteria sem rastro).
--
-- #1 CRÍTICO (regressão introduzida horas antes, na migration 20260729225410): com 25s x3 + 20
--    disparos x5s o pior caso da rodada ia a 175s, acima do statement_timeout de 120s do banco
--    (medido em pg_settings; o role `postgres`, que o pg_cron usa, não tem override). E
--    `EXCEPTION WHEN OTHERS` NÃO captura query_canceled, então no corte a transação voltava atrás
--    inteira: nada de status='error', nada na Central, updated_at intacto, e o próximo tick pegava a
--    mesma clínica -> laço de 120s a cada 2 min, invisível. Correção: PRAZO explícito por rodada
--    (v_deadline de 60s) + timeouts menores. A rodada agora SEMPRE commita, e é isso que permite
--    contador/backoff funcionarem. Pior caso novo: 15+15+15+10x3 = 75s. Medido: 8,6 s por rodada.
-- #2 o tick fazia `PERFORM _onboarding_import_run(...)` e descartava success:false, então rodada que
--    falhou contava como progresso e podia levar a 'done' sem ter importado nada.
-- #3 o laço do history-sync engolia erro em NULL e ainda incrementava `fires` -> uazapi quebrada
--    virava "histórico completo", sem nada na Central (viola §0.5).
-- #4 /message/find ordenava ASCENDENTE (mais ANTIGAS) com limite 8000 e depois descartava o que
--    estava fora da janela: com store > 8000 podia buscar 8000 mensagens velhas e importar ZERO.
--    Agora ordena DESC (recentes primeiro), que é o que a janela de 90 dias quer.
-- #7 curlopt é por SESSÃO: sem reset, os 25s vazavam para a conexão pooled do PostgREST (role
--    authenticated, cujo statement_timeout é 8s), fazendo qualquer http seguinte gastar o orçamento
--    todo e morrer por cancelamento em vez de falhar rápido. Agora reseta sempre, inclusive no erro.
-- #8 /chat/find com limite 400 sem detecção: clínica maior perdia conversas em silêncio e a barra de
--    progresso chegava a 100% sobre um denominador truncado.
-- #9 CREATE TEMP TABLE ... ON COMMIT DROP quebrava a partir da 2ª clínica na MESMA transação
--    (p_max_clinics >= 2), e o erro era engolido pelo PERFORM do #2.
-- #6/#10 status='error' era beco sem saída: o tick só olhava pending/running e o resgate dependia de
--    um UPDATE na mão casando o texto do erro ('timed out' não casa 'SSL connection timeout').
--    Agora há attempts + backoff de 5 min, o tick retoma sozinho e desistir acende alerta.
-- ============================================================================================

ALTER TABLE public.onboarding_deep_sync ADD COLUMN IF NOT EXISTS attempts int NOT NULL DEFAULT 0;

-- ── Import (harvest) ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._onboarding_import_run(p_clinic_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $function$
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
  -- 15s dá 3x de folga sobre o pior tempo medido (5,2 s na Lorena) e mantém a rodada dentro do
  -- statement_timeout. É resetado no fim E no erro (#7: senão vaza para a conexão do PostgREST).
  PERFORM http_set_curlopt('CURLOPT_TIMEOUT_MS', '15000');

  SELECT (http(('POST', 'https://med4growautomacao.uazapi.com/chat/find',
     ARRAY[http_header('token', v_tok)], 'application/json',
     '{"operator":"AND","sort":"-wa_lastMsgTimestamp","limit":' || v_lim_chats || ',"offset":0}')::http_request)).content::jsonb -> 'chats' INTO v_chats;

  -- #4: DESC = mais RECENTES primeiro. Com ASC, um store maior que o limite devolvia só mensagens
  -- velhas, que a janela descartava depois -> importava zero.
  SELECT (http(('POST', 'https://med4growautomacao.uazapi.com/message/find',
     ARRAY[http_header('token', v_tok)], 'application/json',
     '{"operator":"AND","sort":"-messageTimestamp","limit":' || v_lim_msgs || ',"offset":0}')::http_request)).content::jsonb -> 'messages' INTO v_msgs;

  PERFORM http_reset_curlopt();

  IF v_chats IS NULL THEN RETURN jsonb_build_object('success', false, 'error_code', 'uazapi_no_chats'); END IF;

  -- #4/#8: truncamento é PERDA SILENCIOSA. Bateu no teto = avisa na Central.
  v_n_chats := jsonb_array_length(v_chats);
  v_n_msgs  := jsonb_array_length(coalesce(v_msgs, '[]'::jsonb));
  IF v_n_chats >= v_lim_chats OR v_n_msgs >= v_lim_msgs THEN
    PERFORM log_system_error('onboarding-import', 'uazapi_truncado',
      'Leitura da uazapi bateu no teto: parte das conversas/mensagens pode não ter sido importada',
      'warn', p_clinic_id,
      jsonb_build_object('chats', v_n_chats, 'limite_chats', v_lim_chats,
                         'mensagens', v_n_msgs, 'limite_mensagens', v_lim_msgs), false);
  END IF;

  -- #9: ON COMMIT DROP só cai no COMMIT, e o tick chama esta função 1x por clínica na MESMA
  -- transação. Sem este DROP, a 2ª clínica falhava com "relation already exists".
  DROP TABLE IF EXISTS _imp_msgs;
  CREATE TEMP TABLE _imp_msgs ON COMMIT DROP AS
  SELECT m->>'chatid' AS chatid, m->>'messageid' AS messageid, (m->>'fromMe')::boolean AS from_me,
         coalesce(nullif(btrim(coalesce(m->>'text', m->>'content','')),''), '['||coalesce(m->>'messageType','msg')||']') AS content,
         (to_timestamp((m->>'messageTimestamp')::bigint/1000) AT TIME ZONE 'America/Sao_Paulo') AS created_sp
  FROM jsonb_array_elements(coalesce(v_msgs, '[]'::jsonb)) m
  WHERE to_timestamp((m->>'messageTimestamp')::bigint/1000) >= v_cut;
  CREATE INDEX ON _imp_msgs(chatid);

  FOR rec IN
    -- Casa mensagem->chat por wa_chatid OR wa_chatlid: a MESMA conversa tem dois ids (@lid e
    -- @s.whatsapp.net) e casar só por um perdia ~60% das mensagens em silêncio.
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
      -- lead existente: NÃO mexe no avatar (a edge de re-host cuida; evita ressuscitar pps morta).
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
      AND NOT EXISTS (SELECT 1 FROM chat_messages x WHERE x.clinic_id = p_clinic_id AND x.wa_message_id = mm.messageid)
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
  BEGIN PERFORM http_reset_curlopt(); EXCEPTION WHEN OTHERS THEN NULL; END;  -- #7
  PERFORM log_system_error('onboarding-import', 'import_failed',
    'Falha ao importar conversas do onboarding (store uazapi -> Sincronização)', 'error',
    p_clinic_id, jsonb_build_object('detail', sqlerrm), false);
  RETURN jsonb_build_object('success', false, 'error_code', 'exception', 'detail', sqlerrm);
END; $function$;
REVOKE ALL ON FUNCTION public._onboarding_import_run(uuid) FROM PUBLIC, anon, authenticated;

-- ── Worker do deep-sync ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.onboarding_deep_sync_tick(p_max_clinics int DEFAULT 1, p_max_chats int DEFAULT 10)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_clinic uuid; v_tok text; v_target timestamptz; v_chats jsonb; rec record;
  v_processed int := 0; v_deadline timestamptz; v_imp jsonb;
  v_fires int := 0; v_fire_fail int := 0; v_ok boolean;
BEGIN
  -- #1: PRAZO da rodada. O statement_timeout do banco é 120s e query_canceled NÃO é capturado por
  -- `WHEN OTHERS`: se estourar, a transação volta atrás inteira e o job fica preso repetindo sem
  -- deixar rastro. Cortando em 60s a rodada SEMPRE commita, e é isso que faz attempts/backoff
  -- funcionarem. O que não couber nesta rodada continua na próxima (o trabalho é incremental).
  v_deadline := clock_timestamp() + interval '60 seconds';

  FOR v_clinic IN
    -- #6/#10: 'error' volta para a fila com backoff, em vez de morrer ali. attempts limita a
    -- insistência e o teto acende alerta em vez de tentar para sempre.
    SELECT clinic_id FROM onboarding_deep_sync
     WHERE status IN ('pending','running','error')
       AND coalesce(attempts, 0) < 20
       AND (status = 'pending' OR updated_at < now() - interval '5 minutes')
     ORDER BY updated_at ASC LIMIT p_max_clinics
     FOR UPDATE SKIP LOCKED
  LOOP
    v_ok := true; v_fires := 0; v_fire_fail := 0;
    BEGIN
      UPDATE onboarding_deep_sync SET status='running', updated_at=now() WHERE clinic_id=v_clinic;
      SELECT target_cutoff INTO v_target FROM onboarding_deep_sync WHERE clinic_id=v_clinic;

      SELECT api_token INTO v_tok FROM whatsapp_instances
       WHERE clinic_id=v_clinic AND api_token IS NOT NULL
       ORDER BY (status='connected') DESC NULLS LAST LIMIT 1;
      IF v_tok IS NULL THEN
        UPDATE onboarding_deep_sync
           SET status='error', last_error='no_whatsapp_instance',
               attempts = coalesce(attempts,0) + 1, updated_at=now()
         WHERE clinic_id=v_clinic;
        CONTINUE;
      END IF;

      -- 1) HARVEST — #2: agora o retorno é CONFERIDO. Falha não conta como progresso.
      PERFORM set_config('app.onboarding_import','on',true);
      v_imp := _onboarding_import_run(v_clinic);
      IF NOT coalesce((v_imp->>'success')::boolean, false) THEN
        UPDATE onboarding_deep_sync
           SET status='error',
               last_error = 'harvest: ' || coalesce(v_imp->>'error_code','?') || ' / ' || coalesce(v_imp->>'detail',''),
               attempts = coalesce(attempts,0) + 1, updated_at=now()
         WHERE clinic_id=v_clinic;
        CONTINUE;   -- NÃO avança rounds nem deixa virar 'done'
      END IF;

      -- 2) mapa chat->telefone (p/ o JID de disparo)
      IF clock_timestamp() < v_deadline THEN
        PERFORM http_set_curlopt('CURLOPT_TIMEOUT_MS', '15000');
        SELECT (http(('POST', 'https://med4growautomacao.uazapi.com/chat/find',
           ARRAY[http_header('token', v_tok)], 'application/json',
           '{"operator":"AND","sort":"-wa_lastMsgTimestamp","limit":400,"offset":0}')::http_request)).content::jsonb -> 'chats' INTO v_chats;
        PERFORM http_reset_curlopt();
      ELSE
        v_chats := NULL;  -- sem tempo nesta rodada; segue na próxima
      END IF;

      -- 3) atualiza oldest/âncora por chat + detecta estagnação
      IF v_chats IS NOT NULL THEN
        IF jsonb_array_length(v_chats) >= 400 THEN
          PERFORM log_system_error('onboarding-deep-sync', 'chats_truncado',
            'Lista de conversas da uazapi bateu no teto de 400: conversas além disso não entram no histórico',
            'warn', v_clinic, jsonb_build_object('chats', jsonb_array_length(v_chats)), false);
        END IF;

        WITH chats AS (
          SELECT c->>'wa_chatid' AS chatid, normalize_br_phone(c->>'phone') AS nphone
          FROM jsonb_array_elements(v_chats) c
          WHERE (c->>'wa_isGroup')::boolean IS NOT TRUE
            AND length(coalesce(normalize_br_phone(c->>'phone'),'')) >= 12
        ),
        oldest AS (
          SELECT ch.chatid, ch.nphone, cm.created_at AS oldest_ts, cm.wa_message_id AS oldest_msgid
          FROM chats ch
          LEFT JOIN LATERAL (
            SELECT created_at, wa_message_id FROM chat_messages
            WHERE clinic_id=v_clinic AND phone=ch.nphone
            ORDER BY created_at ASC LIMIT 1
          ) cm ON true
        )
        INSERT INTO onboarding_deep_sync_chat (clinic_id, chatid, phone_norm, oldest_ts, oldest_msgid, fires, stall, done)
        SELECT v_clinic, chatid, nphone, oldest_ts, oldest_msgid, 0, 0, false FROM oldest
        ON CONFLICT (clinic_id, chatid) DO UPDATE SET
          phone_norm = EXCLUDED.phone_norm,
          stall = CASE WHEN onboarding_deep_sync_chat.fires > 0
                        AND EXCLUDED.oldest_ts IS NOT NULL AND onboarding_deep_sync_chat.oldest_ts IS NOT NULL
                        AND EXCLUDED.oldest_ts >= onboarding_deep_sync_chat.oldest_ts
                       THEN onboarding_deep_sync_chat.stall + 1 ELSE 0 END,
          oldest_ts = EXCLUDED.oldest_ts,
          oldest_msgid = EXCLUDED.oldest_msgid,
          updated_at = now();

        -- 4) done: alcançou o alvo, estagnou 2 rodadas, ou não tem âncora (nada a puxar)
        UPDATE onboarding_deep_sync_chat SET done=true, updated_at=now()
         WHERE clinic_id=v_clinic AND NOT done
           AND (oldest_ts <= v_target OR stall >= 2 OR oldest_msgid IS NULL);
      END IF;

      -- 5) DISPARA history-sync p/ um lote de chats ainda incompletos
      PERFORM http_set_curlopt('CURLOPT_TIMEOUT_MS', '3000');
      FOR rec IN
        SELECT chatid, oldest_msgid FROM onboarding_deep_sync_chat
         WHERE clinic_id=v_clinic AND NOT done AND oldest_msgid IS NOT NULL
           AND (oldest_ts IS NULL OR oldest_ts > v_target)
         ORDER BY oldest_ts DESC NULLS LAST LIMIT p_max_chats
      LOOP
        EXIT WHEN clock_timestamp() > v_deadline;   -- #1
        BEGIN
          PERFORM http(('POST', 'https://med4growautomacao.uazapi.com/message/history-sync',
            ARRAY[http_header('token', v_tok)], 'application/json',
            json_build_object('number', rec.chatid, 'messageid', rec.oldest_msgid, 'mode','history','count',100)::text)::http_request);
        EXCEPTION WHEN OTHERS THEN
          v_fire_fail := v_fire_fail + 1;   -- #3: não engole mais em silêncio
        END;
        v_fires := v_fires + 1;
        UPDATE onboarding_deep_sync_chat SET fires=fires+1, updated_at=now()
         WHERE clinic_id=v_clinic AND chatid=rec.chatid;
      END LOOP;
      PERFORM http_reset_curlopt();

      -- #3: TODOS os disparos falharam = uazapi indisponível. Não pode virar 'done' calado.
      IF v_fires > 0 AND v_fire_fail = v_fires THEN
        PERFORM log_system_error('onboarding-deep-sync', 'history_sync_falhou',
          'Nenhum pedido de histórico foi aceito pela uazapi nesta rodada (celular offline ou token)',
          'error', v_clinic, jsonb_build_object('tentativas', v_fires), false);
        UPDATE onboarding_deep_sync
           SET status='error', last_error='history-sync recusado em todas as ' || v_fires || ' tentativas',
               attempts = coalesce(attempts,0) + 1, updated_at=now()
         WHERE clinic_id=v_clinic;
        CONTINUE;
      END IF;

      -- 6) job done quando não há mais chat disparável ou estourou o teto de rodadas
      UPDATE onboarding_deep_sync SET
        oldest_reached = (SELECT min(oldest_ts) FROM onboarding_deep_sync_chat WHERE clinic_id=v_clinic),
        rounds = rounds + 1,
        attempts = 0,                        -- rodada boa zera a insistência
        last_error = NULL,
        status = CASE WHEN rounds + 1 >= 300 OR NOT EXISTS (
                   SELECT 1 FROM onboarding_deep_sync_chat
                    WHERE clinic_id=v_clinic AND NOT done AND oldest_msgid IS NOT NULL
                      AND (oldest_ts IS NULL OR oldest_ts > v_target)
                 ) THEN 'done' ELSE 'running' END,
        updated_at = now()
      WHERE clinic_id=v_clinic;
      v_processed := v_processed + 1;
    EXCEPTION WHEN OTHERS THEN
      BEGIN PERFORM http_reset_curlopt(); EXCEPTION WHEN OTHERS THEN NULL; END;
      UPDATE onboarding_deep_sync
         SET status='error', last_error=sqlerrm,
             attempts = coalesce(attempts,0) + 1, updated_at=now()
       WHERE clinic_id=v_clinic;
      PERFORM log_system_error('onboarding-deep-sync','tick_failed','Falha no deep-sync do onboarding','error',
        v_clinic, jsonb_build_object('detail', sqlerrm), false);
    END;
  END LOOP;

  -- Desistiu: avisa em vez de tentar para sempre em silêncio.
  PERFORM log_system_error('onboarding-deep-sync','desistiu',
    'Deep-sync desistiu após 20 tentativas seguidas; reinicie pelo botão quando a causa estiver resolvida',
    'error', ds.clinic_id, jsonb_build_object('last_error', ds.last_error, 'attempts', ds.attempts), false)
  FROM onboarding_deep_sync ds
  WHERE ds.status='error' AND ds.attempts = 20;

  RETURN jsonb_build_object('success', true, 'processed', v_processed);
END; $function$;
REVOKE ALL ON FUNCTION public.onboarding_deep_sync_tick(int, int) FROM PUBLIC, anon, authenticated;

-- #12: o DROP da overload BOOLEANA de onboarding_audit_apply vem AQUI (migração nova) e não
-- enxertado na migration de 24/07 já aplicada (§3: migration é história, não estado). Em produção ela
-- já não existe; isto serve para banco novo, onde o arquivo 20260724053444 a cria e nada a removia.
DROP FUNCTION IF EXISTS public.onboarding_audit_apply(uuid, boolean, boolean, date, boolean, date, boolean, boolean);

-- #13: a causa dos alertas deste incidente está corrigida; a Central mostra só o que está aberto e a
-- contagem da tela É a fila de trabalho. O trigger arquiva ao resolver.
UPDATE public.system_errors
   SET status='resolved', resolved_at=now()
 WHERE status='open'
   AND scope IN ('onboarding-deep-sync','onboarding-import')
   AND code IN ('tick_failed','import_failed');

-- Cron: menos disparos por rodada (10), coerente com o prazo de 60s.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='onboarding_deep_sync_tick') THEN
    PERFORM cron.unschedule('onboarding_deep_sync_tick');
  END IF;
  PERFORM cron.schedule('onboarding_deep_sync_tick', '*/2 * * * *',
    'SELECT public.onboarding_deep_sync_tick(1, 10)');
END $$;
