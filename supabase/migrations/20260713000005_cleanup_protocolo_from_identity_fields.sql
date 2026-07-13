-- Limpeza final da confusão protocolo x rast_id (identidade).
-- Roda DEPOIS do deploy da edge v14 (que já grava protocolo e rast_id em campos separados).
--
-- 1) link_sessions.rast_id dos cliques legados ainda contém o PROTOCOLO (foi copiado para a coluna
--    `protocolo` na 20260713000004, mas a original ficou lá). Agora que a coluna certa está
--    preenchida, limpamos: rast_id passa a significar exclusivamente "identidade do visitante".
--    Cliques antigos ficam sem identidade — é honesto: naquela época o cookie guardava o protocolo,
--    então esses visitantes nunca tiveram identidade de fato.
--
-- 2) leads.rast_id de 25 leads da Tyago contém um protocolo (número de 4 dígitos), escrito pelos
--    backfills (20260618000002 e 20260713000000) e pelo trigger fn_close_redirect_protocol na sua
--    1ª versão. rast_id é a IDENTIDADE (UUID v4 do script do site) — número ali é lixo.
--    Todos os 25 tinham rast_id NULL antes; damos-lhes um UUID v4 novo, para cumprir a regra
--    "todo lead tem rast_id único" (em vez de devolvê-los a NULL).

begin;

-- ---------------------------------------------------------------------------
-- 1) link_sessions: rast_id só guarda UUID de visitante
-- ---------------------------------------------------------------------------
-- rast_id era NOT NULL porque, na prática, guardava o protocolo (sempre presente). Agora é a
-- identidade do visitante e é OPCIONAL: os cliques legados não têm (na época o cookie guardava o
-- protocolo, então esses visitantes nunca chegaram a ter identidade). Quem é obrigatório agora é
-- `protocolo`, e ele já tem UNIQUE.
alter table public.link_sessions alter column rast_id drop not null;

update public.link_sessions
set rast_id = null
where rast_id is not null
  and rast_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

-- O matcher pode parar de aceitar o formato legado: `protocolo` está 100% preenchido.
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
  where ls.protocolo = v_proto
    and ls.clinic_id = new.clinic_id
    and ls.used_at is null
    and ls.created_at > now() - interval '30 days'
  limit 1;

  if not found then
    return new;
  end if;

  select rl.lead_source into v_source
  from public.redirect_links rl
  where rl.id = v_session.redirect_link_id;

  if v_source is null then
    v_source := case
                  when lower(coalesce(v_session.utm_source, '')) = 'instagram' then 'instagram'
                  else null
                end;
  end if;

  -- Identidade: o lead do WhatsApp nasce ANTES de sabermos do protocolo, e o trigger de dedup já
  -- lhe deu um UUID gerado na hora — um id fantasma, que não corresponde a visitante nenhum e não
  -- amarra a jornada. Quando o clique traz a identidade real (cookie), ela tem precedência.
  -- Como distinguir sem coluna extra: um rast_id auto-gerado não aparece em nenhuma link_sessions.
  update public.leads l
  set source  = coalesce(nullif(l.source, ''), v_source),
      rast_id = case
                  when nullif(v_session.rast_id, '') is null then l.rast_id
                  when nullif(l.rast_id, '') is null then v_session.rast_id
                  when l.capture_channel = 'whatsapp'
                       and not exists (
                         select 1 from public.link_sessions s
                          where s.rast_id = l.rast_id and s.id <> v_session.id
                       )
                    then v_session.rast_id
                  else l.rast_id
                end
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

-- ---------------------------------------------------------------------------
-- 2) leads: tirar o protocolo do campo de identidade (25 leads da Tyago)
-- ---------------------------------------------------------------------------
create table if not exists public._fix_leads_rast_id_protocolo_20260713 (
  lead_id      uuid primary key,
  old_rast_id  text,          -- o protocolo que estava indevidamente aqui
  new_rast_id  text,
  fixed_at     timestamptz default now()
);

with alvos as (
  select id as lead_id, rast_id as old_rast_id, gen_random_uuid()::text as new_rast_id
  from public.leads
  where rast_id ~ '^\d{3,6}$'      -- número = protocolo; identidade é UUID
)
insert into public._fix_leads_rast_id_protocolo_20260713 (lead_id, old_rast_id, new_rast_id)
select lead_id, old_rast_id, new_rast_id from alvos
on conflict (lead_id) do nothing;

update public.leads l
set rast_id = f.new_rast_id
from public._fix_leads_rast_id_protocolo_20260713 f
where l.id = f.lead_id;

commit;

-- ============================================================================
-- ROLLBACK:
--   update public.leads l set rast_id = f.old_rast_id
--     from public._fix_leads_rast_id_protocolo_20260713 f where l.id = f.lead_id;
--   drop table public._fix_leads_rast_id_protocolo_20260713;
-- ============================================================================
