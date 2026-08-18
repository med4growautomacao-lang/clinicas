-- Prévia mostrada ANTES de criar a régua de uma etapa: quantos contatos daquela coluna
-- entram na fila e quantos ficam elegíveis já no primeiro tick.
-- Existe porque criar a régua de uma etapa torna TODO o backlog dela elegível de uma vez
-- (ex.: "Contato via WhatsApp" da Vaz tem 58 contatos, 54 deles com a última fala há dias).
-- Isso já aconteceu antes neste sistema: ao introduzir o passo de encerramento numa régua com
-- backlog, saíram 23 mensagens num tick só.
--
-- Os filtros espelham os gates duráveis de fn_followup_candidates_reengagement. O que a prévia
-- NÃO checa (de propósito, porque são chaves e não público): master da clínica, WhatsApp
-- conectado e janela de horário.

create or replace function public.preview_regua_por_etapa(
  p_clinic_id uuid, p_stage_id uuid, p_delay_minutes int default 1440)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_total int;
  v_agora int;
begin
  perform public.assert_clinic_access(p_clinic_id);

  select count(*),
         count(*) filter (
           where coalesce(lin.last_in_at, lm.last_at)
                 + (coalesce(p_delay_minutes, 1440) || ' minutes')::interval
                 <= (now() at time zone 'America/Sao_Paulo'))
    into v_total, v_agora
  from public.leads l
  join public.tickets t
    on t.lead_id = l.id and t.status = 'open' and t.stage_id = p_stage_id
  join public.ai_config ac on ac.clinic_id = l.clinic_id
  join lateral (
    select cm.direction as last_dir, cm.created_at as last_at
      from public.chat_messages cm where cm.lead_id = l.id
     order by cm.seq desc limit 1
  ) lm on true
  left join lateral (
    select cm.created_at as last_in_at
      from public.chat_messages cm where cm.lead_id = l.id and cm.direction = 'inbound'
     order by cm.seq desc limit 1
  ) lin on true
  where l.clinic_id = p_clinic_id
    and l.followup_enabled = true
    and l.ai_enabled = true
    and l.handoff_triggered_at is null
    and l.converted_patient_id is null
    and coalesce(l.is_not_lead, false) = false
    and l.phone is not null and l.phone <> ''
    and not exists (select 1 from public.lead_followup_optout o
                     where o.lead_id = l.id and o.kind = 'reengagement')
    and not exists (select 1 from public.tickets tg
                     where tg.lead_id = l.id and tg.outcome = 'ganho')
    and not exists (select 1 from public.appointments a
                      join public.tickets t2 on t2.id = a.ticket_id
                     where t2.lead_id = l.id
                       and a.status in ('pendente','confirmado')
                       and ((a.date + a."time") at time zone 'America/Sao_Paulo') > now())
    and lm.last_dir = 'outbound'
    and lm.last_at >= ((now() at time zone 'America/Sao_Paulo')
                        - (coalesce(ac.followup_max_idle_days, 7) || ' days')::interval);

  return jsonb_build_object(
    'total', coalesce(v_total, 0),
    'elegiveis_agora', coalesce(v_agora, 0),
    'por_tick', 5,
    'intervalo_min', 30);
end;
$function$;

comment on function public.preview_regua_por_etapa(uuid, uuid, int) is
  'Prévia do público da régua de uma etapa: total de contatos da coluna que passam nos gates duráveis do reengajamento e quantos já estariam vencidos no primeiro tick com o delay informado.';

revoke all on function public.preview_regua_por_etapa(uuid, uuid, int) from public, anon, authenticated;
grant execute on function public.preview_regua_por_etapa(uuid, uuid, int) to authenticated, service_role;
