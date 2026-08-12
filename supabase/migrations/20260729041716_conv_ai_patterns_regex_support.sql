-- 20260729041716_conv_ai_patterns_regex_support
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Suporte a REGEX no padrão (para o par da São Lucas: "dados para agendamento" + CPF, e o CPF
-- é um número, não uma frase fixa). Flags por lado; default false mantém o comportamento contains.
alter table public.conv_ai_patterns add column if not exists in_is_regex boolean not null default false;
alter table public.conv_ai_patterns add column if not exists out_is_regex boolean not null default false;

create or replace function public.conv_ai_match_ticket(p_ticket_id uuid, p_window int default 40)
returns table(target_stage_id uuid, target_slug text, confidence numeric, side text, evidence text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with tk as (
    select clinic_id, lead_id from tickets where id = p_ticket_id
  ),
  win as (
    select cm.seq, cm.direction, public.normalize_stage_text(cm.message->>'content') as c
    from chat_messages cm cross join tk
    where cm.lead_id = tk.lead_id and cm.clinic_id = tk.clinic_id
      and coalesce(btrim(cm.message->>'content'),'') <> ''
    order by cm.seq desc
    limit p_window
  ),
  pats as (
    select p.* from conv_ai_patterns p cross join tk
    where p.clinic_id = tk.clinic_id and p.is_active and p.target_kind = 'stage'
  ),
  matches as (
    select p.target_stage_id, p.confidence, p.side,
           coalesce(p.phrase_out, p.phrase_in) as evidence
    from pats p
    where case p.side
      when 'outbound' then exists (
        select 1 from win w
        where w.direction='outbound' and p.phrase_out is not null
          and case when p.out_is_regex then w.c ~ p.phrase_out
                   else position(public.normalize_stage_text(p.phrase_out) in w.c) > 0 end)
      when 'inbound' then exists (
        select 1 from win w
        where w.direction='inbound' and p.phrase_in is not null
          and case when p.in_is_regex then w.c ~ p.phrase_in
                   else position(public.normalize_stage_text(p.phrase_in) in w.c) > 0 end)
      when 'pair' then exists (
        select 1 from win wi cross join win wo
        where wi.direction='inbound' and wo.direction='outbound'
          and p.phrase_in is not null and p.phrase_out is not null
          and case when p.in_is_regex then wi.c ~ p.phrase_in
                   else position(public.normalize_stage_text(p.phrase_in) in wi.c) > 0 end
          and case when p.out_is_regex then wo.c ~ p.phrase_out
                   else position(public.normalize_stage_text(p.phrase_out) in wo.c) > 0 end
          and abs(wi.seq - wo.seq) <= p.window_msgs
          and (not p.order_strict or wi.seq < wo.seq))
      else false end
  )
  select m.target_stage_id, fs.slug, m.confidence, m.side, m.evidence
  from matches m join funnel_stages fs on fs.id = m.target_stage_id
  order by m.confidence desc;
$function$;

revoke all on function public.conv_ai_match_ticket(uuid,int) from public;
grant execute on function public.conv_ai_match_ticket(uuid,int) to service_role;
