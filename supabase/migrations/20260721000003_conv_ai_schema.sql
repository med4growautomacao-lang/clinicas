-- =============================================================================
-- IA Analista de Conversas — schema, fila, insights e prompt versionado
--
-- O motor de etapas de hoje casa PALAVRA-CHAVE (stage_transition_rules ->
-- match_stage_rule -> trg_zz_apply_stage_rules). Se a secretária escreve a mesma
-- coisa com outras palavras, o card não anda; e venda ninguém detecta (só existe
-- quando um humano arrasta o card). Este é o analista semântico que lê a conversa.
--
-- REGRA DE APLICAÇÃO (decisão do dono, 21/07):
--   • etapa COMUM        -> a IA move sozinha (acima do limiar de confiança);
--   • etapa de CONVERSÃO -> a IA NUNCA aplica. Vira sugestão agrupada para o
--     vendedor decidir. Venda mexe em faturamento e dispara CAPI para a Meta.
--
-- Divisão de configuração:
--   • GLOBAL (super admin): system_settings.conv_ai_config = motor (provider,
--     modelo, temperatura, janela, lote, teto, prompts do SISTEMA, kill-switch).
--   • POR CLÍNICA: conv_ai_clinic_config = liga/desliga + limiar; o conhecimento
--     do negócio mora no prompt versionado (conv_ai_prompt_versions), que nasce
--     do HISTÓRICO de conversas e se reescreve com as decisões humanas.
--
-- Chaves de API: reusam o Vault já existente (set_llm_secret / get_llm_secret).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Config GLOBAL do motor (system_settings) + RPC de escrita gated
-- ---------------------------------------------------------------------------
INSERT INTO public.system_settings (id, value, description)
VALUES (
  'conv_ai_config',
  jsonb_build_object(
    'mode', 'shadow',
    'provider', 'anthropic',
    'model', 'claude-haiku-4-5',
    'temperature', 0.1,
    'max_output_tokens', 1200,
    'max_messages', 40,
    'debounce_minutes', 3,
    'batch_size', 25,
    'daily_cap_per_clinic', 300,
    'min_confidence_stage', 0.75,
    'min_confidence_sale', 0.7,
    'learn', jsonb_build_object(
      'provider', 'anthropic',
      'model', 'claude-sonnet-5',
      'temperature', 0.3,
      'every_n_decisions', 15,
      'bootstrap_sample', 60
    ),
    'system_prompt', $sp$Você é o analista de conversas de um CRM. Você lê a conversa entre a empresa e um contato e decide DUAS coisas:
1) ETAPA: em qual etapa do funil este atendimento deveria estar AGORA.
2) VENDA: se há evidência explícita de que a venda foi FECHADA.

Regras invioláveis:
- Baseie-se SOMENTE no que está literalmente escrito na conversa. Nunca deduza fechamento a partir do otimismo do vendedor.
- Toda conclusão precisa de uma citação textual da conversa. Sem citação, a confiança é baixa.
- Se a conversa não avançou, devolva a ETAPA ATUAL. Essa é a resposta mais comum e é legítima.
- VENDA é compromisso explícito do CLIENTE: pagamento realizado, comprovante enviado, contrato aceito, "pode agendar", "fechado". Proposta enviada, orçamento pedido, interesse ou "vou pensar" NÃO são venda.
- "confidence" vai de 0 a 1 e precisa refletir sua incerteza real. Prefira confiança baixa a inventar.
- Responda em português do Brasil.

Responda SOMENTE com um JSON válido, sem texto antes ou depois, no formato:
{
  "stage": {
    "slug": "<slug de uma das etapas listadas, ou null se não souber>",
    "confidence": 0.0,
    "evidence": ["trecho literal da conversa"],
    "rationale": "uma frase curta"
  },
  "sale": {
    "detected": false,
    "value": null,
    "confidence": 0.0,
    "evidence": ["trecho literal da conversa"],
    "rationale": "uma frase curta"
  }
}$sp$,
    'bootstrap_prompt', $bp$Você vai escrever o MANUAL DE ANÁLISE de uma empresa específica, que será usado por outro modelo para classificar conversas no funil.

Você recebe uma amostra de atendimentos REAIS já resolvidos por humanos: a conversa, a etapa em que o humano colocou o atendimento e o desfecho (ganho ou perdido). Esses rótulos humanos são a verdade.

