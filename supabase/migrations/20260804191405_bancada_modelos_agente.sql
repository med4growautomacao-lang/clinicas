-- Bancada de modelos do Agente IA: replay de turnos REAIS contra vários modelos, lado a lado.
--
-- Por que congelar o input no caso (system_prompt + messages): o prompt do agente inclui o bloco
-- temporal ("Hoje é ...") e os "Dados do Contato", que mudam a cada dia e a cada análise. Se cada
-- modelo montasse o seu, a comparação mediria a diferença de PROMPT, não a de MODELO.
create table if not exists public.ai_bench_cases (
  id            uuid primary key default gen_random_uuid(),
  run_label     text not null,
  clinic_id     uuid references public.clinics(id) on delete cascade,
  lead_id       uuid,
  session_id    text not null,
  cutoff_seq    bigint not null,
  user_text     text not null,
  system_prompt text not null,
  messages      jsonb not null,
  baseline_reply text,
  baseline_calls int,
  nota          text,
  created_at    timestamptz not null default now()
);

create table if not exists public.ai_bench_results (
  id          uuid primary key default gen_random_uuid(),
  case_id     uuid not null references public.ai_bench_cases(id) on delete cascade,
  provider    text not null,
  model       text not null,
  status      text not null default 'pending',
  reply_text  text,
  tool_calls  jsonb not null default '[]'::jsonb,
  iters       int,
  tokens_in   int,
  tokens_out  int,
  latency_ms  int,
  guard_hit   boolean,
  error       text,
  started_at  timestamptz,
  created_at  timestamptz not null default now(),
  constraint ai_bench_results_status_chk check (status in ('pending','running','done','error')),
  constraint ai_bench_results_unq unique (case_id, model)
);

create index if not exists ix_ai_bench_results_pending on public.ai_bench_results (status) where status = 'pending';

alter table public.ai_bench_cases   enable row level security;
alter table public.ai_bench_results enable row level security;

-- Só super admin lê. O backend escreve por service_role, que ignora RLS.
drop policy if exists ai_bench_cases_su on public.ai_bench_cases;
create policy ai_bench_cases_su on public.ai_bench_cases for all
  using ((select public.is_super_admin())) with check ((select public.is_super_admin()));

drop policy if exists ai_bench_results_su on public.ai_bench_results;
create policy ai_bench_results_su on public.ai_bench_results for all
  using ((select public.is_super_admin())) with check ((select public.is_super_admin()));

-- Claim atômico: a bancada roda em várias invocações (limite de tempo da edge), então dois
-- disparos simultâneos não podem pegar o mesmo par (caso, modelo).
create or replace function public.ai_bench_claim(p_limit int default 3)
returns setof public.ai_bench_results
language plpgsql security definer set search_path to 'public' as $$
begin
  return query
  with picked as (
    select r.id from public.ai_bench_results r
     where r.status = 'pending'
     order by r.created_at
     limit p_limit
     for update skip locked
  )
  update public.ai_bench_results r
     set status = 'running', started_at = now()
    from picked p where r.id = p.id
  returning r.*;
end $$;

revoke all on function public.ai_bench_claim(int) from public, anon, authenticated;
grant execute on function public.ai_bench_claim(int) to service_role;
