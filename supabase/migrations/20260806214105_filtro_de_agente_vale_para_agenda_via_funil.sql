-- O filtro Agente (Todos / IA / Humano) nao valia para clinica com agenda_via_funil=true.
-- Os blocos que leem a ETAPA do funil nao chamavam fn_lead_matches_agent, enquanto TODOS os
-- blocos irmaos que leem appointments chamavam. Medido na Gheller (unica clinica com a chave
-- ligada), julho/2026, filtro = IA:
--     card "Agend. gerados" = 335   rodape da lista = 335   leads na lista = 0
-- ou seja, a tela escrevia "0 leads . 335 agend. gerados". Os 335 sao todos do Humano
-- (filtro=Humano da 335, filtro=IA da 0), entao o card mostrava o total da clinica em cima de
-- um filtro que dizia "IA".
--
-- Sao 5 pontos e tem que ser os 5 juntos, senao card, grafico e lista voltam a discordar:
--   get_commercial_dashboard_impl: bloco Agendado, bloco Ganho/Faltou, e as 2 series do grafico
--   get_commercial_leads_impl:     total do rodape da lista
do $$
declare
  src text; novo text; n int; antes int; depois int;
  ag constant text := E'      AND public.fn_lead_matches_agent(l.id, p_clinic_id, p_agent)\n';
  a1 constant text := E'AND (p_agenda_to   IS NULL OR h.changed_at <  v_agd_f)\n      AND (p_entry_from IS NULL OR l.created_at >= v_ent_i)\n      AND (p_entry_to   IS NULL OR l.created_at <  v_ent_f)\n      AND COALESCE(l.is_not_lead, false) = false\n';
  a2 constant text := E'AND (p_conv_to   IS NULL OR h.changed_at <  v_cnv_f)\n      AND (p_entry_from IS NULL OR l.created_at >= v_ent_i)\n      AND (p_entry_to   IS NULL OR l.created_at <  v_ent_f)\n      AND COALESCE(l.is_not_lead, false) = false\n';
  a3 constant text := E'AND h.changed_at >= v_dd_i AND h.changed_at < v_dd_f\n      AND (p_entry_from IS NULL OR l.created_at >= v_ent_i)\n      AND (p_entry_to   IS NULL OR l.created_at <  v_ent_f)\n      AND COALESCE(l.is_not_lead, false) = false\n';
  a4 constant text := E'      AND (p_entry_to   IS NULL OR l.created_at <  (p_entry_to + 1)::timestamp)\n      AND COALESCE(l.is_not_lead, false) = false\n';
begin
  select pg_get_functiondef(p.oid) into src from pg_proc p
    where p.pronamespace='public'::regnamespace and p.proname='get_commercial_dashboard_impl';
  if (length(src)-length(replace(src,a1,'')))/length(a1) <> 1 then raise exception 'ancora do bloco Agendado nao e unica'; end if;
  if (length(src)-length(replace(src,a2,'')))/length(a2) <> 1 then raise exception 'ancora do bloco Ganho/Faltou nao e unica'; end if;
  if (length(src)-length(replace(src,a3,'')))/length(a3) <> 2 then raise exception 'esperava 2 series no grafico diario'; end if;
  antes := (length(src)-length(replace(src,ag,'')))/length(ag);

  novo := replace(src, a1, a1 || ag);
  novo := replace(novo, a2, a2 || ag);
  novo := replace(novo, a3, a3 || ag);
  depois := (length(novo)-length(replace(novo,ag,'')))/length(ag);
  if depois - antes <> 4 then raise exception 'esperava 4 filtros novos no painel, foram %', depois - antes; end if;
  execute novo;

  select pg_get_functiondef(p.oid) into src from pg_proc p
    where p.pronamespace='public'::regnamespace and p.proname='get_commercial_leads_impl';
  n := (length(src)-length(replace(src,a4,'')))/length(a4);
  if n <> 1 then raise exception 'ancora do total da lista nao e unica (achei %)', n; end if;
  novo := replace(src, a4, a4 || ag);
  novo := replace(novo,
    '-- Espelha o bloco IF v_agenda_funil de get_commercial_dashboard_impl, inclusive na ausencia',
    '-- Espelha o bloco IF v_agenda_funil de get_commercial_dashboard_impl, INCLUSIVE o filtro de');
  novo := replace(novo,
    '-- de filtro de agente: la o card dessas clinicas nao aplica fn_lead_matches_agent, e o total',
    '-- agente: desde 06/08/2026 o card dessas clinicas tambem chama fn_lead_matches_agent, entao');
  novo := replace(novo,
    '-- aqui tem que bater com o card, nao com a regua da lista.',
    '-- os dois usam a mesma regua e o rodape volta a bater com a lista.');
  execute novo;
end $$;

revoke all on function public.get_commercial_dashboard_impl(uuid, date, date, date, date, text, text, text, date, date, text, text) from public, anon, authenticated;
revoke all on function public.get_commercial_leads_impl(uuid, date, date, date, date, text, text, integer, integer, text, text, date, date, text, text, text, text) from public, anon, authenticated;
