-- 20260328005008_add_message_to_send_to_transition_rules
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- 1. Add column to stage_transition_rules
ALTER TABLE public.stage_transition_rules ADD COLUMN IF NOT EXISTS message_to_send TEXT;

-- 2. Update the sync function to include new field in the JSON cache
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
      'lead_response', lead_response,
      'message_to_send', message_to_send
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
