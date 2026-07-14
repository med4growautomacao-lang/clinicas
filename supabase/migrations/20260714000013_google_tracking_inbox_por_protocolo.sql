-- Tracking do site (Google/Meta/orgânico) sai do n8n e passa a usar a MESMA máquina do CTWA.
--
-- ── Por que não copiar o desenho do n8n ────────────────────────────────────────────────────
-- O n8n cria um LEAD placeholder ("Lead Pendente - 4829", sem telefone) para segurar o gclid até
-- a pessoa mandar mensagem. Esse placeholder é a raiz de três problemas:
--
--   1. Colisão de protocolo (corrigida em 20260714000012, mas a causa continua: um lead-fantasma
--      que precisa ser "adivinhado" pelo nome).
--   2. Lead DUPLICADO: cliente que já existe no WhatsApp e clica no anúncio de um navegador novo
--      ganha um placeholder próprio — vira 2 leads da mesma pessoa.
--   3. Sem last-touch: se o lead já existe, o n8n simplesmente NÃO FAZ NADA (nó "If"), então o
--      2º clique do Google nunca atualiza a campanha. A atribuição congela no primeiro.
--
-- ── O desenho novo ────────────────────────────────────────────────────────────────────────────
-- Não existe placeholder. O clique vira uma linha em `attribution_inbox` (a mesma fila que o CTWA
-- já usa), com o PROTOCOLO como chave. Quando a pessoa manda a 1ª mensagem com "[Protocolo N]", o
-- lead REAL é encontrado pelo caminho normal (telefone) e um trigger casa o protocolo com a linha
-- da inbox, aplicando a atribuição via `fn_apply_inbox_to_lead` — a mesma função do Meta.
--
-- Resultado: sem lead fantasma, sem duplicata, e o last-touch vem de graça.
--
-- ⚠️ Roda em PARALELO com o n8n sem conflito: o site chama UMA URL só. Site migrado usa a inbox;
--    site ainda no n8n usa o placeholder. Os dois caminhos coexistem.

begin;

-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- 1) A inbox passa a aceitar clique SEM telefone
--
-- No clique do site o telefone é DESCONHECIDO (a pessoa ainda nem abriu o WhatsApp). O CTWA sabe
-- o telefone porque a mensagem já chegou; aqui não.
--
-- Seguro: os dois reconciliadores por telefone já se protegem sozinhos —
--   · fn_reconcile_pending_tracking: "WHERE i.phone_norm IS NOT NULL"
--   · fn_lead_pull_tracking: casa por phone_norm, que será NULL (nunca casa)
-- Ou seja, a linha sem telefone é simplesmente ignorada por eles, e quem a resgata é o trigger
-- do protocolo (abaixo).
-- ═══════════════════════════════════════════════════════════════════════════════════════════
alter table public.attribution_inbox alter column phone drop not null;

alter table public.attribution_inbox add column if not exists protocolo text;

comment on column public.attribution_inbox.protocolo is
  'Código devolvido ao site e embutido na 1ª mensagem do WhatsApp ("[Protocolo N]"). É a chave de reconciliação do clique de SITE — no CTWA quem casa é o telefone, aqui é isto.';

-- 6 dígitos, não 4: com 4 (9.000 combinações) a chance de dois cliques vivos colidirem na mesma
-- clínica é real. Com 6 são 900.000 — e o UNIQUE + retry no RPC fecham o resto.
create unique index if not exists uq_attribution_inbox_protocolo
  on public.attribution_inbox (clinic_id, protocolo)
  where protocolo is not null;

-- Lookup do matcher: protocolo ainda não consumido.
create index if not exists idx_attribution_inbox_protocolo_aberto
  on public.attribution_inbox (clinic_id, protocolo)
  where protocolo is not null and consumed_at is null;

-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- 2) RPC de ingestão — devolve o protocolo que o site precisa
--
-- O site fica ESPERANDO essa resposta para montar o link do WhatsApp. Se falhar, ele cai no
-- fallback (abre o WhatsApp sem protocolo) e o lead entra sem origem — então a função não pode
-- levantar exceção à toa.
-- ═══════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.site_ingest_click(
  p_clinic_id  uuid,
  p_source     text,            -- já mapeado pela edge: google_ads / meta_ads / instagram / NULL
  p_g_clid     text default null,
  p_fb_clid    text default null,
  p_campaign   text default null,
  p_adset      text default null,
  p_ad         text default null,
  p_term       text default null,
  p_utm_source text default null,
  p_rast_id    text default null,
  p_raw        jsonb default '{}'::jsonb
)
returns text                     -- o protocolo
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_proto text;
  v_try   int := 0;
