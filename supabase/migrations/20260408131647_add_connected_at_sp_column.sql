-- 20260408131647_add_connected_at_sp_column
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Adiciona coluna
ALTER TABLE whatsapp_instances ADD COLUMN IF NOT EXISTS connected_at_sp text;

-- Popula dados existentes
UPDATE whatsapp_instances
SET connected_at_sp = to_char(connected_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI:SS')
WHERE connected_at IS NOT NULL;

-- Trigger para manter sincronizado
CREATE OR REPLACE FUNCTION sync_connected_at_sp()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.connected_at IS NOT NULL THEN
    NEW.connected_at_sp := to_char(NEW.connected_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI:SS');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_connected_at_sp ON whatsapp_instances;
CREATE TRIGGER trg_connected_at_sp
  BEFORE INSERT OR UPDATE OF connected_at ON whatsapp_instances
  FOR EACH ROW EXECUTE FUNCTION sync_connected_at_sp();
