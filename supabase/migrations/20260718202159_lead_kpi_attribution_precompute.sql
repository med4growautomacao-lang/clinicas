-- 20260718202159_lead_kpi_attribution_precompute
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Atribuição IA×Humano PRÉ-CALCULADA. Calcular on-the-fly custa ~5s em clínica grande
-- (varre dezenas de milhares de mensagens por load) — inviável na VG "rápida". Refresh
-- por cron ~10min (decisão do dono). Regra canônica única: 1º agendamento do lead
-- (appointments.source ia→IA / manual→Humano) → senão maioria de mensagens
-- (chat_messages sender ai × human+outbound, empate→IA) → senão 'nao_atendido'.

create table if not exists public.lead_kpi_attribution (
  lead_id uuid primary key references public.leads(id) on delete cascade,
  clinic_id uuid not null,
  agent text not null check (agent in ('ia','humano','nao_atendido')),
  computed_at timestamptz not null default now()
);
create index if not exists idx_lead_kpi_attribution_clinic_agent on public.lead_kpi_attribution (clinic_id, agent);

-- RLS: escrita só pela função definer; leitura direta (via PostgREST) só admin da clínica.
-- As RPCs de dashboard são SECURITY DEFINER e leem sem depender destas policies.
alter table public.lead_kpi_attribution enable row level security;
drop policy if exists lead_kpi_attribution_read on public.lead_kpi_attribution;
create policy lead_kpi_attribution_read on public.lead_kpi_attribution
  for select using (is_clinic_admin(clinic_id) or is_super_admin());

create or replace function public.refresh_lead_attribution()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_count integer;
begin
  insert into public.lead_kpi_attribution (lead_id, clinic_id, agent, computed_at)
  with first_appt as (
    select distinct on (t.lead_id) t.lead_id, a.source
    from public.appointments a join public.tickets t on t.id=a.ticket_id
    where a.source is not null
    order by t.lead_id, a.created_at asc
  ),
  msg as (
    select cm.lead_id,
      count(*) filter (where cm.sender='ai') as ai_out,
      count(*) filter (where cm.sender='human' and cm.direction='outbound') as human_out
    from public.chat_messages cm where cm.lead_id is not null group by cm.lead_id
  )
  select l.id, l.clinic_id,
    case
      when fa.source='ia' then 'ia'
      when fa.source='manual' then 'humano'
      when coalesce(m.ai_out,0)+coalesce(m.human_out,0)>0
        then case when coalesce(m.ai_out,0)>=coalesce(m.human_out,0) then 'ia' else 'humano' end
      else 'nao_atendido'
    end,
    now()
  from public.leads l
  left join first_appt fa on fa.lead_id=l.id
  left join msg m on m.lead_id=l.id
  where coalesce(l.is_not_lead,false)=false
  on conflict (lead_id) do update
    set agent=excluded.agent, clinic_id=excluded.clinic_id, computed_at=now();
  get diagnostics v_count = row_count;
  return v_count;
exception when others then
  -- Falha do refresh = atribuição fica STALE (dashboards seguem funcionando com o
  -- valor anterior). O EXCEPTION rola de volta ao savepoint, então o log PERSISTE.
  perform log_system_error('cron','LEAD_ATTRIBUTION_REFRESH_FAIL',
    'refresh_lead_attribution falhou: '||sqlerrm, 'error', null,
    jsonb_build_object('sqlstate', sqlstate), true);
  return -1;
end;
$function$;

revoke execute on function public.refresh_lead_attribution() from anon, authenticated;
