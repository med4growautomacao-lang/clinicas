-- 20260714020817_lead_attribution_last_touch
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

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

  v_tem_atribuicao := (
    nullif(i.source, '')    is not null or nullif(i.ctwa_clid, '') is not null
    or nullif(i.fb_clid, '') is not null or nullif(i.g_clid, '')   is not null
  );

  v_mais_novo := (v_attributed_at is null or i.created_at > v_attributed_at);

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
      attributed_at    = i.created_at,
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
