-- Biblioteca global de "Prompts Fixos" (comportamento do agente) por tipo de negócio.
-- Gerenciada pelo super-admin no System Settings; selecionada por clínica em ai_config.prompt_template_id.
-- O prompt final (comportamento + dados da empresa) é entregue pela view v_clinic_ai_prompt.

-- ── Tabela ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.prompt_templates (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name       text NOT NULL,
  focus      text NOT NULL DEFAULT 'clinica', -- sugestões: sdr|agendamento|suporte|teste|clinica|varejo (livre)
  content    text NOT NULL DEFAULT '',
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.prompt_templates
  IS 'Biblioteca global de prompts fixos (comportamento do agente) por tipo. Gerenciada pelo super-admin; selecionada por clínica via ai_config.prompt_template_id.';

ALTER TABLE public.prompt_templates ENABLE ROW LEVEL SECURITY;

-- Leitura liberada (as clínicas montam o seletor na IA Config).
DROP POLICY IF EXISTS "prompt_templates_select_all" ON public.prompt_templates;
CREATE POLICY "prompt_templates_select_all" ON public.prompt_templates
  FOR SELECT USING (true);

-- Escrita somente para super-admin (is_admin() cobre clinic_users.role='super-admin' / org_users).
DROP POLICY IF EXISTS "prompt_templates_admin_write" ON public.prompt_templates;
CREATE POLICY "prompt_templates_admin_write" ON public.prompt_templates
  FOR ALL USING (is_admin()) WITH CHECK (is_admin());

-- ── Seleção por clínica ───────────────────────────────────────────────────────
ALTER TABLE public.ai_config
  ADD COLUMN IF NOT EXISTS prompt_template_id uuid
  REFERENCES public.prompt_templates(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.ai_config.prompt_template_id
  IS 'Prompt fixo (tipo de atendimento) escolhido pela clínica. NULL = nenhum (usa apenas as Informações da Clínica).';

-- ── View consumida pelo n8n ───────────────────────────────────────────────────
-- security_invoker=on => o app respeita o isolamento por clínica (RLS de ai_config);
-- o n8n lê via service_role, que ignora RLS e enxerga todas as clínicas.
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
