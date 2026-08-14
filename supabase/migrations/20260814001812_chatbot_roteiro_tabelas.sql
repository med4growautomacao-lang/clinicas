-- Módulo Roteiro de Atendimento (Chatbot): as 4 tabelas.
--
-- Decisão do dono (13/08/2026): roteiro e agente de IA são EXCLUSIVOS por clínica, um OU outro,
-- nunca no mesmo atendimento. Por isso o motor NÃO pega carona no turno do ai-agent-worker: ele
-- tem gate próprio, derivado do MESMO cálculo de ingest_wa_message (ver migration do gate).
--
-- ⚠️ O estado do roteiro mora AQUI, nunca em tickets.dados_pre_atendimento. Provado no banco:
-- ticket_merge_dados_pre_atendimento tem `limit 15` e descarta o item MAIS ANTIGO (novos entram
-- com ord 1..n, antigos com 1000+ord). Como o campo mais antigo seria o Produto, e é ele que
-- condiciona Malha e Fio, usar a ficha como estado põe o robô em laço perguntando o produto de
-- novo, sem erro nenhum no sistema. A ficha é VITRINE (o que o vendedor lê), não banco de estado.

-- ── 1. Cabeçalho + rascunho ────────────────────────────────────────────────────────────────────
create table if not exists public.chatbot_scripts (
  id                    uuid primary key default gen_random_uuid(),
  clinic_id             uuid not null references public.clinics(id) on delete cascade,
  nome                  text not null default 'Roteiro de Atendimento',
  ativo                 boolean not null default false,
  versao_publicada      int,
  definicao_rascunho    jsonb not null default jsonb_build_object('passos', '[]'::jsonb),
  -- Onde o card vai parar quando o roteiro terminar. Validado na publicação: etapa de desfecho
  -- (ganho/perdido/agendado/entregue) é PROIBIDA, senão a trigger de consistência grava venda.
  etapa_destino_id      uuid references public.funnel_stages(id) on delete set null,
  -- Números de teste DO ROTEIRO, não os do ai_config. É isto que permite testar em produção sem
  -- tirar a IA dos outros contatos da clínica.
  test_numbers          text[] not null default '{}',
  -- Contato que sumiu no meio: passado disso, a sessão é dada como abandonada pelo cron.
  janela_retomada_horas int not null default 48,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- Um roteiro por clínica na v1 (vários roteiros ficou fora de escopo de propósito).
create unique index if not exists uq_chatbot_scripts_um_por_clinica
  on public.chatbot_scripts (clinic_id);

-- ── 2. Versão publicada, IMUTÁVEL ──────────────────────────────────────────────────────────────
-- A sessão fica pinada na versão em que começou. É isto que deixa o dono editar o roteiro com
-- conversa no ar sem repergunta em massa. Ninguém migra sessão de versão.
create table if not exists public.chatbot_versions (
  script_id     uuid not null references public.chatbot_scripts(id) on delete cascade,
  versao        int  not null,
  definicao     jsonb not null,
  publicado_em  timestamptz not null default now(),
  publicado_por uuid,
  primary key (script_id, versao)
);

-- ── 3. Sessão: o estado, ancorado no TICKET ────────────────────────────────────────────────────
-- No ticket e não no lead: "ticket novo = atendimento novo" é a regra da casa, e telefone
-- duplicado não pode dividir a mesma conversa em duas sessões.
create table if not exists public.chatbot_sessions (
  id                  uuid primary key default gen_random_uuid(),
  clinic_id           uuid not null references public.clinics(id) on delete cascade,
  lead_id             uuid references public.leads(id) on delete cascade,
  ticket_id           uuid not null references public.tickets(id) on delete cascade,
  script_id           uuid not null references public.chatbot_scripts(id) on delete cascade,
  versao              int  not null,
  -- {slug: {"valor": "...", "rotulo": "...", "em": "..."}}
  respostas           jsonb not null default '{}'::jsonb,
  -- {"passo": "malha", "opcoes": [{"id":"...","rotulo":"...","pos":1}], "em": "...", "kind": "menu"}
  -- ⚠️ `opcoes` guarda o que foi REALMENTE apresentado naquela mensagem. É contra isso que "2" é
  -- interpretado, e não contra a definição de hoje: senão o dono editar o roteiro faz o "2" de
  -- quem já recebeu a pergunta gravar no campo errado, e a ficha mente sem ninguém desconfiar.
  aguardando          jsonb,
  status              text not null default 'aguardando'
                      check (status in ('aguardando','transferido','abandonado','encerrado')),
  tentativas_passo    int  not null default 0,
  created_at          timestamptz not null default now(),
  ultima_interacao_em timestamptz not null default now()
);

-- Invariante por ÍNDICE, no padrão da casa: uma sessão aberta por ticket.
create unique index if not exists uq_chatbot_sessions_uma_aberta_por_ticket
  on public.chatbot_sessions (ticket_id) where status = 'aguardando';
create index if not exists idx_chatbot_sessions_clinic_status
  on public.chatbot_sessions (clinic_id, status, ultima_interacao_em);
create index if not exists idx_chatbot_sessions_lead
  on public.chatbot_sessions (lead_id) where lead_id is not null;

-- ── 4. Telemetria append-only ──────────────────────────────────────────────────────────────────
-- É a ÚNICA resposta possível para "onde o contato desiste". Nenhuma decisão do motor depende
-- dela: perder esta tabela custa um relatório, nunca uma conversa.
create table if not exists public.chatbot_events (
  id           bigserial primary key,
  clinic_id    uuid not null references public.clinics(id) on delete cascade,
  session_id   uuid references public.chatbot_sessions(id) on delete cascade,
  script_id    uuid,
  versao       int,
  passo        text,
  tipo         text not null
               check (tipo in ('apresentado','casado','nao_casou','degradou_texto',
                               'transferido','abandonado','encerrado','entregue_humano')),
  outbound_id  uuid,
  detalhe      jsonb not null default '{}'::jsonb,
  occurred_at  timestamptz not null default now()
);
create index if not exists idx_chatbot_events_clinic_data
  on public.chatbot_events (clinic_id, occurred_at desc);
create index if not exists idx_chatbot_events_session
  on public.chatbot_events (session_id, occurred_at);

-- ── RLS, no padrão novo (my_clinic_ids sem argumento = hashed SubPlan, roda 1x por query) ───────
alter table public.chatbot_scripts  enable row level security;
alter table public.chatbot_versions enable row level security;
alter table public.chatbot_sessions enable row level security;
alter table public.chatbot_events   enable row level security;

drop policy if exists chatbot_scripts_all on public.chatbot_scripts;
create policy chatbot_scripts_all on public.chatbot_scripts for all
  using (clinic_id in (select public.my_clinic_ids()) or (select public.is_super_admin()))
  with check (clinic_id in (select public.my_clinic_ids()) or (select public.is_super_admin()));

-- Versões não têm clinic_id: o escopo vem do script pai.
drop policy if exists chatbot_versions_all on public.chatbot_versions;
create policy chatbot_versions_all on public.chatbot_versions for all
  using (exists (select 1 from public.chatbot_scripts s
                  where s.id = script_id
                    and (s.clinic_id in (select public.my_clinic_ids()) or (select public.is_super_admin()))))
  with check (exists (select 1 from public.chatbot_scripts s
                  where s.id = script_id
                    and (s.clinic_id in (select public.my_clinic_ids()) or (select public.is_super_admin()))));

drop policy if exists chatbot_sessions_all on public.chatbot_sessions;
create policy chatbot_sessions_all on public.chatbot_sessions for all
  using (clinic_id in (select public.my_clinic_ids()) or (select public.is_super_admin()))
  with check (clinic_id in (select public.my_clinic_ids()) or (select public.is_super_admin()));

drop policy if exists chatbot_events_all on public.chatbot_events;
create policy chatbot_events_all on public.chatbot_events for all
  using (clinic_id in (select public.my_clinic_ids()) or (select public.is_super_admin()))
  with check (clinic_id in (select public.my_clinic_ids()) or (select public.is_super_admin()));

comment on table public.chatbot_scripts  is 'Roteiro de Atendimento por clínica: cabeçalho, rascunho e chaves. O publicado imutável fica em chatbot_versions.';
comment on table public.chatbot_versions is 'Versão publicada e IMUTÁVEL do roteiro. A sessão fica pinada na versão em que começou.';
comment on table public.chatbot_sessions is 'Estado do roteiro por TICKET. As respostas moram aqui, NUNCA em tickets.dados_pre_atendimento (que tem teto de 15 itens e descarta o mais antigo).';
comment on table public.chatbot_events   is 'Telemetria append-only do roteiro. Base do painel "Onde o contato para".';
