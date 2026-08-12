-- =============================================================================
-- chat-media #5 (dedup/altitude) — RLS de storage delega ao predicado único
--
-- Antes: a policy chat_media_read_clinic_members (migration ...016) replicava, à
-- mão, a MESMA lógica de pertencimento (super-admin ∨ clinic_users ∨ org_users→
-- clinics) que a edge usa via can_access_clinic_media(). Duas cópias → mudar a
-- regra em um só lugar deixa o outro divergir em silêncio.
--
-- Agora: a policy passa a CHAMAR o predicado. Para não reintroduzir o risco que
-- justificou não fazer isso antes (castar o path do objeto p/ uuid dentro da
-- USING poderia ser avaliado em objetos de OUTROS buckets — quotes — cujo 1º
-- segmento não é uuid, e o planner não garante o short-circuit do bucket_id),
-- o cast fica num wrapper com GUARDA por regex: só converte p/ uuid quando o
-- texto CASA o formato uuid; senão devolve false SEM erro. CASE em SQL só avalia
-- o ramo THEN quando o WHEN é verdadeiro, então o `::uuid` nunca roda sobre um
-- segmento não-uuid → zero erro em qualquer bucket.
--
-- Comportamento de acesso é IDÊNTICO ao da ...016 (mesmos 3 casos), então o
-- frontend atual (que ainda assina direto contra a RLS) continua funcionando.
-- Rollback: restaura a policy inline da ...016 e dropa o wrapper.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.can_access_clinic_media_text(p_clinic_text text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_clinic_text ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      THEN public.can_access_clinic_media(p_clinic_text::uuid)
    ELSE false
  END;
$$;

REVOKE ALL ON FUNCTION public.can_access_clinic_media_text(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_clinic_media_text(text) TO authenticated, service_role;

COMMENT ON FUNCTION public.can_access_clinic_media_text(text) IS
  'Wrapper text-safe de can_access_clinic_media: cast p/ uuid guardado por regex (nunca erra em bucket cujo 1º segmento não é uuid). Usado pela RLS de storage.objects.';

-- Policy passa a delegar ao predicado (sem subquery/JOIN → `name` é inequívoco).
DROP POLICY IF EXISTS "chat_media_read_clinic_members" ON storage.objects;
CREATE POLICY "chat_media_read_clinic_members" ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'chat-media'
  AND public.can_access_clinic_media_text((storage.foldername(name))[1])
);
