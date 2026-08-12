-- 20260508025903_add_ticket_id_to_appointments
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

ALTER TABLE public.appointments
ADD COLUMN ticket_id uuid REFERENCES public.tickets(id) ON DELETE SET NULL;

CREATE INDEX idx_appointments_ticket_id ON public.appointments(ticket_id);
