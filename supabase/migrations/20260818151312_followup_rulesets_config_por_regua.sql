-- A chave "marcar Perdido ao terminar a régua" passa a ser POR RÉGUA, não por clínica.
-- Motivo (decisão do dono, 18/08/2026): com cadência por etapa, "acabou a régua desta coluna"
-- não quer dizer a mesma coisa em todas as colunas, então a decisão de arquivar tem que ser
-- de cada régua.
--
-- A configuração ganha tabela própria em vez de virar coluna repetida em followup_steps:
-- ela é da RÉGUA, não do passo, e replicá-la por linha só criaria divergência.
-- Ausência de linha = true = comportamento histórico (fn_check_followup_exhausted marcava
-- Perdido sem que ninguém pudesse desligar).
--
-- A coluna criada horas antes em ai_config sai junto: nasceu na mesma sessão, nunca foi lida em
-- produção (a tela ainda não subiu) e manter duas fontes para a mesma decisão é o começo de
-- um bug de "salvar não pega".

create table if not exists public.followup_rulesets (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  -- null = régua PADRÃO (a que vale para toda etapa sem régua própria)
  stage_id uuid,
  close_ticket_on_exhaust boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- FK composta: garante que a etapa é da MESMA clínica (a RLS só olha clinic_id)
  constraint followup_rulesets_stage_fk
    foreign key (clinic_id, stage_id) references public.funnel_stages (clinic_id, id) on delete cascade
);

create unique index if not exists uq_followup_rulesets_clinic_stage
  on public.followup_rulesets (clinic_id, stage_id) nulls not distinct;

comment on table public.followup_rulesets is
  'Configuração da régua de reengajamento (uma linha por régua; stage_id null = Padrão). Linha ausente = padrões de fábrica, que são o comportamento histórico.';
comment on column public.followup_rulesets.close_ticket_on_exhaust is
  'Ao esgotar ESTA régua sem passo de encerramento, marcar o atendimento como Perdido (sem mensagem). Default true = comportamento histórico.';

drop trigger if exists tr_followup_rulesets_updated_at on public.followup_rulesets;
create trigger tr_followup_rulesets_updated_at
  before update on public.followup_rulesets
  for each row execute function public.handle_updated_at();

alter table public.followup_rulesets enable row level security;

-- espelha as policies de followup_steps (mesma tabela irmã, mesmo alcance)
drop policy if exists followup_rulesets_all on public.followup_rulesets;
create policy followup_rulesets_all on public.followup_rulesets
  for all
  using (clinic_id in (select public.my_clinic_ids()) or (select public.is_super_admin()));

drop policy if exists followup_rulesets_org_access on public.followup_rulesets;
create policy followup_rulesets_org_access on public.followup_rulesets
  for all
  using (clinic_id in (
    select c.id from public.clinics c
      join public.org_users ou on ou.organization_id = c.organization_id
     where ou.user_id = auth.uid()));

-- ACL default de tabela já vazou para anon neste projeto: conceder é explícito
revoke all on table public.followup_rulesets from public, anon, authenticated;
grant select, insert, update, delete on table public.followup_rulesets to authenticated;
grant all on table public.followup_rulesets to service_role;

-- Esgotamento passa a ler a chave DA RÉGUA do contato
create or replace function public.fn_check_followup_exhausted()
returns trigger
language plpgsql
set search_path to 'public', 'extensions'
as $function$
declare
  v_total int;
  v_has_closing boolean;
  v_perdido_id uuid;
  v_fechar boolean;
begin
  if NEW.followup_count = OLD.followup_count then return NEW; end if;

  -- Escopo é a RÉGUA do contato (NULL = Padrão), não a clínica inteira.
  select count(*) filter (where enabled),
         coalesce(bool_or(enabled and is_closing), false)
    into v_total, v_has_closing
  from public.followup_steps
  where clinic_id = NEW.clinic_id
    and stage_id is not distinct from NEW.followup_ruleset_stage_id;

  -- Com passo de encerramento, quem fecha é a edge (despedida + finalize_ticket). Sair AQUI é o
  -- que impede os dois caminhos de agirem no mesmo atendimento.
  if v_has_closing then return NEW; end if;

  if v_total is null or v_total = 0 or NEW.followup_count < v_total then
    return NEW;
  end if;

  select coalesce(
           (select r.close_ticket_on_exhaust
              from public.followup_rulesets r
             where r.clinic_id = NEW.clinic_id
               and r.stage_id is not distinct from NEW.followup_ruleset_stage_id),
           true)
    into v_fechar;
  if not v_fechar then return NEW; end if;

  select id into v_perdido_id
  from public.funnel_stages
  where clinic_id = NEW.clinic_id and slug = 'perdido'
  limit 1;

  if v_perdido_id is not null then
    -- COALESCE nos dois motivos: se a equipe já tinha registrado algo, a automação não sobrescreve.
    update public.tickets
      set stage_id         = v_perdido_id,
          loss_reason      = coalesce(loss_reason, 'Tentativas de follow-up esgotadas'),
          loss_reason_slug = coalesce(loss_reason_slug, 'sem_resposta')
      where lead_id = NEW.id and status = 'open';
    NEW.loss_reason := 'Tentativas de follow-up esgotadas';
  end if;

  return NEW;
end;
$function$;

alter table public.ai_config drop column if exists followup_close_ticket_on_exhaust;
