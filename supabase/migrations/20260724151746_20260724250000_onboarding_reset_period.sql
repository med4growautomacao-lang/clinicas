-- 20260724151746_20260724250000_onboarding_reset_period
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Refazer com PERÍODO (1/3/6 meses): só clientes existentes com agendamento/venda dentro da janela
-- voltam pra fila (senão viriam milhares). Guarda o período na clínica; a fila filtra por ele.
ALTER TABLE public.clinics ADD COLUMN IF NOT EXISTS onboarding_period_months integer;

CREATE OR REPLACE FUNCTION public.onboarding_pending_leads(p_clinic_id uuid)
RETURNS TABLE(ticket_id uuid, lead_id uuid, name text, phone text, avatar_url text, last_appt date, next_appt date, is_scheduled boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_stage uuid; v_today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_months integer; v_cutoff date;
BEGIN
  IF NOT fn_can_onboard(p_clinic_id) THEN RETURN; END IF;
  SELECT id INTO v_stage FROM funnel_stages WHERE clinic_id = p_clinic_id AND slug = 'sincronizacao' LIMIT 1;
  IF v_stage IS NULL THEN RETURN; END IF;
  SELECT onboarding_period_months INTO v_months FROM clinics WHERE id = p_clinic_id;
  v_cutoff := CASE WHEN v_months IS NULL THEN '1900-01-01'::date ELSE (v_today - (v_months || ' months')::interval)::date END;

  RETURN QUERY
  SELECT * FROM (
    -- A) novos contatos: ticket aberto na Sincronização (sempre; já são recentes)
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

    -- B) clientes existentes com agendamento/venda DENTRO DO PERÍODO, não revisados, sem ticket aberto na Sincronização
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
                  AND a.status NOT IN ('cancelado','faltou') AND a.date >= v_cutoff)
        OR EXISTS (SELECT 1 FROM tickets tk WHERE tk.lead_id = l.id AND tk.outcome = 'ganho'
                   AND coalesce(tk.outcome_at, tk.closed_at)::date >= v_cutoff)
      )
  ) q
  ORDER BY q.is_scheduled, q.name;
END; $function$;

-- Refazer com período. Guarda o período e re-abre (limpa "revisado" + "concluído").
DROP FUNCTION IF EXISTS public.onboarding_reset(uuid);
CREATE FUNCTION public.onboarding_reset(p_clinic_id uuid, p_months integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT fn_can_onboard(p_clinic_id) THEN RETURN jsonb_build_object('success', false, 'error_code', 'forbidden'); END IF;
  UPDATE clinics SET onboarding_completed_at = NULL, onboarding_period_months = p_months WHERE id = p_clinic_id;
  UPDATE leads SET onboarding_reviewed_at = NULL WHERE clinic_id = p_clinic_id;
  RETURN jsonb_build_object('success', true, 'months', p_months);
END; $function$;
REVOKE ALL ON FUNCTION public.onboarding_reset(uuid, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.onboarding_reset(uuid, integer) TO authenticated;
