-- O deep-sync passa a PARAR quando o onboarding da clinica esta concluido.
--
-- Defeito (30/07/2026, Lorena): `onboarding_completed_at` foi preenchido em 29/07 as 22h43 e o
-- job continuou 'running' com 175 rodadas, uma a cada 2 minutos, porque o tick nunca olhou esse
-- campo. Como cada rodada relia o store inteiro da uazapi, a clinica ja em operacao ficou
-- recebendo copia das mensagens que ela mesma acabou de mandar. Uma unica conversa de 287
-- (a que nunca fecha) segurava o job aberto para sempre.
--
-- Encerrar aqui e o certo: importar historico e fase de ORGANIZACAO. Depois que o dono declara o
-- onboarding pronto, quem manda na conversa e o sistema, e reinjetar passado numa conversa viva
-- so pode confundir. Se sobrou historico para puxar, o botao de reiniciar continua existindo, e
-- por isso o encerramento AVISA na Central em vez de sumir calado.

CREATE OR REPLACE FUNCTION public.onboarding_deep_sync_tick(p_max_clinics integer DEFAULT 1, p_max_chats integer DEFAULT 10)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_clinic uuid; v_tok text; v_target timestamptz; v_chats jsonb; rec record;
  v_processed int := 0; v_deadline timestamptz; v_imp jsonb;
  v_fires int := 0; v_fire_fail int := 0; v_ok boolean;
  v_encerrados int := 0; v_falta int;
