-- 20260409221750_link_sessions_uuid_rast_id
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Recria link_sessions com rast_id como UUID completo e protocolo como campo separado
ALTER TABLE link_sessions ADD COLUMN IF NOT EXISTS protocolo text;

-- Preenche protocolo nos registros existentes (primeiros 8 chars do rast_id)
UPDATE link_sessions SET protocolo = left(rast_id, 8) WHERE protocolo IS NULL;

-- Index no protocolo para busca rápida
CREATE INDEX IF NOT EXISTS idx_link_sessions_protocolo ON link_sessions(protocolo);

-- Atualiza trigger para buscar por protocolo e salvar UUID completo no lead
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
