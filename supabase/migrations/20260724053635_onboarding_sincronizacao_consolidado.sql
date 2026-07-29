-- ============================================================================================
-- Onboarding "Sincronização" — consolidação
-- ============================================================================================
-- CONTEXTO: a feature foi aplicada via MCP (apply_migration) em ~28 passos entre 24/07 e 29/07/2026
-- e só os 3 primeiros geraram arquivo no repo — erro meu. Este arquivo repõe o resto da história,
-- com o ESTADO FINAL de cada objeto (os passos intermediários eram `create or replace` sucessivos,
-- então o último vale; ver os rótulos abaixo para arqueologia).
--
-- Nome = versão real do 1º passo sem arquivo (20260729/20260724053635 = onboarding_guard_activate_ai),
-- então em produção esta migração é IGNORADA (versão já registrada) e num banco novo roda na posição
-- cronológica correta, depois dos 3 arquivos que já existiam.
--
-- Passos consolidados (rótulo -> version registrada):
--   ..173000_onboarding_guard_activate_ai        -> 20260724053635
--   ..180000_onboarding_broaden_guard            -> 20260724061428
--   ..181000_onboarding_import_preserve_audit    -> 20260724061608
--   ..190000_onboarding_audit_categories         -> 20260724064746
--   ..200000_onboarding_audit_reset_on_reaudit   -> 20260724070039
--   ..210000_onboarding_pending_leads_with_appts -> 20260724072318
--   ..220000_onboarding_state_and_gate           -> 20260724134914
--   ..230000_onboarding_scheduled_leads_in_queue -> 20260724144604
--   ..240000_onboarding_include_won_sales        -> 20260724150734
--   ..250000_onboarding_reset_period             -> 20260724151746
--   ..251000_onboarding_period_by_lead_created   -> 20260724151856
--   ..260000_onboarding_disable_followups_on_reset -> 20260724155535
--   ..270000_onboarding_gate_soft                -> 20260724160136
--   ..280000_onboarding_audit_fixes_and_bulk_existing -> 20260724170316
--   ..290000_onboarding_audit_reuse_sinc_ticket   -> 20260724172346
--   ..300000_onboarding_import_window_90d         -> 20260724173502
--   ..310000_onboarding_import_disable_followups  -> 20260724173652
--   ..320000_onboarding_import_run_internal       -> 20260724174410
--   ..330000_onboarding_deep_sync_state           -> 20260724174500
--   ..340000_onboarding_deep_sync_tick            -> 20260724174757
--   ..350000_onboarding_deep_sync_cron            -> 20260724180221
--   ..360000_onboarding_rehost_avatars_cron       -> 20260724181708
--   ..370000_onboarding_import_no_avatar_resurrect -> 20260724183439
--   ..380000_onboarding_live_fixes_org_access_autostart_period -> 20260729163527
--   ..391000_onboarding_audit_human_only_param    -> 20260729165058
--   ..400000_onboarding_appt_time                 -> 20260729173442
--   ..410000_onboarding_include_unclassified_funnel_leads -> 20260729195332
--   ..420000_onboarding_queue_order_by_recency    -> 20260729200018
--
-- A guarda de silêncio dos 9 gatilhos de chat_messages (app.onboarding_import) está no arquivo que
-- já existia: 20260724031733_onboarding_import_trigger_guards.sql.
-- ============================================================================================

-- 1) Colunas de estado -----------------------------------------------------------------------
ALTER TABLE public.clinics ADD COLUMN IF NOT EXISTS onboarding_completed_at  timestamptz;
ALTER TABLE public.clinics ADD COLUMN IF NOT EXISTS onboarding_period_months integer;
ALTER TABLE public.leads   ADD COLUMN IF NOT EXISTS onboarding_reviewed_at   timestamptz;
-- Defensivo: o estado final de onboarding_audit_apply grava human_only, e num banco novo o arquivo
-- do cadeado (20260729165008) roda DEPOIS deste. Idempotente, então não conflita.
ALTER TABLE public.leads   ADD COLUMN IF NOT EXISTS human_only boolean NOT NULL DEFAULT false;

-- Clínicas EXISTENTES nascem como "já concluídas" para não abrir o modal para quem não pediu.
UPDATE public.clinics SET onboarding_completed_at = now() WHERE onboarding_completed_at IS NULL;

-- 2) Trava de acesso --------------------------------------------------------------------------
-- Inclui org_owner/org_admin: o botão "Refazer onboarding" mora no módulo Organizações, e sem esse
-- braço a RPC devolvia forbidden justamente para quem opera de lá.
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

