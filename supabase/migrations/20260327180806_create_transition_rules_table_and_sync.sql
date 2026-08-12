-- 20260327180806_create_transition_rules_table_and_sync
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- 1. Create the table
CREATE TABLE IF NOT EXISTS public.stage_transition_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID REFERENCES public.clinics(id) ON DELETE CASCADE,
  keywords TEXT NOT NULL,
  target_stage_id UUID REFERENCES public.funnel_stages(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Enable RLS
ALTER TABLE public.stage_transition_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable all for authenticated users" ON public.stage_transition_rules FOR ALL TO authenticated USING (true);

-- 3. Function to sync to ai_config
CREATE OR REPLACE FUNCTION public.fn_sync_transition_rules_to_config()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.ai_config
  SET transition_rules = (
    SELECT jsonb_agg(jsonb_build_object(
      'id', id,
      'keywords', keywords,
      'target_stage_id', target_stage_id
    ))
    FROM public.stage_transition_rules
    WHERE clinic_id = COALESCE(NEW.clinic_id, OLD.clinic_id)
  )
  WHERE clinic_id = COALESCE(NEW.clinic_id, OLD.clinic_id);
  
  -- If no rules left, set to empty array instead of null
  UPDATE public.ai_config
  SET transition_rules = '[]'::jsonb
  WHERE clinic_id = COALESCE(NEW.clinic_id, OLD.clinic_id)
    AND transition_rules IS NULL;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- 4. Create the trigger
DROP TRIGGER IF EXISTS tr_sync_transition_rules ON public.stage_transition_rules;
CREATE TRIGGER tr_sync_transition_rules
AFTER INSERT OR UPDATE OR DELETE ON public.stage_transition_rules
FOR EACH ROW EXECUTE FUNCTION public.fn_sync_transition_rules_to_config();

-- 5. Migrate existing data from ai_config to the new table
DO $$
DECLARE
    r RECORD;
    rule JSONB;
BEGIN
    FOR r IN SELECT clinic_id, transition_rules FROM public.ai_config WHERE transition_rules IS NOT NULL AND transition_rules <> '[]'::jsonb LOOP
        FOR rule IN SELECT * FROM jsonb_array_elements(r.transition_rules) LOOP
            INSERT INTO public.stage_transition_rules (clinic_id, keywords, target_stage_id)
            VALUES (r.clinic_id, rule->>'keywords', (rule->>'target_stage_id')::uuid)
            ON CONFLICT DO NOTHING;
        END LOOP;
    END LOOP;
END $$;
