-- Fecha o loop de atribuição do Link de Redirecionamento (bio/Instagram) — nativo, sem n8n.
--
-- Contexto: a edge `whatsapp-redirect` registra o clique em `link_sessions` e injeta
-- "[Protocolo NNNN não apague essa mensagem]" na 1ª mensagem do WhatsApp. O elo que lia esse
-- protocolo, gravava a origem no lead e marcava o clique como usado vivia no n8n e NÃO roda
-- desde 17/06 → todo lead vindo da bio entra sem origem (ver 20260618000002 e 20260709000090,
-- dois backfills manuais que já tiveram de ser feitos).
--
-- Por que trigger e não cron+edge: os outros fluxos nativos (forms-welcome-followup,
-- reengagement-followup) usam cron+edge porque precisam ENVIAR mensagem via uazapi. Aqui é
-- pura escrita de banco, e o lead já existe quando a mensagem entra (chat_messages.lead_id é
-- FK) — não há race a resolver, então não precisa de staging (lead_tracking_inbox) nem cron.

begin;

-- 1) Liga o clique ao lead (não existia) — habilita métrica de conversão por link
alter table public.link_sessions
  add column if not exists lead_id uuid references public.leads(id) on delete set null;

-- Índice da FK: sem ele, deletar um lead vira seq scan em link_sessions (mesmo problema de
-- 20260612000001_reset_lead_timeout_indexes).
create index if not exists idx_link_sessions_lead_id
  on public.link_sessions (lead_id) where lead_id is not null;

-- Lookup do matcher: clique ainda aberto desta clínica com este protocolo
create index if not exists idx_link_sessions_open
  on public.link_sessions (clinic_id, rast_id) where used_at is null;

-- 2) Matcher: mensagem inbound com [Protocolo NNNN] -> fecha o clique e atribui a origem
create or replace function public.fn_close_redirect_protocol()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_proto   text;
  v_session public.link_sessions%rowtype;
  v_source  text;
begin
  if new.direction is distinct from 'inbound' or new.lead_id is null then
    return new;
  end if;

  v_proto := (regexp_match(coalesce(new.message->>'content', ''), '[Pp]rotocolo:?\s*(\d+)'))[1];
  if v_proto is null then
    return new;
  end if;

  -- rast_id é UNIQUE global (link_sessions_rast_id_key), então o casamento é inequívoco.
  -- clinic_id é guarda extra; o teto de 30 dias evita colar um clique fóssil num lead novo.
  select * into v_session
  from public.link_sessions ls
  where ls.rast_id = v_proto
    and ls.clinic_id = new.clinic_id
    and ls.used_at is null
    and ls.created_at > now() - interval '30 days'
  limit 1;

  if not found then
    return new;
  end if;

  -- Origem: só o que o clique realmente comprova. 'direto' = clique no link sem UTM, ou seja
  -- origem desconhecida -> permanece Orgânico (grava só o rast_id, não inventa atribuição).
  v_source := case
                when lower(coalesce(v_session.utm_source, '')) = 'instagram' then 'instagram'
                else null
              end;

  -- COALESCE-only: nunca sobrescreve first-touch (espelha fn_apply_inbox_to_lead).
  -- Guarda: lead com clid de campanha paga tem precedência sobre clique de bio.
  update public.leads l
  set rast_id = coalesce(l.rast_id, v_session.rast_id),
      source  = coalesce(nullif(l.source, ''), v_source)
  where l.id = new.lead_id
    and l.ctwa_clid is null
    and l.fb_clid   is null
    and l.g_clid    is null;

  -- Fecha o clique mesmo quando a atribuição não foi aplicada (o clique existiu e é desse
  -- lead — vale para a métrica do link). `used_at is null` garante idempotência.
  update public.link_sessions
  set used_at = now(),
      lead_id = new.lead_id
  where id = v_session.id
    and used_at is null;

  return new;
end;
$$;

drop trigger if exists trg_close_redirect_protocol on public.chat_messages;
create trigger trg_close_redirect_protocol
  after insert on public.chat_messages
  for each row
  execute function public.fn_close_redirect_protocol();

commit;

-- ============================================================================
-- ROLLBACK:
--   drop trigger if exists trg_close_redirect_protocol on public.chat_messages;
--   drop function if exists public.fn_close_redirect_protocol();
--   -- (as colunas/índices podem ficar; são aditivos)
-- ============================================================================
