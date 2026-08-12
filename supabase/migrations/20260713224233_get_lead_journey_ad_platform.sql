-- 20260713224233_get_lead_journey_ad_platform
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- A jornada passa a devolver a plataforma do anúncio (Instagram/Facebook/Status do WhatsApp).
-- Sem isso o painel mostra "Meta Ads" para tudo e a clínica não sabe onde o anúncio rendeu.
drop function if exists public.get_lead_journey(uuid);

create or replace function public.get_lead_journey(p_lead_id uuid)
returns table(
  occurred_at timestamp with time zone,
  channel text, source text, ad_platform text,
  campaign text, adset text, ad text, detail text,
  link_name text, is_conversion boolean
)
language sql
stable
as $function$
  select
    t.occurred_at, t.channel, t.source, t.ad_platform, t.campaign, t.adset, t.ad, t.detail,
    rl.name as link_name,
    exists (
      select 1 from public.link_sessions ls
      where ls.protocolo = t.external_ref and ls.used_at is not null
    ) or t.channel in ('meta_forms')  as is_conversion
  from public.lead_touchpoints t
  left join public.redirect_links rl on rl.id = t.redirect_link_id
  where t.lead_id = p_lead_id
  order by t.occurred_at asc;
$function$;
