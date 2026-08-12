-- 20260506151321_add_slug_to_funnel_stages
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

ALTER TABLE public.funnel_stages ADD COLUMN IF NOT EXISTS slug varchar(50) NULL;

UPDATE public.funnel_stages SET slug = 'conversao'     WHERE is_fixed = true;
UPDATE public.funnel_stages SET slug = 'perdido'       WHERE is_system = true AND name = 'Perdido';
UPDATE public.funnel_stages SET slug = 'sincronizacao' WHERE is_system = true AND name = 'Sincronização';
UPDATE public.funnel_stages SET slug = 'whatsapp'      WHERE is_system = true AND name = 'Contato via WhatsApp';
UPDATE public.funnel_stages SET slug = 'forms'         WHERE is_system = true AND name = 'Contato via Forms';
