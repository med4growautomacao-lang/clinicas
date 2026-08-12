-- 20260715182106_get_org_clinics_investment
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Investimento (verba estipulada + investido do mês corrente) de todas as clínicas de uma org,
-- em lote, para a coluna "Investimento" da lista de clínicas na Gestão Organizacional.
-- SECURITY DEFINER + gate can_manage_org(p_org_id): só gestores da org veem.
create or replace function public.get_org_clinics_investment(p_org_id uuid)
returns table (clinic_id uuid, estimated numeric, invested numeric)
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
    coalesce((ci.budget->>'meta_estipulado')::numeric, 0)
      + coalesce((ci.budget->>'google_estipulado')::numeric, 0) as estimated,
    coalesce(md.invested, 0) as invested
  from public.clinics c
  left join public.clinic_client_info ci on ci.clinic_id = c.id
  left join lateral (
    select sum(m.investment) as invested
    from public.marketing_data m
    where m.clinic_id = c.id
      and m.platform in ('meta_ads', 'google_ads')
      and m.date >= v_month_start
  ) md on true
  where c.organization_id = p_org_id;
end;
$$;

grant execute on function public.get_org_clinics_investment(uuid) to authenticated;
