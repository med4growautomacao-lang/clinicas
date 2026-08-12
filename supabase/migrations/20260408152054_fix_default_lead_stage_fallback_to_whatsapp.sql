-- 20260408152054_fix_default_lead_stage_fallback_to_whatsapp
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

CREATE OR REPLACE FUNCTION public.fn_set_default_lead_stage()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_stage_id UUID;
BEGIN
    IF NEW.stage_id IS NULL THEN

        -- REGRA 0: Se a origem for Sincronização ➔ "Sincronização"
        IF NEW.source = 'sincronizacao' THEN
            SELECT id INTO v_stage_id
            FROM public.funnel_stages
            WHERE clinic_id = NEW.clinic_id
              AND LOWER(name) LIKE '%sincroniz%'
            ORDER BY position ASC
            LIMIT 1;
        END IF;

        -- REGRA 1: Se o canal for FORMS ➔ "Contato via Forms"
        IF v_stage_id IS NULL AND NEW.capture_channel = 'forms' THEN
            SELECT id INTO v_stage_id
            FROM public.funnel_stages
            WHERE clinic_id = NEW.clinic_id
              AND LOWER(name) LIKE '%forms%'
            ORDER BY position ASC
            LIMIT 1;
        END IF;

        -- REGRA 2: Todos os outros ➔ "Contato via WhatsApp"
        IF v_stage_id IS NULL THEN
            SELECT id INTO v_stage_id
            FROM public.funnel_stages
            WHERE clinic_id = NEW.clinic_id
              AND LOWER(name) ILIKE '%contato%whatsapp%'
            LIMIT 1;

            IF v_stage_id IS NULL THEN
                SELECT id INTO v_stage_id
                FROM public.funnel_stages
                WHERE clinic_id = NEW.clinic_id
                  AND (LOWER(name) LIKE '%whatsapp%' OR LOWER(name) LIKE '%contato%')
                ORDER BY position ASC
                LIMIT 1;
            END IF;

            -- Fallback final: "Contato via WhatsApp" pelo position 2
            IF v_stage_id IS NULL THEN
                SELECT id INTO v_stage_id
                FROM public.funnel_stages
                WHERE clinic_id = NEW.clinic_id
                ORDER BY position ASC
                OFFSET 2 LIMIT 1;
            END IF;

            -- Último recurso: primeira etapa
            IF v_stage_id IS NULL THEN
                SELECT id INTO v_stage_id
                FROM public.funnel_stages
                WHERE clinic_id = NEW.clinic_id
                ORDER BY position ASC
                LIMIT 1;
            END IF;
        END IF;

        NEW.stage_id := v_stage_id;
    END IF;
    RETURN NEW;
END;
$function$;
