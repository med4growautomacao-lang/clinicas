-- 🚨 CORRECAO DE UM ERRO MEU, aplicado 2 minutos antes (migration 20260810193925).
--
-- O QUE ACONTECEU: li `finalize_ticket` com 5 argumentos, escrevi a mudanca do `outcome_at` em cima
-- dessa assinatura e, entre a leitura e a aplicacao, OUTRA SESSAO publicou a versao de 7 argumentos
-- (migration 20260810163700_finalize_ticket_grava_slug_e_loss_note, com loss_reason_slug/loss_note) e
-- DROPOU a de 5. Meu CREATE OR REPLACE nao substituiu nada: ele RESSUSCITOU a assinatura antiga como
-- uma segunda overload.
--
-- CUSTO REAL, medido: das 19:39:25 as 19:41:32 UTC toda chamada com aqueles 5 parametros devolveu
-- "function finalize_ticket is not unique". Um evento de VENDA GANHA do CRM (clinica Intubacao,
-- 19:40:19) foi recusado e NAO foi gravado: `external-crm-status` devolve 200 mesmo em falha, entao
-- o CRM nao reenvia. Foi 1 evento, o unico da janela (conferido em system_errors e
-- external_crm_events).
--
-- 📌 LICAO (§3 do CLAUDE.md, na pratica): banco e um so para todas as sessoes. Entre LER uma funcao e
-- APLICAR a migration, ela pode ter mudado de assinatura. Conferir a assinatura VIVA
-- (pg_get_function_identity_arguments) imediatamente antes de aplicar, e nao confiar na leitura de
-- 10 minutos atras. E depois de aplicar, conferir que existe UMA overload, nao duas.
--
-- 1) Remove a overload que eu criei sem querer.
DROP FUNCTION IF EXISTS public.finalize_ticket(uuid, text, text, text, boolean);

-- 2) Reaplica a ETAPA 1 na assinatura CERTA (a de 7 argumentos, da outra sessao), preservando
--    integralmente o trabalho de motivo de perda que veio com ela. A unica linha alterada e o
--    `outcome_at`.
--
-- ⚠️ Motivo original da etapa 1: com a segunda venda no mesmo card, `outcome_at = now()` cru fazia a
-- PRIMEIRA venda mudar de mes sozinha (1.283 vendas datadas em mes fechado, 555 em card ainda aberto).
-- Agora `outcome_at` e a data em que o desfecho ATUAL foi alcancado pela PRIMEIRA vez: trocar de
-- ganho para perdido continua carimbando now(), repetir o mesmo desfecho preserva a data.
CREATE OR REPLACE FUNCTION public.finalize_ticket(p_ticket_id uuid, p_outcome text, p_loss_reason text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_resolve boolean DEFAULT true, p_loss_reason_slug text DEFAULT NULL::text, p_loss_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ticket RECORD;
  v_target_stage_id uuid;
  v_slug text;
BEGIN
  PERFORM set_config('app.stage_source', 'finalize', true);
  PERFORM set_config('app.stage_actor', COALESCE(auth.uid()::text, ''), true);

  IF p_outcome NOT IN ('ganho', 'perdido') THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'invalid_outcome');
  END IF;

  SELECT id, lead_id, stage_id, clinic_id INTO v_ticket
  FROM tickets WHERE id = p_ticket_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'ticket_not_found');
  END IF;

  -- Guard de tenant: barra chamador authenticated de outra clínica. Passa para service_role e
  -- para chamada sem JWT (cron/psql/trigger interno).
  PERFORM public.assert_clinic_access(v_ticket.clinic_id);

  SELECT id INTO v_target_stage_id FROM funnel_stages
  WHERE clinic_id = v_ticket.clinic_id AND slug = p_outcome LIMIT 1;

  -- Slug explícito ganha; senão traduz o texto pelo de-para. Nunca inventa.
  IF p_outcome = 'perdido' THEN
    v_slug := COALESCE(p_loss_reason_slug, public.fn_resolve_loss_reason(p_loss_reason));
  END IF;

  UPDATE tickets SET
    status      = CASE WHEN p_resolve THEN 'closed' ELSE status END,
    closed_at   = CASE WHEN p_resolve THEN COALESCE(closed_at, now()) ELSE closed_at END,
    outcome     = p_outcome,

    -- ⚠️ ETAPA 1 do plano "varias vendas no mesmo card": preserva a data quando o desfecho JA era
    -- este. Sem isto, a 2a venda no mesmo card reescreve a data da 1a e a venda antiga migra de mes,
    -- em silencio, inclusive em relatorio ja entregue ao cliente.
    outcome_at  = CASE WHEN outcome IS NOT DISTINCT FROM p_outcome
                       THEN COALESCE(outcome_at, now())
                       ELSE now() END,

    -- ⚠️ COALESCE, não atribuição direta: antes, chamar com p_loss_reason NULL APAGAVA o motivo
    -- que já existia. Era a causa raiz de perda muda em vários caminhos da UI. Quem quer limpar
    -- de verdade usa reopen_ticket, que zera de propósito.
    loss_reason = CASE
                    WHEN p_outcome = 'perdido' THEN COALESCE(p_loss_reason, loss_reason)
                    ELSE NULL   -- ganho não tem motivo de perda (impede a sujeira de voltar)
                  END,
    loss_reason_slug = CASE
                    WHEN p_outcome = 'perdido' THEN COALESCE(v_slug, loss_reason_slug)
                    ELSE NULL
                  END,
    -- Anotação da perda: APPEND, campo próprio. Nunca sobrescreve e nunca encosta em `notes`,
    -- que é compartilhado (onboarding_audit_apply, save_orcamento e import_historical_lead
    -- escrevem e apagam lá).
    loss_note   = CASE
                    WHEN p_outcome = 'perdido' AND NULLIF(btrim(p_loss_note), '') IS NOT NULL
                      THEN COALESCE(loss_note || E'\n', '') || btrim(p_loss_note)
                    WHEN p_outcome = 'perdido' THEN loss_note
                    ELSE NULL
                  END,

    notes       = COALESCE(p_notes, notes),   -- INTOCADO
    stage_id    = COALESCE(v_target_stage_id, stage_id)
  WHERE id = p_ticket_id;

  -- Texto que chegou sem tradução no catálogo: acende a Central e vira 1 INSERT em
  -- loss_reason_aliases, sem deploy. Fica AQUI e não em cada produtor porque este é o ponto
  -- único por onde todos passam (app, Kanban, IA, CRM, automação).
  IF p_outcome = 'perdido' AND NULLIF(btrim(p_loss_reason), '') IS NOT NULL AND v_slug IS NULL THEN
    BEGIN
      PERFORM public.log_system_error(
        'motivo_perda_sem_catalogo',
        'Motivo de perda sem tradução no catálogo: ' || left(p_loss_reason, 120),
        'warning',
        v_ticket.clinic_id,
        jsonb_build_object('loss_reason', p_loss_reason, 'ticket_id', p_ticket_id)
      );
    EXCEPTION WHEN OTHERS THEN
      NULL;  -- monitor que derruba a função monitorada é pior que não ter monitor
    END;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'ticket_id', p_ticket_id,
    'lead_id', v_ticket.lead_id,
    'outcome', p_outcome,
    'resolved', p_resolve,
    'loss_reason_slug', v_slug,
    'new_stage_id', v_target_stage_id
  );
END;
$function$;
