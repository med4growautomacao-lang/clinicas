-- 20260414125442_fix_duplicate_chat_messages
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- 1. Remove duplicatas existentes (mantém o de menor ctid = primeiro inserido fisicamente)
DELETE FROM chat_messages
WHERE id IN (
  SELECT a.id
  FROM chat_messages a
  JOIN chat_messages b 
    ON a.clinic_id = b.clinic_id
    AND a.lead_id = b.lead_id
    AND a.id > b.id
    AND a.message->>'content' = b.message->>'content'
    AND ABS(EXTRACT(EPOCH FROM (a.created_at - b.created_at))) < 10
);

-- 2. Trigger para bloquear inserções duplicadas no futuro
CREATE OR REPLACE FUNCTION prevent_duplicate_chat_message()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM chat_messages
    WHERE clinic_id = NEW.clinic_id
      AND lead_id = NEW.lead_id
      AND direction = NEW.direction
      AND message->>'content' = NEW.message->>'content'
      AND created_at > NOW() - INTERVAL '10 seconds'
  ) THEN
    RETURN NULL; -- descarta silenciosamente
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_prevent_duplicate_chat_message
BEFORE INSERT ON chat_messages
FOR EACH ROW EXECUTE FUNCTION prevent_duplicate_chat_message();
