-- 20260714201743_lead_novo_adota_rast_id_do_site
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Ver supabase/migrations/20260714000014_lead_novo_adota_rast_id_do_site.sql
-- O lead nascido de clique no site perdia a identidade do visitante: nascia pelo telefone,
-- ganhava um rast_id INVENTADO pela fn_handle_lead_uniqueness, e o COALESCE do
-- fn_apply_inbox_to_lead preservava o inventado, descartando o rast_id real do cookie.
-- Isso quebrava a jornada multi-toque. Agora o lead RECEM-CRIADO adota o rast_id do site.

create or replace function public.fn_close_site_protocol()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_proto text;
  i       public.attribution_inbox%rowtype;
begin
  if new.direction is distinct from 'inbound' or new.lead_id is null or new.clinic_id is null then
    return new;
  end if;

  v_proto := (regexp_match(coalesce(new.message->>'content', ''), '[Pp]rotocolo:?\s*([0-9]{4,})'))[1];
  if v_proto is null then
    return new;
  end if;

  select * into i
  from public.attribution_inbox ai
  where ai.clinic_id = new.clinic_id
    and ai.protocolo = v_proto
    and ai.consumed_at is null
    and ai.created_at > now() - interval '7 days'
  order by ai.created_at desc
  limit 1;

  if not found then
    return new;
  end if;

  -- Adocao da identidade: lead recem-nascido troca o rast_id inventado pelo REAL do visitante.
  -- Guardas: so lead novo (2 min) e so se ninguem mais usa esse rast_id (uq_leads_clinic_rast_id).
  update public.leads l
  set rast_id = nullif(i.rast_id, '')
  where l.id = new.lead_id
    and nullif(i.rast_id, '') is not null
    and l.rast_id is distinct from i.rast_id
    and l.created_at > (now() at time zone 'America/Sao_Paulo') - interval '2 minutes'
    and not exists (
      select 1 from public.leads x
      where x.clinic_id = l.clinic_id
        and x.rast_id  = i.rast_id
        and x.id <> l.id
    );

  perform public.fn_apply_inbox_to_lead(new.lead_id, i.id);

  return new;
end;
$$;
