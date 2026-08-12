-- Follow-up Pós-Atendimento: mensagem enviada X dias após o ticket ser ganho/perdido.
-- Diferente de finish_* (que dispara no momento do fechamento), o pós dispara com atraso de dias.
-- O disparo em si é feito por query agendada no n8n (externa); o repo só guarda a config.
ALTER TABLE ai_config
  ADD COLUMN IF NOT EXISTS pos_followup_ganho_enabled    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pos_followup_ganho_message    text,
  ADD COLUMN IF NOT EXISTS pos_followup_ganho_days       integer NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS pos_followup_perdido_enabled  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pos_followup_perdido_message  text,
  ADD COLUMN IF NOT EXISTS pos_followup_perdido_days     integer NOT NULL DEFAULT 30;
