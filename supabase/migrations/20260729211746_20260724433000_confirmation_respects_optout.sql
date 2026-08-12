-- 20260729211746_20260724433000_confirmation_respects_optout
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Confirmação de consulta respeita o opt-out por tipo. Única alteração: o `not exists`.
-- Assinatura e RETURNS TABLE idênticos. `l` vem de LEFT JOIN (consulta sem lead => l.id nulo =>
-- subconsulta vazia => not exists verdadeiro => continua incluído, como hoje).
CREATE OR REPLACE FUNCTION public.fn_followup_candidates_confirmation(p_clinic_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(clinic_id uuid, appointment_id uuid, lead_id uuid, nome text, telefone text, data_consulta text, hora_consulta text, confirm_message text, eligible_at timestamp without time zone, toggle_on boolean, wa_ok boolean, window_start integer, window_end integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select
    a.clinic_id, a.id, t.lead_id, p.name, normalize_br_phone(p.phone),
    to_char(a.date,'DD/MM/YYYY'), to_char(a.time,'HH24:MI'), ai.confirm_message,
    ((a.date + a.time) - (coalesce(ai.confirm_lead_time, 1440) || ' minutes')::interval)::timestamp,
    coalesce(ai.confirm_enabled, false),
    ss.send_token is not null,
    coalesce(ai.confirm_window_start, 6), coalesce(ai.confirm_window_end, 22)
  from appointments a
  join patients p on p.id = a.patient_id
  join doctors d on d.id = a.doctor_id
  join ai_config ai on ai.clinic_id = a.clinic_id
  join v_clinic_send_state ss on ss.clinic_id = a.clinic_id
  left join tickets t on t.id = a.ticket_id
  left join leads   l on l.id = t.lead_id
  where (p_clinic_id is null or a.clinic_id = p_clinic_id)
    and a.reminder_sent_at is null
    and a.status in ('pendente','confirmado')
    and nullif(btrim(ai.confirm_message), '') is not null
    and coalesce(l.followup_enabled, true) = true
    -- opt-out por tipo (lead_followup_optout)
    and not exists (select 1 from lead_followup_optout o
                     where o.lead_id = l.id and o.kind = 'confirmation')
    and ((a.date + a.time) at time zone 'America/Sao_Paulo') > now()
    and normalize_br_phone(p.phone) is not null
$function$;
