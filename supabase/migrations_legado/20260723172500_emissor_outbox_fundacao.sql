-- EMISSOR — fila de saida unica para TODA mensagem que sai do sistema.
--
-- Motivacao medida em 23/07/2026: existem 13 emissores independentes (8 edge functions + 5
-- funcoes do banco) falando com a uazapi por conta propria. Consequencias hoje:
--   1. `fn_clinic_send_token()` e o gate canonico (exige status='connected' + send_blocked_until
--      vencido + order by connected_at) e SO `process_pos_followup` o usa. `fn_handle_confirmation_reply`
--      e `notify_ops` fazem `select api_token ... limit 1` cru: enviam por instancia DESCONECTADA
--      (13 clinicas nesse estado agora) e ignoram a trava anti-ban.
--   2. `limit 1` sem `order by` devolve instancia arbitraria quando a clinica tiver duas.
--   3. Ninguem confirma entrega: `system_http_post` e assincrono e o resultado nunca e lido; todos
--      gravam em chat_messages como "enviado" incondicionalmente. Se a uazapi recusa, o painel
--      mente e o paciente nao recebeu. (E desde 20260723155500 o monitor ignora timeout, entao o
--      Emissor TEM que ler a resposta ele mesmo.)
--   4. Telefone as vezes normalizado, as vezes cru.
--
-- ESTA MIGRATION E SO A FUNDACAO: cria a fila e as operacoes. NENHUM produtor passa a usa-la
-- aqui. A chave (`fn_emissor_ativo`) nasce DESLIGADA para todo mundo.
--
-- Por que tabela+claim e nao pgmq: pgmq esta instalado mas com zero filas; as tres filas da casa
-- (conv_ai_queue, ai_turn_buffer, outbox do CAPI) sao tabela+claim. Migrar 13 emissores ao vivo E
-- estrear pgmq na mesma mexida dobraria o risco. Quatro filas iguais agora, migrar as quatro
-- juntas depois. Ver [[pgmq-dispatch-standardization]].
-- Por que nao particionar ja: ~2.400 mensagens/dia (volume outbound real medido). Purga de
-- terminais com mais de 30 dias resolve; pg_partman entra se o volume justificar.

create table if not exists public.outbound_messages (
  id                uuid primary key default gen_random_uuid(),
  clinic_id         uuid not null references public.clinics(id) on delete cascade,
  lead_id           uuid references public.leads(id) on delete set null,

  -- Destino. `to_addr` entra SEMPRE normalizado (normalize_br_phone aplicado no emit_message);
  -- grupo do WhatsApp nao e telefone e passa direto.
  to_addr           text not null,
  to_kind           text not null default 'lead' check (to_kind in ('lead','group','ops')),

  -- Conteudo
  kind              text not null default 'text' check (kind in ('text','media','audio')),
  body              text,
  media_url         text,
  media_base64      text,
  media_mime        text,
  media_kind        text,
  delay_ms          int  not null default 0,

  -- Roteamento: 'sandbox' e o que torna o simulador possivel sem um `if` em cada produtor.
  transport         text not null default 'uazapi' check (transport in ('uazapi','sandbox')),

  -- Quem pediu (para a auditoria de saida responder "quem falou com esse paciente?")
  producer          text not null,

  -- Ordem: mensagens da MESMA conversa saem na ordem em que foram pedidas (o agente manda varias
  -- bolhas em sequencia). `seq` e global e monotonico; a ordem util e por conversation_key.
  conversation_key  text not null,
  seq               bigint not null generated always as identity,

  -- Idempotencia do produtor: com dedup_key preenchida, pedir duas vezes nao envia duas vezes.
  -- E o que permite retry seguro (hoje reprocessar um turno do agente manda bolha dobrada).
  dedup_key         text,

  status            text not null default 'pending'
                    check (status in ('pending','sending','sent','failed','dropped','simulated')),
  attempts          int  not null default 0,
  max_attempts      int  not null default 3,
  not_before        timestamptz not null default now(),
  claimed_at        timestamptz,
  claimed_by        text,
  sent_at           timestamptz,

  -- Resultado REAL do provedor (o que hoje ninguem guarda)
  provider_status   int,
  provider_message_id text,
  provider_response jsonb,
  last_error        text,

  -- So preenchido DEPOIS de confirmar o envio: chat_messages deixa de mentir.
  chat_message_id   uuid,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint outbound_body_ou_midia check (
    (kind = 'text'  and coalesce(btrim(body), '') <> '') or
    (kind <> 'text' and (media_url is not null or media_base64 is not null))
  )
);

comment on table public.outbound_messages is
  'Fila de saida unica (Emissor). Todo envio ao paciente passa por aqui: um gate de token, uma confirmacao de entrega, um log de auditoria, e transporte plugavel (uazapi | sandbox).';

-- Idempotencia: pedir o mesmo envio duas vezes nao duplica.
create unique index if not exists uq_outbound_dedup
  on public.outbound_messages (dedup_key) where dedup_key is not null;

-- Claim: so as pendentes vencidas interessam ao worker.
create index if not exists ix_outbound_claim
  on public.outbound_messages (not_before, seq) where status = 'pending';

-- Ordem por conversa + deteccao de "ha algo em voo nesta conversa".
create index if not exists ix_outbound_conversa
  on public.outbound_messages (conversation_key, seq) where status in ('pending','sending');

-- Auditoria por clinica ("o que saiu hoje?") e purga.
create index if not exists ix_outbound_clinic_created
  on public.outbound_messages (clinic_id, created_at desc);

create trigger trg_outbound_updated_at
  before update on public.outbound_messages
  for each row execute function public.handle_updated_at();

-- RLS: leitura para quem ja enxerga a clinica; escrita so por service_role/SECURITY DEFINER.
-- Usa is_clinic_admin/is_super_admin (is_admin() esta fora de todas as policies de proposito:
-- dava bypass cross-org).
alter table public.outbound_messages enable row level security;

create policy outbound_select_clinic on public.outbound_messages
  for select to authenticated
  using (public.is_super_admin() or public.is_clinic_admin(clinic_id));
