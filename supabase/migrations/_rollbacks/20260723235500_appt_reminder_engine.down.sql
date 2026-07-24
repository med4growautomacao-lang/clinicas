-- Rollback do motor do Lembrete de Consulta. Restaura o preview SEM o ramo 'appt_reminder'
-- (versão da fonte 20260721000022) ANTES de dropar a função de candidatos, senão o preview fica
-- com referência pendente à fn_followup_candidates_appt_reminder.
select cron.unschedule('appt_reminder_job');
drop function if exists public.process_appointment_reminders();

-- preview restaurado à versão anterior (sem o ramo appt_reminder).
create or replace function public.preview_followup_activation(
  p_clinic_id uuid,
  p_kind      text
) returns jsonb
 language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_now   timestamp := now() at time zone 'America/Sao_Paulo';
  v_hour  int       := extract(hour from (now() at time zone 'America/Sao_Paulo'));
  v_ac    ai_config%rowtype;
  v_wa    record;
  v_in_window boolean := true;
  v_wa_ok  boolean := false;
  v_cap    int := null;  v_tick int := null;
  v_is_trigger boolean := false;
  v_agora int := 0; v_horas int := 0; v_dias int := 0; v_total_7d int := 0;
  v_sample jsonb := '[]'::jsonb;
  v_hist   int := null;
  v_win_start int; v_win_end int;
  v_drain  int := 0;
