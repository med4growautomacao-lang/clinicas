-- =============================================================================
-- IA Analista de Conversas — modo por clínica em CADA eixo
--
-- Mesmo formato do kill-switch global do Super Admin, só que por clínica e
-- separado para etapa e para venda (pedido do dono, 21/07):
--   off     = a IA não mexe nesse eixo
--   suggest = vai para a fila de "Sugestões IA" (o humano decide)
--   auto    = a IA aplica sozinha
--
-- Defaults preservam o comportamento anterior: etapa automática, venda sugerida.
-- O kill-switch global continua mandando em cima: fora de 'active', nada é
-- aplicado, só registrado.
-- =============================================================================

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
