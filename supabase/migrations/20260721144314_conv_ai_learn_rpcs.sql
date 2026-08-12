-- 20260721144314_conv_ai_learn_rpcs
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

CREATE OR REPLACE FUNCTION public.conv_ai_learn_targets(p_every_n int DEFAULT 15)
RETURNS TABLE (clinic_id uuid, mode text, decisions int)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.clinic_id,
         CASE WHEN v.id IS NULL THEN 'bootstrap' ELSE 'learn' END AS mode,
         c.decisions_since_learn
    FROM public.conv_ai_clinic_config c
    LEFT JOIN public.conv_ai_prompt_versions v
           ON v.clinic_id = c.clinic_id AND v.is_current
   WHERE c.enabled
     AND (v.id IS NULL OR c.decisions_since_learn >= p_every_n);
$$;
REVOKE ALL ON FUNCTION public.conv_ai_learn_targets(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.conv_ai_learn_targets(int) TO service_role;

CREATE OR REPLACE FUNCTION public.conv_ai_save_prompt_version(
  p_clinic_id uuid,
  p_content   text,
  p_source    text DEFAULT 'learn',
  p_based_on  int DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next int;
BEGIN
  IF COALESCE(btrim(p_content), '') = '' THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'empty_content');
  END IF;

  SELECT COALESCE(MAX(version), 0) + 1 INTO v_next
    FROM conv_ai_prompt_versions WHERE clinic_id = p_clinic_id;

  UPDATE conv_ai_prompt_versions SET is_current = false
   WHERE clinic_id = p_clinic_id AND is_current;

  INSERT INTO conv_ai_prompt_versions (clinic_id, version, content, source, based_on_decisions, is_current)
  VALUES (p_clinic_id, v_next, btrim(p_content), p_source, COALESCE(p_based_on, 0), true);

  INSERT INTO conv_ai_clinic_config (clinic_id, prompt_version, decisions_since_learn, last_learned_at)
  VALUES (p_clinic_id, v_next, 0, now())
  ON CONFLICT (clinic_id) DO UPDATE
    SET prompt_version = v_next, decisions_since_learn = 0, last_learned_at = now(), updated_at = now();

  RETURN jsonb_build_object('success', true, 'version', v_next);
END;
$$;
REVOKE ALL ON FUNCTION public.conv_ai_save_prompt_version(uuid, text, text, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.conv_ai_save_prompt_version(uuid, text, text, int) TO service_role;
