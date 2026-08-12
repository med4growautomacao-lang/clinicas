-- 20260729031407_conv_ai_match_ticket_fn
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- =============================================================================
-- Matcher do motor mecânico (Passo 1). Dado um ticket, olha a janela recente da
-- conversa do lead e devolve os padrões que casaram (etapa-alvo + confiança).
-- Zero token: é só normalização + contains, dos DOIS lados. Pares (side='pair')
-- exigem entrada e saída dentro de window_msgs (e ordem, se order_strict).
--
-- SECURITY DEFINER (lê chat_messages). EXECUTE só service_role (o backend). Nunca
-- anon/authenticated. Normaliza igual ao motor de keyword existente (normalize_stage_text).
-- =============================================================================
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
          and position(public.normalize_stage_text(p.phrase_out) in w.c) > 0)
      when 'inbound' then exists (
        select 1 from win w
        where w.direction='inbound' and p.phrase_in is not null
          and position(public.normalize_stage_text(p.phrase_in) in w.c) > 0)
      when 'pair' then exists (
        select 1 from win wi cross join win wo
        where wi.direction='inbound' and wo.direction='outbound'
          and p.phrase_in is not null and p.phrase_out is not null
          and position(public.normalize_stage_text(p.phrase_in) in wi.c) > 0
          and position(public.normalize_stage_text(p.phrase_out) in wo.c) > 0
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
