-- 20260729045344_conv_ai_mechanical_min_confidence
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Limiar de confiança por clínica: em modo 'active', só vira sugestão VISÍVEL (mec_pending) o que
-- estiver acima do limiar; o resto fica em observação (mec_shadow). Evita afogar a recepção.
alter table public.conv_ai_clinic_config
  add column if not exists mechanical_min_confidence numeric not null default 0.8;

create or replace function public.conv_ai_mechanical_sweep(p_clinic_id uuid, p_dry boolean default true)
returns table(ticket_id uuid, atual text, sugerido text, confidence numeric, evidencia text)
language plpgsql
security definer
set search_path to 'public'
set statement_timeout to '120s'
as $function$
#variable_conflict use_column
declare v_mode text; v_min_conf numeric;
begin
  select coalesce(cc.mechanical_mode,'shadow'), coalesce(cc.mechanical_min_confidence,0.8)
    into v_mode, v_min_conf
  from conv_ai_clinic_config cc where cc.clinic_id = p_clinic_id;
  v_mode := coalesce(v_mode, 'shadow');
  v_min_conf := coalesce(v_min_conf, 0.8);

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
    delete from conv_ai_insights where clinic_id = p_clinic_id and origin = 'mecanico';
    if v_mode <> 'off' then
      insert into conv_ai_insights
        (clinic_id, ticket_id, lead_id, kind, suggested_stage_id, previous_stage_id,
         confidence, rationale, evidence, status, origin)
      select p_clinic_id, s.ticket_id, s.lead_id, 'stage', s.target_stage_id, s.cur_stage,
         s.confidence,
         'Sugestão mecânica: "' || s.evidence || '" → ' || s.target_slug,
         jsonb_build_array(s.evidence),
         case when v_mode = 'active' and s.confidence >= v_min_conf then 'mec_pending' else 'mec_shadow' end,
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
