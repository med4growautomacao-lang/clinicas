-- 20260729200018_20260724420000_onboarding_queue_order_by_recency
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Ordem da fila: MAIS RECENTE PRIMEIRO (antes era alfabética por nome, que não ajuda a decidir).
-- Recência = última atividade do lead (msg/movimento), caindo para a data de entrada.
-- Mantém os "clientes existentes" no fim (são os de confirmação em lote).
CREATE OR REPLACE FUNCTION public.onboarding_pending_leads(p_clinic_id uuid)
 RETURNS TABLE(ticket_id uuid, lead_id uuid, name text, phone text, avatar_url text,
               last_appt date, last_appt_time time without time zone,
               next_appt date, next_appt_time time without time zone, is_scheduled boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_stage uuid; v_today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_months integer; v_cutoff timestamp;
BEGIN
  IF NOT fn_can_onboard(p_clinic_id) THEN RETURN; END IF;
  SELECT id INTO v_stage FROM funnel_stages WHERE clinic_id = p_clinic_id AND slug = 'sincronizacao' LIMIT 1;
  IF v_stage IS NULL THEN RETURN; END IF;
  SELECT onboarding_period_months INTO v_months FROM clinics WHERE id = p_clinic_id;
  v_cutoff := CASE WHEN v_months IS NULL THEN '1900-01-01'::timestamp
                   ELSE (now() AT TIME ZONE 'America/Sao_Paulo') - (v_months || ' months')::interval END;

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
