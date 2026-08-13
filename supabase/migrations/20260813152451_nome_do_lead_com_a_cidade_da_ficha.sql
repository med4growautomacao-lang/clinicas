-- "Nome / Cidade" no nome do lead, a partir da ficha do pré-atendimento.
--
-- POR QUE: a Metaltres vende para o país inteiro e o frete depende da cidade, então a equipe já
-- fazia isso NA MÃO. Entre os leads com "/" no nome existem "Luiz Gustavo/tc" (Três Corações) e
-- "João Vitor/santa Rita do Sapucaí": o padrão não é novo, é o que eles já digitavam. O agente já
-- coleta a cidade (campo `cidade` da ficha, em `tickets.dados_pre_atendimento`), então o nome
-- passa a sair pronto e sem depender de alguém lembrar.
--
-- ⚠️ NÃO é hard-code de tenant. Quem liga é `clinics.lead_name_suffix_field`, que diz QUAL campo
-- da ficha vai para o nome. NULL (todas as outras clínicas) = desligado, e o gatilho sai na
-- primeira linha, antes de tocar em `tickets`. Hoje só a Metaltres tem 'cidade'.

alter table public.clinics
  add column if not exists lead_name_suffix_field text;

comment on column public.clinics.lead_name_suffix_field is
  'Campo da ficha do pré-atendimento (tickets.dados_pre_atendimento->itens[].campo) anexado ao nome do lead como "Nome / Valor". NULL = desligado. Hoje: Metaltres = cidade.';

-- ── O trabalho, em um lugar só ────────────────────────────────────────────────────────────────
create or replace function public.fn_aplica_sufixo_nome_lead(p_lead_id uuid, p_clinic_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_campo text;
  v_valor text;
  v_atual text;
  v_base  text;
  v_novo  text;
begin
  if p_lead_id is null or p_clinic_id is null then return; end if;

  select nullif(btrim(lead_name_suffix_field), '') into v_campo
    from clinics where id = p_clinic_id;
  if v_campo is null then return; end if;  -- desligado: saída de quase todas as clínicas

  -- Ficha mais recente do CONTATO que tenha o campo preenchido. Atravessa tickets de propósito:
  -- atendimento novo do mesmo cliente não apaga a cidade que ele já informou uma vez.
  select btrim(i->>'valor') into v_valor
    from tickets t, lateral jsonb_array_elements(t.dados_pre_atendimento->'itens') i
   where t.lead_id = p_lead_id
     and jsonb_typeof(t.dados_pre_atendimento->'itens') = 'array'
     and lower(btrim(i->>'campo')) = lower(v_campo)
     and btrim(coalesce(i->>'valor','')) <> ''
   order by t.created_at desc
   limit 1;
  if v_valor is null then return; end if;  -- ainda não informou: o nome fica como está
  v_valor := left(v_valor, 60);            -- ficha é texto livre; nome de card não é parágrafo

  select name into v_atual from leads where id = p_lead_id;

  -- Base = o que vem ANTES da primeira barra. É o que torna a regra idempotente (rodar de novo
  -- não empilha " / Cidade / Cidade") e, de quebra, normaliza o que foi digitado à mão:
  -- "Luiz Gustavo/tc" vira "Luiz Gustavo / Três Corações".
  v_base := btrim(split_part(coalesce(v_atual, ''), '/', 1));
  if v_base = '' then return; end if;      -- nunca montar um nome que seja só a cidade

  v_novo := v_base || ' / ' || v_valor;
  if v_novo is distinct from v_atual then
    update leads set name = v_novo where id = p_lead_id;
  end if;
end;
$$;

revoke all on function public.fn_aplica_sufixo_nome_lead(uuid, uuid) from public, anon, authenticated;

-- ── Gatilho 1: o contato mandou mensagem ──────────────────────────────────────────────────────
-- É o pedido do dono e também a rede de segurança: se alguém renomear o card na mão, a próxima
-- mensagem devolve a cidade ao nome.
create or replace function public.fn_sufixo_nome_lead_na_mensagem()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  begin
    perform fn_aplica_sufixo_nome_lead(new.lead_id, new.clinic_id);
  exception when others then
    -- ⚠️ Nome de card NUNCA pode derrubar a ingestão: este insert roda dentro de
    -- `ingest_wa_message`, e exceção aqui viraria 500 no webhook da uazapi, com a uazapi
    -- reenviando a mensagem. Falhou, registra e segue.
    begin
      perform log_system_error(
        'nome-lead-sufixo', 'sufixo_nome_falhou',
        'Não foi possível anexar o campo da ficha ao nome do lead',
        'warning', new.clinic_id,
        jsonb_build_object('lead_id', new.lead_id, 'origem', 'chat_messages', 'erro', sqlerrm), false);
    exception when others then null;  -- Central fora do ar não derruba a mensagem
    end;
  end;
  return null;
end;
$$;

revoke all on function public.fn_sufixo_nome_lead_na_mensagem() from public, anon, authenticated;

drop trigger if exists trg_sufixo_nome_lead_na_mensagem on public.chat_messages;
create trigger trg_sufixo_nome_lead_na_mensagem
  after insert on public.chat_messages
  for each row
  when (new.direction = 'inbound'
        and new.lead_id is not null
        and coalesce(current_setting('app.onboarding_import', true), '') <> 'on')
  execute function public.fn_sufixo_nome_lead_na_mensagem();

-- ── Gatilho 2: a ficha ganhou a cidade ────────────────────────────────────────────────────────
-- Sem este, quem informasse a cidade na ÚLTIMA mensagem só ganharia o nome novo se escrevesse
-- outra vez, e o caso mais comum (informa a cidade e o vendedor assume) ficaria de fora.
create or replace function public.fn_sufixo_nome_lead_na_ficha()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  begin
    perform fn_aplica_sufixo_nome_lead(new.lead_id, new.clinic_id);
  exception when others then
    begin
      perform log_system_error(
        'nome-lead-sufixo', 'sufixo_nome_falhou',
        'Não foi possível anexar o campo da ficha ao nome do lead',
        'warning', new.clinic_id,
        jsonb_build_object('lead_id', new.lead_id, 'origem', 'tickets', 'erro', sqlerrm), false);
    exception when others then null;
    end;
  end;
  return null;
end;
$$;

revoke all on function public.fn_sufixo_nome_lead_na_ficha() from public, anon, authenticated;

drop trigger if exists trg_sufixo_nome_lead_na_ficha on public.tickets;
create trigger trg_sufixo_nome_lead_na_ficha
  after insert or update of dados_pre_atendimento on public.tickets
  for each row
  when (new.lead_id is not null and new.dados_pre_atendimento is not null)
  execute function public.fn_sufixo_nome_lead_na_ficha();

-- ── Liga na Metaltres e alcança quem já tinha a cidade coletada ───────────────────────────────
update public.clinics
   set lead_name_suffix_field = 'cidade'
 where id = '43575057-f20a-40a3-8805-200384d0b867';

do $$
declare r record;
begin
  for r in
    select distinct t.lead_id, t.clinic_id
      from tickets t
     where t.clinic_id = '43575057-f20a-40a3-8805-200384d0b867'
       and t.lead_id is not null
       and jsonb_typeof(t.dados_pre_atendimento->'itens') = 'array'
  loop
    perform fn_aplica_sufixo_nome_lead(r.lead_id, r.clinic_id);
  end loop;
end;
$$;
