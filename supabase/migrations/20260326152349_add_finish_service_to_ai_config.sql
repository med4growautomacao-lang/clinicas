-- 20260326152349_add_finish_service_to_ai_config
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS finish_service_enabled BOOLEAN DEFAULT false; ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS finish_service_message TEXT DEFAULT 'Atendimento finalizado com sucesso. Agradecemos o contato!';
