-- 20260610035439_drop_redundant_overloads
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

DROP FUNCTION IF EXISTS public.book_appointment(
  uuid, uuid, date, time without time zone, text, text, integer, text, text, text, uuid);

DROP FUNCTION IF EXISTS public.convert_lead_to_appointment(
  uuid, uuid, uuid, date, time without time zone, text, text, uuid, integer, uuid);

DROP FUNCTION IF EXISTS public.create_clinic_with_owner(
  text, text, uuid, text, text, text, text);

DROP FUNCTION IF EXISTS public.sync_n8n_memory_to_chat();

DROP TRIGGER IF EXISTS trg_propagate_clinic_name_whatsapp ON public.clinics;
DROP FUNCTION IF EXISTS public.propagate_clinic_name_to_whatsapp();