Escreva um manual objetivo em português do Brasil que ensine:
- o que caracteriza cada etapa NESTA empresa, com as expressões que de fato aparecem nas conversas dela;
- quais sinais antecedem uma venda fechada aqui, e quais sinais parecem venda mas não são;
- as armadilhas específicas do vocabulário desta empresa (produto, jargão, forma de cobrar).

Não invente regra que a amostra não sustente. Não repita instruções genéricas de análise. Máximo de 400 palavras. Responda somente com o texto do manual.$bp$,
    'learn_prompt', $lp$Você mantém o MANUAL DE ANÁLISE de uma empresa. Você recebe o manual vigente e as decisões humanas recentes sobre as análises da IA: vendas confirmadas, vendas recusadas e etapas que o humano corrigiu depois que a IA moveu.

Reescreva o manual incorporando o que essas decisões ensinam. Regras:
- Toda mudança precisa estar sustentada pelas decisões recebidas. Se elas não contradizem o manual, devolva-o praticamente inalterado.
- Prefira ajustar e afiar o texto existente a inchá-lo. Máximo de 400 palavras.
- Seja concreto: cite as expressões reais que causaram erro.
Responda somente com o texto do novo manual, em português do Brasil.$lp$
  )::text,
  'IA Analista de Conversas: motor global (modelo, temperatura, janela, prompts do sistema, kill-switch). Config por clínica em conv_ai_clinic_config.'
)
ON CONFLICT (id) DO NOTHING;