BEGIN
  v_deadline := clock_timestamp() + interval '60 seconds';

  -- Onboarding concluido = deep-sync encerrado. Feito ANTES do laco de trabalho para a clinica ja
  -- entregue nunca mais entrar numa rodada de importacao.
  FOR rec IN
    SELECT ds.clinic_id, c.name,
           (SELECT count(*) FROM onboarding_deep_sync_chat dsc
             WHERE dsc.clinic_id = ds.clinic_id AND NOT dsc.done) AS faltando
      FROM onboarding_deep_sync ds
      JOIN clinics c ON c.id = ds.clinic_id
     WHERE ds.status IN ('pending','running','error')
       AND c.onboarding_completed_at IS NOT NULL
  LOOP
    UPDATE onboarding_deep_sync
       SET status = 'done', last_error = NULL, updated_at = now()
     WHERE clinic_id = rec.clinic_id;
    v_encerrados := v_encerrados + 1;
    IF rec.faltando > 0 THEN
      PERFORM log_system_error('onboarding-deep-sync', 'encerrado_por_onboarding_concluido',
        'Busca de historico encerrada: o onboarding de ' || rec.name || ' foi marcado como concluido com '
          || rec.faltando || ' conversa(s) ainda sem historico completo',
        'warn', rec.clinic_id,
        jsonb_build_object('conversas_incompletas', rec.faltando,
          'obs', 'Continuar importando numa clinica ja em operacao reinjeta mensagem antiga na conversa viva. '
                 || 'Para retomar, use o botao de reiniciar a sincronizacao no onboarding.'), false);
    END IF;
  END LOOP;

  FOR v_clinic IN
    -- #6/#10: 'error' volta para a fila com backoff, em vez de morrer ali. attempts limita a
    -- insistencia e o teto acende alerta em vez de tentar para sempre.
    SELECT ds.clinic_id FROM onboarding_deep_sync ds
     JOIN clinics c ON c.id = ds.clinic_id
     WHERE ds.status IN ('pending','running','error')
       AND c.onboarding_completed_at IS NULL
       AND coalesce(ds.attempts, 0) < 20
       AND (ds.status = 'pending' OR ds.updated_at < now() - interval '5 minutes')
     ORDER BY ds.updated_at ASC LIMIT p_max_clinics
     FOR UPDATE OF ds SKIP LOCKED
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

      -- 1) HARVEST — #2: o retorno e CONFERIDO. Falha nao conta como progresso.
      PERFORM set_config('app.onboarding_import','on',true);
      v_imp := _onboarding_import_run(v_clinic);
      IF NOT coalesce((v_imp->>'success')::boolean, false) THEN
        UPDATE onboarding_deep_sync
           SET status='error',
               last_error = 'harvest: ' || coalesce(v_imp->>'error_code','?') || ' / ' || coalesce(v_imp->>'detail',''),
               attempts = coalesce(attempts,0) + 1, updated_at=now()
         WHERE clinic_id=v_clinic;
        CONTINUE;
      END IF;

      -- 2) mapa chat->telefone (p/ o JID de disparo)
      IF clock_timestamp() < v_deadline THEN
        PERFORM http_set_curlopt('CURLOPT_TIMEOUT_MS', '15000');
        SELECT (http(('POST', 'https://med4growautomacao.uazapi.com/chat/find',
           ARRAY[http_header('token', v_tok)], 'application/json',
           '{"operator":"AND","sort":"-wa_lastMsgTimestamp","limit":400,"offset":0}')::http_request)).content::jsonb -> 'chats' INTO v_chats;
        PERFORM http_reset_curlopt();
      ELSE
        v_chats := NULL;  -- sem tempo nesta rodada; segue na proxima
      END IF;

      -- 3) atualiza oldest/ancora por chat + detecta estagnacao
      IF v_chats IS NOT NULL THEN
        IF jsonb_array_length(v_chats) >= 400 THEN
          PERFORM log_system_error('onboarding-deep-sync', 'chats_truncado',
            'Lista de conversas da uazapi bateu no teto de 400: conversas alem disso nao entram no historico',
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

        -- 4) done: alcancou o alvo, estagnou 2 rodadas, ou nao tem ancora (nada a puxar)
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
          v_fire_fail := v_fire_fail + 1;   -- #3: nao engole mais em silencio
        END;
        v_fires := v_fires + 1;
        UPDATE onboarding_deep_sync_chat SET fires=fires+1, updated_at=now()
         WHERE clinic_id=v_clinic AND chatid=rec.chatid;
      END LOOP;
      PERFORM http_reset_curlopt();

      -- #3: TODOS os disparos falharam = uazapi indisponivel. Nao pode virar 'done' calado.
      IF v_fires > 0 AND v_fire_fail = v_fires THEN
        PERFORM log_system_error('onboarding-deep-sync', 'history_sync_falhou',
          'Nenhum pedido de historico foi aceito pela uazapi nesta rodada (celular offline ou token)',
          'error', v_clinic, jsonb_build_object('tentativas', v_fires), false);
        UPDATE onboarding_deep_sync
           SET status='error', last_error='history-sync recusado em todas as ' || v_fires || ' tentativas',
               attempts = coalesce(attempts,0) + 1, updated_at=now()
         WHERE clinic_id=v_clinic;
        CONTINUE;
      END IF;

      -- 6) job done quando nao ha mais chat disparavel ou estourou o teto de rodadas.
      -- O teto de 300 e o unico freio quando UMA conversa nunca estagna: a Lorena chegou a 175
      -- rodadas com 286 de 287 conversas prontas. Por isso agora ele AVISA ao desistir.
      SELECT count(*) INTO v_falta
        FROM onboarding_deep_sync_chat
       WHERE clinic_id=v_clinic AND NOT done AND oldest_msgid IS NOT NULL
         AND (oldest_ts IS NULL OR oldest_ts > v_target);

      UPDATE onboarding_deep_sync SET
        oldest_reached = (SELECT min(oldest_ts) FROM onboarding_deep_sync_chat WHERE clinic_id=v_clinic),
        rounds = rounds + 1,
        attempts = 0,
        last_error = NULL,
        status = CASE WHEN rounds + 1 >= 300 OR v_falta = 0 THEN 'done' ELSE 'running' END,
        updated_at = now()
      WHERE clinic_id=v_clinic;

      IF v_falta > 0 AND (SELECT rounds FROM onboarding_deep_sync WHERE clinic_id=v_clinic) >= 300 THEN
        PERFORM log_system_error('onboarding-deep-sync', 'teto_de_rodadas',
          'Busca de historico encerrada no teto de 300 rodadas com ' || v_falta || ' conversa(s) incompleta(s)',
          'warn', v_clinic, jsonb_build_object('conversas_incompletas', v_falta), false);
      END IF;

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

  -- Desistiu: avisa em vez de tentar para sempre em silencio.
  PERFORM log_system_error('onboarding-deep-sync','desistiu',
    'Deep-sync desistiu apos 20 tentativas seguidas; reinicie pelo botao quando a causa estiver resolvida',
    'error', ds.clinic_id, jsonb_build_object('last_error', ds.last_error, 'attempts', ds.attempts), false)
  FROM onboarding_deep_sync ds
  WHERE ds.status='error' AND ds.attempts = 20;

  RETURN jsonb_build_object('success', true, 'processed', v_processed, 'encerrados', v_encerrados);
END; $function$
;
