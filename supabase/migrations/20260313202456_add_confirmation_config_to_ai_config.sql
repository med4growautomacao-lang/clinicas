-- 20260313202456_add_confirmation_config_to_ai_config
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

ALTER TABLE public.ai_config 
ADD COLUMN confirm_enabled boolean DEFAULT false,
ADD COLUMN confirm_message text DEFAULT 'Olá {paciente}, sua consulta na Clínica Navs está confirmada para dia {data} às {hora}. Te esperamos!',
ADD COLUMN confirm_lead_time integer DEFAULT 1440;

-- Atualizar o comentário da tabela para refletir as novas colunas
COMMENT ON TABLE public.ai_config IS 'Configurações da Assistente IA por clínica (Inclui regras de conversão e confirmação)';
