-- 20260409213503_redirect_message_and_protocol_trigger
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- 1. Coluna redirect_message em whatsapp_instances
ALTER TABLE whatsapp_instances
ADD COLUMN IF NOT EXISTS redirect_message text DEFAULT 'Olá! Gostaria de mais informações.';

-- 2. Atualiza trigger com novo padrão [Protocolo XXXXXXXX não apague essa mensagem]
CREATE OR REPLACE FUNCTION apply_link_session_to_lead()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_content   text;
  v_protocolo text;
  v_session   link_sessions%ROWTYPE;
BEGIN
  IF NEW.direction <> 'inbound' THEN RETURN NEW; END IF;

  v_content := NEW.message->>'content';
  IF v_content IS NULL THEN RETURN NEW; END IF;

  v_protocolo := substring(v_content FROM '\[Protocolo ([a-f0-9]{8}) não apague essa mensagem\]');
  IF v_protocolo IS NULL THEN RETURN NEW; END IF;

  SELECT * INTO v_session
  FROM link_sessions
  WHERE rast_id = v_protocolo
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

    UPDATE link_sessions SET used_at = now() WHERE rast_id = v_protocolo;
  END IF;

  RETURN NEW;
END;
$$;
