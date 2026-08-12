-- 20260407132705_add_sincronizacao_stage_and_source
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- 1. Empurra todos os estágios existentes +1 posição para abrir o slot 0
UPDATE public.funnel_stages SET position = position + 1;

-- 2. Insere o estágio "Sincronização" na posição 0 para cada clínica existente
INSERT INTO public.funnel_stages (clinic_id, name, position, color)
SELECT id, 'Sincronização', 0, '#8b5cf6'
FROM public.clinics;

-- 3. Atualiza fn_set_default_lead_stage para incluir a regra de Sincronização
CREATE OR REPLACE FUNCTION public.fn_set_default_lead_stage()
RETURNS trigger LANGUAGE plpgsql AS $function$
DECLARE
    v_stage_id UUID;
BEGIN
    IF NEW.stage_id IS NULL THEN

        -- REGRA 0: Se a origem for Sincronização ➔ Manda para "Sincronização"
        IF NEW.source = 'sincronizacao' THEN
            SELECT id INTO v_stage_id
            FROM public.funnel_stages
            WHERE clinic_id = NEW.clinic_id
              AND LOWER(name) LIKE '%sincroniz%'
            ORDER BY position ASC
            LIMIT 1;
        END IF;

        -- REGRA 1: Se o canal for FORMS ➔ Manda para "Contato via Forms"
        IF v_stage_id IS NULL AND NEW.capture_channel = 'forms' THEN
            SELECT id INTO v_stage_id
            FROM public.funnel_stages
            WHERE clinic_id = NEW.clinic_id
              AND LOWER(name) LIKE '%forms%'
            ORDER BY position ASC
            LIMIT 1;
        END IF;

        -- REGRA 2: Fallback para etapas de WhatsApp/Contato
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

            -- Fallback final: primeira etapa
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
