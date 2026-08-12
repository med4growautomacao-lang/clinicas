-- 20260312174233_allow_connecting_status_in_whatsapp_instances
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Remover a restrição antiga
ALTER TABLE public.whatsapp_instances DROP CONSTRAINT IF EXISTS whatsapp_instances_status_check;

-- Adicionar a nova restrição com 'connecting' incluído
ALTER TABLE public.whatsapp_instances ADD CONSTRAINT whatsapp_instances_status_check 
CHECK (status = ANY (ARRAY['connected'::text, 'disconnected'::text, 'qr_pending'::text, 'connecting'::text]));

-- Garantir que o valor padrão seja 'disconnected'
ALTER TABLE public.whatsapp_instances ALTER COLUMN status SET DEFAULT 'disconnected';
