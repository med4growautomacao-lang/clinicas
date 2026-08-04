-- A uazapi as vezes se recupera sozinha e manda 'connected' por webhook sem passar
-- por 'connecting'. A maquina de estados recusava essa aresta, e o sinal de volta
-- era JOGADO FORA. Aconteceu de verdade na clinica Tyago em 28/06/2026:
--   18:31:41  webhook 'disconnected'
--   18:33:44  webhook 'connected'  -> RECUSADO ("transicao invalida")
--   29/06 09:00  o cron finalmente conserta
-- 14h28 de silencio, com a recuperacao parada na porta desde o segundo minuto.
--
-- O cron ja contornava fazendo o pulo disconnected -> connecting -> connected
-- (whatsapp-sync-status:200). O uazapi-events nao contornava. Em vez de copiar o
-- pulo, liberamos a aresta: a janela 'connecting' tem custo proprio (o
-- fn_clinic_send_token devolve NULL nela, e o emissor grava send_blocked_until de
-- 15 min na propria instancia que esta voltando).
--
-- NAO exigimos phone_number no 'connected', de proposito: quebraria um pareamento
-- legitimo em que a uazapi ainda nao reportou o owner, e isso o cliente ve na tela.
-- O estado meio-vivo (connected sem numero, em que o envio volta mas o agente
-- recusa todo turno) vira ALARME na Central, no monitor da migration seguinte.
create or replace function public.enforce_whatsapp_state_machine()
 returns trigger
 language plpgsql
 set search_path to 'public', 'extensions'
as $function$
declare
  v_allowed boolean;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  v_allowed := case
    when old.status = 'disconnected' and new.status = 'connecting'   then true
    when old.status = 'disconnected' and new.status = 'connected'    then true  -- volta espontanea da uazapi
    when old.status = 'connecting'   and new.status = 'connected'    then true
    when old.status = 'connecting'   and new.status = 'disconnected' then true
    when old.status = 'connected'    and new.status = 'disconnected' then true
    else false
  end;

  if not v_allowed then
    raise exception 'whatsapp_state_machine: transição inválida % -> %', old.status, new.status
      using errcode = '23514';
  end if;

  if new.status = 'connecting' then
    if new.attempt_id is null then
      new.attempt_id := gen_random_uuid();
    end if;
    if new.attempt_started_at is null then
      new.attempt_started_at := now();
    end if;
  elsif new.status = 'connected' then
    new.qr_code := null;
    new.qr_expires_at := null;
    new.attempt_id := null;
    new.attempt_started_at := null;
    new.last_error := null;
    if new.connected_at is null then
      new.connected_at := now();
    end if;
  elsif new.status = 'disconnected' then
    new.qr_code := null;
    new.qr_expires_at := null;
    new.attempt_id := null;
    new.attempt_started_at := null;
    new.connected_at := null;
    new.phone_number := null;
  end if;

  new.last_event_at := now();
  return new;
end;
$function$;
