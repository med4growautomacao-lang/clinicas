-- 20260407155133_add_organizations_layer
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- =====================================================
-- FASE 1: CAMADA DE ORGANIZAÇÕES
-- =====================================================

-- 1. Tabela de organizações
CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  plan text DEFAULT 'pro' CHECK (plan IN ('free', 'pro', 'enterprise')),
  logo_url text,
  created_at timestamp DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo')
);

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

-- 2. Ligar clínicas a organizações (nullable para não quebrar existentes)
ALTER TABLE public.clinics ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;

-- 3. Usuários de organização (separado da tabela users de clínicas)
CREATE TABLE public.org_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'org_admin' CHECK (role IN ('org_owner', 'org_admin')),
  full_name text,
  email text,
  created_at timestamp DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo'),
  UNIQUE(user_id, organization_id)
);

ALTER TABLE public.org_users ENABLE ROW LEVEL SECURITY;

-- 4. RLS: org_users — cada usuário vê apenas suas próprias entradas
CREATE POLICY "org_users_own" ON public.org_users FOR ALL
  USING (user_id = auth.uid());

-- 5. RLS: organizations — org-admin vê apenas sua(s) organização(ões)
CREATE POLICY "organizations_own" ON public.organizations FOR ALL
  USING (
    id IN (
      SELECT organization_id FROM public.org_users WHERE user_id = auth.uid()
    )
    OR EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'super-admin')
  );

-- 6. RLS: clinics — org-admin vê as clínicas da sua organização (policy adicional)
CREATE POLICY "clinics_org_access" ON public.clinics FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id FROM public.org_users WHERE user_id = auth.uid()
    )
  );

-- 7. Atualizar helper is_admin() para incluir org-admin
CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean
  LANGUAGE sql SECURITY DEFINER AS $$
    SELECT EXISTS (
      SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'super-admin'
    ) OR EXISTS (
      SELECT 1 FROM public.org_users WHERE user_id = auth.uid()
    );
$$;