-- Escrita da config global (super admin). MERGE parcial: nunca reconstrói o JSON
-- do zero (campo desconhecido pelo painel não pode ser zerado em silêncio).
CREATE OR REPLACE FUNCTION public.set_conv_ai_config(p_config jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cur  jsonb;
  v_new  jsonb;
  v_mode text;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;
  IF p_config IS NULL OR jsonb_typeof(p_config) <> 'object' THEN
    RAISE EXCEPTION 'config inválida';
  END IF;

  SELECT COALESCE(value::jsonb, '{}'::jsonb) INTO v_cur
    FROM public.system_settings WHERE id = 'conv_ai_config';
  v_cur := COALESCE(v_cur, '{}'::jsonb);

  -- merge raso + merge do sub-objeto 'learn' (senão salvar só o modelo apagaria o resto)
  v_new := v_cur || (p_config - 'learn');
  IF p_config ? 'learn' THEN
    v_new := jsonb_set(v_new, '{learn}', COALESCE(v_cur->'learn', '{}'::jsonb) || (p_config->'learn'));
  END IF;

  v_mode := v_new->>'mode';
  IF v_mode IS NULL OR v_mode NOT IN ('off','shadow','active') THEN
    RAISE EXCEPTION 'mode inválido: %', v_mode;
  END IF;
  IF COALESCE(v_new->>'provider','') NOT IN ('anthropic','openai','gemini') THEN
    RAISE EXCEPTION 'provider inválido: %', v_new->>'provider';
  END IF;
  IF COALESCE(btrim(v_new->>'model'),'') = '' THEN
    RAISE EXCEPTION 'model é obrigatório';
  END IF;
  IF (v_new->>'temperature')::numeric < 0 OR (v_new->>'temperature')::numeric > 1 THEN
    RAISE EXCEPTION 'temperature deve estar entre 0 e 1';
  END IF;

  INSERT INTO public.system_settings (id, value, description, updated_at)
  VALUES ('conv_ai_config', v_new::text,
          'IA Analista de Conversas: motor global (modelo, temperatura, janela, prompts do sistema, kill-switch). Config por clínica em conv_ai_clinic_config.',
          now())
  ON CONFLICT (id) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

  RETURN v_new;
END;
$$;
REVOKE ALL ON FUNCTION public.set_conv_ai_config(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_conv_ai_config(jsonb) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Config POR CLÍNICA (sem modo: etapa comum sempre aplica, conversão sempre revisa)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.conv_ai_clinic_config (
  clinic_id             uuid PRIMARY KEY REFERENCES public.clinics(id) ON DELETE CASCADE,
  enabled               boolean NOT NULL DEFAULT false,
  min_confidence_stage  numeric,                  -- NULL = herda o global
  prompt_version        int NOT NULL DEFAULT 0,
  decisions_since_learn int NOT NULL DEFAULT 0,
  last_learned_at       timestamptz,
  last_analysis_at      timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.conv_ai_clinic_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS conv_ai_clinic_config_all ON public.conv_ai_clinic_config;
CREATE POLICY conv_ai_clinic_config_all ON public.conv_ai_clinic_config
  FOR ALL
  USING (((clinic_id IN (SELECT cu.clinic_id FROM public.clinic_users cu WHERE cu.id = auth.uid()))
          AND public.is_clinic_active(clinic_id)) OR public.is_clinic_admin(clinic_id))
  WITH CHECK (((clinic_id IN (SELECT cu.clinic_id FROM public.clinic_users cu WHERE cu.id = auth.uid()))
          AND public.is_clinic_active(clinic_id)) OR public.is_clinic_admin(clinic_id));

-- ---------------------------------------------------------------------------
-- 3. Prompt versionado por clínica (nasce do histórico, evolui com as decisões)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.conv_ai_prompt_versions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id           uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  version             int NOT NULL,
  content             text NOT NULL,
  source              text NOT NULL DEFAULT 'learn' CHECK (source IN ('bootstrap','learn','manual')),
  based_on_decisions  int NOT NULL DEFAULT 0,
  is_current          boolean NOT NULL DEFAULT false,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_conv_ai_prompt_versions_clinic_version
  ON public.conv_ai_prompt_versions (clinic_id, version);
-- 1 versão vigente por clínica (a invariante mora no índice, não na aplicação)
CREATE UNIQUE INDEX IF NOT EXISTS uq_conv_ai_prompt_versions_current
  ON public.conv_ai_prompt_versions (clinic_id) WHERE is_current;

ALTER TABLE public.conv_ai_prompt_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS conv_ai_prompt_versions_read ON public.conv_ai_prompt_versions;
CREATE POLICY conv_ai_prompt_versions_read ON public.conv_ai_prompt_versions
  FOR SELECT
  USING (((clinic_id IN (SELECT cu.clinic_id FROM public.clinic_users cu WHERE cu.id = auth.uid()))
          AND public.is_clinic_active(clinic_id)) OR public.is_clinic_admin(clinic_id));

-- ---------------------------------------------------------------------------
-- 4. Fila (dirty flag por ticket). O trigger só MARCA; quem analisa é a edge.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.conv_ai_queue (
  ticket_id        uuid PRIMARY KEY REFERENCES public.tickets(id) ON DELETE CASCADE,
  clinic_id        uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  lead_id          uuid,
  last_message_seq bigint NOT NULL DEFAULT 0,
  last_message_at  timestamptz NOT NULL DEFAULT now(),
  analyzed_seq     bigint NOT NULL DEFAULT 0,
  status           text NOT NULL DEFAULT 'pending',   -- pending | done | error
  attempts         int NOT NULL DEFAULT 0,
  last_error       text,
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_conv_ai_queue_pending
  ON public.conv_ai_queue (last_message_at) WHERE status = 'pending';

ALTER TABLE public.conv_ai_queue ENABLE ROW LEVEL SECURITY;
-- Escrita é sempre service_role (trigger SECURITY DEFINER / edge). Leitura só super admin (debug).
DROP POLICY IF EXISTS conv_ai_queue_super_read ON public.conv_ai_queue;
CREATE POLICY conv_ai_queue_super_read ON public.conv_ai_queue
  FOR SELECT USING (public.is_super_admin());

-- ---------------------------------------------------------------------------
-- 5. Resultado da análise
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.conv_ai_insights (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id          uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  ticket_id          uuid NOT NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  lead_id            uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  kind               text NOT NULL CHECK (kind IN ('stage','sale')),
  suggested_stage_id uuid REFERENCES public.funnel_stages(id) ON DELETE SET NULL,
  previous_stage_id  uuid,
  sale_value         numeric,
  confidence         numeric,
  rationale          text,
  evidence           jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- pending (só sale) | auto_applied | approved | rejected | stale
  -- skipped_low_confidence | shadow  (registrado, nada aplicado)
  status             text NOT NULL DEFAULT 'pending',
  decided_by         uuid,
  decided_at         timestamptz,
  decision_note      text,
  provider           text,
  model              text,
  tokens_in          int,
  tokens_out         int,
  analyzed_seq       bigint,
  created_at         timestamptz NOT NULL DEFAULT now()
);
-- 1 sugestão em aberto por ticket (só 'sale' entra em fila). Reanálise atualiza, não duplica.
CREATE UNIQUE INDEX IF NOT EXISTS uq_conv_ai_insights_open
  ON public.conv_ai_insights (ticket_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS ix_conv_ai_insights_clinic_status
  ON public.conv_ai_insights (clinic_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_conv_ai_insights_ticket
  ON public.conv_ai_insights (ticket_id, created_at DESC);

ALTER TABLE public.conv_ai_insights ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS conv_ai_insights_read ON public.conv_ai_insights;
CREATE POLICY conv_ai_insights_read ON public.conv_ai_insights
  FOR SELECT
  USING (((clinic_id IN (SELECT cu.clinic_id FROM public.clinic_users cu WHERE cu.id = auth.uid()))
          AND public.is_clinic_active(clinic_id)) OR public.is_clinic_admin(clinic_id));
-- Decisão do humano passa pela RPC (SECURITY DEFINER), nunca por UPDATE direto.

-- ---------------------------------------------------------------------------
-- 6. Trigger de enfileiramento (espelha o early-exit barato do fn_apply_stage_rules)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_conv_ai_enqueue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ticket_id uuid;
  v_content   text;
BEGIN
  IF NEW.clinic_id IS NULL OR NEW.lead_id IS NULL THEN RETURN NEW; END IF;

  -- Early-exit: clínica sem o analista ligado não paga nada (PK lookup).
  IF NOT EXISTS (
    SELECT 1 FROM conv_ai_clinic_config c
     WHERE c.clinic_id = NEW.clinic_id AND c.enabled
  ) THEN
    RETURN NEW;
  END IF;

  v_content := NEW.message->>'content';
  IF v_content IS NULL OR btrim(v_content) = '' THEN RETURN NEW; END IF;

  v_ticket_id := NEW.ticket_id;
  IF v_ticket_id IS NULL THEN
    SELECT id INTO v_ticket_id
      FROM tickets
     WHERE lead_id = NEW.lead_id AND status = 'open'
     ORDER BY opened_at DESC LIMIT 1;
  END IF;
  IF v_ticket_id IS NULL THEN RETURN NEW; END IF;

  INSERT INTO conv_ai_queue (ticket_id, clinic_id, lead_id, last_message_seq, last_message_at, status)
  VALUES (v_ticket_id, NEW.clinic_id, NEW.lead_id, NEW.seq, now(), 'pending')
  ON CONFLICT (ticket_id) DO UPDATE
    SET last_message_seq = GREATEST(conv_ai_queue.last_message_seq, EXCLUDED.last_message_seq),
        last_message_at  = now(),
        status           = 'pending',
        updated_at       = now();

  RETURN NEW;

EXCEPTION WHEN OTHERS THEN
  -- Enfileirar JAMAIS pode derrubar o insert da mensagem do cliente.
  BEGIN
    PERFORM log_system_error('conv-ai', 'enqueue_error',
      'Falha ao enfileirar conversa para o analista de IA', 'warning', NEW.clinic_id,
      jsonb_build_object('message_id', NEW.id, 'lead_id', NEW.lead_id, 'error', SQLERRM), false);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN NEW;
END;
$$;

-- Mensagem de automação (sender='system': follow-up, confirmação) não muda o
-- estado comercial e não deve custar uma chamada de LLM.
DROP TRIGGER IF EXISTS trg_zz_conv_ai_enqueue ON public.chat_messages;
CREATE TRIGGER trg_zz_conv_ai_enqueue
  AFTER INSERT ON public.chat_messages
  FOR EACH ROW
  WHEN (NEW.lead_id IS NOT NULL AND NEW.sender IS DISTINCT FROM 'system')
  EXECUTE FUNCTION public.fn_conv_ai_enqueue();

-- ---------------------------------------------------------------------------
-- 7. Decisão humana sobre a sugestão de VENDA
--    Aprovar NÃO fecha a venda aqui: devolve needs_ganho_modal para o frontend
--    abrir o fluxo de sempre (finalize_ticket + conversão + CAPI). Uma regra de
--    negócio, um dono.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.decide_conv_ai_insight(
  p_insight_id uuid,
  p_decision   text,
  p_note       text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ins RECORD;
BEGIN
  IF p_decision NOT IN ('approve','reject') THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'invalid_decision');
  END IF;

  SELECT * INTO v_ins FROM conv_ai_insights WHERE id = p_insight_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'insight_not_found');
  END IF;

  -- Escopo: mesma régua da RLS de leitura (a RPC é SECURITY DEFINER).
  IF NOT (
    ((v_ins.clinic_id IN (SELECT cu.clinic_id FROM clinic_users cu WHERE cu.id = auth.uid()))
      AND is_clinic_active(v_ins.clinic_id))
    OR is_clinic_admin(v_ins.clinic_id)
  ) THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  IF v_ins.status <> 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'already_decided', 'status', v_ins.status);
  END IF;

  UPDATE conv_ai_insights
     SET status        = CASE WHEN p_decision = 'approve' THEN 'approved' ELSE 'rejected' END,
         decided_by    = auth.uid(),
         decided_at    = now(),
         decision_note = p_note
   WHERE id = p_insight_id;

  -- Toda decisão humana é combustível do aprendizado.
  UPDATE conv_ai_clinic_config
     SET decisions_since_learn = decisions_since_learn + 1, updated_at = now()
   WHERE clinic_id = v_ins.clinic_id;

  IF p_decision = 'approve' THEN
    RETURN jsonb_build_object(
      'success', true, 'needs_ganho_modal', true,
      'ticket_id', v_ins.ticket_id, 'lead_id', v_ins.lead_id,
      'suggested_value', v_ins.sale_value);
  END IF;

  RETURN jsonb_build_object('success', true, 'needs_ganho_modal', false, 'ticket_id', v_ins.ticket_id);
END;
$$;
REVOKE ALL ON FUNCTION public.decide_conv_ai_insight(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decide_conv_ai_insight(uuid, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 8. Rollback de versão do prompt
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.conv_ai_rollback_prompt(p_clinic_id uuid, p_version int)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exists boolean;
BEGIN
  IF NOT (is_clinic_admin(p_clinic_id)
          OR (p_clinic_id IN (SELECT cu.clinic_id FROM clinic_users cu WHERE cu.id = auth.uid()))) THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  SELECT EXISTS (SELECT 1 FROM conv_ai_prompt_versions
                  WHERE clinic_id = p_clinic_id AND version = p_version) INTO v_exists;
  IF NOT v_exists THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'version_not_found');
  END IF;

  UPDATE conv_ai_prompt_versions SET is_current = false
   WHERE clinic_id = p_clinic_id AND is_current;
  UPDATE conv_ai_prompt_versions SET is_current = true
   WHERE clinic_id = p_clinic_id AND version = p_version;
  UPDATE conv_ai_clinic_config SET prompt_version = p_version, updated_at = now()
   WHERE clinic_id = p_clinic_id;

  RETURN jsonb_build_object('success', true, 'version', p_version);
END;
$$;
REVOKE ALL ON FUNCTION public.conv_ai_rollback_prompt(uuid, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conv_ai_rollback_prompt(uuid, int) TO authenticated;

-- ---------------------------------------------------------------------------
-- 9. Contagem de pendentes (KPI nunca nasce de array do client — max_rows clampa)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.conv_ai_pending_count(p_clinic_id uuid)
RETURNS int
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::int FROM public.conv_ai_insights i
   WHERE i.clinic_id = p_clinic_id
     AND i.status = 'pending'
     AND (((i.clinic_id IN (SELECT cu.clinic_id FROM public.clinic_users cu WHERE cu.id = auth.uid()))
           AND public.is_clinic_active(i.clinic_id)) OR public.is_clinic_admin(i.clinic_id));
$$;
REVOKE ALL ON FUNCTION public.conv_ai_pending_count(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conv_ai_pending_count(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 10. Sugestão de venda vira POEIRA quando o ticket já foi resolvido por fora
--     (o vendedor arrastou o card antes de olhar a fila).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_conv_ai_stale_on_outcome()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.outcome IS NOT NULL AND OLD.outcome IS DISTINCT FROM NEW.outcome THEN
    UPDATE conv_ai_insights
       SET status = 'stale', decided_at = now()
     WHERE ticket_id = NEW.id AND status = 'pending';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_conv_ai_stale_on_outcome ON public.tickets;
CREATE TRIGGER trg_conv_ai_stale_on_outcome
  AFTER UPDATE OF outcome ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.fn_conv_ai_stale_on_outcome();
