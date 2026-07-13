-- Identidade do lead: rast_id universal + separar protocolo de identidade.
--
-- PROBLEMA 1 — cobertura: o rast_id (UUID v4 gerado pelo script instalado no site do cliente) é a
-- identidade do lead e JÁ é a 1ª chave de dedup em fn_handle_lead_uniqueness. Mas só quem vem do
-- site tem: forms 1.717/1.826 (94%) vs WhatsApp 324/20.209 (1,6%), manual/balcao 0. A
-- ingest_meta_form_lead já gera UUID; handle_chat_message_master_logic (lead do WhatsApp) não gera
-- nada. Sem identidade não há como mapear a jornada do lead (1º toque bio, 2º toque anúncio…).
--
-- PROBLEMA 2 — nomes trocados: link_sessions.rast_id guarda na verdade o PROTOCOLO (o código que
-- vai na mensagem do WhatsApp). A tabela já tem uma coluna `protocolo` — e ela está 100% vazia
-- (0 de 359). O desenho original estava certo; o código nunca usou a coluna certa. Pior: o trigger
-- fn_close_redirect_protocol (criado hoje, 20260713000001) leva esse protocolo para leads.rast_id,
-- contaminando o campo de identidade com um número de 4-6 dígitos.
--
-- Nota factual: o rast_id NÃO se repete entre pessoas. Dos 225 repetidos na base, TODOS são entre
-- Clínica Vaz e Clínica MedDesk Demonstrativa (o clone de teste); ZERO repetem dentro da mesma
-- clínica. Por isso a UNIQUE (clinic_id, rast_id) abaixo é segura.

begin;

-- ---------------------------------------------------------------------------
-- PEÇA 1 — Todo lead nasce com rast_id
-- fn_handle_lead_uniqueness é BEFORE INSERT em leads (tr_prevent_lead_duplicate): TODO lead do
-- sistema passa por aqui (WhatsApp, forms, app, n8n, edge). Gerar aqui cobre todos os canais.
-- A verificação "já existe?" já era feita por ela; só faltava gerar quando conclui que é novo.
-- ---------------------------------------------------------------------------
create or replace function public.fn_handle_lead_uniqueness()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
DECLARE v_existing_id uuid; v_nphone text;
BEGIN
  v_nphone := normalize_br_phone(NEW.phone);
  IF v_nphone IS NOT NULL AND length(v_nphone) >= 12 THEN
    NEW.phone := v_nphone;
  END IF;

  -- 1) Já existe alguém com este rast_id? (identidade vinda do site / Meta Forms)
  IF NEW.rast_id IS NOT NULL AND NEW.rast_id <> '' THEN
    SELECT id INTO v_existing_id FROM public.leads WHERE clinic_id = NEW.clinic_id AND rast_id = NEW.rast_id LIMIT 1;
  END IF;

  -- 2) Senão, já existe alguém com este telefone?
  IF v_existing_id IS NULL AND v_nphone IS NOT NULL AND length(v_nphone) >= 12 THEN
    SELECT id INTO v_existing_id FROM public.leads WHERE clinic_id = NEW.clinic_id AND normalize_br_phone(phone) = v_nphone LIMIT 1;
  END IF;

  IF v_existing_id IS NOT NULL THEN
    UPDATE public.leads SET
      name = COALESCE(NULLIF(NEW.name, ''), name),
      phone = COALESCE(normalize_br_phone(NULLIF(NEW.phone, '')), phone),
      email = COALESCE(NULLIF(NEW.email, ''), email),
      source = COALESCE(NULLIF(NEW.source, ''), source),
      -- preserva a identidade de quem já está na base; só preenche se estava vazia
      rast_id = COALESCE(NULLIF(rast_id, ''), NULLIF(NEW.rast_id, '')),
      g_clid = COALESCE(NULLIF(NEW.g_clid, ''), g_clid),
      g_campaign_name = COALESCE(NULLIF(NEW.g_campaign_name, ''), g_campaign_name),
      g_adset_name = COALESCE(NULLIF(NEW.g_adset_name, ''), g_adset_name),
      g_ad_name = COALESCE(NULLIF(NEW.g_ad_name, ''), g_ad_name),
      g_term_name = COALESCE(NULLIF(NEW.g_term_name, ''), g_term_name),
      g_source_name = COALESCE(NULLIF(NEW.g_source_name, ''), g_source_name),
      fb_clid = COALESCE(NULLIF(NEW.fb_clid, ''), fb_clid),
      fb_campaign_name = COALESCE(NULLIF(NEW.fb_campaign_name, ''), fb_campaign_name),
      fb_adset_name = COALESCE(NULLIF(NEW.fb_adset_name, ''), fb_adset_name),
      fb_ad_name = COALESCE(NULLIF(NEW.fb_ad_name, ''), fb_ad_name),
      ctwa_clid = COALESCE(NULLIF(NEW.ctwa_clid, ''), ctwa_clid),
      capture_channel = COALESCE(NULLIF(NEW.capture_channel, ''), capture_channel),
      updated_at = (now() AT TIME ZONE 'America/Sao_Paulo')
    WHERE id = v_existing_id;
    RETURN NULL;
  END IF;

  -- 3) Lead NOVO: se nenhum canal trouxe identidade, geramos uma — mesmo formato do script do site
  --    (UUID v4). Tem de ser DEPOIS das buscas acima: gerar antes faria o dedup nunca casar.
  IF NEW.rast_id IS NULL OR NEW.rast_id = '' THEN
    NEW.rast_id := gen_random_uuid()::text;
  END IF;

  RETURN NEW;