begin
  if not (
      is_super_admin()
      or is_clinic_admin(p_clinic_id)
      or exists (select 1 from clinic_users cu where cu.id = auth.uid() and cu.clinic_id = p_clinic_id)
      or exists (select 1 from clinics c join org_users ou on ou.organization_id = c.organization_id
                 where c.id = p_clinic_id and ou.user_id = auth.uid())
  ) then
    raise exception 'Sem permissão para esta clínica';
  end if;

  select * into v_ac from ai_config where clinic_id = p_clinic_id;

  select wi.status, wi.send_blocked_until into v_wa
    from whatsapp_instances wi where wi.clinic_id = p_clinic_id
   order by (wi.status = 'connected') desc nulls last limit 1;

  v_wa_ok := fn_clinic_can_send(p_clinic_id);

  create temp table if not exists _fu_prev (
    lead_id uuid, nome text, telefone text, quando timestamp, detalhe text
  ) on commit drop;
  truncate table _fu_prev;

  if p_kind = 'welcome' then
    v_cap := 3; v_tick := 1;
    v_win_start := coalesce(v_ac.welcome_window_start, 6);
    v_win_end   := coalesce(v_ac.welcome_window_end, 22);
    insert into _fu_prev
    select c.lead_id, c.nome, c.telefone, c.eligible_at, 'lead de formulário'
      from fn_followup_candidates_welcome(p_clinic_id) c;

  elsif p_kind = 'reengagement' then
    v_cap := 5; v_tick := 15;
    v_win_start := coalesce(v_ac.followup_window_start, 6);
    v_win_end   := coalesce(v_ac.followup_window_end, 22);
    insert into _fu_prev
    select c.lead_id, c.nome, c.telefone, c.eligible_at,
           'passo ' || c.step_no || case when c.is_closing then ' (encerra o atendimento)' else '' end
      from fn_followup_candidates_reengagement(p_clinic_id) c;

  elsif p_kind = 'confirmation' then
    v_cap := 5; v_tick := 1;
    v_win_start := coalesce(v_ac.confirm_window_start, 6);
    v_win_end   := coalesce(v_ac.confirm_window_end, 22);
    insert into _fu_prev
    select c.lead_id, c.nome, c.telefone, c.eligible_at,
           'consulta ' || substr(c.data_consulta,1,5) || ' às ' || c.hora_consulta
      from fn_followup_candidates_confirmation(p_clinic_id) c;

  elsif p_kind in ('pos_ganho','pos_perdido') then
    v_cap := 5; v_tick := 15;
    v_win_start := coalesce(v_ac.pos_followup_window_start, 8);
    v_win_end   := coalesce(v_ac.pos_followup_window_end, 20);
    insert into _fu_prev
    select c.lead_id, c.nome, c.telefone, c.eligible_at,
           'ticket ' || c.outcome || ' em ' || to_char(c.encerrado_em, 'DD/MM')
      from fn_followup_candidates_pos(p_clinic_id) c
     where c.outcome = case when p_kind = 'pos_ganho' then 'ganho' else 'perdido' end
       and c.expires_at >= v_now;

  elsif p_kind in ('finish_ganho','finish_perdido','finish_service') then
    v_is_trigger := true;
    select count(*) into v_hist
      from tickets t join leads l on l.id = t.lead_id
     where t.clinic_id = p_clinic_id
       and coalesce(l.is_not_lead, false) = false
       and coalesce(l.followup_enabled, true) = true
       and l.phone is not null and l.phone <> ''
       and (
            (p_kind = 'finish_ganho'   and t.outcome = 'ganho'   and t.outcome_at >= now() - interval '7 days')
         or (p_kind = 'finish_perdido' and t.outcome = 'perdido' and t.outcome_at >= now() - interval '7 days')
         or (p_kind = 'finish_service' and t.status = 'closed'
             and t.closed_at >= now() - interval '7 days'
             and (t.outcome is null or t.outcome_at is distinct from t.closed_at))
       );
  else
    raise exception 'p_kind inválido: %', p_kind;
  end if;

  if not v_is_trigger then
    v_in_window := v_hour >= v_win_start and v_hour < v_win_end;

    select
      count(*) filter (where quando <= v_now and v_in_window),
      count(*) filter (where (quando <= v_now and not v_in_window)
                          or (quando > v_now and quando <= v_now + interval '24 hours')),
      count(*) filter (where quando > v_now + interval '24 hours' and quando <= v_now + interval '7 days'),
      count(*) filter (where quando <= v_now + interval '7 days')
      into v_agora, v_horas, v_dias, v_total_7d
      from _fu_prev;

    select coalesce(jsonb_agg(jsonb_build_object(
             'lead_id',  lead_id,
             'nome',     coalesce(nullif(btrim(nome), ''), 'Sem nome'),
             'telefone', telefone,
             'detalhe',  detalhe,
             'quando',   to_char(quando, 'DD/MM HH24:MI'),
             'balde',    case when quando <= v_now and v_in_window then 'agora'
                              when quando <= v_now + interval '24 hours' then 'horas'
                              else 'dias' end
           ) order by quando), '[]'::jsonb)
      into v_sample
      from (select * from _fu_prev where quando <= v_now + interval '7 days'
             order by quando limit 50) s;

    if v_cap is not null and v_cap > 0 and v_agora > 0 then
      v_drain := ceil(v_agora::numeric / v_cap)::int * v_tick;
    end if;
  end if;

  return jsonb_build_object(
    'kind', p_kind, 'is_trigger', v_is_trigger,
    'whatsapp_ok', v_wa_ok, 'whatsapp_status', v_wa.status, 'blocked_until', v_wa.send_blocked_until,
    'in_window', v_in_window, 'window_start', v_win_start, 'window_end', v_win_end,
    'cap_por_rodada', v_cap, 'rodada_minutos', v_tick,
    'agora', v_agora, 'proximas_horas', v_horas, 'proximos_dias', v_dias, 'total_7d', v_total_7d,
    'primeiro_disparo', least(v_agora, coalesce(v_cap, v_agora)),
    'escoamento_min', v_drain, 'historico_7d', v_hist, 'amostra', v_sample
  );
exception when others then
  if sqlstate <> 'P0001' then
    perform log_system_error('followup-preview','preview_failed',
      'Falha ao calcular o preview de ativação de follow-up','error', p_clinic_id,
      jsonb_build_object('kind', p_kind, 'sqlstate', sqlstate, 'detail', sqlerrm), false);
  end if;
  raise;
end;
$function$;

drop function if exists public.fn_followup_candidates_appt_reminder(uuid);
