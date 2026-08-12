-- 20260721172716_conv_ai_modes_per_clinic
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Modo por clínica para os dois eixos: etapa e venda.
--   off     = a IA não mexe nesse eixo
--   suggest = vai para a fila de "Sugestões IA" (humano decide)
--   auto    = a IA aplica sozinha
-- Default preserva o comportamento anterior: etapa automática, venda sugerida.
ALTER TABLE public.conv_ai_clinic_config
  ADD COLUMN IF NOT EXISTS stage_mode text NOT NULL DEFAULT 'auto',
  ADD COLUMN IF NOT EXISTS sale_mode  text NOT NULL DEFAULT 'suggest';

ALTER TABLE public.conv_ai_clinic_config
  DROP CONSTRAINT IF EXISTS conv_ai_clinic_config_stage_mode_check;
ALTER TABLE public.conv_ai_clinic_config
  ADD CONSTRAINT conv_ai_clinic_config_stage_mode_check CHECK (stage_mode IN ('off','suggest','auto'));

ALTER TABLE public.conv_ai_clinic_config
  DROP CONSTRAINT IF EXISTS conv_ai_clinic_config_sale_mode_check;
ALTER TABLE public.conv_ai_clinic_config
  ADD CONSTRAINT conv_ai_clinic_config_sale_mode_check CHECK (sale_mode IN ('off','suggest','auto'));
