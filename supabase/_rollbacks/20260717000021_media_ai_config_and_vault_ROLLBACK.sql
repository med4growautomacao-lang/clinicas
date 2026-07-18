-- Rollback da 20260717000021 — remove RPCs e a linha de config.
-- NÃO apaga segredos do Vault automaticamente (evita perder chaves por engano);
-- para remover as chaves, rode antes: DELETE FROM vault.secrets WHERE name IN
-- ('GEMINI_API_KEY','ANTHROPIC_API_KEY','OPENAI_API_KEY');  (opcional/manual)
-- ATENÇÃO: só reverter junto com o redeploy do wa-inbound anterior (hardcoded),
-- senão a edge tenta chamar get_llm_secret inexistente (tem try/catch → cai no
-- fallback env, mas fica sem a config).
DROP FUNCTION IF EXISTS public.get_llm_secret(text);
DROP FUNCTION IF EXISTS public.llm_secrets_status();
DROP FUNCTION IF EXISTS public.delete_llm_secret(text);
DROP FUNCTION IF EXISTS public.set_llm_secret(text, text);
DROP FUNCTION IF EXISTS public.set_media_ai_config(jsonb);
DROP FUNCTION IF EXISTS public._llm_secret_name(text);
DELETE FROM public.system_settings WHERE id = 'media_ai_config';
