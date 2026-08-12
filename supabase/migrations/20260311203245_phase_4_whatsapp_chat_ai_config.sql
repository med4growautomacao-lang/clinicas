-- 20260311203245_phase_4_whatsapp_chat_ai_config
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

CREATE TABLE public.whatsapp_instances (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id uuid NOT NULL UNIQUE REFERENCES public.clinics(id) ON DELETE CASCADE,
  api_url text NOT NULL,
  api_token text NOT NULL,
  phone_number text,
  status text NOT NULL DEFAULT 'disconnected' CHECK (status IN ('connected', 'disconnected', 'qr_pending')),
  connected_at timestamptz
);

CREATE TABLE public.chat_messages (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  patient_id uuid REFERENCES public.patients(id) ON DELETE SET NULL,
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  sender text NOT NULL DEFAULT 'system' CHECK (sender IN ('user', 'ai', 'system')),
  content text NOT NULL,
  phone text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_chat_messages_clinic_id ON public.chat_messages(clinic_id);
CREATE INDEX idx_chat_messages_lead_id ON public.chat_messages(lead_id);
CREATE INDEX idx_chat_messages_created_at ON public.chat_messages(created_at DESC);

CREATE TABLE public.ai_config (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  clinic_id uuid NOT NULL UNIQUE REFERENCES public.clinics(id) ON DELETE CASCADE,
  tone int NOT NULL DEFAULT 70 CHECK (tone >= 0 AND tone <= 100),
  response_style text NOT NULL DEFAULT 'cordial' CHECK (response_style IN ('tecnica', 'objetiva', 'cordial')),
  response_speed text NOT NULL DEFAULT 'instantanea' CHECK (response_speed IN ('instantanea', 'cadenciada')),
  bio_text text DEFAULT 'Olá! Sou a assistente IA da clínica. Estou aqui para ajudá-lo com agendamentos e dúvidas gerais.',
  auto_schedule boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.whatsapp_instances IS 'Instâncias UaZapi conectadas';
COMMENT ON TABLE public.chat_messages IS 'Histórico de conversas WhatsApp (auditoria)';
COMMENT ON TABLE public.ai_config IS 'Configurações da Assistente IA por clínica';
