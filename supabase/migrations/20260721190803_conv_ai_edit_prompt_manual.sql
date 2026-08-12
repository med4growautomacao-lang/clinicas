-- 20260721190803_conv_ai_edit_prompt_manual
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Edição humana do manual da clínica.
--
-- Por que existe: o manual nasce do histórico, e o histórico rotula cada
-- conversa com o desfecho FINAL do ticket — não com o estado dele no momento
-- daquela mensagem. Isso faz o bootstrap confundir o último passo do funil com
-- o passo que a conversa mostra (na Vaz: "agendamento confirmado" virou venda,
-- quando é a etapa Agendado). Sem uma porta de edição, a clínica fica refém do
-- que a IA inferiu até acumular decisões suficientes para o aprendizado corrigir.
--
-- Cria uma versão nova (source='manual'), preservando o histórico e o rollback.
CREATE OR REPLACE FUNCTION public.conv_ai_edit_prompt(p_clinic_id uuid, p_content text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next int;
BEGIN
  IF NOT (
    ((p_clinic_id IN (SELECT cu.clinic_id FROM clinic_users cu WHERE cu.id = auth.uid()))
      AND is_clinic_active(p_clinic_id))
    OR is_clinic_admin(p_clinic_id)
  ) THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  IF COALESCE(btrim(p_content), '') = '' THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'empty_content');
  END IF;
  IF length(p_content) > 20000 THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'too_long');
  END IF;

  SELECT COALESCE(MAX(version), 0) + 1 INTO v_next
    FROM conv_ai_prompt_versions WHERE clinic_id = p_clinic_id;

  UPDATE conv_ai_prompt_versions SET is_current = false
   WHERE clinic_id = p_clinic_id AND is_current;

  INSERT INTO conv_ai_prompt_versions (clinic_id, version, content, source, is_current, notes)
  VALUES (p_clinic_id, v_next, btrim(p_content), 'manual', true,
          'Editado por ' || COALESCE(auth.uid()::text, 'desconhecido'));

  INSERT INTO conv_ai_clinic_config (clinic_id, prompt_version, decisions_since_learn, last_learned_at)
  VALUES (p_clinic_id, v_next, 0, now())
  ON CONFLICT (clinic_id) DO UPDATE
    SET prompt_version = v_next, decisions_since_learn = 0, updated_at = now();

  RETURN jsonb_build_object('success', true, 'version', v_next);
END;
$$;
REVOKE ALL ON FUNCTION public.conv_ai_edit_prompt(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conv_ai_edit_prompt(uuid, text) TO authenticated;
