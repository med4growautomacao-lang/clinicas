-- Backfill de atribuição (2ª leva): Link de Redirecionamento da bio (Instagram) — Tyago Venâncio
-- (a04a78de-358b-4dcc-9d47-8f02d9a61ef2)
--
-- Continuação de 20260618000002. O elo do n8n que fecha o [Protocolo NNNN] -> lead (grava rast_id
-- + UTMs e marca link_sessions.used_at) segue NÃO rodando: 0 cliques fechados desde 17/06 e ~107
-- sessions instagram/bio pendentes nesta clínica. Ver memória [[redirect-link-attribution-broken]].
--
-- Esta leva pega os leads órfãos (source IS NULL) cuja 1ª mensagem contém um [Protocolo NNNN] que
-- casa com um link_session utm_source='instagram' DA MESMA CLÍNICA e DENTRO DE UMA JANELA TEMPORAL
-- (o rast_id de 4 dígitos se repete ao longo do tempo, então o casamento exige proximidade de tempo).
-- Fuso: leads.created_at é SP-sem-tz; link_sessions.created_at é UTC — convertido via AT TIME ZONE.
-- Esperado: 5 leads / 5 sessions (protocolos 7472, 1575, 1704, 6575, 8840). Reversível.

begin;

-- 1) Tabela de backup (rollback)
create table if not exists public._backfill_tyago_instagram_20260709 (
  lead_id              uuid primary key,
  protocolo            text,
  old_source           text,
  old_rast_id          text,
  old_fb_clid          text,
  old_fb_campaign_name text,
  old_fb_adset_name    text,
  old_fb_ad_name       text,
  link_session_id      uuid,
  backed_up_at         timestamptz default now()
);

-- 2) Identifica os leads afetados e guarda o estado atual
with orfaos as (
  select l.id as lead_id, l.clinic_id, l.created_at,
    l.source, l.rast_id, l.fb_clid, l.fb_campaign_name, l.fb_adset_name, l.fb_ad_name,
    (select (regexp_match(cm.message->>'content', '[Pp]rotocolo\s*(\d+)'))[1]
       from public.chat_messages cm
      where cm.lead_id = l.id and cm.message->>'content' ~ '[Pp]rotocolo\s*\d+'
      order by cm.seq asc limit 1) as protocolo
  from public.leads l
  where l.clinic_id = 'a04a78de-358b-4dcc-9d47-8f02d9a61ef2'
    and l.source is null
    and coalesce(l.is_not_lead, false) = false
),
afetados as (
  select o.lead_id, o.protocolo, o.source, o.rast_id,
    o.fb_clid, o.fb_campaign_name, o.fb_adset_name, o.fb_ad_name,
    (select ls.id from public.link_sessions ls
      where ls.clinic_id = o.clinic_id
        and ls.rast_id = o.protocolo
        and ls.utm_source = 'instagram'
        and ls.created_at between (o.created_at at time zone 'America/Sao_Paulo') - interval '45 min'
                              and (o.created_at at time zone 'America/Sao_Paulo') + interval '15 min'
      order by abs(extract(epoch from (ls.created_at - (o.created_at at time zone 'America/Sao_Paulo'))))
      limit 1) as link_session_id
  from orfaos o
  where o.protocolo is not null
)
insert into public._backfill_tyago_instagram_20260709
  (lead_id, protocolo, old_source, old_rast_id, old_fb_clid, old_fb_campaign_name, old_fb_adset_name, old_fb_ad_name, link_session_id)
select lead_id, protocolo, source, rast_id, fb_clid, fb_campaign_name, fb_adset_name, fb_ad_name, link_session_id
from afetados
where link_session_id is not null
on conflict (lead_id) do nothing;

-- 3) Reatribui os leads para Instagram e limpa qualquer campo Meta sintético
update public.leads l
set source           = 'instagram',
    rast_id          = b.protocolo,
    fb_clid          = null,
    fb_campaign_name = null,
    fb_adset_name    = null,
    fb_ad_name       = null
from public._backfill_tyago_instagram_20260709 b
where l.id = b.lead_id;

-- 4) Marca o clique correspondente como usado (SP -> UTC)
update public.link_sessions ls
set used_at = (l.created_at at time zone 'America/Sao_Paulo')
from public._backfill_tyago_instagram_20260709 b
join public.leads l on l.id = b.lead_id
where ls.id = b.link_session_id
  and ls.used_at is null;

commit;

-- ============================================================================
-- ROLLBACK (executar manualmente se necessário):
--
-- begin;
-- update public.leads l
-- set source           = b.old_source,
--     rast_id          = b.old_rast_id,
--     fb_clid          = b.old_fb_clid,
--     fb_campaign_name = b.old_fb_campaign_name,
--     fb_adset_name    = b.old_fb_adset_name,
--     fb_ad_name       = b.old_fb_ad_name
-- from public._backfill_tyago_instagram_20260709 b
-- where l.id = b.lead_id;
--
-- update public.link_sessions ls set used_at = null
-- from public._backfill_tyago_instagram_20260709 b
-- where ls.id = b.link_session_id;
--
-- drop table public._backfill_tyago_instagram_20260709;
-- commit;
-- ============================================================================
