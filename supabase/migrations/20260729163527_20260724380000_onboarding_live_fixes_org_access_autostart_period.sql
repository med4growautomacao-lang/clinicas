-- 20260729163527_20260724380000_onboarding_live_fixes_org_access_autostart_period
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Correções pré-go-live (sessão ao vivo com cliente):
-- F1: fn_can_onboard não cobria org_owner/org_admin — o botão "Refazer onboarding" mora no OrgAdmin,
--     mas a RPC devolvia forbidden para quem opera de lá sem ser super-admin/membro da clínica.
--     Espelha o padrão de acesso org já usado em preview_followup_activation, restrito a owner/admin.
CREATE OR REPLACE FUNCTION public.fn_can_onboard(p_clinic_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT is_super_admin()
      OR is_clinic_admin(p_clinic_id)
      OR EXISTS (
        SELECT 1 FROM public.clinic_users
        WHERE id = auth.uid() AND clinic_id = p_clinic_id
          AND role IN ('gestor', 'medico_gestor') AND coalesce(is_active, true)
      )
      OR EXISTS (
        SELECT 1 FROM public.clinics c
        JOIN public.org_users ou ON ou.organization_id = c.organization_id
        WHERE c.id = p_clinic_id AND ou.user_id = auth.uid()
          AND ou.role IN ('org_owner', 'org_admin')
      );
$function$;

-- F3: a janela de importação passa a respeitar o período escolhido no "Refazer" (1/3/6 meses),
--     teto de 90d (limite prático do WhatsApp). Sem isso, refazer com "1 mês" importava 90 dias e
--     criava tickets na Sincronização FORA da fila de auditoria (o pending filtra por created_at),
--     deixando cards vermelhos que o modal nunca mostraria.
CREATE OR REPLACE FUNCTION public._onboarding_import_window(p_clinic_id uuid)
RETURNS timestamptz LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT now() - (least(coalesce(onboarding_period_months, 3), 3) * 30) * interval '1 day'
  FROM clinics WHERE id = p_clinic_id;
$function$;
REVOKE ALL ON FUNCTION public._onboarding_import_window(uuid) FROM PUBLIC, anon, authenticated;

-- Import usa a janela por período (única mudança no corpo: v_cut).
CREATE OR REPLACE FUNCTION public._onboarding_import_run(p_clinic_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_tok text; v_stage uuid; v_chats jsonb; v_msgs jsonb; rec record;
  v_lead uuid; v_ticket uuid; v_cut timestamptz := _onboarding_import_window(p_clinic_id);
  v_new_leads int := 0; v_new_msgs int := 0; v_rc int;
BEGIN
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
      -- lead existente: NÃO mexe no avatar (a edge de re-host cuida disso; evita ressuscitar pps morta).
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
    'total_leads', (SELECT count(*) FROM leads WHERE clinic_id = p_clinic_id),
    'total_messages', (SELECT count(*) FROM chat_messages WHERE clinic_id = p_clinic_id),
    'tickets_sincronizacao', (SELECT count(*) FROM tickets t JOIN funnel_stages fs ON fs.id = t.stage_id
                              WHERE t.clinic_id = p_clinic_id AND fs.slug = 'sincronizacao' AND t.status = 'open'));
EXCEPTION WHEN OTHERS THEN
  PERFORM log_system_error('onboarding-import', 'import_failed',
    'Falha ao importar conversas do onboarding (store uazapi -> Sincronização)', 'error',
    p_clinic_id, jsonb_build_object('detail', sqlerrm), false);
  RETURN jsonb_build_object('success', false, 'error_code', 'exception', 'detail', sqlerrm);
END;
$function$;

-- Deep-sync também respeita o período (refazer com 1 mês termina bem mais rápido).
CREATE OR REPLACE FUNCTION public.onboarding_deep_sync_start(p_clinic_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT fn_can_onboard(p_clinic_id) THEN RETURN jsonb_build_object('success', false, 'error_code', 'forbidden'); END IF;
  DELETE FROM onboarding_deep_sync_chat WHERE clinic_id = p_clinic_id;
  INSERT INTO onboarding_deep_sync (clinic_id, status, target_cutoff, oldest_reached, rounds, last_error, updated_at)
  VALUES (p_clinic_id, 'pending', _onboarding_import_window(p_clinic_id), NULL, 0, NULL, now())
  ON CONFLICT (clinic_id) DO UPDATE
    SET status='pending', target_cutoff = _onboarding_import_window(p_clinic_id), oldest_reached=NULL,
        rounds=0, last_error=NULL, updated_at=now();
  RETURN jsonb_build_object('success', true);
END; $function$;

-- F2 (opção 1): refazer o onboarding JÁ enfileira o deep-sync — o cron importa e puxa o histórico
-- sozinho, sem depender de clique. (No redo a fila já tem existentes, então o botão "Sincronizar
-- conversas" nem aparece; sem isto, as conversas novas nunca seriam importadas.)
CREATE OR REPLACE FUNCTION public.onboarding_reset(p_clinic_id uuid, p_months integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT fn_can_onboard(p_clinic_id) THEN RETURN jsonb_build_object('success', false, 'error_code', 'forbidden'); END IF;
  UPDATE clinics SET onboarding_completed_at = NULL, onboarding_period_months = p_months WHERE id = p_clinic_id;
  UPDATE leads SET onboarding_reviewed_at = NULL WHERE clinic_id = p_clinic_id;
  PERFORM fn_onboarding_disable_followups(p_clinic_id);  -- desliga follow-ups (reativação manual depois)
  -- enfileira o deep-sync do período (o cron faz import + histórico em segundo plano)
  DELETE FROM onboarding_deep_sync_chat WHERE clinic_id = p_clinic_id;
  INSERT INTO onboarding_deep_sync (clinic_id, status, target_cutoff, oldest_reached, rounds, last_error, updated_at)
  VALUES (p_clinic_id, 'pending', _onboarding_import_window(p_clinic_id), NULL, 0, NULL, now())
  ON CONFLICT (clinic_id) DO UPDATE
    SET status='pending', target_cutoff = _onboarding_import_window(p_clinic_id), oldest_reached=NULL,
        rounds=0, last_error=NULL, updated_at=now();
  RETURN jsonb_build_object('success', true, 'months', p_months);
END; $function$;
