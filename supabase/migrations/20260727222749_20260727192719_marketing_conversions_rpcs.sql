-- 20260727222749_20260727192719_marketing_conversions_rpcs
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- RPCs de leitura das conversões personalizadas. Seguem o formato OBRIGATÓRIO de RPC de painel:
-- wrapper fino SECURITY DEFINER que só chama assert_clinic_access() e delega para <nome>_impl,
-- onde mora a lógica. _impl NÃO recebe EXECUTE para anon/authenticated.

-- ── 1) Catálogo p/ o seletor de colunas ─────────────────────────────────────────────────────
create or replace function public.marketing_conversion_catalog_impl(p_clinic_id uuid)
 returns table(conversion_id text, name text, is_archived boolean, last_fired_at timestamptz, tem_dado boolean)
 language sql stable set search_path to 'public'
as $function$
  select c.conversion_id, c.name, c.is_archived, c.last_fired_at,
         exists (select 1 from public.marketing_conversions_breakdown b
                  where b.clinic_id = c.clinic_id and b.conversion_id = c.conversion_id
                    and b.conversions > 0) as tem_dado
  from public.meta_custom_conversions c
  where c.clinic_id = p_clinic_id
  order by c.is_archived, c.last_fired_at desc nulls last, c.name;
$function$;

create or replace function public.marketing_conversion_catalog(p_clinic_id uuid)
 returns table(conversion_id text, name text, is_archived boolean, last_fired_at timestamptz, tem_dado boolean)
 language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  perform public.assert_clinic_access(p_clinic_id);
  return query select * from public.marketing_conversion_catalog_impl(p_clinic_id);
end;
$function$;

-- ── 2) Conversões por campanha/conjunto/anúncio no período ───────────────────────────────────
-- Devolve a chave NORMALIZADA (mesma régua de marketing_campaign_investment, migr 20260724165609)
-- para o front casar linha a linha sem repetir a limpeza de texto no cliente.
create or replace function public.marketing_campaign_conversions_impl(p_clinic_id uuid, p_start date, p_end date)
 returns table(k_campaign text, k_adset text, k_ad text, conversion_id text, conversions numeric)
 language sql stable set search_path to 'public'
as $function$
  select
    lower(regexp_replace(coalesce(b.campaign_name,''), '[^[:alnum:]]+', '', 'g')) as k_campaign,
    lower(regexp_replace(coalesce(b.adset_name,''),    '[^[:alnum:]]+', '', 'g')) as k_adset,
    lower(regexp_replace(coalesce(b.ad_name,''),       '[^[:alnum:]]+', '', 'g')) as k_ad,
    b.conversion_id,
    sum(b.conversions) as conversions
  from public.marketing_conversions_breakdown b
  where b.clinic_id = p_clinic_id
    and b.date between p_start and p_end
  group by 1,2,3,4
  having sum(b.conversions) > 0;
$function$;

create or replace function public.marketing_campaign_conversions(p_clinic_id uuid, p_start date, p_end date)
 returns table(k_campaign text, k_adset text, k_ad text, conversion_id text, conversions numeric)
 language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  perform public.assert_clinic_access(p_clinic_id);
  return query select * from public.marketing_campaign_conversions_impl(p_clinic_id, p_start, p_end);
end;
$function$;

-- Desde 27/07 o alter default privileges do schema revoga EXECUTE de anon/authenticated, então
-- RPC nova precisa de grant EXPLÍCITO — sem isso o PostgREST devolve erro de permissão e parece
-- "a função não existe". O _impl continua sem grant (só o wrapper é público).
revoke all on function public.marketing_conversion_catalog_impl(uuid) from public, anon, authenticated;
revoke all on function public.marketing_campaign_conversions_impl(uuid, date, date) from public, anon, authenticated;
revoke all on function public.marketing_conversion_catalog(uuid) from public, anon, authenticated;
revoke all on function public.marketing_campaign_conversions(uuid, date, date) from public, anon, authenticated;
grant execute on function public.marketing_conversion_catalog(uuid) to authenticated;
grant execute on function public.marketing_campaign_conversions(uuid, date, date) to authenticated;
