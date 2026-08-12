-- Ponte: o que JÁ era gravado como falha passa a aparecer na Central.
--
-- As edges disparadas por WEBHOOK (não por cron) são invisíveis ao coletor do pg_net — ele só vê o
-- que o banco chamou. Mas elas não são mudas: já registram as próprias falhas em tabelas nossas.
--
--   automation_logs (status='failed') → welcome de formulário e reengajamento.
--                                        Havia 56 welcome e 32 follow-ups falhados. Invisíveis.
--   whatsapp_events (event_type error/timeout) → whatsapp-orchestrator e uazapi-events.
--
-- Fazer a ponte por TRIGGER, em vez de instrumentar as edges, evita redeployar funções grandes e
-- sensíveis (o orchestrator provisiona instância e importa módulo compartilhado) só para adicionar
-- uma linha de log. E cobre de graça qualquer coisa futura que escreva nessas tabelas.
--
-- A agregação por fingerprint (scope|code|clinic_id) é o que impede isso de virar enxurrada: 56
-- falhas de welcome numa clínica viram UMA linha com contador 56, não 56 linhas.

begin;

-- ---------------------------------------------------------------------------
-- 1) Falha de automação (welcome / reengajamento)
-- ---------------------------------------------------------------------------
create or replace function public.fn_bridge_automation_error()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_motivo text;
begin
  if coalesce(new.status, '') <> 'failed' then
    return null;
  end if;

  -- `metadata.reason` é onde a edge guarda o porquê (not_on_whatsapp, infra_unavailable…).
  v_motivo := coalesce(
    new.metadata->>'reason',
    new.metadata->'uazapi'->>'error',
    'sem detalhe'
  );

  perform public.log_system_error(
    'automacao',
    coalesce(new.type, 'desconhecida') || '_falhou',
    'Falha no envio (' || coalesce(new.type, '?') || '): ' || v_motivo,
    'error',
    new.clinic_id,
    jsonb_build_object('tipo', new.type, 'motivo', v_motivo, 'lead_id', new.lead_id,
                       'metadata', new.metadata)
  );

  return null;
end;
$function$;

drop trigger if exists trg_bridge_automation_error on public.automation_logs;
create trigger trg_bridge_automation_error
  after insert on public.automation_logs
  for each row execute function public.fn_bridge_automation_error();

-- ---------------------------------------------------------------------------
-- 2) Falha do WhatsApp (orchestrator / uazapi-events)
-- ---------------------------------------------------------------------------
create or replace function public.fn_bridge_whatsapp_error()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_etapa text;
begin
  if coalesce(new.event_type, '') not in ('error', 'timeout') then
    return null;
  end if;

  v_etapa := coalesce(new.payload->>'stage', new.event_type);

  perform public.log_system_error(
    'whatsapp',
    'evento_' || new.event_type || '_' || v_etapa,
    'WhatsApp: ' || v_etapa || ' — ' || coalesce(new.payload->>'error', 'sem detalhe'),
    'error',
    new.clinic_id,
    jsonb_build_object('evento', new.event_type, 'origem', new.source, 'payload', new.payload)
  );

  return null;
end;
$function$;

drop trigger if exists trg_bridge_whatsapp_error on public.whatsapp_events;
create trigger trg_bridge_whatsapp_error
  after insert on public.whatsapp_events
  for each row execute function public.fn_bridge_whatsapp_error();

commit;

-- ---------------------------------------------------------------------------
-- 3) Backfill dos últimos 7 dias — só o recente. Ressuscitar falha de meses atrás encheria o painel
--    de problema que já não existe, que é justamente o que faz as pessoas pararem de olhar.
-- ---------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select * from automation_logs
    where status = 'failed'
      and triggered_at > (now() at time zone 'America/Sao_Paulo') - interval '7 days'
  loop
    perform public.log_system_error(
      'automacao',
      coalesce(r.type, 'desconhecida') || '_falhou',
      'Falha no envio (' || coalesce(r.type, '?') || '): '
        || coalesce(r.metadata->>'reason', r.metadata->'uazapi'->>'error', 'sem detalhe'),
      'error', r.clinic_id,
      jsonb_build_object('tipo', r.type, 'motivo', coalesce(r.metadata->>'reason', 'sem detalhe'),
                         'lead_id', r.lead_id, 'metadata', r.metadata)
    );
  end loop;
end $$;
