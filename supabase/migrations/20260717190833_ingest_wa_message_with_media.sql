-- 20260717190833_ingest_wa_message_with_media
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- ingest_wa_message agora aceita mídia JÁ pronta (baixada+subida pela edge ANTES
-- do insert) → a mensagem nasce completa e o realtime (que só escuta INSERT) já
-- entrega o player. Sem depender de UPDATE pós-insert que a tela não recebe.

CREATE OR REPLACE FUNCTION public.ingest_wa_message(
  p_instance_token text,
  p_direction text,
  p_lead_phone text,
  p_content text,
  p_wa_message_id text DEFAULT NULL,
  p_lead_name text DEFAULT NULL,
  p_sender text DEFAULT 'human',
  p_media_kind text DEFAULT NULL,
  p_media_mime text DEFAULT NULL,
  p_media_path text DEFAULT NULL,
  p_media_filename text DEFAULT NULL,
  p_media_duration numeric DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_clinic uuid;
  v_clinic_phone text;
  v_norm text;
  v_lead RECORD;
  v_lead_created boolean := false;
  v_msg_id uuid;
  v_duplicate boolean := false;
  v_cfg RECORD;
  v_forward boolean := false;
  v_message jsonb;
BEGIN
  IF p_direction NOT IN ('inbound','outbound') THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'invalid_direction');
  END IF;

  SELECT clinic_id, phone_number INTO v_clinic, v_clinic_phone
  FROM whatsapp_instances WHERE api_token = p_instance_token LIMIT 1;
  IF v_clinic IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'instance_not_found');
  END IF;

  v_norm := normalize_br_phone(p_lead_phone);
  IF v_norm IS NULL OR length(v_norm) < 12 THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'invalid_phone');
  END IF;

  SELECT id, ai_enabled, is_not_lead INTO v_lead
  FROM leads WHERE clinic_id = v_clinic AND normalize_br_phone(phone) = v_norm
  ORDER BY last_activity_at DESC NULLS LAST LIMIT 1;

  IF v_lead.id IS NULL AND p_direction = 'inbound' THEN
    BEGIN
      INSERT INTO leads (clinic_id, name, phone, source, capture_channel)
      VALUES (v_clinic, COALESCE(NULLIF(btrim(p_lead_name), ''), 'Lead ' || v_norm), v_norm, NULL, 'whatsapp')
      RETURNING id, ai_enabled, is_not_lead INTO v_lead;
      v_lead_created := true;
    EXCEPTION WHEN unique_violation THEN
      SELECT id, ai_enabled, is_not_lead INTO v_lead
      FROM leads WHERE clinic_id = v_clinic AND (phone = v_norm OR normalize_br_phone(phone) = v_norm)
      ORDER BY last_activity_at DESC NULLS LAST LIMIT 1;
    END;
  END IF;

  v_message := jsonb_build_object(
    'type', CASE WHEN p_sender = 'ai' THEN 'ai' ELSE 'human' END,
    'content', COALESCE(p_content, ''),
    'additional_kwargs', '{}'::jsonb,
    'response_metadata', '{}'::jsonb
  );
  IF p_media_path IS NOT NULL THEN
    v_message := v_message || jsonb_strip_nulls(jsonb_build_object(
      'kind', p_media_kind, 'mimetype', p_media_mime, 'fileURL', p_media_path,
      'filename', p_media_filename, 'duration', p_media_duration));
  END IF;

  INSERT INTO chat_messages (clinic_id, lead_id, phone, direction, sender, wa_message_id, message, metadata)
  VALUES (
    v_clinic, v_lead.id, v_norm, p_direction, p_sender, NULLIF(btrim(p_wa_message_id), ''), v_message,
    CASE WHEN p_media_path IS NOT NULL
      THEN jsonb_strip_nulls(jsonb_build_object('kind',p_media_kind,'mime',p_media_mime,'storagePath',p_media_path,'filename',p_media_filename))
      ELSE '{}'::jsonb END
  )
  RETURNING id INTO v_msg_id;
  IF v_msg_id IS NULL THEN v_duplicate := true; END IF;

  SELECT auto_schedule, response_wait_seconds, handoff_enabled, handoff_rules,
         confirm_enabled, transition_rules, test_mode_enabled, test_numbers
    INTO v_cfg FROM ai_config WHERE clinic_id = v_clinic;

  v_forward := p_direction = 'inbound' AND NOT v_duplicate
    AND v_lead.id IS NOT NULL AND v_lead.ai_enabled IS NOT FALSE
    AND COALESCE(v_lead.is_not_lead, false) = false
    AND COALESCE(v_cfg.auto_schedule, false)
    AND (COALESCE(v_cfg.test_mode_enabled, false) = false
         OR EXISTS (SELECT 1 FROM unnest(COALESCE(v_cfg.test_numbers, ARRAY[]::text[])) tn
                    WHERE normalize_br_phone(tn) = v_norm));

  RETURN jsonb_build_object(
    'success', true, 'clinic_id', v_clinic, 'clinic_phone', v_clinic_phone,
    'lead_id', v_lead.id, 'lead_created', v_lead_created, 'message_id', v_msg_id,
    'duplicate', v_duplicate, 'forward_ai', v_forward,
    'ai', jsonb_build_object(
      'response_wait_seconds', COALESCE(v_cfg.response_wait_seconds, 30),
      'handoff_enabled', COALESCE(v_cfg.handoff_enabled, false),
      'handoff_rules', COALESCE(v_cfg.handoff_rules, '[]'::jsonb),
      'confirm_enabled', COALESCE(v_cfg.confirm_enabled, false),
      'transition_rules', COALESCE(v_cfg.transition_rules, '[]'::jsonb)
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.ingest_wa_message(text,text,text,text,text,text,text,text,text,text,text,numeric) FROM anon, authenticated;
