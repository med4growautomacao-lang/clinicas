-- 20260729204933_20260724432000_reengagement_respects_optout
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Reengajamento passa a respeitar o opt-out POR TIPO. Única alteração no corpo: o `not exists` do
-- opt-out logo abaixo do gate mestre do lead. Assinatura e RETURNS TABLE IDÊNTICOS (a edge e o
-- preview consomem as colunas por posição/nome).
-- ⚠️ `coalesce(ac.followup_enabled, false)` no SELECT é a chave da CLÍNICA (ai_config), homônima da
-- do lead. NÃO confundir: ela continua intacta.
CREATE OR REPLACE FUNCTION public.fn_followup_candidates_reengagement(p_clinic_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(clinic_id uuid, lead_id uuid, nome text, telefone text, clinic_phone text, message_text text, step_no integer, is_closing boolean, expected_count integer, eligible_at timestamp without time zone, toggle_on boolean, wa_ok boolean, window_start integer, window_end integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select
    l.clinic_id, l.id, l.name, l.phone,
    w.phone_number, s.message_text, s.step_no, s.is_closing, l.followup_count,
    (greatest(lm.last_at, coalesce(l.followup_sent_at, lm.last_at))
       + (s.delay_minutes || ' minutes')::interval)::timestamp,
    coalesce(ac.followup_enabled, false),
    ss.send_token is not null,
    coalesce(ac.followup_window_start, 6), coalesce(ac.followup_window_end, 22)
  from leads l
  join ai_config ac on ac.clinic_id = l.clinic_id
  join v_clinic_send_state ss on ss.clinic_id = l.clinic_id
  join followup_steps s
    on s.clinic_id = l.clinic_id and s.step_no = l.followup_count + 1 and s.enabled = true
  join lateral (
    select wi.phone_number from whatsapp_instances wi where wi.clinic_id = l.clinic_id
     order by (wi.status = 'connected') desc nulls last limit 1
  ) w on true
  join lateral (
    select cm.direction as last_dir, cm.created_at as last_at
      from chat_messages cm where cm.lead_id = l.id
     order by cm.seq desc limit 1
  ) lm on true
  where (p_clinic_id is null or l.clinic_id = p_clinic_id)
    and l.followup_enabled = true
    -- opt-out por tipo (lead_followup_optout): exceção deste lead para ESTE follow-up
    and not exists (select 1 from lead_followup_optout o
                     where o.lead_id = l.id and o.kind = 'reengagement')
    and l.ai_enabled = true
    and l.handoff_triggered_at is null
    and l.converted_patient_id is null
    and coalesce(l.is_not_lead, false) = false
    and l.phone is not null and l.phone <> ''
    and not exists (select 1 from tickets t where t.lead_id = l.id and t.outcome = 'ganho')
    and exists (select 1 from tickets t join funnel_stages fs on fs.id = t.stage_id
                 where t.lead_id = l.id and t.status = 'open'
                   and fs.slug not in ('agendado','compareceu','ganho','perdido'))
    and not exists (select 1 from appointments a join tickets t2 on t2.id = a.ticket_id
                     where t2.lead_id = l.id
                       and a.status in ('pendente','confirmado')
                       and ((a.date + a."time") at time zone 'America/Sao_Paulo') > now())
    and lm.last_dir = 'outbound'
    and lm.last_at >= ((now() at time zone 'America/Sao_Paulo')
                        - (coalesce(ac.followup_max_idle_days, 7) || ' days')::interval)
$function$;
