-- ============================================
-- Confirmações de consulta
-- ============================================
ALTER TABLE public.ai_config
  ADD COLUMN IF NOT EXISTS confirm_enabled     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS confirm_lead_time   int     NOT NULL DEFAULT 1440,   -- minutos antes da consulta
  ADD COLUMN IF NOT EXISTS confirm_message     text    DEFAULT 'Olá {paciente}! Sua consulta está confirmada para amanhã. Por favor, confirme sua presença respondendo SIM ou NÃO.';

-- ============================================
-- Régua de Follow-up (reengajamento)
-- ============================================
ALTER TABLE public.ai_config
  ADD COLUMN IF NOT EXISTS followup_enabled    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS followup_delay      int     NOT NULL DEFAULT 1440,   -- minutos de inatividade
  ADD COLUMN IF NOT EXISTS followup_message    text    DEFAULT 'Olá {paciente}, percebi que ainda não finalizamos seu agendamento. Gostaria de continuar de onde paramos?';

-- ============================================
-- Gatilhos de Handoff (transbordo humano)
-- handoff_rules substitui os antigos campos simples
-- ============================================
ALTER TABLE public.ai_config
  ADD COLUMN IF NOT EXISTS handoff_rules       jsonb   NOT NULL DEFAULT '[]'::jsonb;

-- Colunas legadas mantidas para compatibilidade
ALTER TABLE public.ai_config
  ADD COLUMN IF NOT EXISTS handoff_enabled     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS handoff_message     text    DEFAULT 'Entendido! Estou transferindo seu atendimento para um de nossos especialistas. Por favor, aguarde um momento.',
  ADD COLUMN IF NOT EXISTS handoff_triggers    text[]  DEFAULT '{}';

COMMENT ON COLUMN public.ai_config.confirm_enabled   IS 'Ativa o disparo automático de confirmação de consulta';
COMMENT ON COLUMN public.ai_config.confirm_lead_time IS 'Minutos antes da consulta para enviar a confirmação';
COMMENT ON COLUMN public.ai_config.confirm_message   IS 'Mensagem de confirmação. Variável: {paciente}';
COMMENT ON COLUMN public.ai_config.followup_enabled  IS 'Ativa o follow-up automático após inatividade';
COMMENT ON COLUMN public.ai_config.followup_delay    IS 'Minutos de inatividade para disparar o follow-up';
COMMENT ON COLUMN public.ai_config.followup_message  IS 'Mensagem de reengajamento. Variável: {paciente}';
COMMENT ON COLUMN public.ai_config.handoff_rules     IS 'Array JSON com os gatilhos de handoff configurados';
