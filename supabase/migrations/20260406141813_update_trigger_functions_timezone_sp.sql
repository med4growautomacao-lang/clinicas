-- 20260406141813_update_trigger_functions_timezone_sp
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

CREATE OR REPLACE FUNCTION public.fn_log_lead_stage_change()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    -- Se for um novo lead sendo inserido (e ele tiver etapa)
    IF (TG_OP = 'INSERT') THEN
        IF NEW.stage_id IS NOT NULL THEN
            INSERT INTO public.lead_stage_history (clinic_id, lead_id, old_stage_id, new_stage_id, changed_at)
            VALUES (NEW.clinic_id, NEW.id, NULL, NEW.stage_id, (now() AT TIME ZONE 'America/Sao_Paulo'));
        END IF;
    -- Se for uma atualização de lead, apenas registra se a etapa antiga for diferente da nova
    ELSIF (TG_OP = 'UPDATE') THEN
        IF coalesce(NEW.stage_id, '00000000-0000-0000-0000-000000000000'::uuid) <> coalesce(OLD.stage_id, '00000000-0000-0000-0000-000000000000'::uuid) THEN
            INSERT INTO public.lead_stage_history (clinic_id, lead_id, old_stage_id, new_stage_id, changed_at)
            VALUES (NEW.clinic_id, NEW.id, OLD.stage_id, NEW.stage_id, (now() AT TIME ZONE 'America/Sao_Paulo'));
        END IF;
    END IF;
    
    RETURN NEW;
END;
$function$;
