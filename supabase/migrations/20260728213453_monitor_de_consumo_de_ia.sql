-- MONITOR DE CONSUMO DE IA — uma linha por chamada a provedor, em TODAS as funções.
--
-- Por que: o provedor devolve o consumo em toda resposta e o sistema jogava fora. So o
-- conv-ai-analyst guardava (em conv_ai_insights), e justamente o AGENTE — o maior consumidor —
-- ficava sem registro. Resultado: "quem esta gastando mais?" so tinha resposta por estimativa
-- de volume, nunca por consumo real.
--
-- `feature` = a chave de system_settings que o Super Admin edita, para o painel agrupar pelas
-- MESMAS funcoes que ele configura:
--   agent_ai_config      -> Agente IA (fala com o paciente)
--   conv_ai_config       -> Analista Conversacional (analise + aprendizado)
--   ai_assistant_config  -> Assistente de dados no app
--   media_ai_config      -> Transcricao de audio/imagem recebidos
--   elevenlabs_config    -> Voz (TTS) — cobrado por CARACTERE, nao por token
--
-- `scope` = de onde saiu (edge/passo), para achar o culpado quando um numero pular.

create table if not exists public.llm_usage (
  id           uuid primary key default gen_random_uuid(),
  clinic_id    uuid references public.clinics(id) on delete set null,
  lead_id      uuid,
  feature      text not null,
  scope        text not null,
  provider     text not null,
  model        text,
  tokens_in    integer not null default 0,
  tokens_out   integer not null default 0,
  -- Para o que NAO e cobrado por token: TTS conta caracteres, transcricao pode contar segundos.
  units        integer not null default 0,
  unit_kind    text,
  ok           boolean not null default true,
  error        text,
  duration_ms  integer,
  created_at   timestamptz not null default now()
);

comment on table public.llm_usage is
  'Consumo de IA por chamada. feature = chave de system_settings que o Super Admin edita; scope = edge/passo de origem. Escrita SO por log_llm_usage (DEFINER). Purga em 90 dias.';

-- Os 3 recortes do painel: por dia, por clinica e por funcao.
create index if not exists idx_llm_usage_created    on public.llm_usage (created_at desc);
create index if not exists idx_llm_usage_clinic     on public.llm_usage (clinic_id, created_at desc);
create index if not exists idx_llm_usage_feature    on public.llm_usage (feature, created_at desc);

alter table public.llm_usage enable row level security;

-- Leitura so de super admin (e painel de Super Admin). Escrita nao tem policy de proposito:
-- entra unicamente pela RPC SECURITY DEFINER abaixo.
drop policy if exists llm_usage_super_admin_read on public.llm_usage;
create policy llm_usage_super_admin_read on public.llm_usage
  for select using ((select public.is_super_admin()));

-- ── Registro ────────────────────────────────────────────────────────────────
-- NUNCA levanta excecao: monitor que derruba a funcao monitorada e pior que nao ter monitor.
create or replace function public.log_llm_usage(
  p_feature text,
  p_scope text,
  p_provider text,
  p_model text default null,
  p_clinic_id uuid default null,
  p_tokens_in integer default 0,
  p_tokens_out integer default 0,
  p_ok boolean default true,
  p_error text default null,
  p_duration_ms integer default null,
  p_units integer default 0,
  p_unit_kind text default null,
  p_lead_id uuid default null
) returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into public.llm_usage (
    clinic_id, lead_id, feature, scope, provider, model,
    tokens_in, tokens_out, units, unit_kind, ok, error, duration_ms
  ) values (
    p_clinic_id, p_lead_id,
    coalesce(nullif(btrim(p_feature),''), 'desconhecido'),
    coalesce(nullif(btrim(p_scope),''), 'desconhecido'),
    coalesce(nullif(btrim(p_provider),''), 'desconhecido'),
    nullif(btrim(p_model),''),
    greatest(coalesce(p_tokens_in,0), 0), greatest(coalesce(p_tokens_out,0), 0),
    greatest(coalesce(p_units,0), 0), nullif(btrim(p_unit_kind),''),
    coalesce(p_ok, true), left(nullif(btrim(p_error),''), 500), p_duration_ms
  );
exception when others then
  null;  -- monitor mudo por design: falhar aqui nao pode custar um atendimento
end $function$;

-- ── Purga (mesma politica da fila de saida) ─────────────────────────────────
create or replace function public.purge_llm_usage()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_n integer;
begin
  delete from public.llm_usage where created_at < now() - interval '90 days';
  get diagnostics v_n = row_count;
  return v_n;
end $function$;

-- Backend-only nos dois (o `create function` reconcede EXECUTE ao PUBLIC; revogar so de anon
-- deixaria o grant de PUBLIC de pe — ver §1 do CLAUDE.md).
revoke all on function public.log_llm_usage(text,text,text,text,uuid,integer,integer,boolean,text,integer,integer,text,uuid) from public, anon, authenticated;
revoke all on function public.purge_llm_usage() from public, anon, authenticated;

-- ── Preço por modelo (editável no Super Admin) ──────────────────────────────
-- Guardado como CONFIG, nao no codigo: preco de LLM muda sozinho e ninguem quer deploy para isso.
-- Valores em US$ por 1 MILHAO de tokens (TTS: US$ por 1 milhao de caracteres).
insert into public.system_settings (id, value)
values ('llm_prices', jsonb_build_object(
  'moeda','USD',
  'por','1M',
  'modelos', jsonb_build_object(
    'gemini-3.1-pro-preview-customtools', jsonb_build_object('in', 1.25, 'out', 10.0),
    'gemini-3.1-flash-lite',              jsonb_build_object('in', 0.10, 'out', 0.40),
    'claude-sonnet-5',                    jsonb_build_object('in', 3.00, 'out', 15.0),
    'claude-haiku-4-5',                   jsonb_build_object('in', 1.00, 'out', 5.00),
    'eleven_multilingual_v2',             jsonb_build_object('in', 0.00, 'out', 0.00)
  )
)::text)
on conflict (id) do nothing;
