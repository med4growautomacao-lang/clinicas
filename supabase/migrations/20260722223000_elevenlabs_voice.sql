-- =============================================================================
-- Voz do Agente IA (ElevenLabs) — resposta em audio quando o paciente manda audio.
--
-- Config NAO-secreta: system_settings id='elevenlabs_config' (enabled + voice_id + model_id),
-- escrita via set_elevenlabs_config (super-admin). Chave SECRETA no Vault (ELEVENLABS_API_KEY),
-- gravada pelo painel via set_llm_secret('elevenlabs', ...) e lida pela edge via
-- get_llm_secret('ELEVENLABS_API_KEY'). Fallback para texto vive no worker (se desligado, sem
-- chave, sem voice_id ou erro de TTS -> responde em texto e registra na Central).
-- =============================================================================

-- 1) _llm_secret_name passa a mapear 'elevenlabs' (reusa set_llm_secret/delete_llm_secret).
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

-- 2) llm_secrets_status passa a reportar tambem o elevenlabs.
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

-- 3) Config default (nao sobrescreve se ja existir).
INSERT INTO public.system_settings (id, value, description)
VALUES (
  'elevenlabs_config',
  '{"enabled":false,"voice_id":"","model_id":"eleven_multilingual_v2"}',
  'Voz do Agente (ElevenLabs): enabled + voice_id + model_id. Chave no Vault. Fallback texto no worker.'
)
ON CONFLICT (id) DO NOTHING;

-- 4) Escrita da config (super-admin).
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
