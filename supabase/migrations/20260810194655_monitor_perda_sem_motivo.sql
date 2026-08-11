-- Monitor: PERDA GRAVADA SEM MOTIVO.
--
-- A rede é `loss_reason_slug is null`, e não "texto sem tradução". Isso é deliberado: a maior
-- fatia de perda muda não tem texto NENHUM (vem de gatilho de etapa, agenda e ia_analise, que
-- passam pela trigger de consistência e marcam outcome='perdido' sem tocar em motivo). Um monitor
-- que exigisse `loss_reason not null` seria cego justamente para o pedaço maior.
--
-- Nasce MUDO por marco zero em system_monitor_state: as 47 perdas mudas dos últimos 7 dias são
-- reais, mas o conserto delas depende do deploy do front (Fase 0), e alarme que o dono não pode
-- resolver hoje treina ele a ignorar o painel.
--
-- ⚠️ O bloco é inserido no run_system_monitors por SUBSTITUIÇÃO no próprio DDL, não por
-- transcrição: a função tem ~1.200 linhas densas e recopiá-la à mão é como se perde um bloco sem
-- ninguém notar. O `raise exception` garante que a migration falha se a âncora não existir mais.

insert into public.system_monitor_state(monitor, cursor_at)
values ('perda_sem_motivo', now())
on conflict (monitor) do nothing;

do $mig$
declare
  v_src   text;
  v_ancora text := 'update public.system_errors' || E'\n' || '    set status = ''resolved'', resolved_at = now()';
  v_bloco text;
begin
  select pg_get_functiondef(p.oid) into v_src
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.proname = 'run_system_monitors';

  if v_src is null then
    raise exception 'run_system_monitors nao encontrada';
  end if;

  if position('perda_sem_motivo' in v_src) > 0 then
    raise notice 'bloco ja instalado, nada a fazer';
    return;
  end if;

  -- Âncora tolerante a espaçamento: acha o auto-resolve final por regex.
  if v_src !~ 'update public\.system_errors\s+set status = ''resolved''' then
    raise exception 'ancora do auto-resolve nao encontrada em run_system_monitors';
  end if;

  v_bloco := $bloco$
  -- (i) PERDA GRAVADA SEM MOTIVO nos ultimos 7 dias.
  -- Rede = loss_reason_slug is null, de proposito: pega tanto o texto sem traducao no catalogo
  -- quanto a perda que nasceu completamente muda (gatilho de etapa / agenda / ia_analise passam
  -- pela trigger de consistencia e marcam outcome sem encostar em motivo).
  -- Marco zero em system_monitor_state: so conta perda posterior a instalacao do monitor.
  begin
    select cursor_at into v_cursor from public.system_monitor_state where monitor = 'perda_sem_motivo';
    for r in
      select t.clinic_id, c.name, count(*) as perdas, min(t.outcome_at) as mais_antiga
      from public.tickets t
      join public.clinics c on c.id = t.clinic_id
      where t.outcome = 'perdido'
        and t.loss_reason_slug is null
        and t.outcome_at > greatest(coalesce(v_cursor, now()), now() - interval '7 days')
      group by t.clinic_id, c.name
    loop
      v_tocados := v_tocados || md5('monitor|perda_sem_motivo|' || r.clinic_id::text);
      perform public.log_system_error(
        'monitor', 'perda_sem_motivo',
        r.perdas || ' atendimento(s) encerrados como perdidos SEM motivo registrado: ' || r.name,
        'warn', r.clinic_id,
        jsonb_build_object(
          'perdas', r.perdas,
          'mais_antiga', r.mais_antiga,
          'obs', 'Perda sem motivo some do relatorio de motivo de perda e nao vira decisao ' ||
                 'nenhuma. Conferir: (1) caminho da tela que fecha sem abrir o modal de motivo; ' ||
                 '(2) texto novo do CRM externo sem linha em loss_reason_aliases (o alerta ' ||
                 'motivo_perda_sem_catalogo aponta qual); (3) gatilho de etapa movendo o card ' ||
                 'para Perdido, que marca o desfecho sem tocar no motivo.'),
        true
      );
      n_mon := n_mon + 1;
    end loop;
  exception when others then
    v_tocados := v_tocados || md5('monitor|monitor_falhou_perda_sem_motivo|-')
      || coalesce((select array_agg(e.fingerprint) from public.system_errors e
                    where e.is_monitor and e.status <> 'resolved' and e.code = 'perda_sem_motivo'),
                  array[]::text[]);
    perform public.log_system_error(
      'monitor', 'monitor_falhou_perda_sem_motivo',
      'A vigilancia de perda sem motivo parou de rodar (esse risco ficou sem vigia)',
      'error', null, jsonb_build_object('erro', SQLERRM, 'sqlstate', SQLSTATE), true
    );
    n_falhas := n_falhas + 1;
  end;

$bloco$;

  v_src := regexp_replace(
    v_src,
    '(update public\.system_errors\s+set status = ''resolved'')',
    replace(v_bloco, '\', '\\') || E'\\1',
    ''
  );

  execute v_src;
end
$mig$;

