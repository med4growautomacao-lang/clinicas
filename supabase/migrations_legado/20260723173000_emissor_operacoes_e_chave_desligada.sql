-- EMISSOR — operacoes da fila + a chave (que nasce DESLIGADA) + a marca do simulador.
-- Nenhum produtor e alterado aqui. Depois desta migration o sistema segue enviando exatamente
-- como enviava; a fila existe, aceita mensagem e pode ser exercitada em teste sem afetar ninguem.

-- ---------------------------------------------------------------------------------------------
-- A marca do simulador. Uma coluna so: ticket, appointment, conversao e mensagens penduram no
-- lead, entao marcar o lead marca a jornada inteira. Mesmo mecanismo do `is_not_lead`, que ja
-- provou funcionar. E o que faz o Emissor rotear para 'sandbox' sem o produtor saber de nada.
alter table public.leads add column if not exists is_simulation boolean not null default false;

create index if not exists ix_leads_simulation on public.leads (clinic_id) where is_simulation;

comment on column public.leads.is_simulation is
  'Lead de ambiente de teste interno. Nao envia para o WhatsApp (Emissor roteia para sandbox), fica fora dos KPIs e e removivel pelo purge da sessao.';

-- ---------------------------------------------------------------------------------------------
-- A CHAVE. Nasce desligada e sem clinica nenhuma. Semantica deliberadamente explicita: nao existe
-- "ligou geral sem querer". Para valer para todas as clinicas e preciso escrever all=true.
insert into public.system_settings (id, value, description)
values (
  'emissor_config',
  '{"enabled": false, "all": false, "clinics": []}',
  'Chave do Emissor (fila de saida). enabled=false: cada produtor segue enviando direto, como sempre. Para migrar uma clinica: enabled=true + o id dela em clinics. all=true so quando os 13 produtores estiverem migrados e testados.'
)
on conflict (id) do nothing;

create or replace function public.fn_emissor_ativo(p_clinic_id uuid)
returns boolean
language plpgsql stable security definer set search_path to 'public'
as $$
declare v_cfg jsonb;
begin
  begin
    select coalesce(nullif(value, '')::jsonb, '{}'::jsonb) into v_cfg
      from public.system_settings where id = 'emissor_config';
  exception when others then
    return false;  -- config corrompida = desligado. Fail-closed: na duvida, caminho antigo.
  end;

  if v_cfg is null or coalesce((v_cfg->>'enabled')::boolean, false) is not true then
    return false;
  end if;
  if coalesce((v_cfg->>'all')::boolean, false) then
    return true;
  end if;
  return coalesce(v_cfg->'clinics', '[]'::jsonb) ? p_clinic_id::text;
end $$;

comment on function public.fn_emissor_ativo(uuid) is
  'Chave do Emissor por clinica. Fail-closed: qualquer duvida devolve false e o produtor usa o caminho antigo.';

-- ---------------------------------------------------------------------------------------------
-- ENFILEIRAR. Unico ponto de entrada dos produtores.
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
  p_not_before    timestamptz default null
) returns uuid
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_addr      text;
  v_transport text;
  v_simulado  boolean := false;
  v_id        uuid;
begin
  if p_clinic_id is null or coalesce(btrim(p_to_addr), '') = '' then
    raise exception 'emit_message: clinic_id e to_addr sao obrigatorios';
  end if;

  -- Normaliza UM lado so, aqui, de uma vez por todas. Hoje cada produtor faz diferente:
  -- fn_handle_confirmation_reply normaliza, process_pos_followup manda cru. Grupo nao e telefone.
  -- normalize_br_phone devolve 12 digitos (remove o 9o), que e o formato que a uazapi aceita hoje
  -- (o chat-send ja manda assim, com milhares de entregas confirmadas).
  v_addr := case
              when p_to_kind = 'lead' then coalesce(normalize_br_phone(p_to_addr), btrim(p_to_addr))
              else btrim(p_to_addr)
            end;

  -- Transporte: explicito ganha; senao, lead de simulacao nunca toca a uazapi.
  if p_lead_id is not null then
    select coalesce(is_simulation, false) into v_simulado from public.leads where id = p_lead_id;
  end if;
  v_transport := coalesce(p_transport, case when v_simulado then 'sandbox' else 'uazapi' end);

  insert into public.outbound_messages (
    clinic_id, lead_id, to_addr, to_kind, kind, body,
    media_url, media_base64, media_mime, media_kind,
    delay_ms, transport, producer, conversation_key, dedup_key, not_before
  ) values (
    p_clinic_id, p_lead_id, v_addr, p_to_kind, p_kind, p_body,
    p_media_url, p_media_base64, p_media_mime, p_media_kind,
    coalesce(p_delay_ms, 0), v_transport, p_producer,
    p_clinic_id::text || '|' || v_addr, p_dedup_key, coalesce(p_not_before, now())
  )
  on conflict (dedup_key) where dedup_key is not null do nothing
  returning id into v_id;

  -- Conflito de dedup: o pedido ja existia. Devolve o id de la (idempotencia de verdade, nao
  -- silencio) para o produtor conseguir rastrear.
  if v_id is null and p_dedup_key is not null then
    select id into v_id from public.outbound_messages where dedup_key = p_dedup_key;
  end if;

  return v_id;
end $$;

