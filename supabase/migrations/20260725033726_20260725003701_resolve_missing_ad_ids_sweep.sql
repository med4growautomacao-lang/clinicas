-- 20260725033726_20260725003701_resolve_missing_ad_ids_sweep
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Resolução REVERSA nome -> ID do anúncio. O lead que chega só com o NOME da campanha (anúncio
-- antigo sem utm_id na URL, CTWA, n8n, criação manual) fica sem ID e depende do texto pra casar
-- com o gasto — e o texto quebra quando a campanha é RENOMEADA no Meta. Aqui gravamos o ID
-- enquanto o nome ainda bate, tornando o lead imune à renomeação futura.
--
-- É um SWEEP (não um trigger) de propósito: cobre TODOS os caminhos de entrada de lead sem pesar
-- o insert, e é idempotente — mesmo padrão de fn_reconcile_pending_tracking.
--
-- TRAVA: só resolve quando o nome mapeia para EXATAMENTE 1 id no gasto daquela clínica. Nome
-- ambíguo (duas campanhas homônimas, comum quando se duplica campanha) NÃO é adivinhado.
create or replace function public.fn_resolve_missing_ad_ids(p_limit integer default 5000)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_camp int := 0;
  v_adset int := 0;
  v_ad int := 0;
begin
  -- CAMPANHA
  with mapa as (
    select clinic_id, lower(regexp_replace(campaign_name,'[^[:alnum:]]+','','g')) as k,
           min(campaign_id) as id
    from public.marketing_spend_breakdown
    where nullif(campaign_id,'') is not null and coalesce(campaign_name,'') <> ''
    group by 1,2
    having count(distinct campaign_id) = 1
  ),
  alvo as (
    select l.id as lead_id, m.id as novo_id,
           (l.source in ('meta_ads','instagram')) as is_meta
    from public.leads l
    join mapa m
      on m.clinic_id = l.clinic_id
     and m.k = lower(regexp_replace(coalesce(nullif(l.fb_campaign_name,''), nullif(l.g_campaign_name,'')),'[^[:alnum:]]+','','g'))
    where coalesce(nullif(l.fb_campaign_id,''), nullif(l.g_campaign_id,'')) is null
      and coalesce(nullif(l.fb_campaign_name,''), nullif(l.g_campaign_name,'')) is not null
      and l.source in ('meta_ads','instagram','google_ads')
    limit p_limit
  )
  update public.leads l
     set fb_campaign_id = case when a.is_meta then a.novo_id else l.fb_campaign_id end,
         g_campaign_id  = case when a.is_meta then l.g_campaign_id else a.novo_id end
    from alvo a
   where l.id = a.lead_id;
  get diagnostics v_camp = row_count;

  -- CONJUNTO
  with mapa as (
    select clinic_id, lower(regexp_replace(adset_name,'[^[:alnum:]]+','','g')) as k,
           min(adset_id) as id
    from public.marketing_spend_breakdown
    where nullif(adset_id,'') is not null and coalesce(adset_name,'') <> ''
    group by 1,2
    having count(distinct adset_id) = 1
  ),
  alvo as (
    select l.id as lead_id, m.id as novo_id,
           (l.source in ('meta_ads','instagram')) as is_meta
    from public.leads l
    join mapa m
      on m.clinic_id = l.clinic_id
     and m.k = lower(regexp_replace(coalesce(nullif(l.fb_adset_name,''), nullif(l.g_adset_name,'')),'[^[:alnum:]]+','','g'))
    where coalesce(nullif(l.fb_adset_id,''), nullif(l.g_adset_id,'')) is null
      and coalesce(nullif(l.fb_adset_name,''), nullif(l.g_adset_name,'')) is not null
      and l.source in ('meta_ads','instagram','google_ads')
    limit p_limit
  )
  update public.leads l
     set fb_adset_id = case when a.is_meta then a.novo_id else l.fb_adset_id end,
         g_adset_id  = case when a.is_meta then l.g_adset_id else a.novo_id end
    from alvo a
   where l.id = a.lead_id;
  get diagnostics v_adset = row_count;

  -- ANÚNCIO
  with mapa as (
    select clinic_id, lower(regexp_replace(ad_name,'[^[:alnum:]]+','','g')) as k,
           min(ad_id) as id
    from public.marketing_spend_breakdown
    where nullif(ad_id,'') is not null and coalesce(ad_name,'') <> ''
    group by 1,2
    having count(distinct ad_id) = 1
  ),
  alvo as (
    select l.id as lead_id, m.id as novo_id,
           (l.source in ('meta_ads','instagram')) as is_meta
    from public.leads l
    join mapa m
      on m.clinic_id = l.clinic_id
     and m.k = lower(regexp_replace(coalesce(nullif(l.fb_ad_name,''), nullif(l.g_ad_name,'')),'[^[:alnum:]]+','','g'))
    where coalesce(nullif(l.fb_ad_id,''), nullif(l.g_ad_id,'')) is null
      and coalesce(nullif(l.fb_ad_name,''), nullif(l.g_ad_name,'')) is not null
      and l.source in ('meta_ads','instagram','google_ads')
    limit p_limit
  )
  update public.leads l
     set fb_ad_id = case when a.is_meta then a.novo_id else l.fb_ad_id end,
         g_ad_id  = case when a.is_meta then l.g_ad_id else a.novo_id end
    from alvo a
   where l.id = a.lead_id;
  get diagnostics v_ad = row_count;

  return jsonb_build_object('campanhas', v_camp, 'conjuntos', v_adset, 'anuncios', v_ad);
end;
$function$;
