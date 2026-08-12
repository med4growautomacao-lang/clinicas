-- 20260610013509_add_company_prompts_to_ai_config
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

ALTER TABLE public.ai_config
  ADD COLUMN IF NOT EXISTS company_prompts jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS company_prompt_id text;

COMMENT ON COLUMN public.ai_config.company_prompts
  IS 'Biblioteca de prompts do cliente (dados da empresa): [{id,name,content}]. O item ativo (company_prompt_id) é espelhado em ai_config.prompt e vira o company_prompt na view v_clinic_ai_prompt.';
COMMENT ON COLUMN public.ai_config.company_prompt_id
  IS 'Id do item de company_prompts atualmente ativo (espelhado em ai_config.prompt).';

WITH gen AS (
  SELECT clinic_id,
         gen_random_uuid()::text AS new_id,
         coalesce(prompt, '') AS content
  FROM public.ai_config
  WHERE company_prompts = '[]'::jsonb OR company_prompts IS NULL
)
UPDATE public.ai_config ac
SET company_prompts = jsonb_build_array(
      jsonb_build_object('id', gen.new_id, 'name', 'Padrão', 'content', gen.content)
    ),
    company_prompt_id = gen.new_id
FROM gen
WHERE ac.clinic_id = gen.clinic_id;
