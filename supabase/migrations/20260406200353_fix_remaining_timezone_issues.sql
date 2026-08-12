-- 20260406200353_fix_remaining_timezone_issues
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- 1. Reverte timestamptz columns para now() puro (correto para esse tipo)
--    timestamptz já armazena em UTC e converte automaticamente
ALTER TABLE public.funnel_stages
  ALTER COLUMN created_at SET DEFAULT now();

ALTER TABLE public.stage_transition_rules
  ALTER COLUMN created_at SET DEFAULT now();

ALTER TABLE public.system_settings
  ALTER COLUMN updated_at SET DEFAULT now();

-- 2. Corrige fn_handle_lead_uniqueness: updated_at deve usar SP
CREATE OR REPLACE FUNCTION public.fn_handle_lead_uniqueness()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
    v_existing_id uuid;
BEGIN
    IF NEW.rast_id IS NOT NULL AND NEW.rast_id <> '' THEN
        SELECT id INTO v_existing_id FROM public.leads 
        WHERE clinic_id = NEW.clinic_id AND rast_id = NEW.rast_id LIMIT 1;
    END IF;

    IF v_existing_id IS NULL AND NEW.phone IS NOT NULL AND NEW.phone <> '' THEN
        SELECT id INTO v_existing_id FROM public.leads 
        WHERE clinic_id = NEW.clinic_id AND phone = NEW.phone LIMIT 1;
    END IF;

    IF v_existing_id IS NOT NULL THEN
        UPDATE public.leads 
        SET 
            name = COALESCE(NULLIF(NEW.name, ''), name),
            phone = COALESCE(NULLIF(NEW.phone, ''), phone),
            email = COALESCE(NULLIF(NEW.email, ''), email),
            source = COALESCE(NULLIF(NEW.source, ''), source),
            g_clid = COALESCE(NULLIF(NEW.g_clid, ''), g_clid),
            g_campaign_name = COALESCE(NULLIF(NEW.g_campaign_name, ''), g_campaign_name),
            g_adset_name = COALESCE(NULLIF(NEW.g_adset_name, ''), g_adset_name),
            g_ad_name = COALESCE(NULLIF(NEW.g_ad_name, ''), g_ad_name),
            g_term_name = COALESCE(NULLIF(NEW.g_term_name, ''), g_term_name),
            g_source_name = COALESCE(NULLIF(NEW.g_source_name, ''), g_source_name),
            fb_clid = COALESCE(NULLIF(NEW.fb_clid, ''), fb_clid),
            fb_campaign_name = COALESCE(NULLIF(NEW.fb_campaign_name, ''), fb_campaign_name),
            fb_adset_name = COALESCE(NULLIF(NEW.fb_adset_name, ''), fb_adset_name),
            fb_ad_name = COALESCE(NULLIF(NEW.fb_ad_name, ''), fb_ad_name),
            ctwa_clid = COALESCE(NULLIF(NEW.ctwa_clid, ''), ctwa_clid),
            capture_channel = COALESCE(NULLIF(NEW.capture_channel, ''), capture_channel),
            updated_at = (now() AT TIME ZONE 'America/Sao_Paulo')
        WHERE id = v_existing_id;
        
        RETURN NULL;
    END IF;

    RETURN NEW;
END;
$function$;