-- ---------------------------------------------------------------------------------------------
-- RECLAMAR. O worker chama isto. Duas garantias que o envio inline de hoje nao tem:
--   (a) ORDEM POR CONVERSA: so a mensagem de menor `seq` de cada conversa concorre, e so se
--       nao houver outra da mesma conversa em voo. O agente manda varias bolhas em sequencia;
--       entregar fora de ordem e pior do que atrasar.
--   (b) EXCLUSAO MUTUA por conversa via advisory lock, para dois workers simultaneos (cron +
--       kick) nunca pegarem duas mensagens da mesma conversa no mesmo instante.
create or replace function public.claim_outbound_messages(
  p_limit  int  default 25,
  p_worker text default null
) returns setof public.outbound_messages
language plpgsql security definer set search_path to 'public'
as $$
begin
  return query
  with candidatas as (
    select o.id
      from public.outbound_messages o
     where o.status = 'pending'
       and o.not_before <= now()
       and not exists (
             select 1 from public.outbound_messages b
              where b.conversation_key = o.conversation_key and b.status = 'sending')
       and not exists (
             select 1 from public.outbound_messages b
              where b.conversation_key = o.conversation_key
                and b.status = 'pending' and b.not_before <= now() and b.seq < o.seq)
       and pg_try_advisory_xact_lock(hashtext(o.conversation_key))
     order by o.seq
     limit greatest(coalesce(p_limit, 25), 1)
     for update skip locked
  )
  update public.outbound_messages o
     set status     = 'sending',
         claimed_at = now(),
         claimed_by = coalesce(p_worker, 'worker'),
         attempts   = o.attempts + 1
    from candidatas c
   where o.id = c.id
  returning o.*;
end $$;

-- ---------------------------------------------------------------------------------------------
-- CONCLUIR. `chat_message_id` so chega aqui, isto e, DEPOIS de o provedor confirmar. E o que faz
-- a conversa no painel parar de mentir quando o envio falha.
create or replace function public.mark_outbound_sent(
  p_id uuid,
  p_provider_status int default null,
  p_provider_message_id text default null,
  p_provider_response jsonb default null,
  p_chat_message_id uuid default null,
  p_simulated boolean default false
) returns void
language sql security definer set search_path to 'public'
as $$
  update public.outbound_messages
     set status = case when p_simulated then 'simulated' else 'sent' end,
         sent_at = now(),
         provider_status = p_provider_status,
         provider_message_id = p_provider_message_id,
         provider_response = p_provider_response,
         chat_message_id = coalesce(p_chat_message_id, chat_message_id),
         last_error = null
   where id = p_id;
$$;

-- FALHAR. Backoff exponencial; esgotadas as tentativas vira 'failed' (a DLQ) e grita na Central
-- COM clinica e lead. Hoje um 401 da uazapi vira, no maximo, um evento anonimo agregado por URL.
create or replace function public.mark_outbound_failed(
  p_id uuid,
  p_error text,
  p_provider_status int default null,
  p_provider_response jsonb default null,
  p_permanente boolean default false
) returns void
language plpgsql security definer set search_path to 'public'
as $$
declare r public.outbound_messages;
begin
  select * into r from public.outbound_messages where id = p_id;
  if not found then return; end if;

  if p_permanente or r.attempts >= r.max_attempts then
    update public.outbound_messages
       set status = case when p_permanente then 'dropped' else 'failed' end,
           last_error = p_error, provider_status = p_provider_status,
           provider_response = p_provider_response
     where id = p_id;

    perform public.log_system_error(
      'emissor',
      case when p_permanente then 'envio_descartado' else 'envio_esgotou_tentativas' end,
      case when p_permanente
           then 'Mensagem descartada sem envio: ' || coalesce(p_error, 'sem detalhe')
           else 'Mensagem NAO entregue apos ' || r.attempts || ' tentativas: ' || coalesce(p_error, 'sem detalhe') end,
      'critical', r.clinic_id,
      jsonb_build_object('outbound_id', r.id, 'lead_id', r.lead_id, 'producer', r.producer,
                         'destino', r.to_addr, 'status_http', p_provider_status,
                         'tentativas', r.attempts),
      false
    );
  else
    -- 30s, 90s, 270s...
    update public.outbound_messages
       set status = 'pending',
           not_before = now() + (interval '30 seconds' * power(3, greatest(r.attempts - 1, 0))),
           last_error = p_error, provider_status = p_provider_status,
           provider_response = p_provider_response
     where id = p_id;
  end if;
end $$;

-- Devolve a voo mensagem cujo worker morreu no meio (claim orfao).
create or replace function public.requeue_stale_outbound(p_older_minutes int default 5)
returns int
language sql security definer set search_path to 'public'
as $$
  with v as (
    update public.outbound_messages
       set status = 'pending', claimed_at = null, claimed_by = null
     where status = 'sending'
       and claimed_at < now() - make_interval(mins => greatest(coalesce(p_older_minutes,5), 1))
    returning 1)
  select coalesce(count(*), 0)::int from v;
$$;

-- Purga: terminais com mais de 30 dias. Mantem a auditoria util sem deixar a tabela crescer sem fim.
create or replace function public.purge_outbound_messages(p_dias int default 30)
returns int
language sql security definer set search_path to 'public'
as $$
  with v as (
    delete from public.outbound_messages
     where status in ('sent','simulated','dropped')
       and created_at < now() - make_interval(days => greatest(coalesce(p_dias,30), 7))
    returning 1)
  select coalesce(count(*), 0)::int from v;
$$;

revoke all on function public.emit_message(uuid,text,text,text,text,uuid,text,text,text,text,text,int,text,text,timestamptz) from anon, authenticated;
revoke all on function public.claim_outbound_messages(int,text) from anon, authenticated;
revoke all on function public.mark_outbound_sent(uuid,int,text,jsonb,uuid,boolean) from anon, authenticated;
revoke all on function public.mark_outbound_failed(uuid,text,int,jsonb,boolean) from anon, authenticated;
revoke all on function public.requeue_stale_outbound(int) from anon, authenticated;
revoke all on function public.purge_outbound_messages(int) from anon, authenticated;
