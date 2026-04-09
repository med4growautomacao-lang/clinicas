-- Add CSAT/NPS fields to ai_config
ALTER TABLE ai_config
  ADD COLUMN IF NOT EXISTS csat_enabled       boolean  NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS csat_type          text     NOT NULL DEFAULT 'csat' CHECK (csat_type IN ('csat', 'nps', 'both')),
  ADD COLUMN IF NOT EXISTS csat_message       text     DEFAULT 'Olá! Poderia avaliar nosso atendimento? Sua opinião é muito importante para nós.',
  ADD COLUMN IF NOT EXISTS csat_delay_hours   integer  NOT NULL DEFAULT 2;
