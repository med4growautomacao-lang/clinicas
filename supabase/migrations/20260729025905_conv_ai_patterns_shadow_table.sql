-- 20260729025905_conv_ai_patterns_shadow_table
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- =============================================================================
-- Motor de sugestão mecânica (4º modo do analista de conversas): a "estante de padrões".
--
-- Tabela NOVA e INDEPENDENTE. NÃO tem relação com stage_transition_rules (o motor de
-- keyword que já existe e MOVE a etapa). Esta aqui SUGERE, é minerada POR CLÍNICA, e
-- guarda pares entrada+saída com a confiança e a ORIGEM dela. Nasce em SOMBRA: vazia,
-- ninguém lê em produção ainda.
--
-- Segurança: espelha conv_ai_clinic_config (clinic-scoped OR super admin). O backend
-- (minerador/matcher) usa service_role, que ignora RLS. anon não acessa nenhuma linha.
-- Ganho nunca é alvo mecânico (decisão de produto); target_kind existe mas o uso será stage.
-- =============================================================================
create table if not exists public.conv_ai_patterns (
  id              uuid primary key default gen_random_uuid(),
  clinic_id       uuid not null references public.clinics(id) on delete cascade,
  side            text not null check (side in ('inbound','outbound','pair')),
  phrase_in       text,                              -- frase do paciente (normalizada na comparação)
  phrase_out      text,                              -- frase da clínica
  window_msgs     integer not null default 5,        -- janela entre os dois lados (para 'pair')
  order_strict    boolean not null default false,    -- exige entrada antes da saída
  target_kind     text not null default 'stage' check (target_kind in ('stage','sale')),
  target_stage_id uuid references public.funnel_stages(id) on delete cascade,
  confidence      numeric not null default 0.5 check (confidence >= 0 and confidence <= 1),
  source          text not null default 'mined' check (source in ('mined','pair','manual')),
  hits            integer not null default 0,        -- quantas vezes o padrão casou (auditoria)
  accepted        integer not null default 0,        -- confirmado pelo humano na fila
  rejected        integer not null default 0,        -- descartado pelo humano
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint conv_ai_patterns_has_phrase check (phrase_in is not null or phrase_out is not null)
);

create index if not exists idx_conv_ai_patterns_clinic on public.conv_ai_patterns(clinic_id);
create index if not exists idx_conv_ai_patterns_active on public.conv_ai_patterns(clinic_id) where is_active;

alter table public.conv_ai_patterns enable row level security;

revoke all on table public.conv_ai_patterns from public;
grant select, insert, update, delete on table public.conv_ai_patterns to authenticated, service_role;

drop policy if exists conv_ai_patterns_rw on public.conv_ai_patterns;
create policy conv_ai_patterns_rw on public.conv_ai_patterns
  for all
  using ((clinic_id in (select public.my_clinic_ids())) or (select public.is_super_admin()))
  with check ((clinic_id in (select public.my_clinic_ids())) or (select public.is_super_admin()));
