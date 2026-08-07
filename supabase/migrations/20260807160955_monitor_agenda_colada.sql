-- VIGIA DE AGENDA COLADA
-- Motivo (07/08/2026): o par colado da Lorena (12/08, 18:00 e 18:45, zero minuto onde ela pede 10)
-- so apareceu porque a cliente reclamou e alguem foi olhar a mao. A oferta automatica nao produz
-- isso desde o fix de 08/07; quem produz e o encaixe forcado da recepcao, que e permitido de
-- proposito. Por isso o nivel e 'warn': nao e defeito de codigo, e um aviso de operacao.
--
-- O bloco e acrescentado por replace no corpo vivo da funcao, e nao redigitando os 36 mil
-- caracteres dela: reescrever run_system_monitors na mao e como um dos monitores morrer sem
-- ninguem notar. Idempotente: se o bloco ja existir, nao faz nada.
do $mig$
declare
  v_src text;
  v_novo text;
  v_bloco text;
begin
  select p.prosrc into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'run_system_monitors';

  if v_src is null then
    raise exception 'run_system_monitors nao encontrada';
  end if;

  if position('agenda_colada' in v_src) > 0 then
    raise notice 'bloco agenda_colada ja existe; nada a fazer';
    return;
  end if;

  if (select count(*) from regexp_matches(v_src, '  update public\.system_errors', 'g')) <> 1 then
    raise exception 'ancora do auto-resolve nao e unica; abortando para nao corromper a funcao';
  end if;

  v_bloco := $novo$
  -- (h) Agenda colada: consulta FUTURA com intervalo menor que o que a propria clinica configurou.
  -- Regua IDENTICA a de get_available_slots: exigido = duracao da 1a + GREATEST(intervalo depois
  -- da 1a, intervalo antes da 2a). Se divergir da funcao de oferta, o painel passa a acusar o que
  -- o motor permite, que e a pior especie de alarme falso.
  -- So olha quem CONFIGUROU intervalo (greatest > 0): clinica com intervalo zero nao tem o que
  -- violar, e sobreposicao de verdade ja e barrada pelo indice de exclusao.
  begin
    for r in
      with agenda as (
        select a.clinic_id, a.doctor_id, a.date, a.time,
               coalesce(a.duration_minutes, ct.consultation_duration, d.consultation_duration, 60) as dur,
               coalesce(ct.buffer_after_minutes, 0) as buf_depois,
               coalesce(ct.buffer_before_minutes, 0) as buf_antes
          from appointments a
          join doctors d on d.id = a.doctor_id
          left join consultation_types ct on ct.id = a.consultation_type_id
         where a.date >= (now() at time zone 'America/Sao_Paulo')::date
           and coalesce(a.status, '') not in ('cancelado', 'faltou')
      ), pares as (
        select clinic_id, date, time as hora_1, dur, buf_depois,
               lead(time) over (partition by clinic_id, doctor_id, date order by time) as hora_2,
               lead(buf_antes) over (partition by clinic_id, doctor_id, date order by time) as buf_antes_2
          from agenda
      )
      select p.clinic_id, c.name, count(*) as pares,
             min(p.date) as primeiro_dia,
             min(to_char(p.date, 'DD/MM') || ' ' || to_char(p.hora_1, 'HH24:MI')) as exemplo
        from pares p
        join clinics c on c.id = p.clinic_id
       where p.hora_2 is not null
         and greatest(p.buf_depois, coalesce(p.buf_antes_2, 0)) > 0
         and (p.hora_2 - p.hora_1) < make_interval(mins => p.dur + greatest(p.buf_depois, coalesce(p.buf_antes_2, 0)))
       group by p.clinic_id, c.name
    loop
      v_tocados := v_tocados || md5('monitor|agenda_colada|' || r.clinic_id::text);
      perform public.log_system_error(
        'monitor', 'agenda_colada',
        r.pares || ' consulta(s) futura(s) sem o intervalo configurado entre elas: ' || r.name,
        'warn', r.clinic_id,
        jsonb_build_object(
          'pares', r.pares, 'primeiro_dia', r.primeiro_dia, 'exemplo', r.exemplo,
          'obs', 'Quase sempre e encaixe manual da recepcao, que pula a validacao de proposito. '
              || 'Conferir appointment_changes.forcado para saber se foi encaixe e quem fez.'),
        true
      );
      n_mon := n_mon + 1;
    end loop;
  exception when others then
    v_tocados := v_tocados
      || md5('monitor|monitor_falhou_agenda_colada|-')
      || coalesce((select array_agg(e.fingerprint) from public.system_errors e
                    where e.is_monitor and e.status <> 'resolved'
                      and e.code = 'agenda_colada'), array[]::text[]);
    perform public.log_system_error(
      'monitor', 'monitor_falhou_agenda_colada',
      'A vigilancia de agenda colada parou de rodar (esse risco ficou sem vigia)',
      'error', null, jsonb_build_object('erro', SQLERRM, 'sqlstate', SQLSTATE), true
    );
    n_falhas := n_falhas + 1;
  end;

$novo$;

  v_novo := replace(v_src, '  update public.system_errors', v_bloco || '  update public.system_errors');

  execute 'create or replace function public.run_system_monitors() returns jsonb '
       || 'language plpgsql security definer set search_path to ''public'' as $f$'
       || v_novo || '$f$';
end $mig$;
