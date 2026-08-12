-- Roteamento por ORIGEM DE TOKEN no Emissor, para o send_clinic_report caber.
-- O relatorio comercial sai pelo WhatsApp da ORGANIZACAO (token por org_id), nao da clinica. O gate
-- do worker resolvia so por clinic_id. Adiciona send_as ('clinic'|'org') e um resolvedor unico.

alter table public.outbound_messages add column if not exists send_as text not null default 'clinic'
  check (send_as in ('clinic','org'));

-- Resolvedor unico: 'org' pega o token da instancia da ORG da clinica; 'clinic' usa o gate canonico.
create or replace function public.fn_outbound_token(p_clinic_id uuid, p_send_as text default 'clinic')
returns text language sql stable security definer set search_path to 'public'
as $$
  select case
    when p_send_as = 'org' then (
      select wi.api_token
        from public.whatsapp_instances wi
        join public.clinics c on c.organization_id = wi.org_id
       where c.id = p_clinic_id
         and wi.status = 'connected'
         and wi.api_token is not null and btrim(wi.api_token) <> ''
         and (wi.send_blocked_until is null or wi.send_blocked_until <= now())
       order by wi.connected_at desc nulls last
       limit 1
    )
    else public.fn_clinic_send_token(p_clinic_id)
  end
$$;

-- emit_message ganha p_send_as (append no fim: chamadas nomeadas e posicionais seguem validas).
drop function if exists public.emit_message(uuid,text,text,text,text,uuid,text,text,text,text,text,int,text,text,timestamptz,jsonb,text);

create or replace function public.emit_message(
  p_clinic_id     uuid,
  p_to_addr       text,
  p_producer      text,
  p_body          text        default null,
  p_kind          text        default 'text',
  p_lead_id       uuid        default null,
  p_to_kind       text        default 'lead',
  p_media_url     text        default null,
  p_media_base64  text        default null,
  p_media_mime    text        default null,
  p_media_kind    text        default null,
  p_delay_ms      int         default 0,
  p_dedup_key     text        default null,
  p_transport     text        default null,
  p_not_before    timestamptz default null,
  p_chat_payload  jsonb       default null,
  p_media_filename text       default null,
  p_send_as       text        default 'clinic'
) returns uuid
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_addr text; v_transport text; v_simulado boolean := false; v_id uuid;
begin
  if p_clinic_id is null or coalesce(btrim(p_to_addr), '') = '' then
    raise exception 'emit_message: clinic_id e to_addr sao obrigatorios';
  end if;
  v_addr := case when p_to_kind = 'lead' then coalesce(normalize_br_phone(p_to_addr), btrim(p_to_addr))
                 else btrim(p_to_addr) end;
  if p_lead_id is not null then
    select coalesce(is_simulation, false) into v_simulado from public.leads where id = p_lead_id;
  end if;
  v_transport := coalesce(p_transport, case when v_simulado then 'sandbox' else 'uazapi' end);

  insert into public.outbound_messages (
    clinic_id, lead_id, to_addr, to_kind, kind, body,
    media_url, media_base64, media_mime, media_kind, media_filename,
    delay_ms, transport, producer, conversation_key, dedup_key, not_before, chat_payload, send_as
  ) values (
    p_clinic_id, p_lead_id, v_addr, p_to_kind, p_kind, p_body,
    p_media_url, p_media_base64, p_media_mime, p_media_kind, p_media_filename,
    coalesce(p_delay_ms, 0), v_transport, p_producer,
    p_clinic_id::text || '|' || v_addr, p_dedup_key, coalesce(p_not_before, now()), p_chat_payload,
    coalesce(p_send_as, 'clinic')
  )
  on conflict (dedup_key) where dedup_key is not null do nothing
  returning id into v_id;

  if v_id is null and p_dedup_key is not null then
    select id into v_id from public.outbound_messages where dedup_key = p_dedup_key;
  end if;
  return v_id;
end $$;

revoke all on function public.emit_message(uuid,text,text,text,text,uuid,text,text,text,text,text,int,text,text,timestamptz,jsonb,text,text) from anon, authenticated;

-- Falha de infra num envio de ORG NAO pode bloquear a instancia da CLINICA (senao um relatorio
-- derruba as mensagens de paciente). So bloqueia a instancia quando send_as='clinic'.
create or replace function public.mark_outbound_infra_blocked(
  p_id uuid, p_clinic_id uuid, p_until timestamptz, p_error text
) returns void language plpgsql security definer set search_path to 'public'
as $$
declare r public.outbound_messages; v_until timestamptz := coalesce(p_until, now() + interval '15 minutes');
begin
  select * into r from public.outbound_messages where id = p_id;
  if not found then return; end if;

  if r.send_as = 'clinic' then
    update public.whatsapp_instances
       set send_blocked_until = greatest(coalesce(send_blocked_until, v_until), v_until)
     where clinic_id = p_clinic_id;
  end if;

  if r.created_at < now() - interval '24 hours' then
    update public.outbound_messages
       set status = 'dropped', last_error = 'WhatsApp indisponível por mais de 24h: ' || coalesce(p_error,'')
     where id = p_id;
    perform public.log_system_error('emissor','infra_descartada',
      'Mensagem descartada: WhatsApp indisponível por mais de 24h', 'critical', p_clinic_id,
      jsonb_build_object('outbound_id', p_id, 'lead_id', r.lead_id, 'producer', r.producer), false);
    return;
  end if;

  update public.outbound_messages
     set status = 'pending', not_before = v_until, attempts = greatest(r.attempts - 1, 0),
         claimed_at = null, claimed_by = null,
         last_error = coalesce(p_error, 'WhatsApp indisponível (infra)')
   where id = p_id;
end $$;