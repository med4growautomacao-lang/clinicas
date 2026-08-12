-- =============================================================================
-- Fase A2 — Gatilhos de etapa por keyword: n8n "Gatilhos" -> trigger no banco
--
-- O workflow n8n "Gatilhos" faz UPDATE cru em tickets ao detectar keyword numa
-- mensagem de saída da secretária. Trazemos isso para um trigger em
-- chat_messages, com a MESMA normalização (match_stage_rule, Fase A1) e passando
-- pela RPC-dona set_ticket_stage (source='gatilho', p_on_resolved='block' — nunca
-- mexe numa venda).
--
-- Sobe em modo SHADOW: só registra a decisão do matcher em _shadow_stage_rules,
-- sem mover nada (o n8n continua sendo a fonte). Depois de ≥3 dias de 100% de
-- concordância, vira 'active' (system_settings) E os nós Call Gatilhos do Receptor
-- são desligados — nessa ordem, para nunca haver movimento duplo.
--
-- Modo controlado por system_settings.id='stage_rules_engine_mode':
--   'shadow' (default) | 'active' | 'off'   — kill-switch instantâneo, sem migration.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public._shadow_stage_rules (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at       timestamptz NOT NULL DEFAULT now(),
  clinic_id        uuid,
  lead_id          uuid,
  message_id       uuid,
  ticket_id        uuid,
  current_stage_id uuid,
  matched_stage_id uuid,
  content_preview  text
);

INSERT INTO public.system_settings (id, value, description)
VALUES ('stage_rules_engine_mode', 'shadow',
        'Motor de gatilhos de etapa por keyword: shadow (só registra) | active (move) | off')
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.fn_apply_stage_rules()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_mode      text;
  v_content   text;
  v_target    uuid;
  v_ticket_id uuid;
  v_cur_stage uuid;
BEGIN
  IF NEW.clinic_id IS NULL OR NEW.lead_id IS NULL THEN RETURN NEW; END IF;

  v_mode := COALESCE((SELECT value FROM system_settings WHERE id = 'stage_rules_engine_mode'), 'shadow');
  IF v_mode = 'off' THEN RETURN NEW; END IF;

  v_content := NEW.message->>'content';
  IF v_content IS NULL OR btrim(v_content) = '' THEN RETURN NEW; END IF;

  -- Early-exit barato: clínica sem regras (índice em stage_transition_rules.clinic_id).
  IF NOT EXISTS (SELECT 1 FROM stage_transition_rules WHERE clinic_id = NEW.clinic_id) THEN
    RETURN NEW;
  END IF;

  v_target := match_stage_rule(NEW.clinic_id, v_content);
  IF v_target IS NULL THEN RETURN NEW; END IF;

  -- Ticket-alvo: o da mensagem, se já veio preenchido (trg_auto_open_ticket é BEFORE);
  -- senão, o aberto mais recente do lead.
  v_ticket_id := NEW.ticket_id;
  IF v_ticket_id IS NOT NULL THEN
    SELECT stage_id INTO v_cur_stage FROM tickets WHERE id = v_ticket_id;
  ELSE
    SELECT id, stage_id INTO v_ticket_id, v_cur_stage
    FROM tickets WHERE lead_id = NEW.lead_id AND status = 'open'
    ORDER BY opened_at DESC LIMIT 1;
  END IF;

  IF v_mode = 'shadow' THEN
    INSERT INTO _shadow_stage_rules
      (clinic_id, lead_id, message_id, ticket_id, current_stage_id, matched_stage_id, content_preview)
    VALUES
      (NEW.clinic_id, NEW.lead_id, NEW.id, v_ticket_id, v_cur_stage, v_target, left(v_content, 200));
    RETURN NEW;
  END IF;

  -- v_mode = 'active'
  IF v_ticket_id IS NOT NULL THEN
    PERFORM set_ticket_stage(v_ticket_id, v_target, 'gatilho', NULL, 'block');
  END IF;
  RETURN NEW;

EXCEPTION WHEN OTHERS THEN
  -- Uma regra malformada JAMAIS pode derrubar o insert da mensagem do cliente.
  BEGIN
    PERFORM log_system_error('stage-rules', 'trigger_error',
      'Falha no gatilho de etapa por keyword', 'error', NEW.clinic_id,
      jsonb_build_object('message_id', NEW.id, 'lead_id', NEW.lead_id, 'error', SQLERRM), false);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_zz_apply_stage_rules ON public.chat_messages;
CREATE TRIGGER trg_zz_apply_stage_rules
  AFTER INSERT ON public.chat_messages
  FOR EACH ROW
  WHEN (NEW.direction = 'outbound' AND NEW.sender IS DISTINCT FROM 'ai' AND NEW.lead_id IS NOT NULL)
  EXECUTE FUNCTION public.fn_apply_stage_rules();
