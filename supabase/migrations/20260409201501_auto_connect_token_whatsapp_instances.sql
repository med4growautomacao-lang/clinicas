-- 20260409201501_auto_connect_token_whatsapp_instances
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- 1. Preenche tokens nulos com UUID gerado
UPDATE whatsapp_instances
SET connect_token = gen_random_uuid()
WHERE connect_token IS NULL;

-- 2. Função que auto-gera connect_token ao inserir nova instância
CREATE OR REPLACE FUNCTION set_whatsapp_connect_token()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.connect_token IS NULL THEN
    NEW.connect_token := gen_random_uuid();
  END IF;
  RETURN NEW;
END;
$$;

-- 3. Trigger BEFORE INSERT
DROP TRIGGER IF EXISTS trg_set_whatsapp_connect_token ON whatsapp_instances;
CREATE TRIGGER trg_set_whatsapp_connect_token
  BEFORE INSERT ON whatsapp_instances
  FOR EACH ROW
  EXECUTE FUNCTION set_whatsapp_connect_token();
