-- 20260313010322_add_doctor_schedule_config
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

ALTER TABLE public.doctors
ADD COLUMN working_hours JSONB DEFAULT '{"0":[],"1":[{"start":"08:00","end":"12:00"},{"start":"13:00","end":"18:00"}],"2":[{"start":"08:00","end":"12:00"},{"start":"13:00","end":"18:00"}],"3":[{"start":"08:00","end":"12:00"},{"start":"13:00","end":"18:00"}],"4":[{"start":"08:00","end":"12:00"},{"start":"13:00","end":"18:00"}],"5":[{"start":"08:00","end":"12:00"},{"start":"13:00","end":"18:00"}],"6":[]}'::jsonb,
ADD COLUMN consultation_duration INT DEFAULT 30,
ADD COLUMN days_off JSONB DEFAULT '[]'::jsonb;
