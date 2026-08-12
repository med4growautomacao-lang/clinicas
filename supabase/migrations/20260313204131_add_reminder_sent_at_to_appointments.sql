-- 20260313204131_add_reminder_sent_at_to_appointments
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

ALTER TABLE public.appointments ADD COLUMN reminder_sent_at timestamp with time zone;
COMMENT ON COLUMN public.appointments.reminder_sent_at IS 'Marca quando o lembrete de consulta foi enviado para evitar duplicidade no n8n.';
