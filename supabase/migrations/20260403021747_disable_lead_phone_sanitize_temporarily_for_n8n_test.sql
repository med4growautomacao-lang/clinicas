-- 20260403021747_disable_lead_phone_sanitize_temporarily_for_n8n_test
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- 1. Desativa a trigger de limpeza de telefone (Isso evita erros se o número mudar sutilmente)
ALTER TABLE leads DISABLE TRIGGER tr_sanitize_lead_phone;
