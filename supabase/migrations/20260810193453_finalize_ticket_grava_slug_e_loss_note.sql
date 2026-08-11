-- finalize_ticket passa a gravar o motivo CANÔNICO (slug) e a anotação da perda em campo próprio.
--
-- ⚠️ POR QUE DROP E NÃO SÓ `create or replace`: acrescentar parâmetro cria uma SEGUNDA função com
-- o mesmo nome. Consequências, todas silenciosas:
--   1. PostgREST fica ambíguo (PGRST203) ou roteia para a antiga, que nunca grava slug;
--   2. a assinatura nova nasce com ACL nula, ou seja EXECUTE para PUBLIC (logo para `anon`) numa
--      SECURITY DEFINER que fecha ticket — é o padrão exato do vazamento de 17h do §1;
--   3. `authenticated` NÃO herda o grant, e o Kanban perde o botão de encerrar.
-- Precedente da casa: 20260613000024_finalize_ticket_resolve_flag.sql fez DROP + re-GRANT quando
-- acrescentou p_resolve.
--
-- ROLLBACK: recriar com os 5 parâmetros antigos, em migration NOVA (migration é história, §3).
-- Definição anterior guardada no comentário ao final desta migration.

drop function if exists public.finalize_ticket(uuid, text, text, text, boolean);

create or replace function public.finalize_ticket(
  p_ticket_id       uuid,
  p_outcome         text,
  p_loss_reason     text    default null,
  p_notes           text    default null,
  p_resolve         boolean default true,
  p_loss_reason_slug text   default null,   -- motivo canônico; se vier null, resolve pelo texto
  p_loss_note        text   default null    -- anotação DA PERDA (nunca vai para tickets.notes)
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
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
    outcome_at  = now(),

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

-- Permissões: o `create function` acabou de conceder EXECUTE a PUBLIC. Fechar e reconceder.
revoke all on function public.finalize_ticket(uuid, text, text, text, boolean, text, text)
  from public, anon, authenticated;
grant execute on function public.finalize_ticket(uuid, text, text, text, boolean, text, text)
  to authenticated, service_role;

comment on function public.finalize_ticket(uuid, text, text, text, boolean, text, text) is
  'Encerra ticket como ganho/perdido. Ponto ÚNICO de escrita de desfecho (app, Kanban, IA, CRM, automação). Grava motivo canônico + anotação da perda em campo próprio.';

