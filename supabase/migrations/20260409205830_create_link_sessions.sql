-- 20260409205830_create_link_sessions
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Tabela de sessões de redirect
CREATE TABLE IF NOT EXISTS link_sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rast_id     text NOT NULL UNIQUE,
  clinic_id   uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  utm_source  text,
  utm_medium  text,
  utm_campaign text,
  utm_content text,
  utm_term    text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  used_at     timestamptz
);

CREATE INDEX idx_link_sessions_rast_id ON link_sessions(rast_id);
CREATE INDEX idx_link_sessions_expires ON link_sessions(expires_at);

-- Trigger: quando chega mensagem inbound com [rast_id], preenche UTMs no lead
CREATE OR REPLACE FUNCTION apply_link_session_to_lead()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_content   text;
  v_rast_id   text;
  v_session   link_sessions%ROWTYPE;
BEGIN
  -- Só mensagens inbound
  IF NEW.direction <> 'inbound' THEN RETURN NEW; END IF;

  -- Extrai texto da mensagem
  v_content := NEW.message->>'content';
  IF v_content IS NULL THEN RETURN NEW; END IF;

  -- Busca padrão [nod-XXXXXXXX]
  v_rast_id := substring(v_content FROM '\[nod-([a-f0-9]{8})\]');
  IF v_rast_id IS NULL THEN RETURN NEW; END IF;
  v_rast_id := 'nod-' || v_rast_id;

  -- Busca sessão válida e não expirada
  SELECT * INTO v_session
  FROM link_sessions
  WHERE rast_id = v_rast_id
    AND expires_at > now()
    AND used_at IS NULL
  LIMIT 1;

  IF NOT FOUND THEN RETURN NEW; END IF;

  -- Atualiza o lead com UTMs e rast_id
  IF NEW.lead_id IS NOT NULL THEN
    UPDATE leads SET
      rast_id       = v_session.rast_id,
      source        = COALESCE(source, v_session.utm_source),
      capture_channel = COALESCE(capture_channel, v_session.utm_medium),
      g_source_name = COALESCE(g_source_name, v_session.utm_source),
      g_campaign_name = COALESCE(g_campaign_name, v_session.utm_campaign)
    WHERE id = NEW.lead_id;

    -- Marca sessão como usada
    UPDATE link_sessions SET used_at = now() WHERE rast_id = v_rast_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_apply_link_session ON chat_messages;
CREATE TRIGGER trg_apply_link_session
  AFTER INSERT ON chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION apply_link_session_to_lead();
