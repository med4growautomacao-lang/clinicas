-- A hora do CLIQUE, não a hora do INSERT — é ela que decide o last-touch.
--
-- ERRO QUE ESTA MIGRATION CONSERTA (meu, na 20260714000003): usei `attribution_inbox.created_at`
-- como "quando o clique aconteceu". Não é: `created_at` é quando a LINHA foi gravada. Para tráfego
-- ao vivo dá na mesma (gravamos em segundos), mas basta um replay/backfill para os dois divergirem.
--
-- E replay não é hipótese: nesta mesma madrugada eu repliquei ~40 cliques antigos recuperados da
-- uazapi. Com o comparador errado, um clique das 21:27 reinserido às 01:52 "vencia" um clique real
-- das 21:49 — e o lead ficava com a campanha ERRADA. Aconteceu de verdade (Metaltres, 5535
-- 9212-9889): o last-touch elegeu o meu replay em vez do clique mais recente.
--
-- `occurred_at` guarda o `messageTimestamp` que o WhatsApp manda. `created_at` continua existindo,
-- mas só como auditoria de quando NÓS gravamos.
--
-- LIÇÃO GERAL: em qualquer regra de "o mais recente vence", o carimbo tem que ser o do EVENTO, e
-- não o da nossa escrita. Senão a regra passa a depender de quando rodamos o backfill.

begin;

alter table public.attribution_inbox add column if not exists occurred_at timestamptz;

comment on column public.attribution_inbox.occurred_at is
  'Hora REAL do clique (messageTimestamp do WhatsApp). É o que decide o last-touch — created_at é a hora do INSERT e diverge em replays/backfills.';

-- Linhas antigas: a hora do insert é a melhor aproximação (foram gravadas ao vivo). As replicadas
-- em 13-14/07 foram corrigidas com a hora real vinda da uazapi.
update public.attribution_inbox set occurred_at = created_at where occurred_at is null;

