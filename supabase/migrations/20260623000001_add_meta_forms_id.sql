ALTER TABLE public.clinics
  ADD COLUMN IF NOT EXISTS meta_forms_id text;

COMMENT ON COLUMN public.clinics.meta_forms_id IS 'ID do formulário nativo do Meta (Lead Ads / Instant Forms) usado para vincular leads do formulário à clínica';
