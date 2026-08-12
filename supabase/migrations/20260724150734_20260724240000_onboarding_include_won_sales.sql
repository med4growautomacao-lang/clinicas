-- 20260724150734_20260724240000_onboarding_include_won_sales
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- "Cliente existente" no onboarding = tem AGENDAMENTO na agenda OU tem VENDA ganha (ticket outcome='ganho').
-- Ambos entram na fila preservados (is_scheduled=true → auditoria não mexe no ticket, só define IA/follow-up).
-- Cobre os tenants "outro" (não-clínica), onde a venda não tem consulta. Mesma assinatura/retorno.
CREATE OR REPLACE FUNCTION public.onboarding_pending_leads(p_clinic_id uuid)
RETURNS TABLE(ticket_id uuid, lead_id uuid, name text, phone text, avatar_url text, last_appt date, next_appt date, is_scheduled boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_stage uuid; v_today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF NOT fn_can_onboard(p_clinic_id) THEN RETURN; END IF;
  SELECT id INTO v_stage FROM funnel_stages WHERE clinic_id = p_clinic_id AND slug = 'sincronizacao' LIMIT 1;
  IF v_stage IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT * FROM (
    -- A) novos contatos: ticket aberto na Sincronização
    SELECT t.id AS ticket_id, l.id AS lead_id, l.name, l.phone, l.avatar_url,
      (SELECT max(a.date) FROM appointments a JOIN patients p ON p.id = a.patient_id
         WHERE a.clinic_id = p_clinic_id AND normalize_br_phone(p.phone) = normalize_br_phone(l.phone)
           AND a.status NOT IN ('cancelado','faltou') AND a.date <  v_today) AS last_appt,
      (SELECT min(a.date) FROM appointments a JOIN patients p ON p.id = a.patient_id
         WHERE a.clinic_id = p_clinic_id AND normalize_br_phone(p.phone) = normalize_br_phone(l.phone)
           AND a.status NOT IN ('cancelado','faltou') AND a.date >= v_today) AS next_appt,
      false AS is_scheduled
    FROM tickets t JOIN leads l ON l.id = t.lead_id
    WHERE t.clinic_id = p_clinic_id AND t.stage_id = v_stage AND t.status = 'open'

    UNION ALL

    -- B) clientes existentes: têm AGENDAMENTO ou VENDA ganha, ainda não revisados, sem ticket aberto na Sincronização
    SELECT (SELECT tk.id FROM tickets tk WHERE tk.lead_id = l.id ORDER BY (tk.status = 'open') DESC, tk.opened_at DESC LIMIT 1),
      l.id, l.name, l.phone, l.avatar_url,
      (SELECT max(a.date) FROM appointments a JOIN patients p ON p.id = a.patient_id
         WHERE a.clinic_id = p_clinic_id AND normalize_br_phone(p.phone) = normalize_br_phone(l.phone)
           AND a.status NOT IN ('cancelado','faltou') AND a.date <  v_today),
      (SELECT min(a.date) FROM appointments a JOIN patients p ON p.id = a.patient_id
         WHERE a.clinic_id = p_clinic_id AND normalize_br_phone(p.phone) = normalize_br_phone(l.phone)
           AND a.status NOT IN ('cancelado','faltou') AND a.date >= v_today),
      true
    FROM leads l
    WHERE l.clinic_id = p_clinic_id
      AND l.onboarding_reviewed_at IS NULL
      AND coalesce(l.is_not_lead, false) = false
      AND EXISTS (SELECT 1 FROM tickets tk WHERE tk.lead_id = l.id)
      AND NOT EXISTS (SELECT 1 FROM tickets tk WHERE tk.lead_id = l.id AND tk.stage_id = v_stage AND tk.status = 'open')
      AND (
        EXISTS (SELECT 1 FROM appointments a JOIN patients p ON p.id = a.patient_id
                WHERE a.clinic_id = p_clinic_id AND normalize_br_phone(p.phone) = normalize_br_phone(l.phone)
                  AND a.status NOT IN ('cancelado','faltou'))
        OR EXISTS (SELECT 1 FROM tickets tk WHERE tk.lead_id = l.id AND tk.outcome = 'ganho')
      )
  ) q
  ORDER BY q.is_scheduled, q.name;
END; $function$;
