-- 20260715015734_external_integrations_config_table
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Config da "Integração Externa" (webhook nativo por clínica).
-- Bloco 1 (captação) usa capture_*; os campos won/lost já nascem aqui p/ o Bloco 2 futuro.
-- 1 linha por clínica. Segredos ficam aqui (RLS por is_clinic_admin/is_super_admin); a edge lê via service role.

CREATE TABLE IF NOT EXISTS public.clinic_external_integrations (
  clinic_id        uuid PRIMARY KEY REFERENCES public.clinics(id) ON DELETE CASCADE,

  -- Captação (entrada de leads do formulário do cliente)
  capture_enabled  boolean NOT NULL DEFAULT true,
  capture_token    text NOT NULL UNIQUE
                     DEFAULT replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-',''),
  -- override opcional de nomes de campo do formulário do cliente:
  -- { "name": "...", "phone": "...", "email": "..." }. Vazio = fuzzy match na edge.
  field_map        jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_capture_at  timestamptz,
  capture_count    integer NOT NULL DEFAULT 0,

  -- Ganho/Perdido vindo do CRM do cliente (Bloco 2 — ainda não fiado)
  crm_token        text NOT NULL UNIQUE
                     DEFAULT replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-',''),
  won_enabled      boolean NOT NULL DEFAULT false,
  lost_enabled     boolean NOT NULL DEFAULT false,

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- updated_at automático (reusa o handler já existente no schema)
DROP TRIGGER IF EXISTS tr_cei_updated_at ON public.clinic_external_integrations;
CREATE TRIGGER tr_cei_updated_at BEFORE UPDATE ON public.clinic_external_integrations
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.clinic_external_integrations ENABLE ROW LEVEL SECURITY;

-- Admin da própria clínica gerencia; super admin vê tudo. Sem policy anon: a edge usa service role.
CREATE POLICY cei_select ON public.clinic_external_integrations
  FOR SELECT USING (public.is_clinic_admin(clinic_id) OR public.is_super_admin());
CREATE POLICY cei_insert ON public.clinic_external_integrations
  FOR INSERT WITH CHECK (public.is_clinic_admin(clinic_id) OR public.is_super_admin());
CREATE POLICY cei_update ON public.clinic_external_integrations
  FOR UPDATE USING (public.is_clinic_admin(clinic_id) OR public.is_super_admin())
             WITH CHECK (public.is_clinic_admin(clinic_id) OR public.is_super_admin());

COMMENT ON TABLE public.clinic_external_integrations IS
  'Config da Integração Externa por clínica: webhook nativo de captação (capture_*) e, futuro, ganho/perdido do CRM do cliente (crm_token/won/lost).';
