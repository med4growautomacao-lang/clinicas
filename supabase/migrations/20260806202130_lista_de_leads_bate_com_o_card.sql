-- Decisao do dono (06/08/2026): o numero ao lado da lista tem que bater com o CARD clicado,
-- e o card conta ATENDIMENTO/CONSULTA, nao pessoa. Dois defeitos separados impediam isso.
--
-- (1) A lista contava COUNT(DISTINCT lead) enquanto o card conta ticket/consulta. Cliente que
--     perdeu o atendimento duas vezes valia 2 no card e 1 na lista (Clinica Vaz junho: 145 x 143).
--     tickets.outcome e a fonte unica da verdade (CLAUDE.md secao 2), entao quem cede e a lista.
--     A tela ja escreve "143 leads . 145 perdidos", ou seja, os dois numeros convivem de proposito.
--
-- (2) ⚠️ Pior: clinica com agenda_via_funil=true NAO usa a tabela appointments, mas a lista lia
--     appointments do mesmo jeito. Resultado: card "Gerados" = 335 e a lista abria VAZIA.
--     Medido na Gheller (unica clinica com a chave ligada, e com 0 linhas em appointments).
--     O ramo novo le a ETAPA do funil, exatamente como o painel ja faz para essas clinicas.
--     "Marcados" continua vazio para elas DE PROPOSITO: o painel so devolve realizado/faltou,
--     entao nao existe card correspondente para a lista bater.
do $$
declare src text; novo text; n int;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p where p.pronamespace='public'::regnamespace and p.proname='get_commercial_leads_impl';
  novo := src;

  -- (a) Descobrir se a clinica agenda pelo funil, igual o painel faz.
  novo := replace(novo,
'DECLARE
  v_total int;
  v_rows jsonb;
  v_metric_count int;
BEGIN',
'DECLARE
  v_total int;
  v_rows jsonb;
  v_metric_count int;
  -- Mesma leitura que get_commercial_dashboard_impl faz: sem isto a lista le appointments
  -- numa clinica que nao usa appointments, e o drill-down do card abre vazio.
  v_agenda_funil boolean;
  v_agendado_stage_id uuid;
  v_ganho_stage_id uuid;
BEGIN
  SELECT COALESCE((features->>''agenda_via_funil'')::boolean, false) INTO v_agenda_funil
    FROM clinics WHERE id = p_clinic_id;
  IF v_agenda_funil THEN
    SELECT id INTO v_agendado_stage_id FROM funnel_stages WHERE clinic_id = p_clinic_id AND slug = ''agendado'' LIMIT 1;
    SELECT id INTO v_ganho_stage_id    FROM funnel_stages WHERE clinic_id = p_clinic_id AND slug = ''ganho''    LIMIT 1;
  END IF;');

  -- (b) O ramo que le appointments passa a valer so para quem usa a agenda.
  novo := replace(novo,
'        OR (p_metric IN (''gerados'', ''realizadas'', ''marcados'') AND EXISTS (',
'        OR (p_metric IN (''gerados'', ''realizadas'', ''marcados'') AND NOT v_agenda_funil AND EXISTS (');

  -- (c) Ramo novo, pela etapa do funil, para quem agenda pelo funil.
  novo := replace(novo,
'              OR (p_metric = ''marcados''   AND a.status IN (''pendente'',''confirmado'')))
        ))
      )',
