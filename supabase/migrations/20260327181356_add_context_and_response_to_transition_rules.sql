-- 20260327181356_add_context_and_response_to_transition_rules
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- 1. Add columns to stage_transition_rules
ALTER TABLE public.stage_transition_rules ADD COLUMN IF NOT EXISTS context TEXT;
ALTER TABLE public.stage_transition_rules ADD COLUMN IF NOT EXISTS lead_response TEXT;

-- 2. Update the sync function to include new fields in the JSON cache
CREATE OR REPLACE FUNCTION public.fn_sync_transition_rules_to_config()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.ai_config
  SET transition_rules = (
    SELECT jsonb_agg(jsonb_build_object(
      'id', id,
      'keywords', keywords,
      'target_stage_id', target_stage_id,
      'context', context,
      'lead_response', lead_response
    ))
    FROM public.stage_transition_rules
    WHERE clinic_id = COALESCE(NEW.clinic_id, OLD.clinic_id)
  )
  WHERE clinic_id = COALESCE(NEW.clinic_id, OLD.clinic_id);
  
  -- If no rules left, set to empty array instead of null
  UPDATE public.ai_config
  SET transition_rules = '[]'::jsonb
  WHERE clinic_id = COALESCE(NEW.clinic_id, OLD.clinic_id)
    AND (transition_rules IS NULL OR transition_rules = 'null'::jsonb);

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- 3. Force a sync of existing data to update the JSON cache
UPDATE public.stage_transition_rules SET id = id;
