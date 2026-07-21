-- =============================================================================
-- IA Analista de Conversas — bootstrap na ativação + "Analisar agora"
--
-- 1) conv_ai_set_enabled: ligar a análise passa a JÁ montar o manual da clínica
--    a partir das conversas existentes, em vez de esperar o job da madrugada.
--    Sem isso a clínica passa até 24h sendo analisada sem manual — exatamente a
--    diferença entre a análise que confundiu agendamento com venda na Vaz e a
--    que acertou depois de existir manual.
--
-- 2) conv_ai_request_analysis: o "Analisar agora". Enfileira até 50 atendimentos
--    abertos com conversa nas últimas 48h (com last_message_at já vencido, para
--    furar o debounce: o pedido foi explícito) e chama a edge na hora via
--    system_http_post — nunca net.http_post cru.
--
--    Cooldown de 2 min, guardado em last_manual_run_at. É MENOR que o ciclo do
--    cron (5 min) de propósito: um botão mais lento que o automático não teria
--    razão de existir. O teto diário por clínica continua valendo.
-- =============================================================================

ALTER TABLE public.conv_ai_clinic_config
  ADD COLUMN IF NOT EXISTS last_manual_run_at timestamptz;

CREATE OR REPLACE FUNCTION public.conv_ai_set_enabled(p_clinic_id uuid, p_enabled boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tem_manual boolean;
  v_liberada   boolean;
BEGIN
  IF NOT (
    ((p_clinic_id IN (SELECT cu.clinic_id FROM clinic_users cu WHERE cu.id = auth.uid()))
      AND is_clinic_active(p_clinic_id))
    OR is_clinic_admin(p_clinic_id)
  ) THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  SELECT COALESCE((features->>'feature_conv_ai')::boolean, false) INTO v_liberada
    FROM clinics WHERE id = p_clinic_id;
  IF p_enabled AND NOT COALESCE(v_liberada, false) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'feature_off');
  END IF;

  INSERT INTO conv_ai_clinic_config (clinic_id, enabled)
  VALUES (p_clinic_id, p_enabled)
  ON CONFLICT (clinic_id) DO UPDATE SET enabled = p_enabled, updated_at = now();

  IF NOT p_enabled THEN
    RETURN jsonb_build_object('success', true, 'enabled', false);
  END IF;

  SELECT EXISTS (SELECT 1 FROM conv_ai_prompt_versions v
                  WHERE v.clinic_id = p_clinic_id AND v.is_current)
    INTO v_tem_manual;

  IF NOT v_tem_manual THEN
    BEGIN
      PERFORM system_http_post(
        'https://yzpclhuifquhfqpiwysh.supabase.co/functions/v1/conv-ai-learn?clinic='
          || p_clinic_id::text || '&mode=bootstrap');
    EXCEPTION WHEN OTHERS THEN
      NULL; -- bootstrap é otimização, não pré-requisito: o cron diário refaz
    END;
  END IF;

  RETURN jsonb_build_object('success', true, 'enabled', true, 'montando_manual', NOT v_tem_manual);
END;
$$;
REVOKE ALL ON FUNCTION public.conv_ai_set_enabled(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conv_ai_set_enabled(uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.conv_ai_request_analysis(p_clinic_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cfg      RECORD;
  v_espera   int;
  v_fila     int;
BEGIN
  IF NOT (
    ((p_clinic_id IN (SELECT cu.clinic_id FROM clinic_users cu WHERE cu.id = auth.uid()))
      AND is_clinic_active(p_clinic_id))
    OR is_clinic_admin(p_clinic_id)
  ) THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  SELECT c.enabled, c.last_manual_run_at,
         COALESCE((cl.features->>'feature_conv_ai')::boolean, false) AS liberada
    INTO v_cfg
    FROM conv_ai_clinic_config c
    JOIN clinics cl ON cl.id = c.clinic_id
   WHERE c.clinic_id = p_clinic_id;

  IF NOT FOUND OR NOT v_cfg.enabled OR NOT v_cfg.liberada THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'disabled');
  END IF;

  v_espera := GREATEST(0, 120 - FLOOR(EXTRACT(EPOCH FROM (now() - COALESCE(v_cfg.last_manual_run_at, 'epoch'::timestamptz))))::int);
  IF v_espera > 0 THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'cooldown', 'aguarde_segundos', v_espera);
  END IF;

  WITH alvo AS (
    SELECT t.id AS ticket_id, t.clinic_id, t.lead_id, MAX(m.seq) AS seq
      FROM tickets t
      JOIN chat_messages m ON m.lead_id = t.lead_id
       AND m.created_at >= (t.opened_at AT TIME ZONE 'America/Sao_Paulo') - interval '5 minutes'
     WHERE t.clinic_id = p_clinic_id
       AND t.status = 'open' AND t.outcome IS NULL
       AND m.created_at > (now() AT TIME ZONE 'America/Sao_Paulo') - interval '48 hours'
     GROUP BY 1, 2, 3
     ORDER BY MAX(m.seq) DESC
     LIMIT 50
  ), ins AS (
    INSERT INTO conv_ai_queue (ticket_id, clinic_id, lead_id, last_message_seq, last_message_at, status)
    SELECT a.ticket_id, a.clinic_id, a.lead_id, a.seq, now() - interval '10 minutes', 'pending'
      FROM alvo a
    ON CONFLICT (ticket_id) DO UPDATE
      SET last_message_seq = GREATEST(conv_ai_queue.last_message_seq, EXCLUDED.last_message_seq),
          last_message_at  = now() - interval '10 minutes',
          status           = CASE WHEN conv_ai_queue.analyzed_seq >= EXCLUDED.last_message_seq
                                  THEN conv_ai_queue.status ELSE 'pending' END,
          updated_at       = now()
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_fila FROM ins;

  UPDATE conv_ai_clinic_config SET last_manual_run_at = now(), updated_at = now()
   WHERE clinic_id = p_clinic_id;

  BEGIN
    PERFORM system_http_post('https://yzpclhuifquhfqpiwysh.supabase.co/functions/v1/conv-ai-analyst');
  EXCEPTION WHEN OTHERS THEN
    NULL; -- o cron pega em até 5 min de qualquer forma
  END;

  RETURN jsonb_build_object('success', true, 'enfileirados', COALESCE(v_fila, 0));
END;
$$;
REVOKE ALL ON FUNCTION public.conv_ai_request_analysis(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conv_ai_request_analysis(uuid) TO authenticated;
