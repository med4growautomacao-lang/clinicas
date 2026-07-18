-- =============================================================================
-- Painel Super Admin — IA de transcrição de mídia: provider/modelo + chaves
--
-- Config (NÃO-secreta): linha system_settings id='media_ai_config' (JSON: provider
-- + model por tipo, áudio/imagem). Escrita via RPC gated (set_media_ai_config),
-- porque a RLS de system_settings é aberta a qualquer authenticated (dívida
-- pré-existente); leitura é pública/edge.
--
-- Chaves (SECRETAS): Supabase Vault. O painel grava via set_llm_secret (super-admin);
-- a chave fica CRIPTOGRAFADA e NUNCA é devolvida ao painel (só status via
-- llm_secrets_status). A edge lê o valor decifrado via get_llm_secret — função
-- concedida SÓ a service_role (um super-admin autenticado não consegue ler a chave).
--
-- Providers válidos: áudio ∈ {gemini, openai} (Claude não faz áudio);
-- imagem ∈ {anthropic, gemini, openai}.
-- =============================================================================

-- Config default (não sobrescreve se já existir)
INSERT INTO public.system_settings (id, value, description)
VALUES (
  'media_ai_config',
  '{"audio":{"provider":"gemini","model":"gemini-2.0-flash"},"image":{"provider":"anthropic","model":"claude-haiku-4-5"}}',
  'IA de transcrição de mídia: provider+model por tipo (áudio/imagem). Chaves no Vault.'
)
ON CONFLICT (id) DO NOTHING;

-- Escrita da config (super-admin; valida provider/model)
CREATE OR REPLACE FUNCTION public.set_media_ai_config(p_config jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a_prov text := p_config->'audio'->>'provider';
  a_model text := p_config->'audio'->>'model';
  i_prov text := p_config->'image'->>'provider';
  i_model text := p_config->'image'->>'model';
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;
  IF a_prov IS NULL OR a_prov NOT IN ('gemini','openai') THEN
    RAISE EXCEPTION 'provider de áudio inválido: %', a_prov;
  END IF;
  IF i_prov IS NULL OR i_prov NOT IN ('anthropic','gemini','openai') THEN
    RAISE EXCEPTION 'provider de imagem inválido: %', i_prov;
  END IF;
  IF coalesce(trim(a_model),'') = '' OR coalesce(trim(i_model),'') = '' THEN
    RAISE EXCEPTION 'model é obrigatório para áudio e imagem';
  END IF;

  INSERT INTO public.system_settings (id, value, description, updated_at)
  VALUES (
    'media_ai_config',
    jsonb_build_object(
      'audio', jsonb_build_object('provider', a_prov, 'model', trim(a_model)),
      'image', jsonb_build_object('provider', i_prov, 'model', trim(i_model))
    )::text,
    'IA de transcrição de mídia: provider+model por tipo (áudio/imagem). Chaves no Vault.',
    now()
  )
  ON CONFLICT (id) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

  RETURN (SELECT value::jsonb FROM public.system_settings WHERE id = 'media_ai_config');
END;
$$;
REVOKE ALL ON FUNCTION public.set_media_ai_config(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_media_ai_config(jsonb) TO authenticated;

-- Map provider -> nome do segredo no Vault
CREATE OR REPLACE FUNCTION public._llm_secret_name(p_provider text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE lower(p_provider)
    WHEN 'gemini' THEN 'GEMINI_API_KEY'
    WHEN 'anthropic' THEN 'ANTHROPIC_API_KEY'
    WHEN 'openai' THEN 'OPENAI_API_KEY'
    ELSE NULL
  END;
$$;

-- Grava/atualiza a chave no Vault (super-admin)
CREATE OR REPLACE FUNCTION public.set_llm_secret(p_provider text, p_value text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text := public._llm_secret_name(p_provider);
  v_desc text := 'LLM API key (' || lower(p_provider) || ') — set via painel super-admin';
  v_id uuid;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'provider inválido: %', p_provider;
  END IF;
  IF p_value IS NULL OR length(trim(p_value)) < 8 THEN
    RAISE EXCEPTION 'chave inválida';
  END IF;

  SELECT id INTO v_id FROM vault.secrets WHERE name = v_name;
  IF v_id IS NULL THEN
    PERFORM vault.create_secret(trim(p_value), v_name, v_desc, NULL::uuid);
  ELSE
    PERFORM vault.update_secret(v_id, trim(p_value), v_name, v_desc, NULL::uuid);
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.set_llm_secret(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_llm_secret(text, text) TO authenticated;

-- Remove a chave do Vault (super-admin)
CREATE OR REPLACE FUNCTION public.delete_llm_secret(p_provider text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text := public._llm_secret_name(p_provider);
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'provider inválido: %', p_provider;
  END IF;
  DELETE FROM vault.secrets WHERE name = v_name;
END;
$$;
REVOKE ALL ON FUNCTION public.delete_llm_secret(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_llm_secret(text) TO authenticated;

-- Status das chaves (super-admin) — SEM valores, só existência
CREATE OR REPLACE FUNCTION public.llm_secrets_status()
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
    'gemini',    EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'GEMINI_API_KEY'),
    'anthropic', EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'ANTHROPIC_API_KEY'),
    'openai',    EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'OPENAI_API_KEY')
  );
END;
$$;
REVOKE ALL ON FUNCTION public.llm_secrets_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.llm_secrets_status() TO authenticated;

-- Leitura do valor decifrado — SÓ a edge (service_role). Um super-admin NÃO lê a chave.
CREATE OR REPLACE FUNCTION public.get_llm_secret(p_name text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = p_name LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.get_llm_secret(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_llm_secret(text) TO service_role;
