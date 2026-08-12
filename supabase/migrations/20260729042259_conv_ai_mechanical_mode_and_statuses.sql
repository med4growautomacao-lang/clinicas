-- 20260729042259_conv_ai_mechanical_mode_and_statuses
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Modo mecânico por clínica: off (não sugere) | shadow (registra invisível) | active (visível).
alter table public.conv_ai_clinic_config
  add column if not exists mechanical_mode text not null default 'shadow';
alter table public.conv_ai_clinic_config
  drop constraint if exists conv_ai_clinic_config_mechanical_mode_check;
alter table public.conv_ai_clinic_config
  add constraint conv_ai_clinic_config_mechanical_mode_check check (mechanical_mode in ('off','shadow','active'));

-- Cascata respeitando o modo. Usa status PRÓPRIOS ('mec_shadow'/'mec_pending') para NUNCA colidir
-- com o analista de IA (que só toca 'pending'/'shadow') nem com o índice único de 1-pending-por-ticket.
create or replace function public.conv_ai_mechanical_sweep(p_clinic_id uuid, p_dry boolean default true)
returns table(ticket_id uuid, atual text, sugerido text, confidence numeric, evidencia text)
language plpgsql
security definer
set search_path to 'public'
set statement_timeout to '120s'
as $function$
#variable_conflict use_column
declare v_mode text;
begin
  select coalesce(cc.mechanical_mode,'shadow') into v_mode
  from conv_ai_clinic_config cc where cc.clinic_id = p_clinic_id;
  v_mode := coalesce(v_mode, 'shadow');

  drop table if exists _sweep;
  create temp table _sweep on commit drop as
  with lvl(slug,nivel) as (values
    ('sincronizacao',0),('forms',0),('whatsapp',0),('qualificado',1),('orcamento',2),
    ('agendado',3),('compareceu',4),('ganho',5),('faltou_cancelou',-1),('perdido',-1)),
  tk as (
    select t.id, t.lead_id, t.stage_id, fs.slug::text as cur_slug, coalesce(cl.nivel,0) as cur_nivel
    from tickets t
    join funnel_stages fs on fs.id = t.stage_id
    left join lvl cl on cl.slug = fs.slug
    where t.clinic_id = p_clinic_id
      and fs.slug not in ('ganho','perdido','faltou_cancelou')
  ),
  m as (
    select tk.id as ticket_id, tk.lead_id, tk.stage_id as cur_stage, tk.cur_slug, tk.cur_nivel,
           mm.target_stage_id, mm.target_slug::text as target_slug, mm.confidence, mm.evidence::text as evidence,
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
    and ( sug_nivel > cur_nivel
          or target_slug in ('perdido','faltou_cancelou') );

  if not p_dry then
    -- limpa as sugestões mecânicas anteriores desta clínica (idempotente)
    delete from conv_ai_insights where clinic_id = p_clinic_id and origin = 'mecanico';
    if v_mode <> 'off' then
      insert into conv_ai_insights
        (clinic_id, ticket_id, lead_id, kind, suggested_stage_id, previous_stage_id,
         confidence, rationale, evidence, status, origin)
      select p_clinic_id, s.ticket_id, s.lead_id, 'stage', s.target_stage_id, s.cur_stage,
         s.confidence,
         'Sugestão mecânica: "' || s.evidence || '" → ' || s.target_slug,
         jsonb_build_array(s.evidence),
         case when v_mode = 'active' then 'mec_pending' else 'mec_shadow' end,
         'mecanico'
      from _sweep s;
    end if;
  end if;

  return query
    select s.ticket_id, s.cur_slug::text, s.target_slug::text, s.confidence, s.evidence::text
    from _sweep s order by s.confidence desc;
end;
$function$;

revoke all on function public.conv_ai_mechanical_sweep(uuid,boolean) from public;
grant execute on function public.conv_ai_mechanical_sweep(uuid,boolean) to service_role;
