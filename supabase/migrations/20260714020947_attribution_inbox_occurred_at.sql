-- 20260714020947_attribution_inbox_occurred_at
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- `created_at` é quando a LINHA foi gravada, não quando o CLIQUE aconteceu. Para tráfego ao vivo dá
-- na mesma, mas basta um replay/backfill (fizemos vários hoje) para os dois divergirem — e aí o
-- last-touch elege o clique errado: um clique ANTIGO reinserido hoje ganharia de um clique NOVO
-- gravado ontem.
--
-- `occurred_at` guarda a hora real do clique (messageTimestamp do WhatsApp). É ela que decide o
-- last-touch; `created_at` continua sendo só auditoria de quando gravamos.

begin;

alter table public.attribution_inbox add column if not exists occurred_at timestamptz;

comment on column public.attribution_inbox.occurred_at is
  'Hora REAL do clique (messageTimestamp do WhatsApp). É o que decide o last-touch — created_at é a hora do INSERT e diverge em replays/backfills.';

-- Para as linhas que já existiam, a hora do insert é a melhor aproximação disponível
-- (foram gravadas ao vivo). As replicadas hoje são corrigidas logo abaixo, com a hora real da uazapi.
update public.attribution_inbox set occurred_at = created_at where occurred_at is null;

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
      rast_id          = coalesce(nullif(l.rast_id, ''), nullif(i.rast_id, ''))
    where l.id = p_lead_id;
  else
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
