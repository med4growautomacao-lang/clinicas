-- Central de Erros — o "Sentry" do projeto, nativo.
--
-- POR QUE NÃO UM SENTRY DE VERDADE: error tracker captura EXCEÇÃO. Passando os bugs reais desta
-- semana por esse filtro, ele pegaria 2 de 8. O n8n perdendo o clique quando a Graph API recusava,
-- o welcome queimando 14 leads pagos numa falha de infra, o fluxo pausado sem ninguém ver, o
-- Anúncio no Status descartado, a campanha congelada no primeiro clique, o loop de reengajamento —
-- **nenhum deles lançou exceção**. Eram decisões erradas tomadas com sucesso. Além disso, metade do
-- sistema vive no Postgres (triggers, RPCs, cron), onde um SDK de SaaS não enxerga; e os payloads
-- têm telefone e conversa de paciente, que não vão para terceiro sem decisão jurídica.
--
-- O que copiamos do Sentry (as ideias boas): FINGERPRINT com agregação — sem isso, 500 erros iguais
-- viram enxurrada e a pessoa para de olhar, que é o mesmo que não ter monitoramento.
--
-- DUAS NATUREZAS na mesma tabela, e a diferença importa:
--   • EVENTO   (is_monitor=false): aconteceu e passou. Só um humano resolve.
--   • CONDIÇÃO (is_monitor=true):  é um estado que vale AGORA (token bloqueado, instância caída).
--                                   Se o estado some, o próprio monitor marca como resolvido.

begin;

create table if not exists public.system_errors (
  id             uuid primary key default gen_random_uuid(),

  -- Chave de agrupamento: mesma origem + mesmo código + mesma clínica = mesma linha, contador sobe.
  fingerprint    text not null unique,

  scope          text not null,                    -- 'ctwa-tracking', 'cron', 'pg_net', 'monitor'...
  code           text not null,                    -- 'graph_api_blocked', 'clinic_not_found'...
  level          text not null default 'error',    -- 'warn' | 'error' | 'critical'
  title          text not null,                    -- frase legível, em português
  clinic_id      uuid references public.clinics(id) on delete set null,

  is_monitor     boolean not null default false,   -- condição (auto-resolve) vs evento

  occurrences    integer not null default 1,
  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),

  status         text not null default 'open',     -- 'open' | 'ack' | 'resolved'
  resolved_at    timestamptz,

  last_context   jsonb,

  constraint system_errors_level_chk  check (level  in ('warn','error','critical')),
  constraint system_errors_status_chk check (status in ('open','ack','resolved'))
);

create index if not exists system_errors_status_idx on public.system_errors (status, level, last_seen_at desc);
create index if not exists system_errors_clinic_idx on public.system_errors (clinic_id);

comment on table public.system_errors is
  'Central de Erros: falhas e condições anômalas de todo o sistema (edge functions, crons, invariantes de domínio), agregadas por fingerprint. Visível só para super admin.';

-- ---------------------------------------------------------------------------
-- Registro (chamável tanto das edges quanto de dentro do Postgres)
-- ---------------------------------------------------------------------------
create or replace function public.log_system_error(
  p_scope      text,
  p_code       text,
  p_title      text,
  p_level      text    default 'error',
  p_clinic_id  uuid    default null,
  p_context    jsonb   default null,
  p_is_monitor boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_fp text;
  v_id uuid;
begin
  -- A clínica entra no fingerprint DE PROPÓSITO: "token bloqueado" é um problema por clínica, e
  -- juntar todas numa linha só esconderia quantas estão afetadas — que é a informação acionável.
  v_fp := md5(p_scope || '|' || p_code || '|' || coalesce(p_clinic_id::text, '-'));

  insert into public.system_errors as e (
    fingerprint, scope, code, level, title, clinic_id, is_monitor, last_context
  ) values (
    v_fp, p_scope, p_code, coalesce(p_level, 'error'), p_title, p_clinic_id,
    coalesce(p_is_monitor, false), p_context
  )
  on conflict (fingerprint) do update set
    occurrences  = e.occurrences + 1,
    last_seen_at = now(),
    title        = excluded.title,
    level        = excluded.level,
    last_context = coalesce(excluded.last_context, e.last_context),
    -- Voltou a acontecer depois de resolvido? Reabre — senão o problema fica invisível na recaída.
    status       = case when e.status = 'resolved' then 'open' else e.status end,
    resolved_at  = case when e.status = 'resolved' then null  else e.resolved_at end
  returning e.id into v_id;

  return v_id;
end;
$function$;

revoke all on function public.log_system_error(text, text, text, text, uuid, jsonb, boolean) from public, anon;
grant execute on function public.log_system_error(text, text, text, text, uuid, jsonb, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- Visibilidade: só super admin (decisão do usuário)
-- ---------------------------------------------------------------------------
alter table public.system_errors enable row level security;

drop policy if exists system_errors_super_admin_all on public.system_errors;
create policy system_errors_super_admin_all on public.system_errors
  for all
  using (public.is_super_admin())
  with check (public.is_super_admin());

grant select, update on public.system_errors to authenticated;

commit;
