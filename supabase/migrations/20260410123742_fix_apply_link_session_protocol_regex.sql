-- 20260410123742_fix_apply_link_session_protocol_regex
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

CREATE OR REPLACE FUNCTION apply_link_session_to_lead()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_content   text;
  v_protocolo text;
  v_session   link_sessions%ROWTYPE;
BEGIN
  IF NEW.direction <> 'inbound' THEN RETURN NEW; END IF;

  v_content := NEW.message->>'content';
  IF v_content IS NULL THEN RETURN NEW; END IF;

  -- Aceita protocolo de 4 dígitos numéricos (novo formato)
  v_protocolo := substring(v_content FROM '\[Protocolo ([0-9]{4}) não apague essa mensagem\]');
  IF v_protocolo IS NULL THEN RETURN NEW; END IF;

  SELECT * INTO v_session
  FROM link_sessions
  WHERE protocolo = v_protocolo
    AND expires_at > now()
    AND used_at IS NULL
  LIMIT 1;

  IF NOT FOUND THEN RETURN NEW; END IF;

  IF NEW.lead_id IS NOT NULL THEN
    UPDATE leads SET
      rast_id         = v_session.rast_id,
      source          = COALESCE(source, v_session.utm_source),
      capture_channel = COALESCE(capture_channel, v_session.utm_medium),
      g_source_name   = COALESCE(g_source_name, v_session.utm_source),
      g_campaign_name = COALESCE(g_campaign_name, v_session.utm_campaign)
    WHERE id = NEW.lead_id;

    UPDATE link_sessions SET used_at = now() WHERE protocolo = v_protocolo;
  END IF;

  RETURN NEW;
END;
$$;
