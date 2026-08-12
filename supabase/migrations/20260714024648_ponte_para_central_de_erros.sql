-- 20260714024648_ponte_para_central_de_erros
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

begin;

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
