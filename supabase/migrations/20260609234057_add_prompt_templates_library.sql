-- 20260609234057_add_prompt_templates_library
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Biblioteca global de "Prompts Fixos" (comportamento do agente) por tipo de negócio.
CREATE TABLE IF NOT EXISTS public.prompt_templates (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name       text NOT NULL,
  focus      text NOT NULL DEFAULT 'clinica',
  content    text NOT NULL DEFAULT '',
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.prompt_templates
  IS 'Biblioteca global de prompts fixos (comportamento do agente) por tipo. Gerenciada pelo super-admin; selecionada por clínica via ai_config.prompt_template_id.';

ALTER TABLE public.prompt_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "prompt_templates_select_all" ON public.prompt_templates;
CREATE POLICY "prompt_templates_select_all" ON public.prompt_templates
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "prompt_templates_admin_write" ON public.prompt_templates;
CREATE POLICY "prompt_templates_admin_write" ON public.prompt_templates
  FOR ALL USING (is_admin()) WITH CHECK (is_admin());

ALTER TABLE public.ai_config
  ADD COLUMN IF NOT EXISTS prompt_template_id uuid
  REFERENCES public.prompt_templates(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.ai_config.prompt_template_id
  IS 'Prompt fixo (tipo de atendimento) escolhido pela clínica. NULL = nenhum (usa apenas as Informações da Clínica).';

CREATE OR REPLACE VIEW public.v_clinic_ai_prompt
WITH (security_invoker = on) AS
SELECT
  ac.clinic_id,
  ac.prompt_template_id           AS template_id,
  pt.name                         AS template_name,
  pt.focus                        AS template_focus,
  pt.content                      AS template_content,
  ac.prompt                       AS company_prompt,
  trim(BOTH E'\n' FROM
    coalesce(nullif(pt.content, ''), '')
    || CASE
         WHEN nullif(pt.content, '') IS NOT NULL AND nullif(ac.prompt, '') IS NOT NULL
         THEN E'\n\n---\n\n'
         ELSE ''
       END
    || coalesce(nullif(ac.prompt, ''), '')
  )                               AS combined_prompt
FROM public.ai_config ac
LEFT JOIN public.prompt_templates pt ON pt.id = ac.prompt_template_id;

COMMENT ON VIEW public.v_clinic_ai_prompt
  IS 'Prompt resolvido por clínica: comportamento do prompt fixo escolhido + dados da empresa (ai_config.prompt). Consumir combined_prompt no System Message do n8n, filtrando por clinic_id.';

GRANT SELECT ON public.v_clinic_ai_prompt TO authenticated, service_role;
