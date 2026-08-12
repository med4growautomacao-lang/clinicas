-- 20260512192648_add_test_reset_phrase_rebook
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Adiciona segunda frase de reset (paciente de reagendamento)
ALTER TABLE ai_config ADD COLUMN IF NOT EXISTS test_reset_phrase_rebook text;

COMMENT ON COLUMN ai_config.test_reset_phrase IS
  'Frase que aciona test_reset_full (primeiro contato absoluto). Apaga TUDO.';
COMMENT ON COLUMN ai_config.test_reset_phrase_rebook IS
  'Frase que aciona test_reset_for_rebook (paciente de reagendamento). Apaga chat/lead/ticket, preserva paciente/appointments.';
