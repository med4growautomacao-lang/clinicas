-- 20260718215920_confirm_reply_messages
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

alter table public.ai_config
  add column if not exists confirm_reply_remarcado text,
  add column if not exists confirm_reply_cancelado text;

comment on column public.ai_config.confirm_reply_remarcado is
  'Resposta enviada quando o paciente toca "Remarcar" no lembrete de confirmação. Vars: {paciente} {data} {hora}.';
comment on column public.ai_config.confirm_reply_cancelado is
  'Resposta enviada quando o paciente toca "Cancelar" no lembrete de confirmação. Vars: {paciente} {data} {hora}.';
