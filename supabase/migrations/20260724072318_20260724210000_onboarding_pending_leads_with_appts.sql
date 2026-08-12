-- 20260724072318_20260724210000_onboarding_pending_leads_with_appts
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Lista os leads da Sincronização JÁ com as datas da agenda (último passado / próximo futuro),
-- cruzando appointments por telefone normalizado. Assim o card do onboarding vai pré-preenchido
-- como paciente para quem já tem agendamento (não perde os que já agendaram).
CREATE OR REPLACE FUNCTION public.onboarding_pending_leads(p_clinic_id uuid)
RETURNS TABLE(ticket_id uuid, lead_id uuid, name text, phone text, avatar_url text, last_appt date, next_appt date)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_stage uuid;
  v_today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF NOT fn_can_onboard(p_clinic_id) THEN RETURN; END IF;
  SELECT id INTO v_stage FROM funnel_stages WHERE clinic_id = p_clinic_id AND slug = 'sincronizacao' LIMIT 1;
  IF v_stage IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT t.id, l.id, l.name, l.phone, l.avatar_url,
    (SELECT max(a.date) FROM appointments a JOIN patients p ON p.id = a.patient_id
       WHERE a.clinic_id = p_clinic_id AND normalize_br_phone(p.phone) = normalize_br_phone(l.phone)
         AND a.status NOT IN ('cancelado','faltou') AND a.date < v_today) AS last_appt,
    (SELECT min(a.date) FROM appointments a JOIN patients p ON p.id = a.patient_id
       WHERE a.clinic_id = p_clinic_id AND normalize_br_phone(p.phone) = normalize_br_phone(l.phone)
         AND a.status NOT IN ('cancelado','faltou') AND a.date >= v_today) AS next_appt
  FROM tickets t JOIN leads l ON l.id = t.lead_id
  WHERE t.clinic_id = p_clinic_id AND t.stage_id = v_stage AND t.status = 'open'
  ORDER BY t.opened_at;
END;
$function$;

REVOKE ALL ON FUNCTION public.onboarding_pending_leads(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.onboarding_pending_leads(uuid) TO authenticated;
