-- Estado meio-vivo: status='connected' com phone_number NULL.
-- Nesse estado o fn_clinic_send_token LIBERA o envio (so olha status) mas o
-- fn_chat_session_id devolve NULL, e o agente RECUSA 100% dos turnos. O monitor
-- whatsapp_desconectado nao ve nada, porque so olha status. Falha muda.
--
-- Ficou alcancavel agora que a aresta disconnected -> connected foi liberada:
-- basta o webhook trazer 'connected' sem 'owner' e a busca do numero falhar.
-- Preferimos ALARME a uma trava na trigger: travar quebraria um pareamento
-- legitimo, e isso o cliente ve na tela.
--
-- Cirurgia no texto da funcao (pg_get_functiondef + position/replace + execute):
-- run_system_monitors e grande e reescreve-la a mao arrisca derrubar bloco alheio.
do $cirurgia$
declare
  v_def   text;
  v_ancora text;
  v_novo  text;
  v_pos   int;
begin
  select pg_get_functiondef(oid) into v_def
  from pg_proc where proname = 'run_system_monitors';

  v_ancora := '  for r in
    select c.id as clinic_id, c.name, wi.send_blocked_until';

  v_pos := position(v_ancora in v_def);
  if v_pos = 0 then
    raise exception 'ancora nao encontrada em run_system_monitors: abortado sem alterar nada';
  end if;

  if position('whatsapp_sem_numero' in v_def) > 0 then
    raise notice 'bloco ja existe, nada a fazer';
    return;
  end if;

  v_novo := '  for r in
    select c.id as clinic_id, c.name
    from whatsapp_instances wi
    join clinics c on c.id = wi.clinic_id
    where wi.status = ''connected''
      and coalesce(wi.phone_number, '''') = ''''
      and c.is_active
  loop
    v_tocados := v_tocados || md5(''monitor|whatsapp_sem_numero|'' || r.clinic_id::text);
    perform public.log_system_error(
      ''monitor'', ''whatsapp_sem_numero'',
      ''WhatsApp conectado mas SEM numero (o agente recusa todo turno): '' || r.name,
      ''critical'', r.clinic_id, jsonb_build_object(''status'', ''connected''), true
    );
    n_mon := n_mon + 1;
  end loop;

' || v_ancora;

  v_def := substr(v_def, 1, v_pos - 1) || v_novo || substr(v_def, v_pos + length(v_ancora));

  execute v_def;
  raise notice 'bloco whatsapp_sem_numero instalado';
end
$cirurgia$;
