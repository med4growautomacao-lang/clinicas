-- 20260713190211_close_protocol_prefers_visitor_identity
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

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
  where coalesce(ls.protocolo, ls.rast_id) = v_proto
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
  -- lhe deu um UUID gerado na hora. Esse UUID é fantasma — não corresponde a nenhum visitante real
  -- e não amarra a jornada. Quando o clique traz a identidade verdadeira (cookie), ela tem
  -- precedência sobre a auto-gerada.
  -- Como distinguir uma da outra sem coluna extra: um rast_id auto-gerado não aparece em nenhuma
  -- link_sessions. Um vindo do site/forms aparece via capture_channel, e esse nós nunca tocamos.
  update public.leads l
  set source  = coalesce(nullif(l.source, ''), v_source),
      rast_id = case
                  when nullif(v_session.rast_id, '') is null then l.rast_id      -- clique legado, sem identidade
                  when nullif(l.rast_id, '') is null then v_session.rast_id      -- lead sem identidade
                  when l.capture_channel = 'whatsapp'
                       and not exists (
                         select 1 from public.link_sessions s
                          where s.rast_id = l.rast_id and s.id <> v_session.id
                       )
                    then v_session.rast_id                                        -- era auto-gerado -> usa a real
                  else l.rast_id                                                  -- identidade real preexistente: preserva
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
