-- 20260623172241_meta_forms_cursor
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

alter table public.clinics
  add column if not exists meta_forms_last_synced_at timestamptz;

comment on column public.clinics.meta_forms_last_synced_at is
  'Cursor do poller meta-forms-sync: created_time do lead mais recente já sincronizado do Formulário Nativo do Meta. Avança só em ciclo 100% ok. Ver migration 20260623000005.';
