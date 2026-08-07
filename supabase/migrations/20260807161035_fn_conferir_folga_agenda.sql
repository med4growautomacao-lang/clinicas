-- AVISO DE ENCAIXE COLADO (para a tela de Agendamentos)
-- Motivo (07/08/2026): a recepcao encaixa forcado de proposito (Appointments.tsx manda p_force),
-- e e assim que nasce consulta sem folga. A decisao do dono foi NAO bloquear, e sim avisar antes
-- de confirmar. Esta funcao devolve a conta pronta, com a mesma regua da oferta automatica:
-- exigido = duracao da consulta anterior + GREATEST(intervalo depois dela, intervalo antes desta).
--
-- SECURITY INVOKER de proposito: assim a RLS de appointments/doctors/consultation_types continua
-- valendo e ninguem enxerga agenda de outra clinica por aqui. Nao devolve nome de paciente.
create or replace function public.fn_conferir_folga_agenda(
  p_doctor_id uuid,
  p_date date,
  p_time time without time zone,
  p_consultation_type_id uuid,
  p_appointment_id uuid default null
) returns jsonb
language plpgsql
stable
as $$
declare
  v_dur int; v_buf_antes int; v_buf_depois int;
  v_ant record; v_pos record;
  v_exig_antes int; v_folga_antes int;
  v_exig_depois int; v_folga_depois int;
  v_msgs text[] := array[]::text[];
begin
  select coalesce(ct.consultation_duration, d.consultation_duration, 60),
         coalesce(ct.buffer_before_minutes, 0), coalesce(ct.buffer_after_minutes, 0)
    into v_dur, v_buf_antes, v_buf_depois
    from consultation_types ct join doctors d on d.id = ct.doctor_id
   where ct.id = p_consultation_type_id;

  if v_dur is null then
    return jsonb_build_object('colado', false, 'motivo', 'tipo_de_consulta_nao_encontrado');
  end if;

  -- vizinha imediatamente ANTES
  select a.time,
         coalesce(a.duration_minutes, ct.consultation_duration, 60) as dur,
         coalesce(ct.buffer_after_minutes, 0) as buf_depois
    into v_ant
    from appointments a left join consultation_types ct on ct.id = a.consultation_type_id
   where a.doctor_id = p_doctor_id and a.date = p_date
     and coalesce(a.status, '') not in ('cancelado', 'faltou')
     and (p_appointment_id is null or a.id <> p_appointment_id)
     and a.time <= p_time
   order by a.time desc limit 1;

  -- vizinha imediatamente DEPOIS
  select a.time, coalesce(ct.buffer_before_minutes, 0) as buf_antes
    into v_pos
    from appointments a left join consultation_types ct on ct.id = a.consultation_type_id
   where a.doctor_id = p_doctor_id and a.date = p_date
     and coalesce(a.status, '') not in ('cancelado', 'faltou')
     and (p_appointment_id is null or a.id <> p_appointment_id)
     and a.time > p_time
   order by a.time asc limit 1;

  if v_ant.time is not null then
    v_exig_antes := v_ant.dur + greatest(v_ant.buf_depois, v_buf_antes);
    v_folga_antes := (extract(epoch from (p_time - v_ant.time)) / 60)::int;
    if v_folga_antes < v_exig_antes then
      v_msgs := v_msgs || format(
        'A consulta anterior comeca as %s e ocupa %s min; sobram %s min ate este horario, e a configuracao pede %s.',
        to_char(v_ant.time, 'HH24:MI'), v_ant.dur, v_folga_antes, v_exig_antes);
    end if;
  end if;

  if v_pos.time is not null then
    v_exig_depois := v_dur + greatest(v_buf_depois, v_pos.buf_antes);
    v_folga_depois := (extract(epoch from (v_pos.time - p_time)) / 60)::int;
    if v_folga_depois < v_exig_depois then
      v_msgs := v_msgs || format(
        'A proxima consulta comeca as %s, ou seja %s min depois desta, e a configuracao pede %s.',
        to_char(v_pos.time, 'HH24:MI'), v_folga_depois, v_exig_depois);
    end if;
  end if;

  return jsonb_build_object(
    'colado', array_length(v_msgs, 1) is not null,
    'mensagem', array_to_string(v_msgs, ' '),
    'antes', case when v_ant.time is null then null else jsonb_build_object(
      'hora', to_char(v_ant.time, 'HH24:MI'), 'folga_min', v_folga_antes, 'exigido_min', v_exig_antes) end,
    'depois', case when v_pos.time is null then null else jsonb_build_object(
      'hora', to_char(v_pos.time, 'HH24:MI'), 'folga_min', v_folga_depois, 'exigido_min', v_exig_depois) end
  );
end; $$;

revoke all on function public.fn_conferir_folga_agenda(uuid, date, time, uuid, uuid) from public, anon, authenticated;
grant execute on function public.fn_conferir_folga_agenda(uuid, date, time, uuid, uuid) to authenticated;
