-- 20260715130056_merge_clinic_funnel_dups_helper
-- Exportado de supabase_migrations.schema_migrations em 11/08/2026 (backfill).
-- JA APLICADA em producao nesta versao. Arquivo existe para o repo poder reconstruir o banco.

-- Helper TEMPORÁRIO (removido ao final) para desduplicar etapas de funil de uma clínica.
-- Sobrevivente = 1 por NOME canônico, a que tem MAIS tickets (menos remanejo). Vítimas: cópias
-- duplicadas + etapas legado (Conversão/Paciente/Atendimento Humano). Remaneja tickets, leads,
-- lead_stage_history (old+new) e stage_transition_rules da vítima -> sobrevivente, depois apaga.
CREATE OR REPLACE FUNCTION public._merge_clinic_funnel_dups(p_clinic uuid)
RETURNS jsonb LANGUAGE plpgsql AS $function$
DECLARE
  v_before int; v_after int; v_reparented int; v_deleted int;
BEGIN
  SELECT count(*) INTO v_before FROM public.funnel_stages WHERE clinic_id = p_clinic;

  DROP TABLE IF EXISTS _vmap;
  CREATE TEMP TABLE _vmap AS
  WITH survivors AS (
    SELECT DISTINCT ON (fs.name) fs.name, fs.id AS survivor_id
    FROM public.funnel_stages fs
    WHERE fs.clinic_id = p_clinic
      AND fs.name = ANY (ARRAY['Sincronização','Contato via Forms','Contato via WhatsApp',
                               'Qualificado','Orçamento Enviado','Agendado','Compareceu',
                               'Ganho','Faltou/Cancelou','Perdido'])
    ORDER BY fs.name, (SELECT count(*) FROM public.tickets t WHERE t.stage_id = fs.id) DESC, fs.id
  )
  -- cópias duplicadas de etapas canônicas
  SELECT fs.id AS victim_id, s.survivor_id
    FROM public.funnel_stages fs JOIN survivors s ON s.name = fs.name
    WHERE fs.clinic_id = p_clinic AND fs.id <> s.survivor_id
  UNION ALL
  -- etapas legado-exclusivas (0 tickets) -> Qualificado sobrevivente (defensivo)
  SELECT fs.id, (SELECT survivor_id FROM survivors WHERE name = 'Qualificado')
    FROM public.funnel_stages fs
    WHERE fs.clinic_id = p_clinic AND fs.name IN ('Conversão','Paciente','Atendimento Humano');

  UPDATE public.tickets t SET stage_id = m.survivor_id FROM _vmap m WHERE t.stage_id = m.victim_id;
  GET DIAGNOSTICS v_reparented = ROW_COUNT;
  UPDATE public.leads l SET stage_id = m.survivor_id FROM _vmap m WHERE l.stage_id = m.victim_id;
  UPDATE public.lead_stage_history h SET new_stage_id = m.survivor_id FROM _vmap m WHERE h.new_stage_id = m.victim_id;
  UPDATE public.lead_stage_history h SET old_stage_id = m.survivor_id FROM _vmap m WHERE h.old_stage_id = m.victim_id;
  UPDATE public.stage_transition_rules r SET target_stage_id = m.survivor_id FROM _vmap m WHERE r.target_stage_id = m.victim_id;

  DELETE FROM public.funnel_stages fs USING _vmap m WHERE fs.id = m.victim_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  DROP TABLE IF EXISTS _vmap;

  SELECT count(*) INTO v_after FROM public.funnel_stages WHERE clinic_id = p_clinic;
  RETURN jsonb_build_object('clinic', p_clinic, 'before', v_before, 'after', v_after,
                            'deleted', v_deleted, 'reparented_tickets', v_reparented);
END $function$;
