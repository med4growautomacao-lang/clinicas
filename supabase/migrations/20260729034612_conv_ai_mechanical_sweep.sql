-- 20260729034612_conv_ai_mechanical_sweep
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- =============================================================================
-- Cascata mecânica (saída do motor). Varre os tickets NÃO-resolvidos de uma clínica,
-- pega a melhor sugestão do matcher e, com a TRAVA DE DIREÇÃO, grava na fila de
-- auditoria (conv_ai_insights) como sugestão de origem 'mecanico', status 'shadow'.
--
-- Trava de direção: só sugere se AVANÇA o card (nível maior) OU é uma resolução que o
-- humano não marcou (perdido/faltou). Nunca sugere mover pra trás; nunca toca card já
-- resolvido (ganho/perdido/faltou). Zero token: é só o matcher.
-- =============================================================================

-- Marca a origem da sugestão. Default 'ia' preserva as linhas do analista.
alter table public.conv_ai_insights add column if not exists origin text not null default 'ia';
alter table public.conv_ai_insights drop constraint if exists conv_ai_insights_origin_check;
alter table public.conv_ai_insights add constraint conv_ai_insights_origin_check check (origin in ('ia','mecanico'));

create or replace function public.conv_ai_mechanical_sweep(p_clinic_id uuid, p_dry boolean default true)
returns table(ticket_id uuid, atual text, sugerido text, confidence numeric, evidencia text)
language plpgsql
security definer
set search_path to 'public'
set statement_timeout to '120s'
as $function$
begin
  drop table if exists _sweep;
  create temp table _sweep on commit drop as
  with lvl(slug,nivel) as (values
    ('sincronizacao',0),('forms',0),('whatsapp',0),('qualificado',1),('orcamento',2),
    ('agendado',3),('compareceu',4),('ganho',5),('faltou_cancelou',-1),('perdido',-1)),
  tk as (
    select t.id, t.lead_id, t.stage_id, fs.slug as cur_slug, coalesce(cl.nivel,0) as cur_nivel
    from tickets t
    join funnel_stages fs on fs.id = t.stage_id
    left join lvl cl on cl.slug = fs.slug
    where t.clinic_id = p_clinic_id
      and fs.slug not in ('ganho','perdido','faltou_cancelou')   -- só card não-resolvido
  ),
  m as (
    select tk.id as ticket_id, tk.lead_id, tk.stage_id as cur_stage, tk.cur_slug, tk.cur_nivel,
           mm.target_stage_id, mm.target_slug, mm.confidence, mm.evidence,
           coalesce(sl.nivel, 9) as sug_nivel
    from tk
    join lateral (
      select target_stage_id, target_slug, confidence, evidence
      from conv_ai_match_ticket(tk.id)
      order by confidence desc limit 1
    ) mm on true
    left join lvl sl on sl.slug = mm.target_slug
  )
  select ticket_id, lead_id, cur_stage, cur_slug, target_stage_id, target_slug, confidence, evidence
  from m
  where target_slug is distinct from cur_slug
    and ( sug_nivel > cur_nivel                              -- avança
          or target_slug in ('perdido','faltou_cancelou') ); -- resolução não marcada

  if not p_dry then
    delete from conv_ai_insights
    where clinic_id = p_clinic_id and origin = 'mecanico' and status = 'shadow';

    insert into conv_ai_insights
      (clinic_id, ticket_id, lead_id, kind, suggested_stage_id, previous_stage_id,
       confidence, rationale, evidence, status, origin)
    select p_clinic_id, s.ticket_id, s.lead_id, 'stage', s.target_stage_id, s.cur_stage,
       s.confidence,
       'Sugestão mecânica: "' || s.evidence || '" → ' || s.target_slug,
       jsonb_build_array(s.evidence), 'shadow', 'mecanico'
    from _sweep s;
  end if;

  return query
    select s.ticket_id, s.cur_slug, s.target_slug, s.confidence, s.evidence
    from _sweep s order by s.confidence desc;
end;
$function$;

revoke all on function public.conv_ai_mechanical_sweep(uuid,boolean) from public;
grant execute on function public.conv_ai_mechanical_sweep(uuid,boolean) to service_role;
