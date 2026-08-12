-- 20260727221621_20260727221545_fase0_guard_ticket_writers_and_view_leak
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- FASE 0 (crítico): fecha o vetor não autenticado que permitia fechar/mover QUALQUER ticket.
--
-- finalize_ticket e set_ticket_stage (as duas RPCs que escrevem em tickets.outcome/stage, a
-- fonte única de todos os painéis) eram SECURITY DEFINER, sem guard no corpo, e escaparam do
-- revoke de 20260727163000 porque citam auth.uid() só dentro de set_config('app.stage_actor',...)
-- (o loop pula funções cujo prosrc casa 'auth\.uid'). Resultado medido: anon, com a chave do
-- bundle, executava as duas via PostgREST; e vw_lead_active_stage entregava a anon os
-- active_ticket_id dos ~32k leads (alvo enumerável em massa).
--
-- Correção: (1) revoke de public+anon e grant só a authenticated/service_role; (2) guard de
-- tenant no corpo, logo após buscar o ticket. assert_clinic_access passa para service_role
-- (edge) e para chamada sem JWT (cron/trigger interno roda com o JWT da sessão que o disparou),
-- e só barra o chamador authenticated cross-tenant — que é o ataque. Os 7 callers internos são
-- todos SECURITY DEFINER (owner postgres mantém EXECUTE) e operam na clínica do próprio
-- chamador, então não quebram. (3) vw_lead_active_stage passa a security_invoker=on (herda a
-- RLS de leads/tickets) e perde SELECT de anon; o Kanban já filtra por lead_id da própria
-- clínica, então continua idêntico.

-- 1. finalize_ticket + guard -----------------------------------------------------
create or replace function public.finalize_ticket(p_ticket_id uuid, p_outcome text, p_loss_reason text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_resolve boolean DEFAULT true)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
DECLARE
  v_ticket RECORD;
  v_target_stage_id uuid;
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

  UPDATE tickets SET
    status      = CASE WHEN p_resolve THEN 'closed' ELSE status END,
    closed_at   = CASE WHEN p_resolve THEN COALESCE(closed_at, now()) ELSE closed_at END,
    outcome     = p_outcome,
    outcome_at  = now(),
    loss_reason = CASE WHEN p_outcome = 'perdido' THEN p_loss_reason ELSE loss_reason END,
    notes       = COALESCE(p_notes, notes),
    stage_id    = COALESCE(v_target_stage_id, stage_id)
  WHERE id = p_ticket_id;

  RETURN jsonb_build_object(
    'success', true,
    'ticket_id', p_ticket_id,
    'lead_id', v_ticket.lead_id,
    'outcome', p_outcome,
    'resolved', p_resolve,
    'new_stage_id', v_target_stage_id
  );
END;
$function$;

-- 2. set_ticket_stage + guard ----------------------------------------------------
create or replace function public.set_ticket_stage(p_ticket_id uuid, p_new_stage_id uuid, p_source text DEFAULT 'unknown'::text, p_actor text DEFAULT NULL::text, p_on_resolved text DEFAULT 'new_cycle'::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
DECLARE
  v_ticket     RECORD;
  v_new_slug   text;
  v_new_ticket uuid;
  v_resolved   boolean;
BEGIN
  PERFORM set_config('app.stage_source', COALESCE(NULLIF(p_source, ''), 'unknown'), true);
  PERFORM set_config('app.stage_actor', COALESCE(p_actor, auth.uid()::text, ''), true);

  SELECT id, lead_id, stage_id, clinic_id, status, outcome
    INTO v_ticket
  FROM tickets WHERE id = p_ticket_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'ticket_not_found');
  END IF;

  -- Guard de tenant: barra chamador authenticated de outra clínica. Passa para service_role e
  -- para chamada sem JWT (cron/psql/trigger interno).
  PERFORM public.assert_clinic_access(v_ticket.clinic_id);

  SELECT slug INTO v_new_slug FROM funnel_stages WHERE id = p_new_stage_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'stage_not_found');
  END IF;

  IF v_ticket.stage_id = p_new_stage_id THEN
    RETURN jsonb_build_object('success', true, 'ticket_id', p_ticket_id,
                              'new_stage_id', p_new_stage_id, 'new_cycle', false, 'noop', true);
  END IF;

  v_resolved := (v_ticket.outcome IS NOT NULL OR v_ticket.status = 'closed');

  IF v_resolved
     AND v_ticket.lead_id IS NOT NULL   -- órfão não se reproduz (ver comentário no topo)
     AND v_new_slug IS DISTINCT FROM 'ganho'
     AND v_new_slug IS DISTINCT FROM 'perdido' THEN

    IF p_on_resolved = 'block' THEN
      RETURN jsonb_build_object('success', true, 'ticket_id', p_ticket_id,
                                'blocked', true, 'reason', 'ticket_resolved');

    ELSIF p_on_resolved = 'new_cycle' THEN
      IF v_ticket.status <> 'closed' THEN
        UPDATE tickets SET status = 'closed', closed_at = COALESCE(closed_at, now())
        WHERE id = v_ticket.id;
      END IF;
      INSERT INTO tickets (clinic_id, lead_id, stage_id, status, opened_at)
      VALUES (v_ticket.clinic_id, v_ticket.lead_id, p_new_stage_id, 'open', now())
      RETURNING id INTO v_new_ticket;
      RETURN jsonb_build_object('success', true, 'ticket_id', v_new_ticket,
                                'previous_ticket_id', v_ticket.id,
                                'new_stage_id', p_new_stage_id, 'new_cycle', true);

    END IF;
  END IF;

  UPDATE tickets SET stage_id = p_new_stage_id WHERE id = p_ticket_id;
  RETURN jsonb_build_object('success', true, 'ticket_id', p_ticket_id,
                            'new_stage_id', p_new_stage_id, 'new_cycle', false);
END;
$function$;

-- 3. Fecha os grants (CREATE OR REPLACE preserva a ACL antiga, então revoga aqui) ---
revoke all on function public.finalize_ticket(uuid,text,text,text,boolean) from public, anon;
revoke all on function public.set_ticket_stage(uuid,uuid,text,text,text) from public, anon;
grant execute on function public.finalize_ticket(uuid,text,text,text,boolean) to authenticated, service_role;
grant execute on function public.set_ticket_stage(uuid,uuid,text,text,text) to authenticated, service_role;

-- 4. Fecha o vetor de enumeração de ticket_ids ----------------------------------
alter view public.vw_lead_active_stage set (security_invoker = on);
revoke all on table public.vw_lead_active_stage from anon;
