-- =============================================================================
-- conv_ai_get_context: regras de gatilho da clínica + precedência do gatilho
--
-- 1) REGRAS DE GATILHO (par palavra-chave -> etapa) passam a ir no prompt. É
--    conhecimento que o cliente já escreveu e a IA ignorava: "nesta clínica,
--    esta frase significa esta etapa". Só o par entra; os campos `context` e
--    `lead_response` ficam de fora (vazios em quase todas as regras, e o lugar
--    do conhecimento de negócio é o manual versionado da clínica).
--
-- 2) ÚLTIMO MOVIMENTO POR GATILHO + idade em minutos. O motor de palavra-chave
--    e a IA são dois donos possíveis do mesmo card: o gatilho move na hora da
--    mensagem, a IA reavalia minutos depois. Com esse dado, a edge deixa de
--    desfazer em silêncio o que a regra do cliente acabou de fazer — discordância
--    dentro de 1h vira sugestão para um humano, não sobrescrita.
--
-- Contexto: 46 regras em 17 clínicas, 242 movimentos em 30 dias (source='gatilho').
-- O motor de keyword é cego para mensagens da IA (sender='ai'), por isso segue
-- útil nas clínicas atendidas por humano e inútil nas atendidas pelo agente.
-- =============================================================================
-- (corpo idêntico ao aplicado via MCP em 21/07; ver conv_ai_get_context)

CREATE OR REPLACE FUNCTION public.conv_ai_get_context(
  p_ticket_id    uuid,
  p_max_messages int DEFAULT 40
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_t          RECORD;
  v_messages   jsonb;
  v_stages     jsonb;
  v_rules      jsonb;
  v_prompt     text;
  v_last_seq   bigint;
  v_gat_stage  uuid;
  v_gat_min    numeric;
BEGIN
  SELECT t.id, t.clinic_id, t.lead_id, t.stage_id, t.status, t.outcome, t.opened_at,
         s.name AS stage_name, s.slug AS stage_slug,
         l.name AS lead_name, c.name AS clinic_name, c.category AS clinic_category
    INTO v_t
    FROM tickets t
    LEFT JOIN funnel_stages s ON s.id = t.stage_id
    LEFT JOIN leads l ON l.id = t.lead_id
    LEFT JOIN clinics c ON c.id = t.clinic_id
   WHERE t.id = p_ticket_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
           'id', s.id, 'name', s.name, 'slug', s.slug,
           'position', s.position, 'is_conversion', s.is_conversion
         ) ORDER BY s.position)
    INTO v_stages
    FROM funnel_stages s
   WHERE s.clinic_id = v_t.clinic_id;

  SELECT jsonb_agg(jsonb_build_object('quando_a_mensagem_contem', r.keywords, 'etapa', s.name)
                   ORDER BY r.order_index NULLS LAST, r.created_at)
    INTO v_rules
    FROM stage_transition_rules r
    JOIN funnel_stages s ON s.id = r.target_stage_id
   WHERE r.clinic_id = v_t.clinic_id
     AND COALESCE(btrim(r.keywords), '') <> '';

  SELECT v.content INTO v_prompt
    FROM conv_ai_prompt_versions v
   WHERE v.clinic_id = v_t.clinic_id AND v.is_current;

  SELECT h.new_stage_id,
         EXTRACT(EPOCH FROM ((now() AT TIME ZONE 'America/Sao_Paulo') - h.changed_at)) / 60
    INTO v_gat_stage, v_gat_min
    FROM lead_stage_history h
   WHERE h.ticket_id = p_ticket_id AND h.source = 'gatilho'
   ORDER BY h.changed_at DESC
   LIMIT 1;

  WITH win AS (
    SELECT m.seq, m.direction, m.sender, m.created_at, m.message->>'content' AS content
      FROM chat_messages m
     WHERE m.lead_id = v_t.lead_id
       AND m.created_at >= (v_t.opened_at AT TIME ZONE 'America/Sao_Paulo') - interval '5 minutes'
       AND COALESCE(btrim(m.message->>'content'), '') <> ''
     ORDER BY m.seq DESC
     LIMIT p_max_messages
  )
  SELECT jsonb_agg(jsonb_build_object(
           'seq', w.seq,
           'who', CASE WHEN w.direction = 'inbound' THEN 'cliente'
                       WHEN w.sender = 'ai' THEN 'ia'
                       WHEN w.sender = 'system' THEN 'automacao'
                       ELSE 'empresa' END,
           'at', to_char(w.created_at, 'DD/MM HH24:MI'),
           'text', left(w.content, 1200)
         ) ORDER BY w.seq),
         MAX(w.seq)
    INTO v_messages, v_last_seq
    FROM win w;

  RETURN jsonb_build_object(
    'found', true,
    'ticket', jsonb_build_object(
      'id', v_t.id, 'stage_id', v_t.stage_id, 'stage_name', v_t.stage_name,
      'stage_slug', v_t.stage_slug, 'status', v_t.status, 'outcome', v_t.outcome),
    'lead', jsonb_build_object('id', v_t.lead_id, 'name', v_t.lead_name),
    'clinic', jsonb_build_object('id', v_t.clinic_id, 'name', v_t.clinic_name, 'category', v_t.clinic_category),
    'stages', COALESCE(v_stages, '[]'::jsonb),
    'clinic_rules', COALESCE(v_rules, '[]'::jsonb),
    'clinic_prompt', v_prompt,
    'last_trigger_stage_id', v_gat_stage,
    'last_trigger_minutes', v_gat_min,
    'messages', COALESCE(v_messages, '[]'::jsonb),
    'last_seq', COALESCE(v_last_seq, 0)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.conv_ai_get_context(uuid, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.conv_ai_get_context(uuid, int) TO service_role;