-- O comparador do last-touch passa a ser occurred_at.
create or replace function public.fn_apply_inbox_to_lead(p_lead_id uuid, p_inbox_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  i public.attribution_inbox%rowtype;
  v_quando timestamptz;
  v_attributed_at timestamptz;
  v_tem_atribuicao boolean;
  v_mais_novo boolean;
begin
  select * into i from public.attribution_inbox where id = p_inbox_id;
  if not found then return; end if;

  -- A hora do CLIQUE manda; a hora do insert é só fallback.
  v_quando := coalesce(i.occurred_at, i.created_at);

  select l.attributed_at into v_attributed_at from public.leads l where l.id = p_lead_id;

  v_tem_atribuicao := (
    nullif(i.source, '')    is not null or nullif(i.ctwa_clid, '') is not null
    or nullif(i.fb_clid, '') is not null or nullif(i.g_clid, '')   is not null
  );

  v_mais_novo := (v_attributed_at is null or v_quando > v_attributed_at);

  if v_tem_atribuicao and v_mais_novo then
    -- LAST-TOUCH: substitui o bloco INTEIRO de atribuição, inclusive limpando o que não veio.
    -- Metade de um anúncio com metade de outro seria pior do que qualquer um dos dois.
    update public.leads l set
      source           = nullif(i.source, ''),
      ctwa_clid        = nullif(i.ctwa_clid, ''),
      fb_clid          = nullif(i.fb_clid, ''),
      g_clid           = nullif(i.g_clid, ''),
      fb_campaign_name = nullif(i.fb_campaign_name, ''),
      fb_adset_name    = nullif(i.fb_adset_name, ''),
      fb_ad_name       = nullif(i.fb_ad_name, ''),
      ad_platform      = nullif(i.ad_platform, ''),
      g_campaign_name  = nullif(i.g_campaign_name, ''),
      g_adset_name     = nullif(i.g_adset_name, ''),
      g_ad_name        = nullif(i.g_ad_name, ''),
      g_term_name      = nullif(i.g_term_name, ''),
      g_source_name    = nullif(i.g_source_name, ''),
      attributed_at    = v_quando,
      -- Identidade NUNCA é sobrescrita: rast_id é quem a pessoa é, não de onde ela veio.
      rast_id          = coalesce(nullif(l.rast_id, ''), nullif(i.rast_id, ''))
    where l.id = p_lead_id;
  else
    -- Clique mais ANTIGO (replay, sweep fora de ordem, reentrega do webhook): não pode rebaixar a
    -- atribuição atual. Só preenche buraco.
    update public.leads l set
      source           = coalesce(nullif(l.source, ''),           nullif(i.source, '')),
      ctwa_clid        = coalesce(nullif(l.ctwa_clid, ''),        nullif(i.ctwa_clid, '')),
      fb_clid          = coalesce(nullif(l.fb_clid, ''),          nullif(i.fb_clid, '')),
      g_clid           = coalesce(nullif(l.g_clid, ''),           nullif(i.g_clid, '')),
      fb_campaign_name = coalesce(nullif(l.fb_campaign_name, ''), nullif(i.fb_campaign_name, '')),
      fb_adset_name    = coalesce(nullif(l.fb_adset_name, ''),    nullif(i.fb_adset_name, '')),
      fb_ad_name       = coalesce(nullif(l.fb_ad_name, ''),       nullif(i.fb_ad_name, '')),
      ad_platform      = coalesce(nullif(l.ad_platform, ''),      nullif(i.ad_platform, '')),
      g_campaign_name  = coalesce(nullif(l.g_campaign_name, ''),  nullif(i.g_campaign_name, '')),
      g_adset_name     = coalesce(nullif(l.g_adset_name, ''),     nullif(i.g_adset_name, '')),
      g_ad_name        = coalesce(nullif(l.g_ad_name, ''),        nullif(i.g_ad_name, '')),
      g_term_name      = coalesce(nullif(l.g_term_name, ''),      nullif(i.g_term_name, '')),
      g_source_name    = coalesce(nullif(l.g_source_name, ''),    nullif(i.g_source_name, '')),
      rast_id          = coalesce(nullif(l.rast_id, ''),          nullif(i.rast_id, ''))
    where l.id = p_lead_id;
  end if;

  update public.attribution_inbox
     set consumed_at = now(), matched_lead_id = p_lead_id
   where id = p_inbox_id;
end;
$function$;

-- A RPC de ingestão passa a receber e gravar a hora do clique.
drop function if exists public.ctwa_ingest_click(uuid, text, text, text, text, text, text, text, jsonb);

create or replace function public.ctwa_ingest_click(
  p_clinic_id   uuid,
  p_phone       text,
  p_external_id text,
  p_ctwa_clid   text,
  p_campaign    text,
  p_adset       text,
  p_ad          text,
  p_ad_platform text,
  p_raw         jsonb,
  p_occurred_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_id      uuid;
  v_lead_id uuid;
  v_novo    boolean;
  v_quando  timestamptz := coalesce(p_occurred_at, now());
begin
  insert into public.attribution_inbox as i (
    clinic_id, phone, source, ctwa_clid, external_id,
    fb_campaign_name, fb_adset_name, fb_ad_name, ad_platform, raw, occurred_at
  ) values (
    p_clinic_id, p_phone, 'meta_ads', p_ctwa_clid, p_external_id,
    p_campaign, p_adset, p_ad, p_ad_platform, p_raw, v_quando
  )
  on conflict (clinic_id, external_id) where external_id is not null
  do update set
    ctwa_clid        = coalesce(nullif(i.ctwa_clid, ''),        nullif(excluded.ctwa_clid, '')),
    fb_campaign_name = coalesce(nullif(i.fb_campaign_name, ''), nullif(excluded.fb_campaign_name, '')),
    fb_adset_name    = coalesce(nullif(i.fb_adset_name, ''),    nullif(excluded.fb_adset_name, '')),
    fb_ad_name       = coalesce(nullif(i.fb_ad_name, ''),       nullif(excluded.fb_ad_name, '')),
    ad_platform      = coalesce(nullif(i.ad_platform, ''),      nullif(excluded.ad_platform, '')),
    occurred_at      = coalesce(i.occurred_at, excluded.occurred_at),
    raw              = coalesce(i.raw, '{}'::jsonb) || coalesce(excluded.raw, '{}'::jsonb)
  returning i.id, i.matched_lead_id, (xmax = 0) into v_id, v_lead_id, v_novo;

  if not v_novo and v_lead_id is not null then
    perform public.fn_apply_inbox_to_lead(v_lead_id, v_id);

    update public.lead_touchpoints t
       set ad_platform = coalesce(t.ad_platform, p_ad_platform),
           campaign    = coalesce(nullif(t.campaign, ''), nullif(p_campaign, '')),
           adset       = coalesce(nullif(t.adset, ''),    nullif(p_adset, '')),
           ad          = coalesce(nullif(t.ad, ''),       nullif(p_ad, ''))
     where t.channel = 'whatsapp' and t.external_ref = p_external_id;
  end if;

  return jsonb_build_object('id', v_id, 'inserted', v_novo);
end;
$function$;

revoke all on function public.ctwa_ingest_click(uuid, text, text, text, text, text, text, text, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.ctwa_ingest_click(uuid, text, text, text, text, text, text, text, jsonb, timestamptz) to service_role;

commit;
