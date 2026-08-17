-- O aviso de encaixe da recepcao passa a enxergar tambem o BLOQUEIO da agenda.
--
-- A tela de agendamento manual reagenda com p_force=true (encaixe da recepcao, flexibilidade
-- comprada de proposito), entao a validacao do motor nao roda e o unico freio e este aviso.
-- Ele so olhava consulta vizinha: encaixar por cima de um compromisso pessoal da medica
-- (blocked_times) passava MUDO. O proprio comentario da tela promete "a MESMA regua da oferta
-- automatica, para tela e motor nunca discordarem", e a regua da oferta inclui bloqueio.
--
-- Mesma conta da oferta automatica: o que precisa estar livre e a consulta MAIS os buffers.
-- Continua sendo AVISO, nunca trava (decisao do dono, 07/08/2026).
CREATE OR REPLACE FUNCTION public.fn_conferir_folga_agenda(p_doctor_id uuid, p_date date, p_time time without time zone, p_consultation_type_id uuid, p_appointment_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $function$
declare
  v_dur int; v_buf_antes int; v_buf_depois int;
  v_ant record; v_pos record;
  v_exig_antes int; v_folga_antes int;
  v_exig_depois int; v_folga_depois int;
  v_msgs text[] := array[]::text[];
  v_probe tsrange; v_blk jsonb; v_blk_ini time; v_blk_fim time;
  v_blocked jsonb; v_bloqueios jsonb := '[]'::jsonb;
begin
  select coalesce(ct.consultation_duration, d.consultation_duration, 60),
         coalesce(ct.buffer_before_minutes, 0), coalesce(ct.buffer_after_minutes, 0),
         coalesce(d.blocked_times, '[]'::jsonb)
    into v_dur, v_buf_antes, v_buf_depois, v_blocked
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

  -- BLOQUEIO: mesma regua da oferta automatica (consulta + buffers dos dois lados).
  v_probe := tsrange(
    (p_date + p_time)::timestamp - make_interval(mins => v_buf_antes),
    (p_date + p_time)::timestamp + make_interval(mins => v_dur + v_buf_depois),
    '[)'
  );
  for v_blk in select value from jsonb_array_elements(v_blocked) where value->>'date' = p_date::text
  loop
    v_blk_ini := (v_blk->>'start')::time;
    v_blk_fim := (v_blk->>'end')::time;
    continue when v_blk_ini is null or v_blk_fim is null or v_blk_fim <= v_blk_ini;
    if tsrange((p_date + v_blk_ini)::timestamp, (p_date + v_blk_fim)::timestamp, '[)') && v_probe then
      v_msgs := v_msgs || format(
        'Ha um bloqueio na agenda (%s) das %s as %s, e esta consulta com os intervalos configurados ocupa das %s as %s.',
        coalesce(nullif(v_blk->>'name',''), 'sem nome'),
        to_char(v_blk_ini, 'HH24:MI'), to_char(v_blk_fim, 'HH24:MI'),
        to_char(lower(v_probe), 'HH24:MI'), to_char(upper(v_probe), 'HH24:MI'));
      v_bloqueios := v_bloqueios || jsonb_build_array(jsonb_build_object(
        'nome', v_blk->>'name',
        'inicio', to_char(v_blk_ini, 'HH24:MI'),
        'fim', to_char(v_blk_fim, 'HH24:MI')));
    end if;
  end loop;

  return jsonb_build_object(
    'colado', array_length(v_msgs, 1) is not null,
    'mensagem', array_to_string(v_msgs, ' '),
    'antes', case when v_ant.time is null then null else jsonb_build_object(
      'hora', to_char(v_ant.time, 'HH24:MI'), 'folga_min', v_folga_antes, 'exigido_min', v_exig_antes) end,
    'depois', case when v_pos.time is null then null else jsonb_build_object(
      'hora', to_char(v_pos.time, 'HH24:MI'), 'folga_min', v_folga_depois, 'exigido_min', v_exig_depois) end,
    'bloqueios', v_bloqueios
  );
end; $function$;
