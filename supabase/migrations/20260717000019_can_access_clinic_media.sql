-- =============================================================================
-- chat-media robusto (item 2) — predicado ÚNICO de acesso à mídia de conversa
--
-- Contexto: a leitura da mídia dependia da RLS de storage.objects (folder-based,
-- subqueries contra storage.objects) — frágil: já custou 2 bugs (super-admin
-- faltando; ambiguidade de `name`). A partir daqui a leitura passa por uma EDGE
-- (chat-media-sign) que assina com service role, e a autorização vira UM predicado
-- SQL limpo e testável.
--
-- can_access_clinic_media(clinic_id): true se o chamador é super-admin, membro da
-- clínica (clinic_users) ou membro da organização dona (org_users→clinics).
-- SECURITY DEFINER: enxerga clinic_users/org_users sem depender da RLS delas;
-- auth.uid() continua resolvendo o usuário do JWT (definer não muda o claim).
--
-- NOTA: NÃO reescreve a RLS de storage.objects. A policy chat_media_read_clinic_members
-- (migration ...016) já cobre os 3 casos e permanece como defense-in-depth. Delegá-la
-- a este predicado exigiria castar o path do objeto para uuid dentro da USING — e o
-- planner não garante o short-circuit do bucket_id, então o cast poderia ser avaliado
-- em objetos de OUTROS buckets (quotes) cujo 1º segmento não é uuid, quebrando a
-- leitura deles. A edge (que já parseia o clinic_id do path) é a fonte de acesso.
-- Rollback em _rollbacks/.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.can_access_clinic_media(p_clinic_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.clinic_users cu
      WHERE cu.id = auth.uid() AND cu.clinic_id = p_clinic_id
    )
    OR EXISTS (
      SELECT 1 FROM public.org_users ou
      JOIN public.clinics c ON c.organization_id = ou.organization_id
      WHERE ou.user_id = auth.uid() AND c.id = p_clinic_id
    );
$$;

REVOKE ALL ON FUNCTION public.can_access_clinic_media(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_clinic_media(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.can_access_clinic_media(uuid) IS
  'Fonte única de acesso à mídia da conversa (chat-media). Usada pela edge chat-media-sign. Espelha is_super_admin ∨ clinic_users ∨ org_users→clinics.';
