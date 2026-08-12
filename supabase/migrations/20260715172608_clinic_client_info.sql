-- 20260715172608_clinic_client_info
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Cadastro de "Informações da Clínica" (dados do cliente + acessos) para a Gestão Organizacional.
-- Tabela SEPARADA de clinics de propósito: guarda credenciais (senhas em texto) e não deve
-- vazar nos SELECTs gerais de clinics. RLS restrita a super-admin e org_owner/org_admin da org dona.
create table if not exists public.clinic_client_info (
  clinic_id       uuid primary key references public.clinics(id) on delete cascade,
  responsibles    jsonb not null default '[]'::jsonb,   -- [{name, role, phone, email}]
  extra_phones    jsonb not null default '[]'::jsonb,   -- [{label, number}]
  budget          jsonb not null default '{}'::jsonb,   -- {meta_estipulado, google_estipulado} (numérico, R$)
  access          jsonb not null default '{}'::jsonb,   -- {site,meta,crm,meta_ads,google_ads,instagram:{url,login,password,note}}
  important_links jsonb not null default '[]'::jsonb,   -- [{label, url}]
  notes           text,
  updated_at      timestamptz not null default now(),
  updated_by      uuid
);

alter table public.clinic_client_info enable row level security;

create policy clinic_client_info_manage on public.clinic_client_info
  for all
  using (
    exists (
      select 1 from public.clinics c
      where c.id = clinic_client_info.clinic_id
        and can_manage_org(c.organization_id)
    )
  )
  with check (
    exists (
      select 1 from public.clinics c
      where c.id = clinic_client_info.clinic_id
        and can_manage_org(c.organization_id)
    )
  );

-- Leitura: retorna o cadastro + o investido do mês corrente (America/Sao_Paulo) por canal,
-- somado de marketing_data. SECURITY DEFINER para poder ler marketing_data independentemente
-- de o org admin ser clinic_user; o acesso é barrado por can_manage_org.
create or replace function public.get_clinic_client_info(p_clinic_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_row public.clinic_client_info%rowtype;
  v_meta numeric;
  v_google numeric;
  v_month_start date;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then
    raise exception 'Clínica não encontrada';
  end if;
  if not can_manage_org(v_org) then
    raise exception 'Sem permissão';
  end if;

  select * into v_row from public.clinic_client_info where clinic_id = p_clinic_id;

  v_month_start := date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date;

  select coalesce(sum(investment) filter (where platform = 'meta_ads'), 0),
         coalesce(sum(investment) filter (where platform = 'google_ads'), 0)
    into v_meta, v_google
    from public.marketing_data
   where clinic_id = p_clinic_id
     and date >= v_month_start;

  return jsonb_build_object(
    'responsibles',    coalesce(v_row.responsibles, '[]'::jsonb),
    'extra_phones',    coalesce(v_row.extra_phones, '[]'::jsonb),
    'budget',          coalesce(v_row.budget, '{}'::jsonb),
    'access',          coalesce(v_row.access, '{}'::jsonb),
    'important_links', coalesce(v_row.important_links, '[]'::jsonb),
    'notes',           v_row.notes,
    'updated_at',      v_row.updated_at,
    'spend',           jsonb_build_object('meta', v_meta, 'google', v_google),
    'spend_month',     to_char(v_month_start, 'YYYY-MM')
  );
end;
$$;

-- Upsert com merge parcial: cada chave ausente no payload PRESERVA o valor atual (COALESCE).
-- Nunca reconstruir o JSONB do zero — payload parcial não deve zerar campos omitidos.
create or replace function public.upsert_clinic_client_info(p_clinic_id uuid, p_data jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then
    raise exception 'Clínica não encontrada';
  end if;
  if not can_manage_org(v_org) then
    raise exception 'Sem permissão';
  end if;

  insert into public.clinic_client_info as t
    (clinic_id, responsibles, extra_phones, budget, access, important_links, notes, updated_at, updated_by)
  values (
    p_clinic_id,
    coalesce(p_data->'responsibles', '[]'::jsonb),
    coalesce(p_data->'extra_phones', '[]'::jsonb),
    coalesce(p_data->'budget', '{}'::jsonb),
    coalesce(p_data->'access', '{}'::jsonb),
    coalesce(p_data->'important_links', '[]'::jsonb),
    nullif(p_data->>'notes', ''),
    now(),
    auth.uid()
  )
  on conflict (clinic_id) do update set
    responsibles    = coalesce(p_data->'responsibles', t.responsibles),
    extra_phones    = coalesce(p_data->'extra_phones', t.extra_phones),
    budget          = coalesce(p_data->'budget', t.budget),
    access          = coalesce(p_data->'access', t.access),
    important_links = coalesce(p_data->'important_links', t.important_links),
    notes           = case when p_data ? 'notes' then nullif(p_data->>'notes', '') else t.notes end,
    updated_at      = now(),
    updated_by      = auth.uid();
end;
$$;

grant execute on function public.get_clinic_client_info(uuid) to authenticated;
grant execute on function public.upsert_clinic_client_info(uuid, jsonb) to authenticated;
