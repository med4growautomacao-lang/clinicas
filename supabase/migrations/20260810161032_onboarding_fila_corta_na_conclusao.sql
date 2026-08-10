-- A fila de "Organizar contatos" se REALIMENTAVA com o movimento do dia a dia.
--
-- Os ramos B (cliente existente) e C (ja no funil, com conversa) so exigiam
-- `onboarding_reviewed_at IS NULL` dentro de uma janela ROLANTE de N meses. Lead novo nasce sem
-- auditoria, entao entrava sozinho na fila, todo dia, para sempre. Medido na Lorena em 10/08:
-- os 24 da pilula vermelha foram TODOS criados em 31/07 ou depois, que e o dia em que ela concluiu
-- a organizacao; nenhum era do lote importado. Quatro dos cinco "clientes" ja eram venda ganha.
-- (Vaz: 38 dos 153. MedDesk Comercial: 4 dos 21. Gabriela Aredes: 5 dos 342, ainda organizando.)
--
-- Nao aparecia antes de 29/07 porque ate ali o alarme contava so o ramo A (`pending`), conjunto que
-- so encolhe. A migration 20260729223108 passou a contar a fila INTEIRA (`pending_total`), e a fila
-- inteira nunca teve corte de data: ate entao ela so era lida DENTRO do modal, durante a rodada.
--
-- Corte: contato que chegou DEPOIS de a clinica concluir a organizacao e trabalho do dia a dia, nao
-- da organizacao. `onboarding_reset` (Refazer) zera `onboarding_completed_at`, entao durante a
-- rodada o teto some sozinho e tudo volta a contar. Sem data concluida = sem teto.
--
-- ⚠️ Tipos: `leads.created_at` e timestamp SEM tz (ja e SP) e `clinics.onboarding_completed_at` e
-- timestamptz. Comparar cru deslocaria 3h, por isso o AT TIME ZONE.
--
-- ⚠️ O ramo A (ticket aberto na etapa Sincronizacao) fica SEM teto de proposito: quem esta la veio
-- da importacao e pisca vermelho no Kanban. Esconde-lo da fila deixaria o card piscando sem nenhuma
-- forma de organiza-lo.
CREATE OR REPLACE FUNCTION public.onboarding_pending_leads(p_clinic_id uuid)
 RETURNS TABLE(ticket_id uuid, lead_id uuid, name text, phone text, avatar_url text, last_appt date, last_appt_time time without time zone, next_appt date, next_appt_time time without time zone, is_scheduled boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_stage uuid; v_today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_months integer; v_cutoff timestamp;
  v_done_at timestamptz; v_upper timestamp;
BEGIN
  IF NOT fn_can_onboard(p_clinic_id) THEN RETURN; END IF;
  SELECT id INTO v_stage FROM funnel_stages WHERE clinic_id = p_clinic_id AND slug = 'sincronizacao' LIMIT 1;
  IF v_stage IS NULL THEN RETURN; END IF;
  SELECT onboarding_period_months, onboarding_completed_at
    INTO v_months, v_done_at FROM clinics WHERE id = p_clinic_id;
  v_cutoff := CASE WHEN v_months IS NULL THEN '1900-01-01'::timestamp
                   ELSE (now() AT TIME ZONE 'America/Sao_Paulo') - (v_months || ' months')::interval END;
  -- Teto: nada criado depois do fim da rodada entra na fila.
  v_upper := CASE WHEN v_done_at IS NULL THEN 'infinity'::timestamp
                  ELSE (v_done_at AT TIME ZONE 'America/Sao_Paulo') END;

  RETURN QUERY
  SELECT q.ticket_id, q.lead_id, q.name, q.phone, q.avatar_url,
         q.last_appt, q.last_appt_time, q.next_appt, q.next_appt_time, q.is_scheduled
  FROM (
    -- A) importados: ticket aberto na Sincronização
    SELECT t.id AS ticket_id, l.id AS lead_id, l.name, l.phone, l.avatar_url,
      pa.d AS last_appt, pa.t AS last_appt_time, na.d AS next_appt, na.t AS next_appt_time,
      false AS is_scheduled,
      coalesce(l.last_activity_at, l.last_message_at, l.created_at) AS ord
    FROM tickets t JOIN leads l ON l.id = t.lead_id
    LEFT JOIN LATERAL (
      SELECT a.date AS d, a."time" AS t FROM appointments a JOIN patients p ON p.id = a.patient_id
       WHERE a.clinic_id = p_clinic_id AND normalize_br_phone(p.phone) = normalize_br_phone(l.phone)
         AND a.status NOT IN ('cancelado','faltou') AND a.date <  v_today
       ORDER BY a.date DESC, a."time" DESC LIMIT 1) pa ON true
    LEFT JOIN LATERAL (
      SELECT a.date AS d, a."time" AS t FROM appointments a JOIN patients p ON p.id = a.patient_id
       WHERE a.clinic_id = p_clinic_id AND normalize_br_phone(p.phone) = normalize_br_phone(l.phone)
         AND a.status NOT IN ('cancelado','faltou') AND a.date >= v_today
       ORDER BY a.date ASC, a."time" ASC LIMIT 1) na ON true
    WHERE t.clinic_id = p_clinic_id AND t.stage_id = v_stage AND t.status = 'open'
      AND l.created_at >= v_cutoff

    UNION ALL

    -- B) cliente existente: tem consulta na agenda OU venda ganha
    SELECT (SELECT tk.id FROM tickets tk WHERE tk.lead_id = l.id ORDER BY (tk.status = 'open') DESC, tk.opened_at DESC LIMIT 1),
      l.id, l.name, l.phone, l.avatar_url,
      pa.d, pa.t, na.d, na.t, true,
      coalesce(l.last_activity_at, l.last_message_at, l.created_at)
    FROM leads l
    LEFT JOIN LATERAL (
      SELECT a.date AS d, a."time" AS t FROM appointments a JOIN patients p ON p.id = a.patient_id
       WHERE a.clinic_id = p_clinic_id AND normalize_br_phone(p.phone) = normalize_br_phone(l.phone)
         AND a.status NOT IN ('cancelado','faltou') AND a.date <  v_today
       ORDER BY a.date DESC, a."time" DESC LIMIT 1) pa ON true
    LEFT JOIN LATERAL (
      SELECT a.date AS d, a."time" AS t FROM appointments a JOIN patients p ON p.id = a.patient_id
       WHERE a.clinic_id = p_clinic_id AND normalize_br_phone(p.phone) = normalize_br_phone(l.phone)
         AND a.status NOT IN ('cancelado','faltou') AND a.date >= v_today
       ORDER BY a.date ASC, a."time" ASC LIMIT 1) na ON true
    WHERE l.clinic_id = p_clinic_id
      AND l.created_at >= v_cutoff
      AND l.created_at <  v_upper
      AND l.onboarding_reviewed_at IS NULL
      AND coalesce(l.is_not_lead, false) = false
      AND EXISTS (SELECT 1 FROM tickets tk WHERE tk.lead_id = l.id)
      AND NOT EXISTS (SELECT 1 FROM tickets tk WHERE tk.lead_id = l.id AND tk.stage_id = v_stage AND tk.status = 'open')
      AND (
        pa.d IS NOT NULL OR na.d IS NOT NULL
        OR EXISTS (SELECT 1 FROM tickets tk WHERE tk.lead_id = l.id AND tk.outcome = 'ganho')
      )

    UNION ALL

    -- C) já no funil, com conversa, ainda em aberto e nunca classificado
    SELECT tk.id, l.id, l.name, l.phone, l.avatar_url,
      NULL::date, NULL::time, NULL::date, NULL::time, false,
      coalesce(l.last_activity_at, l.last_message_at, l.created_at)
    FROM leads l
    JOIN LATERAL (
      SELECT t2.id FROM tickets t2
        LEFT JOIN funnel_stages fs2 ON fs2.id = t2.stage_id
       WHERE t2.lead_id = l.id AND t2.status = 'open' AND t2.outcome IS NULL
         AND coalesce(fs2.slug,'') NOT IN ('perdido','ganho','sincronizacao')
       ORDER BY t2.opened_at DESC LIMIT 1) tk ON true
    WHERE l.clinic_id = p_clinic_id
      AND l.created_at >= v_cutoff
      AND l.created_at <  v_upper
      AND l.onboarding_reviewed_at IS NULL
      AND coalesce(l.is_not_lead, false) = false
      AND EXISTS (SELECT 1 FROM chat_messages cm WHERE cm.lead_id = l.id)
      AND NOT EXISTS (SELECT 1 FROM tickets t3 WHERE t3.lead_id = l.id AND t3.stage_id = v_stage AND t3.status = 'open')
      AND NOT EXISTS (SELECT 1 FROM tickets t4 WHERE t4.lead_id = l.id AND t4.outcome = 'ganho')
      AND NOT EXISTS (SELECT 1 FROM appointments a JOIN patients p ON p.id = a.patient_id
                      WHERE a.clinic_id = p_clinic_id AND normalize_br_phone(p.phone) = normalize_br_phone(l.phone)
                        AND a.status NOT IN ('cancelado','faltou'))
  ) q
  ORDER BY q.is_scheduled, q.ord DESC NULLS LAST, q.name;
END; $function$;

REVOKE ALL ON FUNCTION public.onboarding_pending_leads(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.onboarding_pending_leads(uuid) TO authenticated, service_role;
