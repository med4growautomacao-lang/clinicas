-- 20260701202518_leads_whatsapp_invalid_and_welcome_attempts
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS whatsapp_invalid boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS welcome_attempts integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.leads.whatsapp_invalid IS 'Numero confirmado sem WhatsApp (uazapi /chat/check). Sinaliza no card do Kanban e em Conversas; nao reenvia welcome.';
COMMENT ON COLUMN public.leads.welcome_attempts IS 'Tentativas de envio do welcome de forms; usado p/ retry limitado no edge forms-welcome-followup.';

-- Leticia (5511 4292-7479): confirmado sem WhatsApp (nem com nem sem 9) em 01/07
UPDATE public.leads SET whatsapp_invalid = true
WHERE id = 'fffa6bf2-0106-49df-bdc1-26beefa67fb5';
