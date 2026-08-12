-- 20260408155806_fix_last_message_at_any_direction
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

CREATE OR REPLACE FUNCTION public.fn_update_lead_last_message()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.lead_id IS NOT NULL THEN
    UPDATE public.leads
      SET last_message_at = NEW.created_at
      WHERE id = NEW.lead_id;
  END IF;
  RETURN NEW;
END;
$function$;
