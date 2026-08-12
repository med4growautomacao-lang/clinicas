-- 20260723021552_elevenlabs_voice
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

CREATE OR REPLACE FUNCTION public._llm_secret_name(p_provider text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE lower(p_provider)
    WHEN 'gemini' THEN 'GEMINI_API_KEY'
    WHEN 'anthropic' THEN 'ANTHROPIC_API_KEY'
    WHEN 'openai' THEN 'OPENAI_API_KEY'
    WHEN 'elevenlabs' THEN 'ELEVENLABS_API_KEY'
    ELSE NULL
  END;
$$;

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
    'gemini',     EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'GEMINI_API_KEY'),
    'anthropic',  EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'ANTHROPIC_API_KEY'),
    'openai',     EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'OPENAI_API_KEY'),
    'elevenlabs', EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'ELEVENLABS_API_KEY')
  );
END;
$$;

INSERT INTO public.system_settings (id, value, description)
VALUES (
  'elevenlabs_config',
  '{"enabled":false,"voice_id":"","model_id":"eleven_multilingual_v2"}',
  'Voz do Agente (ElevenLabs): enabled + voice_id + model_id. Chave no Vault. Fallback texto no worker.'
)
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.set_elevenlabs_config(p_config jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enabled boolean := COALESCE((p_config->>'enabled')::boolean, false);
  v_voice   text    := COALESCE(trim(p_config->>'voice_id'), '');
  v_model   text    := COALESCE(NULLIF(trim(p_config->>'model_id'), ''), 'eleven_multilingual_v2');
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;
  INSERT INTO public.system_settings (id, value, description, updated_at)
  VALUES (
    'elevenlabs_config',
    jsonb_build_object('enabled', v_enabled, 'voice_id', v_voice, 'model_id', v_model)::text,
    'Voz do Agente (ElevenLabs): enabled + voice_id + model_id. Chave no Vault. Fallback texto no worker.',
    now()
  )
  ON CONFLICT (id) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
  RETURN (SELECT value::jsonb FROM public.system_settings WHERE id = 'elevenlabs_config');
END;
$$;
REVOKE ALL ON FUNCTION public.set_elevenlabs_config(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_elevenlabs_config(jsonb) TO authenticated;
