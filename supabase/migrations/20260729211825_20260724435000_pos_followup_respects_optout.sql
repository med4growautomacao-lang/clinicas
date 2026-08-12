-- 20260729211825_20260724435000_pos_followup_respects_optout
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Pós-atendimento respeita o opt-out por tipo. Esta função serve GANHO e PERDIDO na mesma consulta,
-- então o kind é derivado: 'pos_' || t.outcome (o WHERE já garante outcome in ('ganho','perdido'),
-- logo sempre cai em 'pos_ganho'/'pos_perdido', valores aceitos pelo CHECK da tabela).
CREATE OR REPLACE FUNCTION public.fn_followup_candidates_pos(p_clinic_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(clinic_id uuid, ticket_id uuid, lead_id uuid, nome text, telefone text, outcome text, message text, encerrado_em timestamp without time zone, eligible_at timestamp without time zone, expires_at timestamp without time zone, toggle_on boolean, wa_ok boolean, window_start integer, window_end integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select
    t.clinic_id, t.id, t.lead_id, l.name, normalize_br_phone(l.phone),
    t.outcome,
    case when t.outcome = 'ganho' then ai.pos_followup_ganho_message else ai.pos_followup_perdido_message end,
    (t.outcome_at at time zone 'America/Sao_Paulo')::timestamp,
    ((t.outcome_at at time zone 'America/Sao_Paulo')
      + ((case when t.outcome = 'ganho' then coalesce(ai.pos_followup_ganho_days,1)
               else coalesce(ai.pos_followup_perdido_days,1) end) || ' days')::interval)::timestamp,
    ((t.outcome_at at time zone 'America/Sao_Paulo')
      + (((case when t.outcome = 'ganho' then coalesce(ai.pos_followup_ganho_days,1)
                else coalesce(ai.pos_followup_perdido_days,1) end)
          + coalesce(ai.pos_followup_grace_days,2)) || ' days')::interval)::timestamp,
    case when t.outcome = 'ganho' then coalesce(ai.pos_followup_ganho_enabled,false)
         else coalesce(ai.pos_followup_perdido_enabled,false) end,
    ss.send_token is not null,
    coalesce(ai.pos_followup_window_start, 8), coalesce(ai.pos_followup_window_end, 20)
  from tickets t
  join leads l on l.id = t.lead_id
  join ai_config ai on ai.clinic_id = t.clinic_id
  join v_clinic_send_state ss on ss.clinic_id = t.clinic_id
  where (p_clinic_id is null or t.clinic_id = p_clinic_id)
    and t.outcome in ('ganho','perdido')
    and t.outcome_at is not null
    and t.pos_followup_sent_at is null
    and t.pos_followup_expired_at is null
    and coalesce(l.followup_enabled, true) = true
    -- opt-out por tipo (lead_followup_optout): pos_ganho ou pos_perdido, conforme o desfecho
    and not exists (select 1 from lead_followup_optout o
                     where o.lead_id = l.id and o.kind = 'pos_' || t.outcome)
    and coalesce(l.is_not_lead, false) = false
    and normalize_br_phone(l.phone) is not null
    and not exists (select 1 from tickets t2
                     where t2.lead_id = t.lead_id and t2.status = 'open' and t2.id <> t.id)
    and not exists (select 1 from chat_messages cm
                     where cm.lead_id = t.lead_id and cm.direction = 'inbound'
                       and cm.created_at > (t.outcome_at at time zone 'America/Sao_Paulo'))
$function$;
