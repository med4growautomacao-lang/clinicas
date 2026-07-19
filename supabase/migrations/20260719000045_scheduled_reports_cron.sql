-- Fase D: relatórios agendados. Cron horário (min 5) varre report_settings
-- habilitados; quando hora/dia (SP) batem e ainda não houve envio agendado hoje,
-- envia pelo WhatsApp da org (send_clinic_report). Janela = últimos period_days
-- dias completos (ontem para trás). Falha de uma clínica não derruba as demais.
-- (Aplicada em produção via MCP como 'scheduled_reports_cron'.)

create or replace function public.run_scheduled_reports()
returns int
language plpgsql security definer set search_path to 'public'
as $function$
declare
  r record;
  v_now_sp timestamp := now() at time zone 'America/Sao_Paulo';
  v_from date; v_to date;
  v_res jsonb;
  v_count int := 0;
begin
  for r in
    select rs.*
    from report_settings rs
    join clinics c on c.id = rs.clinic_id
    where rs.schedule_enabled
      and cardinality(rs.recipients) > 0
      and coalesce(c.is_active, true)
      and rs.send_hour = extract(hour from v_now_sp)::int
      and (rs.cadence = 'daily' or rs.send_weekday = extract(dow from v_now_sp)::int)
      and not exists (
        select 1 from report_sends s
        where s.clinic_id = rs.clinic_id and s.trigger = 'scheduled'
          and (s.sent_at at time zone 'America/Sao_Paulo')::date = v_now_sp::date)
  loop
    begin
      v_to := v_now_sp::date - 1;                    -- ontem (último dia completo)
      v_from := v_now_sp::date - r.period_days;      -- N dias completos
      v_res := send_clinic_report(r.clinic_id, r.kind, v_from, v_to, v_from, v_to, v_from, v_to, 'scheduled');
      if coalesce((v_res->>'success')::boolean, false) then
        v_count := v_count + 1;
      else
        perform log_system_error('report_schedule','scheduled_send_skipped',
          'Relatório agendado não enviado: ' || coalesce(v_res->>'error','erro desconhecido'),
          'warning', r.clinic_id, v_res, false);
      end if;
    exception when others then
      perform log_system_error('report_schedule','scheduled_send_failed',
        'Falha no envio do relatório agendado', 'error',
        r.clinic_id, jsonb_build_object('detail', sqlerrm), false);
    end;
  end loop;
  return v_count;
end;
$function$;

revoke execute on function public.run_scheduled_reports() from anon, authenticated;

select cron.schedule('run_scheduled_reports', '5 * * * *', 'select public.run_scheduled_reports();');
