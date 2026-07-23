-- =============================================================================
-- Config de modelo do Agente IA (edge ai-agent nativa) — painel Super Admin
--
-- Espelha media_ai_config (20260717000021): config NAO-secreta em
-- system_settings id='agent_ai_config' (JSON provider+model+temperature+fallback),
-- escrita via RPC gated por is_super_admin(); leitura pela edge (service_role).
-- As CHAVES continuam no Vault e sao lidas pela edge via get_llm_secret() — nada
-- de novo aqui (reusa GEMINI_API_KEY / ANTHROPIC_API_KEY / OPENAI_API_KEY).
--
-- Default = o modelo que o workflow n8n "Agente IA" usa hoje (paridade no corte):
-- gemini-3.1-pro-preview-customtools, temperature 0.6.
-- =============================================================================

-- Seed default (nao sobrescreve se ja existir)
INSERT INTO public.system_settings (id, value, description)
VALUES (
  'agent_ai_config',
  '{"provider":"gemini","model":"gemini-3.1-pro-preview-customtools","temperature":0.6,"fallback":null}',
  'Modelo do Agente IA (edge ai-agent): provider+model+temperature+fallback. Chaves no Vault.'
)
ON CONFLICT (id) DO NOTHING;

-- Escrita da config (super-admin; valida provider/model/temperature)
CREATE OR REPLACE FUNCTION public.set_agent_ai_config(p_config jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prov  text := p_config->>'provider';
  v_model text := p_config->>'model';
  v_temp  numeric := NULLIF(p_config->>'temperature','')::numeric;
  f_prov  text := p_config->'fallback'->>'provider';
  f_model text := p_config->'fallback'->>'model';
  v_fallback jsonb;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;
  IF v_prov IS NULL OR v_prov NOT IN ('gemini','anthropic','openai') THEN
    RAISE EXCEPTION 'provider invalido: %', v_prov;
  END IF;
  IF coalesce(trim(v_model),'') = '' THEN
    RAISE EXCEPTION 'model e obrigatorio';
  END IF;
  IF v_temp IS NOT NULL AND (v_temp < 0 OR v_temp > 2) THEN
    RAISE EXCEPTION 'temperature fora do intervalo [0,2]: %', v_temp;
  END IF;

  -- fallback opcional; so entra se provider+model validos
  IF f_prov IS NOT NULL AND f_prov IN ('gemini','anthropic','openai')
     AND coalesce(trim(f_model),'') <> '' THEN
    v_fallback := jsonb_build_object('provider', f_prov, 'model', trim(f_model));
  ELSE
    v_fallback := 'null'::jsonb;
  END IF;

  INSERT INTO public.system_settings (id, value, description, updated_at)
  VALUES (
    'agent_ai_config',
    jsonb_build_object(
      'provider', v_prov,
      'model', trim(v_model),
      'temperature', coalesce(v_temp, 0.6),
      'fallback', v_fallback
    )::text,
    'Modelo do Agente IA (edge ai-agent): provider+model+temperature+fallback. Chaves no Vault.',
    now()
  )
  ON CONFLICT (id) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

  RETURN (SELECT value::jsonb FROM public.system_settings WHERE id = 'agent_ai_config');
END;
$$;
REVOKE ALL ON FUNCTION public.set_agent_ai_config(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_agent_ai_config(jsonb) TO authenticated;
