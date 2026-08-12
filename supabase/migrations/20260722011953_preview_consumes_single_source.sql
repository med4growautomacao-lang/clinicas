-- 20260722011953_preview_consumes_single_source
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- O preview passa a consumir fn_followup_candidates_*, as MESMAS funções que os motores usam.
-- Não há mais cópia do predicado: a única diferença com o motor é o que deve ser diferente, o
-- toggle (que é justamente o que está prestes a ser ligado) e o corte de tempo (o preview quer o
-- futuro, o motor só o presente). Se alguém mudar um gate, os dois mudam juntos, por construção.
create or replace function public.preview_followup_activation(
  p_clinic_id uuid,
  p_kind      text
) returns jsonb
 language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_now   timestamp := now() at time zone 'America/Sao_Paulo';
  v_hour  int       := extract(hour from (now() at time zone 'America/Sao_Paulo'));
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

  select wi.status, wi.api_token, wi.send_blocked_until into v_wa
    from whatsapp_instances wi where wi.clinic_id = p_clinic_id
   order by (wi.status = 'connected') desc nulls last limit 1;

  v_wa_ok := coalesce(v_wa.status = 'connected', false)
             and v_wa.api_token is not null and btrim(v_wa.api_token) <> ''
             and (v_wa.send_blocked_until is null or v_wa.send_blocked_until <= now());

  create temp table if not exists _fu_prev (
    lead_id uuid, nome text, telefone text, quando timestamp, detalhe text
  ) on commit drop;
  truncate table _fu_prev;

  if p_kind = 'welcome' then
    v_cap := 3; v_tick := 1;
    insert into _fu_prev
    select c.lead_id, c.nome, c.telefone, c.eligible_at, 'lead de formulário'
      from fn_followup_candidates_welcome(p_clinic_id) c;
    select max(window_start), max(window_end) into v_win_start, v_win_end
      from fn_followup_candidates_welcome(p_clinic_id);

  elsif p_kind = 'reengagement' then
    v_cap := 5; v_tick := 15;
    insert into _fu_prev
    select c.lead_id, c.nome, c.telefone, c.eligible_at,
           'passo ' || c.step_no || case when c.is_closing then ' (encerra o atendimento)' else '' end
      from fn_followup_candidates_reengagement(p_clinic_id) c;
    select max(window_start), max(window_end) into v_win_start, v_win_end
      from fn_followup_candidates_reengagement(p_clinic_id);

  elsif p_kind = 'confirmation' then
    v_cap := 5; v_tick := 1;
    insert into _fu_prev
    select c.lead_id, c.nome, c.telefone, c.eligible_at,
           'consulta ' || substr(c.data_consulta,1,5) || ' às ' || c.hora_consulta
      from fn_followup_candidates_confirmation(p_clinic_id) c;
    select max(window_start), max(window_end) into v_win_start, v_win_end
      from fn_followup_candidates_confirmation(p_clinic_id);

  elsif p_kind in ('pos_ganho','pos_perdido') then
    v_cap := 5; v_tick := 15;
    insert into _fu_prev
    select c.lead_id, c.nome, c.telefone, c.eligible_at,
           'ticket ' || c.outcome || ' encerrado'
      from fn_followup_candidates_pos(p_clinic_id) c
     where c.outcome = case when p_kind = 'pos_ganho' then 'ganho' else 'perdido' end
       and c.expires_at >= v_now;
    v_win_start := 8; v_win_end := 20;

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
         -- 'service' = fechou SEM mudar o outcome. finalize_ticket grava os dois no mesmo statement
         -- (outcome_at = closed_at) e dispara ganho/perdido, não service.
         or (p_kind = 'finish_service' and t.status = 'closed'
             and t.closed_at >= now() - interval '7 days'
             and (t.outcome is null or t.outcome_at is distinct from t.closed_at))
       );
  else
    raise exception 'p_kind inválido: %', p_kind;
  end if;

  if not v_is_trigger then
    v_win_start := coalesce(v_win_start, 6);
    v_win_end   := coalesce(v_win_end, 22);
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