begin
  if p_clinic_id is null then
    raise exception 'clinic_id obrigatorio';
  end if;

  -- Retry na colisão: o UNIQUE é a verdade, não a esperança estatística.
  loop
    v_try := v_try + 1;
    v_proto := lpad((100000 + floor(random() * 900000))::int::text, 6, '0');

    begin
      insert into public.attribution_inbox (
        clinic_id, phone, protocolo, source,
        g_clid, fb_clid,
        g_campaign_name, g_adset_name, g_ad_name, g_term_name, g_source_name,
        rast_id, raw, occurred_at,
        external_id
      ) values (
        p_clinic_id, null, v_proto, nullif(p_source, ''),
        nullif(p_g_clid, ''), nullif(p_fb_clid, ''),
        nullif(p_campaign, ''), nullif(p_adset, ''), nullif(p_ad, ''), nullif(p_term, ''),
        nullif(p_utm_source, ''),          -- g_source_name: a coluna existia e o n8n NUNCA gravava
        nullif(p_rast_id, ''), coalesce(p_raw, '{}'::jsonb), now(),
        'proto:' || v_proto                -- 1 clique = 1 linha (não deduplica por gclid de propósito:
                                           -- o mesmo gclid pode gerar 2 cliques, e cada um tem protocolo)
      );
      return v_proto;

    exception when unique_violation then
      if v_try >= 5 then
        raise exception 'nao consegui gerar protocolo unico apos % tentativas', v_try;
      end if;
      -- tenta outro número
    end;
  end loop;
end;
$$;

revoke all on function public.site_ingest_click(uuid, text, text, text, text, text, text, text, text, text, jsonb) from public, anon;
grant execute on function public.site_ingest_click(uuid, text, text, text, text, text, text, text, text, text, jsonb) to service_role;

-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- 3) O matcher: "[Protocolo N]" na 1ª mensagem → aplica a atribuição no lead REAL
--
-- AFTER INSERT (não BEFORE): precisa do NEW.lead_id, que o handle_chat_message_master_logic
-- resolve antes, pelo caminho normal (telefone). Ou seja: o lead é achado/criado como qualquer
-- lead de WhatsApp — sem fantasma — e só DEPOIS a origem é colada nele.
-- ═══════════════════════════════════════════════════════════════════════════════════════════
create or replace function public.fn_close_site_protocol()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_proto text;
  v_inbox uuid;
begin
  if new.direction is distinct from 'inbound' or new.lead_id is null or new.clinic_id is null then
    return new;
  end if;

  -- 4+ dígitos: mesma trava do handle_chat_message_master_logic. Com (\w+) um "protocolo 2"
  -- casaria com qualquer coisa — foi o bug de 20260714000012.
  v_proto := (regexp_match(coalesce(new.message->>'content', ''), '[Pp]rotocolo:?\s*([0-9]{4,})'))[1];
  if v_proto is null then
    return new;
  end if;

  select i.id into v_inbox
  from public.attribution_inbox i
  where i.clinic_id = new.clinic_id
    and i.protocolo = v_proto           -- match EXATO, nunca substring
    and i.consumed_at is null
    and i.created_at > now() - interval '7 days'
  order by i.created_at desc
  limit 1;

  if v_inbox is null then
    return new;                          -- protocolo do fluxo antigo (n8n) ou já consumido
  end if;

  -- Mesma função que o CTWA usa: aplica origem/campanha no lead e marca a linha como consumida.
  perform public.fn_apply_inbox_to_lead(new.lead_id, v_inbox);

  return new;
end;
$$;

drop trigger if exists trg_close_site_protocol on public.chat_messages;
create trigger trg_close_site_protocol
  after insert on public.chat_messages
  for each row
  execute function public.fn_close_site_protocol();

commit;

-- ============================================================================
-- ROLLBACK:
--   drop trigger if exists trg_close_site_protocol on public.chat_messages;
--   drop function if exists public.fn_close_site_protocol();
--   drop function if exists public.site_ingest_click(uuid,text,text,text,text,text,text,text,text,text,jsonb);
--   drop index if exists uq_attribution_inbox_protocolo;
--   drop index if exists idx_attribution_inbox_protocolo_aberto;
--   alter table public.attribution_inbox drop column if exists protocolo;
--   -- (o phone volta a NOT NULL só se não houver linha com phone nulo)
-- ============================================================================
