-- Catálogo canônico de MOTIVO DE PERDA.
--
-- Problema que resolve: `tickets.loss_reason` é texto livre escrito por 6 produtores diferentes
-- (2 dropdowns do front, a IA, a automação de reengajamento, a auditoria de onboarding e o CRM
-- externo do cliente). Resultado medido em 10/08/2026: 28 rótulos distintos para ~14 motivos reais,
-- com sinônimos ("Preço alto" x "Preço", "Fora do perfil" x "Sem perfil") competindo entre si no
-- top-3 do relatório do dono, e 739 perdas sem motivo nenhum.
--
-- Desenho: o SLUG é global e fechado (fonte única por conceito, o KPI não se parte entre MedDesk e
-- WakeDesk); só o RÓTULO ramifica por marca. O texto original NUNCA é apagado — `loss_reason`
-- continua sendo gravado como snapshot, e o slug entra em coluna nova.
--
-- Esta fase é fundação: NADA lê estas tabelas ainda.

-- ---------------------------------------------------------------- catálogo global

create table if not exists public.loss_reasons (
  slug              text primary key check (slug ~ '^[a-z0-9_]+$'),
  -- ^ sem acento, sem espaço e SEM VÍRGULA de propósito: o filtro do Comercial faz
  --   string_to_array(p_loss_reasons, ','), e um motivo com vírgula fatiaria o filtro em pedaços
  --   que não casam com nada, devolvendo painel vazio que parece "período sem perdas".
  label             text not null,          -- rótulo neutro (§0.2), serve às duas marcas
  label_clinica     text,                   -- só quando o termo neutro for incompatível
  label_outro       text,
  descricao         text not null,          -- definição de 1 linha; é o que a IA lê para escolher
  position          int  not null default 0,
  ia_pode_escolher  boolean not null default false,
  categorias        text[] not null default array['clinica','outro','meta_tester'],
  is_system         boolean not null default false,  -- fora do menu humano e fora do enum da IA
  ativo             boolean not null default true,
  created_at        timestamptz not null default now()
);

comment on table public.loss_reasons is
  'Catálogo global de motivo de perda. Slug é a chave do KPI; label ramifica por marca.';

-- ---------------------------------------------------------------- override por clínica

create table if not exists public.clinic_loss_reasons (
  clinic_id         uuid not null references public.clinics(id) on delete cascade,
  slug              text not null references public.loss_reasons(slug) on delete cascade,
  enabled           boolean not null default true,
  label_custom      text,
  ia_pode_escolher  boolean,   -- null = herda do catálogo global
  position          int,
  primary key (clinic_id, slug)
);

comment on table public.clinic_loss_reasons is
  'Ajuste por cliente: liga/desliga, renomeia e restringe o que a IA pode escolher. Null herda o global.';

-- ---------------------------------------------------------------- de-para

create table if not exists public.loss_reason_aliases (
  alias_norm  text primary key,   -- chave = normalize_stage_text(texto original)
  slug        text not null references public.loss_reasons(slug) on delete cascade,
  origem      text not null default 'legado' check (origem in ('legado','crm','automacao','manual')),
  exemplo     text,               -- o texto cru, para arqueologia
  created_at  timestamptz not null default now()
);

comment on table public.loss_reason_aliases is
  'Traduz texto legado/CRM/automação para o slug canônico. Chave normalizada: mata a divergência de acento dos dois dropdowns de graça.';

create index if not exists idx_loss_reason_aliases_slug on public.loss_reason_aliases(slug);

-- ---------------------------------------------------------------- colunas novas

alter table public.tickets add column if not exists loss_reason_slug text;
alter table public.tickets add column if not exists loss_note text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tickets_loss_reason_slug_fkey') then
    alter table public.tickets
      add constraint tickets_loss_reason_slug_fkey
      foreign key (loss_reason_slug) references public.loss_reasons(slug) on delete set null;
  end if;
end $$;

comment on column public.tickets.loss_reason_slug is
  'Motivo canônico. É por AQUI que os painéis agrupam. loss_reason (texto) fica como snapshot.';
comment on column public.tickets.loss_note is
  'Anotação livre DA PERDA. Campo próprio de propósito: tickets.notes é compartilhado e três rotinas o apagam (onboarding_audit_apply, save_orcamento, import_historical_lead).';

-- índice parcial: os painéis só agrupam perdidos
create index if not exists idx_tickets_loss_reason_slug
  on public.tickets(clinic_id, loss_reason_slug)
  where outcome = 'perdido';

-- ---------------------------------------------------------------- RLS

alter table public.loss_reasons        enable row level security;
alter table public.clinic_loss_reasons enable row level security;
alter table public.loss_reason_aliases enable row level security;

-- Catálogo global: todo mundo logado LÊ; só super admin escreve.
drop policy if exists loss_reasons_read on public.loss_reasons;
create policy loss_reasons_read on public.loss_reasons
  for select to authenticated using (true);

drop policy if exists loss_reasons_write on public.loss_reasons;
create policy loss_reasons_write on public.loss_reasons
  for all to authenticated
  using ((select public.is_super_admin())) with check ((select public.is_super_admin()));

drop policy if exists loss_reason_aliases_read on public.loss_reason_aliases;
create policy loss_reason_aliases_read on public.loss_reason_aliases
  for select to authenticated using (true);

drop policy if exists loss_reason_aliases_write on public.loss_reason_aliases;
create policy loss_reason_aliases_write on public.loss_reason_aliases
  for all to authenticated
  using ((select public.is_super_admin())) with check ((select public.is_super_admin()));

-- Override por clínica: régua set-based (my_clinic_ids sem argumento resolve 1x por query, §2).
drop policy if exists clinic_loss_reasons_all on public.clinic_loss_reasons;
create policy clinic_loss_reasons_all on public.clinic_loss_reasons
  for all to authenticated
  using (clinic_id in (select public.my_clinic_ids()) or (select public.is_super_admin()))
  with check (clinic_id in (select public.my_clinic_ids()) or (select public.is_super_admin()));

