-- 20260720065809_meta_cloud_secrets_vault
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Credenciais da API Oficial Meta como SEGREDO GLOBAL de plataforma no Vault (mesmo padrão
-- do Google Ads OAuth). Configuradas no painel Super Admin › Investimento? não — aba "API Meta".
-- Escrita/leitura via RPC; a edge meta-cloud-api lê pelo service role. Reverte a abordagem
-- anterior por-organização (colunas removidas).

-- Reverte colunas de org (abordagem anterior, ainda vazias)
ALTER TABLE public.organizations
  DROP COLUMN IF EXISTS meta_cloud_token,
  DROP COLUMN IF EXISTS meta_cloud_waba_id;

CREATE OR REPLACE FUNCTION public._meta_cloud_secret_name(p_key text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE lower(p_key)
    WHEN 'token'   THEN 'META_CLOUD_TOKEN'
    WHEN 'waba_id' THEN 'META_CLOUD_WABA_ID'
    ELSE NULL
  END;
$function$;

CREATE OR REPLACE FUNCTION public.set_meta_cloud_secret(p_key text, p_value text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_name text := public._meta_cloud_secret_name(p_key);
  v_desc text := 'Meta Cloud API (' || lower(p_key) || ') — set via painel super-admin';
  v_id uuid;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'chave inválida: %', p_key;
  END IF;
  IF p_value IS NULL OR length(trim(p_value)) < 8 THEN
    RAISE EXCEPTION 'valor inválido';
  END IF;

  SELECT id INTO v_id FROM vault.secrets WHERE name = v_name;
  IF v_id IS NULL THEN
    PERFORM vault.create_secret(trim(p_value), v_name, v_desc, NULL::uuid);
  ELSE
    PERFORM vault.update_secret(v_id, trim(p_value), v_name, v_desc, NULL::uuid);
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_meta_cloud_secret(p_key text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_name text := public._meta_cloud_secret_name(p_key);
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'chave inválida: %', p_key;
  END IF;
  DELETE FROM vault.secrets WHERE name = v_name;
END;
$function$;

CREATE OR REPLACE FUNCTION public.meta_cloud_secrets_status()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;
  RETURN jsonb_build_object(
    'token',   EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'META_CLOUD_TOKEN'),
    'waba_id', EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'META_CLOUD_WABA_ID')
  );
END;
$function$;

-- Leitura da edge (service role). Bloqueada para browsers.
CREATE OR REPLACE FUNCTION public.get_meta_cloud_secret(p_name text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = p_name LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION public.get_meta_cloud_secret(text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_meta_cloud_secret(text) TO service_role;