-- 3) Janela do período (1/3/6 meses, teto de 90 dias) -----------------------------------------
-- Sem isto, "refazer com 1 mês" importava 90 dias e criava tickets na Sincronização FORA da fila de
-- auditoria (o pending filtra por created_at), deixando cards que o modal nunca mostraria.
CREATE OR REPLACE FUNCTION public._onboarding_import_window(p_clinic_id uuid)
RETURNS timestamptz LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT now() - (least(coalesce(onboarding_period_months, 3), 3) * 30) * interval '1 day'
  FROM clinics WHERE id = p_clinic_id;
$function$;
REVOKE ALL ON FUNCTION public._onboarding_import_window(uuid) FROM PUBLIC, anon, authenticated;

-- 4) Desligar os follow-ups da clínica --------------------------------------------------------
-- Chamado ao iniciar o onboarding e ao refazer: nada dispara em massa durante a reorganização.
-- NÃO toca IA (auto_schedule/handoff): a IA é controlada por lead.
CREATE OR REPLACE FUNCTION public.fn_onboarding_disable_followups(p_clinic_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $function$
  UPDATE ai_config SET
    welcome_message_enabled      = false,
    followup_enabled             = false,
    confirm_native_enabled       = false,
    confirm_enabled              = false,
    confirm_post_enabled         = false,
    appt_reminder_enabled        = false,
    pos_followup_ganho_enabled   = false,
    pos_followup_perdido_enabled = false,
    finish_ganho_enabled         = false,
    finish_perdido_enabled       = false,
    finish_service_enabled       = false,
    csat_enabled                 = false
  WHERE clinic_id = p_clinic_id;
$function$;

-- 5) Importação (pull do store da uazapi -> leads/chat_messages) -------------------------------
-- Interna, SEM trava: o harvest do deep-sync a chama pelo cron (sem auth.uid).
CREATE OR REPLACE FUNCTION public._onboarding_import_run(p_clinic_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
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
    -- ⚠️ Casa mensagem->chat por wa_chatid OR wa_chatlid: a MESMA conversa tem dois ids (@lid e
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

    -- Reusa o ticket aberto; se não há aberto mas o lead JÁ TEM ticket (auditado), anexa ao mais
    -- recente (NÃO ressuscita na Sincronização); só cria na Sincronização se não tem ticket nenhum.
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
END; $function$;
REVOKE ALL ON FUNCTION public._onboarding_import_run(uuid) FROM PUBLIC, anon, authenticated;

-- RPC pública: trava + desliga follow-ups + delega.
CREATE OR REPLACE FUNCTION public.onboarding_import_conversations(p_clinic_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF NOT fn_can_onboard(p_clinic_id) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;
  PERFORM fn_onboarding_disable_followups(p_clinic_id);
  RETURN _onboarding_import_run(p_clinic_id);
END; $function$;

-- 6) Fila de auditoria ------------------------------------------------------------------------
-- Tipo A: importados (ticket aberto na Sincronização).
-- Tipo B: cliente existente (consulta na agenda OU venda ganha) -> is_scheduled = true.
-- Tipo C: já no funil, com conversa, em aberto e nunca classificado (na Lorena eram 125 parados em
--         "Contato via WhatsApp" que nenhuma das duas primeiras regras alcançava).
-- Ordem: MAIS RECENTE primeiro; clientes existentes no fim (são os de confirmação em lote).
DROP FUNCTION IF EXISTS public.onboarding_pending_leads(uuid);
CREATE OR REPLACE FUNCTION public.onboarding_pending_leads(p_clinic_id uuid)
 RETURNS TABLE(ticket_id uuid, lead_id uuid, name text, phone text, avatar_url text,
               last_appt date, last_appt_time time without time zone,
               next_appt date, next_appt_time time without time zone, is_scheduled boolean)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_stage uuid; v_today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_months integer; v_cutoff timestamp;
BEGIN
  IF NOT fn_can_onboard(p_clinic_id) THEN RETURN; END IF;
  SELECT id INTO v_stage FROM funnel_stages WHERE clinic_id = p_clinic_id AND slug = 'sincronizacao' LIMIT 1;
  IF v_stage IS NULL THEN RETURN; END IF;
  SELECT onboarding_period_months INTO v_months FROM clinics WHERE id = p_clinic_id;
  v_cutoff := CASE WHEN v_months IS NULL THEN '1900-01-01'::timestamp
                   ELSE (now() AT TIME ZONE 'America/Sao_Paulo') - (v_months || ' months')::interval END;

  RETURN QUERY
  SELECT q.ticket_id, q.lead_id, q.name, q.phone, q.avatar_url,
         q.last_appt, q.last_appt_time, q.next_appt, q.next_appt_time, q.is_scheduled
  FROM (
    SELECT t.id AS ticket_id, l.id AS lead_id, l.name, l.phone, l.avatar_url,
      pa.d AS last_appt, pa.t AS last_appt_time, na.d AS next_appt, na.t AS next_appt_time,
      false AS is_scheduled,
      coalesce(l.last_activity_at, l.last_message_at, l.created_at) AS ord
    FROM tickets t JOIN leads l ON l.id = t.lead_id
    LEFT JOIN LATERAL (
      SELECT a.date AS d, a."time" AS t FROM appointments a JOIN patients p ON p.id = a.patient_id
       WHERE a.clinic_id = p_clinic_id AND normalize_br_phone(p.phone) = normalize_br_phone(l.phone)
         AND a.status NOT IN ('cancelado','faltou') AND a.date <  v_today
       ORDER BY a.date DESC, a."time" DESC LIMIT 1) pa ON true
    LEFT JOIN LATERAL (
      SELECT a.date AS d, a."time" AS t FROM appointments a JOIN patients p ON p.id = a.patient_id
       WHERE a.clinic_id = p_clinic_id AND normalize_br_phone(p.phone) = normalize_br_phone(l.phone)
         AND a.status NOT IN ('cancelado','faltou') AND a.date >= v_today
       ORDER BY a.date ASC, a."time" ASC LIMIT 1) na ON true
    WHERE t.clinic_id = p_clinic_id AND t.stage_id = v_stage AND t.status = 'open'
      AND l.created_at >= v_cutoff

    UNION ALL

    SELECT (SELECT tk.id FROM tickets tk WHERE tk.lead_id = l.id ORDER BY (tk.status = 'open') DESC, tk.opened_at DESC LIMIT 1),
      l.id, l.name, l.phone, l.avatar_url,
      pa.d, pa.t, na.d, na.t, true,
      coalesce(l.last_activity_at, l.last_message_at, l.created_at)
    FROM leads l
    LEFT JOIN LATERAL (
      SELECT a.date AS d, a."time" AS t FROM appointments a JOIN patients p ON p.id = a.patient_id
       WHERE a.clinic_id = p_clinic_id AND normalize_br_phone(p.phone) = normalize_br_phone(l.phone)
         AND a.status NOT IN ('cancelado','faltou') AND a.date <  v_today
       ORDER BY a.date DESC, a."time" DESC LIMIT 1) pa ON true
    LEFT JOIN LATERAL (
      SELECT a.date AS d, a."time" AS t FROM appointments a JOIN patients p ON p.id = a.patient_id
       WHERE a.clinic_id = p_clinic_id AND normalize_br_phone(p.phone) = normalize_br_phone(l.phone)
         AND a.status NOT IN ('cancelado','faltou') AND a.date >= v_today
       ORDER BY a.date ASC, a."time" ASC LIMIT 1) na ON true
    WHERE l.clinic_id = p_clinic_id
      AND l.created_at >= v_cutoff
      AND l.onboarding_reviewed_at IS NULL
      AND coalesce(l.is_not_lead, false) = false
      AND EXISTS (SELECT 1 FROM tickets tk WHERE tk.lead_id = l.id)
      AND NOT EXISTS (SELECT 1 FROM tickets tk WHERE tk.lead_id = l.id AND tk.stage_id = v_stage AND tk.status = 'open')
      AND (
        pa.d IS NOT NULL OR na.d IS NOT NULL
        OR EXISTS (SELECT 1 FROM tickets tk WHERE tk.lead_id = l.id AND tk.outcome = 'ganho')
      )

    UNION ALL

    SELECT tk.id, l.id, l.name, l.phone, l.avatar_url,
      NULL::date, NULL::time, NULL::date, NULL::time, false,
      coalesce(l.last_activity_at, l.last_message_at, l.created_at)
    FROM leads l
    JOIN LATERAL (
      SELECT t2.id FROM tickets t2
        LEFT JOIN funnel_stages fs2 ON fs2.id = t2.stage_id
       WHERE t2.lead_id = l.id AND t2.status = 'open' AND t2.outcome IS NULL
         AND coalesce(fs2.slug,'') NOT IN ('perdido','ganho','sincronizacao')
       ORDER BY t2.opened_at DESC LIMIT 1) tk ON true
    WHERE l.clinic_id = p_clinic_id
      AND l.created_at >= v_cutoff
      AND l.onboarding_reviewed_at IS NULL
      AND coalesce(l.is_not_lead, false) = false
      AND EXISTS (SELECT 1 FROM chat_messages cm WHERE cm.lead_id = l.id)
      AND NOT EXISTS (SELECT 1 FROM tickets t3 WHERE t3.lead_id = l.id AND t3.stage_id = v_stage AND t3.status = 'open')
      AND NOT EXISTS (SELECT 1 FROM tickets t4 WHERE t4.lead_id = l.id AND t4.outcome = 'ganho')
      AND NOT EXISTS (SELECT 1 FROM appointments a JOIN patients p ON p.id = a.patient_id
                      WHERE a.clinic_id = p_clinic_id AND normalize_br_phone(p.phone) = normalize_br_phone(l.phone)
                        AND a.status NOT IN ('cancelado','faltou'))
  ) q
  ORDER BY q.is_scheduled, q.ord DESC NULLS LAST, q.name;
END; $function$;
REVOKE ALL ON FUNCTION public.onboarding_pending_leads(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.onboarding_pending_leads(uuid) TO authenticated, service_role;

-- 7) Aplicar a auditoria de um lead -----------------------------------------------------------
DROP FUNCTION IF EXISTS public.onboarding_audit_apply(uuid, text, date, boolean, date, boolean, boolean);
DROP FUNCTION IF EXISTS public.onboarding_audit_apply(uuid, text, date, boolean, date, boolean, boolean, boolean);
DROP FUNCTION IF EXISTS public.onboarding_audit_apply(uuid, text, date, boolean, date, boolean, boolean, boolean, boolean);
CREATE OR REPLACE FUNCTION public.onboarding_audit_apply(p_ticket_id uuid, p_category text, p_last_appt_date date DEFAULT NULL::date, p_resolve_past boolean DEFAULT true, p_next_appt_date date DEFAULT NULL::date, p_ai_enabled boolean DEFAULT true, p_followup_enabled boolean DEFAULT true, p_scheduled boolean DEFAULT false, p_human_only boolean DEFAULT false, p_next_appt_time time without time zone DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_lead uuid; v_clinic uuid; v_ganho uuid; v_agendado uuid; v_wa uuid; v_perdido uuid; v_sinc uuid;
  v_past_ticket uuid; v_action text; v_next_txt text;
BEGIN
  SELECT lead_id, clinic_id INTO v_lead, v_clinic FROM tickets WHERE id = p_ticket_id;
  IF v_lead IS NULL THEN RETURN jsonb_build_object('success', false, 'error_code', 'ticket_not_found'); END IF;
  IF NOT fn_can_onboard(v_clinic) THEN RETURN jsonb_build_object('success', false, 'error_code', 'forbidden'); END IF;
  IF p_category NOT IN ('contato_geral','lead_potencial','lead_perdido','paciente') THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'invalid_category');
  END IF;

  v_next_txt := CASE WHEN p_next_appt_date IS NULL THEN NULL
    ELSE 'Próximo agendamento em ' || to_char(p_next_appt_date, 'DD/MM/YYYY')
         || CASE WHEN p_next_appt_time IS NOT NULL THEN ' às ' || to_char(p_next_appt_time, 'HH24:MI') ELSE '' END
         || ' (onboarding)' END;

  PERFORM set_config('app.onboarding_import', 'on', true);
  PERFORM set_config('app.stage_source', 'onboarding', true);
  UPDATE leads SET onboarding_reviewed_at = now(), human_only = p_human_only WHERE id = v_lead;

  -- Cliente existente: só define IA/follow-up, não toca no ticket (a venda/agendamento fica intacta).
  IF p_scheduled THEN
    IF p_category = 'contato_geral' THEN
      UPDATE leads SET is_not_lead = true, ai_enabled = false, followup_enabled = false, not_lead_at = now() WHERE id = v_lead;
    ELSE
      UPDATE leads SET is_not_lead = false, ai_enabled = p_ai_enabled, followup_enabled = p_followup_enabled WHERE id = v_lead;
    END IF;
    RETURN jsonb_build_object('success', true, 'action', 'scheduled_' || p_category, 'lead_id', v_lead);
  END IF;

  -- Reset (permite reauditar): apaga tickets de onboarding e devolve o principal à Sincronização,
  -- preservando anotação HUMANA (só limpa nota gerada pelo próprio onboarding).
  DELETE FROM tickets WHERE lead_id = v_lead AND id <> p_ticket_id AND coalesce(notes,'') LIKE '%(onboarding)%';
  SELECT id INTO v_sinc FROM funnel_stages WHERE clinic_id = v_clinic AND slug = 'sincronizacao' LIMIT 1;
  UPDATE tickets SET status='open', closed_at=NULL, outcome=NULL, outcome_at=NULL, loss_reason=NULL,
         stage_id=coalesce(v_sinc, stage_id),
         notes = CASE WHEN coalesce(notes,'') LIKE '%(onboarding)%' THEN NULL ELSE notes END
   WHERE id = p_ticket_id;

  IF p_category = 'contato_geral' THEN
    UPDATE leads SET is_not_lead = true, ai_enabled = false, followup_enabled = false, not_lead_at = now() WHERE id = v_lead;
    UPDATE tickets SET status = 'closed', closed_at = coalesce(closed_at, now()) WHERE id = p_ticket_id AND status <> 'closed';
    RETURN jsonb_build_object('success', true, 'action', 'contato_geral', 'lead_id', v_lead);
  END IF;

  IF p_category = 'lead_perdido' THEN
    -- Resolver SEMPRE liga a IA (regra do dono): perdido é aquela oportunidade, não a pessoa.
    -- Exceção: cadeado human_only, que a trigger força para off.
    UPDATE leads SET is_not_lead = false, ai_enabled = true, followup_enabled = false WHERE id = v_lead;
    SELECT id INTO v_perdido FROM funnel_stages WHERE clinic_id = v_clinic AND slug = 'perdido' LIMIT 1;
    UPDATE tickets SET outcome = 'perdido', outcome_at = now(), status = 'closed', closed_at = coalesce(closed_at, now()),
           stage_id = coalesce(v_perdido, stage_id), loss_reason = coalesce(loss_reason, 'Onboarding') WHERE id = p_ticket_id;
    RETURN jsonb_build_object('success', true, 'action', 'lead_perdido', 'lead_id', v_lead);
  END IF;

  UPDATE leads SET is_not_lead = false, ai_enabled = p_ai_enabled, followup_enabled = p_followup_enabled WHERE id = v_lead;

  IF p_category = 'lead_potencial' THEN
    SELECT id INTO v_wa FROM funnel_stages WHERE clinic_id = v_clinic AND slug = 'whatsapp' LIMIT 1;
    UPDATE tickets SET stage_id = coalesce(v_wa, stage_id) WHERE id = p_ticket_id AND status = 'open';
    RETURN jsonb_build_object('success', true, 'action', 'lead_potencial', 'lead_id', v_lead);
  END IF;

  -- p_category = 'paciente'
  IF p_last_appt_date IS NOT NULL AND NOT p_resolve_past AND p_next_appt_date IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'resolve_past_required_with_open_current');
  END IF;

  SELECT id INTO v_ganho    FROM funnel_stages WHERE clinic_id = v_clinic AND slug = 'ganho'    LIMIT 1;
  SELECT id INTO v_agendado FROM funnel_stages WHERE clinic_id = v_clinic AND slug = 'agendado' LIMIT 1;
  SELECT id INTO v_wa       FROM funnel_stages WHERE clinic_id = v_clinic AND slug = 'whatsapp' LIMIT 1;

  IF p_last_appt_date IS NOT NULL AND p_next_appt_date IS NOT NULL THEN
    INSERT INTO tickets (clinic_id, lead_id, stage_id, status, outcome, opened_at, closed_at, outcome_at, notes)
    VALUES (v_clinic, v_lead, coalesce(v_ganho, v_sinc), 'closed', 'ganho',
            (p_last_appt_date::timestamp) AT TIME ZONE 'America/Sao_Paulo',
            (p_last_appt_date::timestamp) AT TIME ZONE 'America/Sao_Paulo',
            (p_last_appt_date::timestamp) AT TIME ZONE 'America/Sao_Paulo',
            'Atendimento anterior em ' || to_char(p_last_appt_date, 'DD/MM/YYYY') || ' (onboarding)')
    RETURNING id INTO v_past_ticket;
    UPDATE tickets SET stage_id = coalesce(v_agendado, stage_id),
           notes = CASE WHEN coalesce(notes,'') = '' THEN v_next_txt ELSE notes || E'\n' || v_next_txt END
     WHERE id = p_ticket_id;
    v_action := 'paciente_agendado';

  ELSIF p_last_appt_date IS NOT NULL THEN
    -- Só passado: REUSA o ticket da Sincronização como o próprio ganho (não deixa ticket fechado
    -- órfão parado naquela etapa).
    UPDATE tickets SET stage_id = coalesce(v_ganho, stage_id), outcome = 'ganho',
           status     = CASE WHEN p_resolve_past THEN 'closed' ELSE 'open' END,
           opened_at  = (p_last_appt_date::timestamp) AT TIME ZONE 'America/Sao_Paulo',
           closed_at  = CASE WHEN p_resolve_past THEN (p_last_appt_date::timestamp) AT TIME ZONE 'America/Sao_Paulo' END,
           outcome_at = (p_last_appt_date::timestamp) AT TIME ZONE 'America/Sao_Paulo',
           notes = CASE WHEN coalesce(notes,'') = '' THEN 'Atendimento anterior em ' || to_char(p_last_appt_date, 'DD/MM/YYYY') || ' (onboarding)'
                        ELSE notes || E'\n' || 'Atendimento anterior em ' || to_char(p_last_appt_date, 'DD/MM/YYYY') || ' (onboarding)' END
     WHERE id = p_ticket_id;
    v_past_ticket := p_ticket_id;
    v_action := CASE WHEN p_resolve_past THEN 'paciente_passado' ELSE 'paciente_passado_aberto' END;

  ELSIF p_next_appt_date IS NOT NULL THEN
    UPDATE tickets SET stage_id = coalesce(v_agendado, stage_id),
           notes = CASE WHEN coalesce(notes,'') = '' THEN v_next_txt ELSE notes || E'\n' || v_next_txt END
     WHERE id = p_ticket_id;
    v_action := 'paciente_agendado';

  ELSE
    UPDATE tickets SET stage_id = coalesce(v_wa, stage_id) WHERE id = p_ticket_id;
    v_action := 'paciente_ativo';
  END IF;

  RETURN jsonb_build_object('success', true, 'action', v_action, 'lead_id', v_lead, 'past_ticket', v_past_ticket);
EXCEPTION WHEN OTHERS THEN
  PERFORM log_system_error('onboarding-audit', 'audit_apply_failed', 'Falha ao aplicar auditoria de onboarding', 'error',
    v_clinic, jsonb_build_object('ticket_id', p_ticket_id, 'category', p_category, 'detail', sqlerrm), false);
  RETURN jsonb_build_object('success', false, 'error_code', 'exception', 'detail', sqlerrm);
END; $function$;
REVOKE ALL ON FUNCTION public.onboarding_audit_apply(uuid, text, date, boolean, date, boolean, boolean, boolean, boolean, time without time zone) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.onboarding_audit_apply(uuid, text, date, boolean, date, boolean, boolean, boolean, boolean, time without time zone) TO authenticated, service_role;

-- Confirmação em LOTE dos clientes existentes (mesma seleção do Tipo B; não toca ticket).
CREATE OR REPLACE FUNCTION public.onboarding_confirm_all_existing(p_clinic_id uuid, p_ai boolean DEFAULT false, p_followup boolean DEFAULT false)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_stage uuid; v_months integer; v_cutoff timestamp; v_count int;
BEGIN
  IF NOT fn_can_onboard(p_clinic_id) THEN RETURN jsonb_build_object('success', false, 'error_code', 'forbidden'); END IF;
  SELECT id INTO v_stage FROM funnel_stages WHERE clinic_id = p_clinic_id AND slug = 'sincronizacao' LIMIT 1;
  SELECT onboarding_period_months INTO v_months FROM clinics WHERE id = p_clinic_id;
  v_cutoff := CASE WHEN v_months IS NULL THEN '1900-01-01'::timestamp
                   ELSE (now() AT TIME ZONE 'America/Sao_Paulo') - (v_months || ' months')::interval END;
  PERFORM set_config('app.onboarding_import', 'on', true);

  WITH tgt AS (
    SELECT l.id FROM leads l
    WHERE l.clinic_id = p_clinic_id
      AND l.created_at >= v_cutoff
      AND l.onboarding_reviewed_at IS NULL
      AND coalesce(l.is_not_lead, false) = false
      AND EXISTS (SELECT 1 FROM tickets tk WHERE tk.lead_id = l.id)
      AND (v_stage IS NULL OR NOT EXISTS (SELECT 1 FROM tickets tk WHERE tk.lead_id = l.id AND tk.stage_id = v_stage AND tk.status = 'open'))
      AND (
        EXISTS (SELECT 1 FROM appointments a JOIN patients p ON p.id = a.patient_id
                WHERE a.clinic_id = p_clinic_id AND normalize_br_phone(p.phone) = normalize_br_phone(l.phone)
                  AND a.status NOT IN ('cancelado','faltou'))
        OR EXISTS (SELECT 1 FROM tickets tk WHERE tk.lead_id = l.id AND tk.outcome = 'ganho')
      )
  )
  UPDATE leads SET is_not_lead = false, ai_enabled = p_ai, followup_enabled = p_followup, onboarding_reviewed_at = now()
  WHERE id IN (SELECT id FROM tgt);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('success', true, 'count', v_count);
END; $function$;

-- 8) Gatilho e estado (trava MACIA) ------------------------------------------------------------
-- should_onboard NÃO depende de pending: depois de liberar/concluir, o modal não reabre sozinho
-- (quem sobra pisca em vermelho na Sincronização + pílula "Organizar N"). Se dependesse, TODA
-- clínica antiga ganharia uma pílula gigante.
CREATE OR REPLACE FUNCTION public.onboarding_gate_status(p_clinic_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_connected boolean; v_completed boolean; v_pending int; v_stage uuid;
BEGIN
  IF NOT fn_can_onboard(p_clinic_id) THEN RETURN jsonb_build_object('should_onboard', false, 'pending', 0); END IF;
  v_connected := EXISTS (SELECT 1 FROM whatsapp_instances WHERE clinic_id = p_clinic_id AND status = 'connected');
  SELECT onboarding_completed_at IS NOT NULL INTO v_completed FROM clinics WHERE id = p_clinic_id;
  SELECT id INTO v_stage FROM funnel_stages WHERE clinic_id = p_clinic_id AND slug = 'sincronizacao' LIMIT 1;
  v_pending := coalesce((SELECT count(*) FROM tickets WHERE clinic_id = p_clinic_id AND stage_id = v_stage AND status = 'open'), 0);
  RETURN jsonb_build_object(
    'should_onboard', (v_connected AND NOT coalesce(v_completed, false)),
    'pending', v_pending, 'connected', v_connected, 'completed', coalesce(v_completed, false));
END; $function$;

CREATE OR REPLACE FUNCTION public.onboarding_mark_done(p_clinic_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT fn_can_onboard(p_clinic_id) THEN RETURN jsonb_build_object('success', false, 'error_code', 'forbidden'); END IF;
  UPDATE clinics SET onboarding_completed_at = now() WHERE id = p_clinic_id;
  RETURN jsonb_build_object('success', true);
END; $function$;

-- Refazer: reabre, desliga follow-ups e JÁ ENFILEIRA o deep-sync (no redo a fila nasce só com
-- existentes, então o botão "Sincronizar conversas" não aparece e sem isto nada seria importado).
CREATE OR REPLACE FUNCTION public.onboarding_reset(p_clinic_id uuid, p_months integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT fn_can_onboard(p_clinic_id) THEN RETURN jsonb_build_object('success', false, 'error_code', 'forbidden'); END IF;
  UPDATE clinics SET onboarding_completed_at = NULL, onboarding_period_months = p_months WHERE id = p_clinic_id;
  UPDATE leads SET onboarding_reviewed_at = NULL WHERE clinic_id = p_clinic_id;
  PERFORM fn_onboarding_disable_followups(p_clinic_id);
  DELETE FROM onboarding_deep_sync_chat WHERE clinic_id = p_clinic_id;
  INSERT INTO onboarding_deep_sync (clinic_id, status, target_cutoff, oldest_reached, rounds, last_error, updated_at)
  VALUES (p_clinic_id, 'pending', _onboarding_import_window(p_clinic_id), NULL, 0, NULL, now())
  ON CONFLICT (clinic_id) DO UPDATE
    SET status='pending', target_cutoff = _onboarding_import_window(p_clinic_id), oldest_reached=NULL,
        rounds=0, last_error=NULL, updated_at=now();
  RETURN jsonb_build_object('success', true, 'months', p_months);
END; $function$;

-- 9) Deep-sync do histórico (uazapi /message/history-sync) --------------------------------------
CREATE TABLE IF NOT EXISTS public.onboarding_deep_sync (
  clinic_id      uuid PRIMARY KEY REFERENCES public.clinics(id) ON DELETE CASCADE,
  status         text NOT NULL DEFAULT 'pending',   -- pending | running | done | error
  target_cutoff  timestamptz NOT NULL,
  oldest_reached timestamptz,
  rounds         int NOT NULL DEFAULT 0,
  last_error     text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.onboarding_deep_sync_chat (
  clinic_id    uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  chatid       text NOT NULL,
  phone_norm   text,
  oldest_ts    timestamptz,
  oldest_msgid text,
  fires        int NOT NULL DEFAULT 0,
  stall        int NOT NULL DEFAULT 0,
  done         boolean NOT NULL DEFAULT false,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (clinic_id, chatid)
);
CREATE INDEX IF NOT EXISTS idx_deep_sync_chat_pending ON public.onboarding_deep_sync_chat (clinic_id) WHERE NOT done;

ALTER TABLE public.onboarding_deep_sync      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_deep_sync_chat ENABLE ROW LEVEL SECURITY;
-- Sem policies: acesso só pelas RPCs SECURITY DEFINER (start/status/tick), que já checam fn_can_onboard.
REVOKE ALL ON TABLE public.onboarding_deep_sync      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.onboarding_deep_sync_chat FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.onboarding_deep_sync      TO service_role;
GRANT ALL ON TABLE public.onboarding_deep_sync_chat TO service_role;

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

CREATE OR REPLACE FUNCTION public.onboarding_deep_sync_status(p_clinic_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v onboarding_deep_sync%rowtype; v_total int; v_done int; v_pct int;
BEGIN
  IF NOT fn_can_onboard(p_clinic_id) THEN RETURN jsonb_build_object('exists', false); END IF;
  SELECT * INTO v FROM onboarding_deep_sync WHERE clinic_id = p_clinic_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('exists', false); END IF;
  SELECT count(*), count(*) FILTER (WHERE done) INTO v_total, v_done FROM onboarding_deep_sync_chat WHERE clinic_id = p_clinic_id;
  v_pct := CASE
    WHEN v.status = 'done' THEN 100
    WHEN v.oldest_reached IS NULL THEN 0
    ELSE LEAST(100, GREATEST(0, round(100.0 * extract(epoch FROM (now() - v.oldest_reached))
                                          / NULLIF(extract(epoch FROM (now() - v.target_cutoff)), 0))::numeric)::int)
  END;
  RETURN jsonb_build_object('exists', true, 'status', v.status, 'rounds', v.rounds,
    'target_cutoff', v.target_cutoff, 'oldest_reached', v.oldest_reached,
    'chats_total', v_total, 'chats_done', v_done, 'percent', v_pct, 'last_error', v.last_error,
    'updated_at', v.updated_at);
END; $function$;

-- Worker: colhe (re-import), atualiza a âncora por chat, marca done e dispara history-sync em lote.
-- Best-effort: depende do celular estar online; retoma se cair.
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

      -- 4) done: alcançou o alvo, estagnou 2 ticks, ou não tem âncora (nada a puxar)
      UPDATE onboarding_deep_sync_chat SET done=true, updated_at=now()
       WHERE clinic_id=v_clinic AND NOT done
         AND (oldest_ts <= v_target OR stall >= 2 OR oldest_msgid IS NULL);

      -- 5) dispara history-sync p/ um lote de chats ainda incompletos
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

      -- 6) job done quando não há mais chat disparável ou estourou o teto de rodadas
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
REVOKE ALL ON FUNCTION public.onboarding_deep_sync_tick(int, int) FROM PUBLIC, anon, authenticated;

-- 10) Crons ------------------------------------------------------------------------------------
-- Sem job ativo os dois são no-op barato.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='onboarding_deep_sync_tick') THEN
    PERFORM cron.unschedule('onboarding_deep_sync_tick');
  END IF;
  PERFORM cron.schedule('onboarding_deep_sync_tick', '*/2 * * * *',
    'SELECT public.onboarding_deep_sync_tick(1, 20)');

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='onboarding_rehost_avatars') THEN
    PERFORM cron.unschedule('onboarding_rehost_avatars');
  END IF;
  -- Re-hospeda avatares pps.whatsapp.net (que expiram) no bucket lead-avatars. A edge
  -- onboarding-rehost-avatars é deployada pelo CLI, não por migração.
  PERFORM cron.schedule('onboarding_rehost_avatars', '*/3 * * * *',
    $cmd$select public.system_http_post('https://yzpclhuifquhfqpiwysh.supabase.co/functions/v1/onboarding-rehost-avatars', '{"Content-Type":"application/json"}'::jsonb, '{}'::jsonb, 60000)$cmd$);
END $$;
