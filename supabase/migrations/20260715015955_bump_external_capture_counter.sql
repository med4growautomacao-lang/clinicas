-- 20260715015955_bump_external_capture_counter
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Contador leve de captações por clínica (chamado best-effort pela edge após ingestão ok).
CREATE OR REPLACE FUNCTION public.bump_external_capture(p_clinic_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  UPDATE public.clinic_external_integrations
     SET capture_count = capture_count + 1,
         last_capture_at = now()
   WHERE clinic_id = p_clinic_id;
$function$;

REVOKE ALL ON FUNCTION public.bump_external_capture(uuid) FROM anon;
