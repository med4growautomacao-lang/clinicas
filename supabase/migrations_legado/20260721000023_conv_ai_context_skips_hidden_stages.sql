-- A IA analista não pode mandar lead para etapa OCULTA.
--
-- Bug encontrado logo depois de criar is_hidden (20260721000015): conv_ai_get_context devolvia
-- TODAS as etapas da clínica, e a edge conv-ai-analyst monta a lista de opções do prompt a partir
-- dela. Em stage_mode='auto' a escolha vira set_ticket_stage direto. Resultado: a IA podia mover o
-- ticket para uma etapa que não desenha coluna, e o card sumia do quadro sem ninguém saber, a
-- mesma classe de perda silenciosa dos 389 tickets sem etapa de maio.
--
-- Ficou concreto em 21/07: 'Compareceu' foi restaurada OCULTA em 6 clínicas (20260721000016), e é
-- justamente uma das etapas que a IA detecta com mais facilidade ("o paciente compareceu").
--
-- Correção na FONTE: etapa oculta sai da lista de opções. A IA não a vê, não a sugere, e se
-- alucinar o slug o lookup da edge não acha e nada acontece (o código já trata sugStage null).
-- A etapa ATUAL do ticket continua indo no contexto por fora (ticket.stage_name/stage_slug), então
-- um ticket que já esteja numa etapa oculta segue sendo analisado normalmente.

create or replace function public.conv_ai_get_context(p_ticket_id uuid, p_max_messages integer DEFAULT 40)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- NÃO oferecer etapa oculta como destino (ver cabeçalho).
  SELECT jsonb_agg(jsonb_build_object(
           'id', s.id, 'name', s.name, 'slug', s.slug,
           'position', s.position, 'is_conversion', s.is_conversion
         ) ORDER BY s.position)
    INTO v_stages
    FROM funnel_stages s
   WHERE s.clinic_id = v_t.clinic_id
     AND NOT s.is_hidden;

  -- Idem para as regras de palavra-chave mostradas como exemplo à IA: uma regra que aponta para
  -- etapa oculta ensinaria justamente o destino que queremos evitar.
  SELECT jsonb_agg(jsonb_build_object('quando_a_mensagem_contem', r.keywords, 'etapa', s.name)
                   ORDER BY r.order_index NULLS LAST, r.created_at)
    INTO v_rules
    FROM stage_transition_rules r
    JOIN funnel_stages s ON s.id = r.target_stage_id
   WHERE r.clinic_id = v_t.clinic_id
     AND COALESCE(btrim(r.keywords), '') <> ''
     AND NOT s.is_hidden;

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
$function$;

-- Repetidos da 20260721000013: CREATE OR REPLACE preserva a ACL de uma função que já existe, então
-- em produção nada tinha se aberto, mas sem estas duas linhas o arquivo deixaria de carregar o
-- próprio endurecimento. Aplicado sozinho num banco onde a função ainda não existe, ele criaria uma
-- SECURITY DEFINER com EXECUTE default para PUBLIC.
revoke all on function public.conv_ai_get_context(uuid, int) from public, anon, authenticated;
grant execute on function public.conv_ai_get_context(uuid, int) to service_role;
