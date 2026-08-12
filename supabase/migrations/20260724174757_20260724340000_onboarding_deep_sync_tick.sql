-- 20260724174757_20260724340000_onboarding_deep_sync_tick
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

ALTER TABLE public.onboarding_deep_sync_chat ADD COLUMN IF NOT EXISTS stall int NOT NULL DEFAULT 0;
ALTER TABLE public.onboarding_deep_sync_chat ADD COLUMN IF NOT EXISTS oldest_msgid text;

-- Worker do deep-sync. pg_cron chama (como postgres). Por tick: colhe (harvest = re-import do store),
-- atualiza o oldest por chat, marca done (alcançou 90d / sem progresso / sem âncora) e dispara
-- /message/history-sync p/ um lote de chats ainda incompletos. Best-effort, capado, idempotente.
CREATE OR REPLACE FUNCTION public.onboarding_deep_sync_tick(p_max_clinics int DEFAULT 1, p_max_chats int DEFAULT 20)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_clinic uuid; v_tok text; v_target timestamptz; v_chats jsonb; rec record; v_processed int := 0;
BEGIN
  FOR v_clinic IN
    SELECT clinic_id FROM onboarding_deep_sync
     WHERE status IN ('pending','running')
     ORDER BY updated_at ASC LIMIT p_max_clinics
     FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      UPDATE onboarding_deep_sync SET status='running', updated_at=now() WHERE clinic_id=v_clinic;
      SELECT target_cutoff INTO v_target FROM onboarding_deep_sync WHERE clinic_id=v_clinic;

      SELECT api_token INTO v_tok FROM whatsapp_instances
       WHERE clinic_id=v_clinic AND api_token IS NOT NULL
       ORDER BY (status='connected') DESC NULLS LAST LIMIT 1;
      IF v_tok IS NULL THEN
        UPDATE onboarding_deep_sync SET status='error', last_error='no_whatsapp_instance', updated_at=now() WHERE clinic_id=v_clinic;
        CONTINUE;
      END IF;

      -- 1) HARVEST: colhe o que o celular já devolveu ao store desde o último tick
      PERFORM set_config('app.onboarding_import','on',true);
      PERFORM _onboarding_import_run(v_clinic);

      -- 2) mapa chat->telefone da uazapi (p/ ter o JID de disparo)
      SELECT (http(('POST', 'https://med4growautomacao.uazapi.com/chat/find',
         ARRAY[http_header('token', v_tok)], 'application/json',
         '{"operator":"AND","sort":"-wa_lastMsgTimestamp","limit":400,"offset":0}')::http_request)).content::jsonb -> 'chats' INTO v_chats;

      -- 3) atualiza oldest/âncora por chat + detecta estagnação
      IF v_chats IS NOT NULL THEN
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
      END IF;

      -- 4) marca done: alcançou 90d, ou estagnou 2 ticks, ou sem âncora (nada a puxar)
      UPDATE onboarding_deep_sync_chat SET done=true, updated_at=now()
       WHERE clinic_id=v_clinic AND NOT done
         AND (oldest_ts <= v_target OR stall >= 2 OR oldest_msgid IS NULL);

      -- 5) DISPARA history-sync p/ um lote de chats ainda incompletos
      FOR rec IN
        SELECT chatid, oldest_msgid FROM onboarding_deep_sync_chat
         WHERE clinic_id=v_clinic AND NOT done AND oldest_msgid IS NOT NULL
           AND (oldest_ts IS NULL OR oldest_ts > v_target)
         ORDER BY oldest_ts DESC NULLS LAST LIMIT p_max_chats
      LOOP
        BEGIN
          PERFORM http(('POST', 'https://med4growautomacao.uazapi.com/message/history-sync',
            ARRAY[http_header('token', v_tok)], 'application/json',
            json_build_object('number', rec.chatid, 'messageid', rec.oldest_msgid, 'mode','history','count',100)::text)::http_request);
        EXCEPTION WHEN OTHERS THEN NULL; END;
        UPDATE onboarding_deep_sync_chat SET fires=fires+1, updated_at=now()
         WHERE clinic_id=v_clinic AND chatid=rec.chatid;
      END LOOP;

      -- 6) atualiza o job (done quando não há mais chat disparável ou estourou o teto de rodadas)
      UPDATE onboarding_deep_sync SET
        oldest_reached = (SELECT min(oldest_ts) FROM onboarding_deep_sync_chat WHERE clinic_id=v_clinic),
        rounds = rounds + 1,
        status = CASE WHEN rounds + 1 >= 300 OR NOT EXISTS (
                   SELECT 1 FROM onboarding_deep_sync_chat
                    WHERE clinic_id=v_clinic AND NOT done AND oldest_msgid IS NOT NULL
                      AND (oldest_ts IS NULL OR oldest_ts > v_target)
                 ) THEN 'done' ELSE 'running' END,
        updated_at = now()
      WHERE clinic_id=v_clinic;
      v_processed := v_processed + 1;
    EXCEPTION WHEN OTHERS THEN
      UPDATE onboarding_deep_sync SET status='error', last_error=sqlerrm, updated_at=now() WHERE clinic_id=v_clinic;
      PERFORM log_system_error('onboarding-deep-sync','tick_failed','Falha no deep-sync do onboarding','error',
        v_clinic, jsonb_build_object('detail', sqlerrm), false);
    END;
  END LOOP;
  RETURN jsonb_build_object('success', true, 'processed', v_processed);
END; $function$;

REVOKE ALL ON FUNCTION public.onboarding_deep_sync_tick(int, int) FROM anon, authenticated;
