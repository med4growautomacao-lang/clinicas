-- 20260706000005_ganho_pipeline_keep_outcome.sql
--
-- Objetivo (pedido do usuário): "Manter venda" deve MOVER o próprio card para outra coluna
-- CONTINUANDO marcado como Ganho — mantendo a conversão, todas as propriedades e o botão
-- "Resolver" — em vez de fechar o ganho e criar um card novo (o "novo ciclo"). Modelo de
-- PIPELINE DE VENDAS: o negócio é ganho e avança pelas etapas (ex.: Entregue) sem deixar de
-- ser venda. Vale para qualquer coluna-alvo. Os dashboards já contam venda por outcome='ganho'
-- (não pela coluna), então continua contando certo; o total da coluna soma a conversão do card
-- que estiver nela.
--
-- Bloqueio: fn_enforce_ticket_resolution_consistency zera o outcome ao mover para etapa ativa.
-- Solução CIRÚRGICA: um sinalizador de transação (app.keep_ticket_outcome='on') que SÓ o novo
-- RPC move_ticket_keep_outcome liga. O gatilho, ao ver o sinalizador, PRESERVA o outcome em vez
-- de zerar. Nenhum outro caminho liga o sinalizador -> comportamento de todos os demais fluxos
-- (agendamento, n8n, arraste comum, move_lead_stage) fica IDÊNTICO.

-- ============ enforce: respeitar o sinalizador de "manter desfecho" ============
CREATE OR REPLACE FUNCTION public.fn_enforce_ticket_resolution_consistency()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_slug text;
  v_stage_changed boolean;
  v_outcome_changed boolean;
  v_term_stage_id uuid;
BEGIN
  SELECT slug INTO v_slug FROM funnel_stages WHERE id = NEW.stage_id;

  IF TG_OP = 'INSERT' THEN
    v_stage_changed := true;
    v_outcome_changed := (NEW.outcome IS NOT NULL);
  ELSE
    v_stage_changed := NEW.stage_id IS DISTINCT FROM OLD.stage_id;
    v_outcome_changed := NEW.outcome IS DISTINCT FROM OLD.outcome;
  END IF;

  IF v_outcome_changed AND NEW.outcome IS NOT NULL THEN
    IF NEW.outcome = 'ganho' AND v_slug IS DISTINCT FROM 'ganho' THEN
      SELECT id INTO v_term_stage_id FROM funnel_stages WHERE clinic_id = NEW.clinic_id AND slug = 'ganho' LIMIT 1;
      IF v_term_stage_id IS NOT NULL THEN NEW.stage_id := v_term_stage_id; END IF;
    ELSIF NEW.outcome = 'perdido' AND v_slug IS DISTINCT FROM 'perdido' AND v_slug IS DISTINCT FROM 'faltou_cancelou' THEN
      SELECT id INTO v_term_stage_id FROM funnel_stages WHERE clinic_id = NEW.clinic_id AND slug = 'perdido' LIMIT 1;
      IF v_term_stage_id IS NOT NULL THEN NEW.stage_id := v_term_stage_id; END IF;
    END IF;
    NEW.outcome_at := COALESCE(NEW.outcome_at, now());

  ELSIF v_stage_changed AND NOT v_outcome_changed THEN
    IF v_slug = 'ganho' THEN
      NEW.outcome := 'ganho';
      NEW.outcome_at := COALESCE(NEW.outcome_at, now());
    ELSIF v_slug = 'perdido' THEN
      NEW.outcome := 'perdido';
      NEW.outcome_at := COALESCE(NEW.outcome_at, now());
    ELSIF COALESCE(current_setting('app.keep_ticket_outcome', true), '') = 'on' THEN
      -- Pipeline de vendas: move para etapa ativa PRESERVANDO o desfecho (ganho/perdido).
      -- Só o RPC move_ticket_keep_outcome ("Manter venda") liga esse sinalizador.
      NULL;  -- mantém NEW.outcome / outcome_at / loss_reason como estão (= OLD)
    ELSE
      NEW.outcome := NULL;
      NEW.outcome_at := NULL;
      NEW.loss_reason := NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- ============ RPC: mover mantendo o desfecho (usado pelo "Manter venda") ============
CREATE OR REPLACE FUNCTION public.move_ticket_keep_outcome(p_ticket_id uuid, p_new_stage_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_new_slug text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM tickets WHERE id = p_ticket_id) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'ticket_not_found');
  END IF;

  SELECT slug INTO v_new_slug FROM funnel_stages WHERE id = p_new_stage_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'stage_not_found');
  END IF;

  -- Liga o sinalizador só em torno DESTE UPDATE (e desliga logo em seguida), para não vazar
  -- para nenhuma outra operação de ticket que rode na mesma transação (gatilhos encadeados etc.).
  PERFORM set_config('app.keep_ticket_outcome', 'on', true);
  UPDATE tickets SET stage_id = p_new_stage_id WHERE id = p_ticket_id;
  PERFORM set_config('app.keep_ticket_outcome', 'off', true);

  RETURN jsonb_build_object('success', true, 'ticket_id', p_ticket_id, 'new_stage_id', p_new_stage_id);
END;
$function$;
