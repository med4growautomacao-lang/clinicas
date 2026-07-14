-- O contador de uma CONDIÇÃO não pode subir a cada verificação.
--
-- O monitor roda de 5 em 5 min. Como `occurrences` incrementava em toda reincidência, um WhatsApp
-- caído acumularia 288 "ocorrências" por dia — número que não significa nada e que ainda ordena a
-- lista errado, jogando a condição mais VELHA para o topo em vez da mais grave.
--
-- Para condição, o que importa é HÁ QUANTO TEMPO ela dura (first_seen_at → last_seen_at), não
-- quantas vezes olhamos. O contador fica reservado para EVENTO, onde "51 welcome falharam" é
-- exatamente a informação que se quer ver.

create or replace function public.log_system_error(
  p_scope      text,
  p_code       text,
  p_title      text,
  p_level      text    default 'error',
  p_clinic_id  uuid    default null,
  p_context    jsonb   default null,
  p_is_monitor boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_fp text;
  v_id uuid;
begin
  -- A clínica entra no fingerprint DE PROPÓSITO: "token bloqueado" é um problema por clínica, e
  -- juntar todas numa linha só esconderia quantas estão afetadas — que é o dado acionável.
  v_fp := md5(p_scope || '|' || p_code || '|' || coalesce(p_clinic_id::text, '-'));

  insert into public.system_errors as e (
    fingerprint, scope, code, level, title, clinic_id, is_monitor, last_context
  ) values (
    v_fp, p_scope, p_code, coalesce(p_level, 'error'), p_title, p_clinic_id,
    coalesce(p_is_monitor, false), p_context
  )
  on conflict (fingerprint) do update set
    -- Evento conta; condição só atualiza "visto agora".
    occurrences  = e.occurrences + case when coalesce(excluded.is_monitor, false) then 0 else 1 end,
    last_seen_at = now(),
    title        = excluded.title,
    level        = excluded.level,
    last_context = coalesce(excluded.last_context, e.last_context),
    -- Voltou a acontecer depois de resolvido? Reabre — senão a recaída fica invisível.
    status       = case when e.status = 'resolved' then 'open' else e.status end,
    resolved_at  = case when e.status = 'resolved' then null  else e.resolved_at end
  returning e.id into v_id;

  return v_id;
end;
$function$;

update public.system_errors set occurrences = 1 where is_monitor;
