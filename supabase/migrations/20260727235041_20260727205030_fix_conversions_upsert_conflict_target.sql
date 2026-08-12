-- 20260727235041_20260727205030_fix_conversions_upsert_conflict_target
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- O upsert das conversões falhava com "there is no unique or exclusion constraint matching the
-- ON CONFLICT specification": o índice de unicidade usava EXPRESSÕES (coalesce(campaign_id,'')),
-- e ON CONFLICT (lista de colunas) — que é o formato do onConflict do supabase-js — só casa com
-- índice sobre COLUNAS SIMPLES. Resultado: a Graph devolvia as conversões e nada era gravado.
--
-- Correção: as colunas de id viram NOT NULL DEFAULT '' (a edge já grava '' quando o Meta omite,
-- via String(d.campaign_id ?? "")), o que torna o coalesce desnecessário e permite índice simples.
-- Manter o '' em vez de NULL também preserva a razão original do coalesce: NULL não colide em
-- unique, então linha sem adset/ad (Advantage+) duplicaria a cada sync.
update public.marketing_conversions_breakdown
   set campaign_id = coalesce(campaign_id,''),
       adset_id    = coalesce(adset_id,''),
       ad_id       = coalesce(ad_id,'')
 where campaign_id is null or adset_id is null or ad_id is null;

alter table public.marketing_conversions_breakdown
  alter column campaign_id set default '',
  alter column adset_id    set default '',
  alter column ad_id       set default '',
  alter column campaign_id set not null,
  alter column adset_id    set not null,
  alter column ad_id       set not null;

drop index if exists public.uq_mkt_conv_breakdown;
create unique index uq_mkt_conv_breakdown
  on public.marketing_conversions_breakdown
     (clinic_id, date, platform, campaign_id, adset_id, ad_id, conversion_id);
