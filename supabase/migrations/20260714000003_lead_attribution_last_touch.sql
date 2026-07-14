-- Atribuição do lead passa a ser LAST-TOUCH também no caminho do clique pago.
--
-- BUG (achado 14/07 a partir de uma dúvida do usuário): `fn_apply_inbox_to_lead` usava COALESCE —
-- só preenchia o que estava VAZIO. Resultado: **a campanha do lead congelava no PRIMEIRO clique,
-- para sempre**. Quem voltasse semanas depois por outro anúncio continuava creditado à campanha
-- antiga, e os painéis (Comercial, Marketing, ROAS) leem exatamente esse campo.
--
-- Caso real (Metaltres, 5535 9889-1496): clicou em três campanhas — `Frio | Leads WPP — Mangueirão`
-- (11/07 08h), `Vendas ADV+ | 25/11` (11/07 10h) e `Vendas ADV+ | 23/02` (13/07). O lead seguia
-- gravado com a primeira. As outras duas nunca chegaram nele.
--
-- Isso CONTRADIZIA a decisão de 13/07 (last-touch atômico no merge de lead, ver
-- [[lead-journey-touchpoints]]): a jornada registrava os três cliques certinho, mas o campo que os
-- painéis consomem estava preso no primeiro. Duas verdades diferentes no mesmo banco.
--
-- FIX: nova coluna `leads.attributed_at` = quando foi o clique que definiu a atribuição atual.
-- Um clique só sobrescreve o lead se for MAIS NOVO que isso.
--
-- ⚠️ A TRAVA DE TEMPO É O CORAÇÃO DISTO, não um detalhe. Sem ela, o resultado dependeria da ORDEM
-- DE CHEGADA: o sweep de 1 min pode aplicar uma linha antiga depois de uma nova, um replay manual
-- de clique velho (fizemos vários) sobrescreveria a atribuição boa, e uma reentrega de webhook faria
-- o mesmo. Com a trava, aplicar em qualquer ordem dá o mesmo resultado final.
--
-- Sobrescreve o BLOCO INTEIRO de atribuição (origem + clids + campanha + plataforma), não campo a
-- campo — senão o lead vira um Frankenstein: origem de um anúncio, campanha de outro.
--
-- IMPACTO MEDIDO: 1.371 leads com clique. 49 mudam de campanha — **47 ganham a campanha correta**
-- e 2 ficam sem campanha (o último clique deles caiu num token bloqueado). Esses 2 se curam
-- sozinhos: o `raw.source_id` está guardado e o cron `ctwa_enrich_weekly` preenche quando o token
-- da Meta voltar.

-- ⚠️ SUPERADA em parte pela 20260714000004: o comparador correto é occurred_at (hora do CLIQUE),
-- não created_at (hora do INSERT). Ver o arquivo seguinte.

begin;

alter table public.leads add column if not exists attributed_at timestamptz;

comment on column public.leads.attributed_at is
  'Quando ocorreu o clique que definiu a atribuição atual do lead. Um clique só sobrescreve a atribuição se for mais novo que isto — é o que torna o last-touch independente da ordem de chegada.';

create or replace function public.fn_apply_inbox_to_lead(p_lead_id uuid, p_inbox_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  i public.attribution_inbox%rowtype;
  v_attributed_at timestamptz;
  v_tem_atribuicao boolean;
  v_mais_novo boolean;
begin
  select * into i from public.attribution_inbox where id = p_inbox_id;
  if not found then return; end if;

  select l.attributed_at into v_attributed_at from public.leads l where l.id = p_lead_id;

  -- Uma linha da inbox só "vale" como toque se de fato traz atribuição.
  v_tem_atribuicao := (
    nullif(i.source, '')    is not null or nullif(i.ctwa_clid, '') is not null
    or nullif(i.fb_clid, '') is not null or nullif(i.g_clid, '')   is not null
  );

  v_mais_novo := (v_attributed_at is null or i.created_at > v_attributed_at);

  if v_tem_atribuicao and v_mais_novo then
    -- LAST-TOUCH: este é o clique mais recente conhecido — ele define a atribuição do lead.
    -- Substitui o bloco inteiro, inclusive limpando o que não veio: metade de um anúncio com
    -- metade de outro seria pior do que qualquer um dos dois.
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
      attributed_at    = i.created_at,
      -- Identidade NUNCA é sobrescrita: rast_id é quem a pessoa é, não de onde ela veio.
      rast_id          = coalesce(nullif(l.rast_id, ''), nullif(i.rast_id, ''))
    where l.id = p_lead_id;
  else
    -- Clique mais ANTIGO (replay, sweep fora de ordem, reentrega): não pode rebaixar a atribuição
    -- atual. Só preenche buraco.
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

commit;