END; $function$;

-- Garante no banco a regra "cada lead tem seu rast_id único" (por clínica — o clone de teste
-- repete o mesmo rast_id em OUTRA clínica, e isso continua permitido).
create unique index if not exists uq_leads_clinic_rast_id
  on public.leads (clinic_id, rast_id) where rast_id is not null;

-- ---------------------------------------------------------------------------
-- PEÇA 2 — link_sessions: protocolo (código do clique) ≠ rast_id (identidade do visitante)
-- ---------------------------------------------------------------------------
-- Move os 359 códigos que estão indevidamente em rast_id para a coluna que sempre foi deles.
update public.link_sessions
set protocolo = rast_id
where protocolo is null and rast_id is not null;

-- O UNIQUE global sai de rast_id e vai para protocolo (é o protocolo que precisa ser único —
-- é ele que casa a mensagem do WhatsApp com o clique).
create unique index if not exists uq_link_sessions_protocolo on public.link_sessions (protocolo);
create index if not exists idx_link_sessions_open_proto
  on public.link_sessions (clinic_id, protocolo) where used_at is null;
-- rast_id agora é identidade do visitante: repete entre cliques do mesmo navegador (é justamente o
-- objetivo — é o que permite agrupar a jornada), então NÃO pode mais ser unique.
-- É uma CONSTRAINT (contype='u'), não um índice solto: dropar pelo índice daria erro.
alter table public.link_sessions drop constraint if exists link_sessions_rast_id_key;
create index if not exists idx_link_sessions_visitor on public.link_sessions (clinic_id, rast_id)
  where rast_id is not null;

-- ---------------------------------------------------------------------------
-- PEÇA 4 — o matcher passa a usar `protocolo` e a levar a IDENTIDADE (não o protocolo) ao lead
-- Durante a transição aceita os dois campos (coalesce): a edge nova ainda não está no ar, e um
-- clique que caísse entre esta migration e o deploy se perderia.
-- ---------------------------------------------------------------------------
create or replace function public.fn_close_redirect_protocol()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_proto   text;
  v_session public.link_sessions%rowtype;
  v_source  text;
begin
  if new.direction is distinct from 'inbound' or new.lead_id is null then
    return new;
  end if;

  v_proto := (regexp_match(coalesce(new.message->>'content', ''), '[Pp]rotocolo:?\s*(\d+)'))[1];
  if v_proto is null then
    return new;
  end if;

  select * into v_session
  from public.link_sessions ls
  where coalesce(ls.protocolo, ls.rast_id) = v_proto   -- transição: aceita legado
    and ls.clinic_id = new.clinic_id
    and ls.used_at is null
    and ls.created_at > now() - interval '30 days'
  limit 1;

  if not found then
    return new;
  end if;

  -- Origem: 1º o que o link define explicitamente; 2º fallback pelo utm_source do clique.
  select rl.lead_source into v_source
  from public.redirect_links rl
  where rl.id = v_session.redirect_link_id;

  if v_source is null then
    v_source := case
                  when lower(coalesce(v_session.utm_source, '')) = 'instagram' then 'instagram'
                  else null
                end;
  end if;

  -- Leva ao lead a ORIGEM e a IDENTIDADE do visitante (nunca o protocolo — ele é só o mecanismo
  -- de casamento). COALESCE: não sobrescreve first-touch. Guarda: não toca campanha paga (clid).
  -- v_session.rast_id só terá valor depois que a edge nova estiver no ar; nos cliques legados é
  -- nulo e o COALESCE simplesmente mantém o rast_id que o lead já tem.
  update public.leads l
  set source  = coalesce(nullif(l.source, ''), v_source),
      rast_id = coalesce(nullif(l.rast_id, ''), nullif(v_session.rast_id, ''))
  where l.id = new.lead_id
    and l.ctwa_clid is null
    and l.fb_clid   is null
    and l.g_clid    is null;

  update public.link_sessions
  set used_at = now(),
      lead_id = new.lead_id
  where id = v_session.id
    and used_at is null;

  return new;
end;
$$;

commit;
