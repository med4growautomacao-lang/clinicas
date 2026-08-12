-- 20260714020146_rename_inbox_unique_index
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- O índice foi criado antes do rename da tabela e ficou com o nome antigo — aparece assim na
-- mensagem de erro 409 que o n8n recebe, o que confunde na hora de debugar.
alter index if exists public.lead_tracking_inbox_external_id_uniq
  rename to attribution_inbox_external_id_uniq;
