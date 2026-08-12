-- 20260715182523_get_org_clinics_investment_by_channel
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

drop function if exists public.get_org_clinics_investment(uuid);

-- Investimento por CANAL (Meta e Google separados) de todas as clínicas de uma org, em lote.
create function public.get_org_clinics_investment(p_org_id uuid)
returns table (
  clinic_id uuid,
  meta_estimated numeric,
  meta_invested numeric,
  google_estimated numeric,
  google_invested numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_month_start date;
begin
  if not can_manage_org(p_org_id) then
    raise exception 'Sem permissão';
  end if;

  v_month_start := date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date;

  return query
  select
    c.id,
    coalesce((ci.budget->>'meta_estipulado')::numeric, 0)    as meta_estimated,
    coalesce(md.meta_invested, 0)                            as meta_invested,
    coalesce((ci.budget->>'google_estipulado')::numeric, 0)  as google_estimated,
    coalesce(md.google_invested, 0)                          as google_invested
  from public.clinics c
  left join public.clinic_client_info ci on ci.clinic_id = c.id
  left join lateral (
    select
      sum(m.investment) filter (where m.platform = 'meta_ads')   as meta_invested,
      sum(m.investment) filter (where m.platform = 'google_ads') as google_invested
    from public.marketing_data m
    where m.clinic_id = c.id
      and m.date >= v_month_start
  ) md on true
  where c.organization_id = p_org_id;
end;
$$;

grant execute on function public.get_org_clinics_investment(uuid) to authenticated;
