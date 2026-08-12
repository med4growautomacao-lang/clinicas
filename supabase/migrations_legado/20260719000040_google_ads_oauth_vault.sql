-- =============================================================================
-- OAuth do Google Ads (MCC único, global) — client_id / client_secret / refresh_token
-- no Supabase Vault. MESMO padrão das chaves de LLM (set_llm_secret / get_llm_secret /
-- llm_secrets_status): super-admin GRAVA (criptografado, nunca devolvido ao painel);
-- a edge LÊ o valor decifrado só como service_role. Usado por google-spend-sync.
--
-- Por que Vault e não system_settings: o SELECT de system_settings é público — poria o
-- refresh_token (acesso total ao MCC de TODAS as clínicas) ao alcance de qualquer usuário.
-- =============================================================================

-- Map id curto -> nome do segredo no Vault
CREATE OR REPLACE FUNCTION public._google_ads_secret_name(p_key text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE lower(p_key)
    WHEN 'client_id'     THEN 'GOOGLE_ADS_CLIENT_ID'
    WHEN 'client_secret' THEN 'GOOGLE_ADS_CLIENT_SECRET'
    WHEN 'refresh_token' THEN 'GOOGLE_ADS_REFRESH_TOKEN'
    ELSE NULL
  END;
$$;

-- Grava/atualiza um dos 3 valores no Vault (super-admin)
CREATE OR REPLACE FUNCTION public.set_google_ads_secret(p_key text, p_value text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text := public._google_ads_secret_name(p_key);
  v_desc text := 'Google Ads OAuth (' || lower(p_key) || ') — set via painel super-admin';
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
$$;
REVOKE ALL ON FUNCTION public.set_google_ads_secret(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_google_ads_secret(text, text) TO authenticated;

-- Remove um dos 3 valores (super-admin)
CREATE OR REPLACE FUNCTION public.delete_google_ads_secret(p_key text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text := public._google_ads_secret_name(p_key);
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'chave inválida: %', p_key;
  END IF;
  DELETE FROM vault.secrets WHERE name = v_name;
END;
$$;
REVOKE ALL ON FUNCTION public.delete_google_ads_secret(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_google_ads_secret(text) TO authenticated;

-- Status (super-admin) — só existência, nunca o valor
CREATE OR REPLACE FUNCTION public.google_ads_secrets_status()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;
  RETURN jsonb_build_object(
    'client_id',     EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'GOOGLE_ADS_CLIENT_ID'),
    'client_secret', EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'GOOGLE_ADS_CLIENT_SECRET'),
    'refresh_token', EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'GOOGLE_ADS_REFRESH_TOKEN')
  );
END;
$$;
REVOKE ALL ON FUNCTION public.google_ads_secrets_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.google_ads_secrets_status() TO authenticated;

-- Leitura do valor decifrado — SÓ a edge (service_role). Super-admin NÃO lê o valor.
CREATE OR REPLACE FUNCTION public.get_google_ads_secret(p_name text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = p_name LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.get_google_ads_secret(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_google_ads_secret(text) TO service_role;