'              OR (p_metric = ''marcados''   AND a.status IN (''pendente'',''confirmado'')))
        ))
        OR (p_metric IN (''gerados'', ''realizadas'') AND v_agenda_funil AND EXISTS (
          SELECT 1 FROM lead_stage_history h
          WHERE h.lead_id = l.id AND h.clinic_id = p_clinic_id AND h.ticket_id IS NOT NULL
            AND h.new_stage_id = (CASE WHEN p_metric = ''realizadas'' THEN v_ganho_stage_id ELSE v_agendado_stage_id END)
            AND (CASE WHEN p_metric = ''realizadas''
                      THEN (p_conv_from   IS NULL OR h.changed_at >= p_conv_from::timestamp)
                       AND (p_conv_to     IS NULL OR h.changed_at <  (p_conv_to + 1)::timestamp)
                      ELSE (p_agenda_from IS NULL OR h.changed_at >= p_agenda_from::timestamp)
                       AND (p_agenda_to   IS NULL OR h.changed_at <  (p_agenda_to + 1)::timestamp) END)
        ))
      )');

  -- (d) Contar a MESMA coisa que o card: atendimento/consulta, nao pessoa.
  n := (length(novo) - length(replace(novo,'SELECT COUNT(DISTINCT l.id) INTO v_metric_count',''))) / 46;
  if n <> 2 then raise exception 'Esperava 2 contagens por lead, achei %', n; end if;
  novo := replace(novo,'SELECT COUNT(DISTINCT l.id) INTO v_metric_count','SELECT COUNT(*) INTO v_metric_count');
  novo := regexp_replace(novo,
    '-- COUNT\(DISTINCT l\.id\): lead pode ter mais de 1 [^\n]*\n\s*-- [^\n]*\n',
    '-- COUNT(*), nao COUNT(DISTINCT lead): este numero fica ao lado da lista e tem que bater' || chr(10) ||
    '    -- com o CARD clicado, que conta atendimento/consulta. A tela mostra os dois: "143 leads' || chr(10) ||
    '    -- . 145 perdidos". Voltar para DISTINCT faz o card e a lista discordarem de novo.' || chr(10),
    'g');

  -- (e) Total do card para quem agenda pelo funil: sai da etapa, com os MESMOS filtros do painel.
  novo := replace(novo,
'  END IF;

  RETURN jsonb_build_object(''total'',',
'  END IF;

  -- Espelha o bloco IF v_agenda_funil de get_commercial_dashboard_impl, inclusive na ausencia
  -- de filtro de agente: la o card dessas clinicas nao aplica fn_lead_matches_agent, e o total
  -- aqui tem que bater com o card, nao com a regua da lista.
  IF v_agenda_funil AND p_metric IN (''gerados'', ''realizadas'') THEN
    SELECT COUNT(DISTINCT h.ticket_id) INTO v_metric_count
    FROM lead_stage_history h JOIN leads l ON l.id = h.lead_id
    WHERE h.clinic_id = p_clinic_id
      AND h.new_stage_id = (CASE WHEN p_metric = ''realizadas'' THEN v_ganho_stage_id ELSE v_agendado_stage_id END)
      AND (CASE WHEN p_metric = ''realizadas''
                THEN (p_conv_from   IS NULL OR h.changed_at >= p_conv_from::timestamp)
                 AND (p_conv_to     IS NULL OR h.changed_at <  (p_conv_to + 1)::timestamp)
                ELSE (p_agenda_from IS NULL OR h.changed_at >= p_agenda_from::timestamp)
                 AND (p_agenda_to   IS NULL OR h.changed_at <  (p_agenda_to + 1)::timestamp) END)
      AND (p_entry_from IS NULL OR l.created_at >= p_entry_from::timestamp)
      AND (p_entry_to   IS NULL OR l.created_at <  (p_entry_to + 1)::timestamp)
      AND COALESCE(l.is_not_lead, false) = false
      AND (p_origin = ''todos''
        OR (CASE WHEN l.source = ''meta_ads'' THEN ''meta'' WHEN l.source = ''google_ads'' THEN ''google'' WHEN l.source = ''balcao'' THEN ''balcao'' ELSE ''sem_origem'' END) = ANY(string_to_array(p_origin, '','')))
      AND (p_channel = ''todos'' OR l.capture_channel = ANY(string_to_array(p_channel, '','')));
  END IF;

  RETURN jsonb_build_object(''total'',');

  -- Fail-closed: se algum trecho nao existia, a correcao teria entrado muda.
  if position('v_agenda_funil boolean' in novo) = 0
     or position('NOT v_agenda_funil AND EXISTS' in novo) = 0
     or position('AND v_agenda_funil AND EXISTS' in novo) = 0
     or position('COUNT(DISTINCT h.ticket_id) INTO v_metric_count' in novo) = 0
     or position('COUNT(DISTINCT l.id)' in novo) > 0 then
    raise exception 'Substituicao incompleta em get_commercial_leads_impl';
  end if;

  execute novo;
end $$;

revoke all on function public.get_commercial_leads_impl(uuid, date, date, date, date, text, text, integer, integer, text, text, date, date, text, text, text, text) from public, anon, authenticated;
