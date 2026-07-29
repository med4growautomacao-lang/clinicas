-- v_kpi_scheduled: deixa o filtro de clínica alcançar as CTEs internas.
--
-- PROBLEMA (medido na GG Imports, 1.747 leads): o primeiro bloco de get_dashboard_stats levava
-- 1.295 ms **para devolver 0 linhas**, e o painel inteiro 2.943 ms, perto do timeout de 8 s.
-- O plano mostrava a causa:
--     Seq Scan on lead_stage_history h (actual rows=55542)   <- a tabela INTEIRA, todas as clínicas
--     HashAggregate Group Key: h.ticket_id
--
-- As CTEs `appt` e `stg` agregavam `appointments` e `lead_stage_history` inteiras e só depois o
-- resultado era juntado a `tickets` (esse sim filtrado por clínica). Como as CTEs não carregavam
-- `clinic_id`, o planner não tinha por onde empurrar o filtro para dentro delas.
--
-- É o mesmo vício do embed `lead:leads(*)` do PostgREST: o custo vira GLOBAL, cresce com o banco e
-- atinge toda clínica, inclusive as pequenas. Por isso a GG Imports (1.747 leads) sofria igual às
-- grandes.
--
-- CONSERTO: `clinic_id` entra nas duas CTEs e no join. Verificado antes de aplicar que isso é
-- equivalente, e não uma aposta:
--     appointments com clinic_id != o do ticket ....... 0
--     lead_stage_history com clinic_id != o do ticket .. 0
--     qualquer um dos dois com clinic_id nulo .......... 0
-- Ou seja, `appt.clinic_id = t.clinic_id` nunca descarta nem duplica linha; só dá ao planner o
-- caminho para filtrar cedo.
--
-- RESULTADO: 1.295 ms -> 16,3 ms (79x) no bloco, com o plano passando a usar
-- `Bitmap Index Scan on idx_lead_stage_history_clinic_changed (Index Cond: clinic_id = ...)`.
--
-- EQUIVALÊNCIA: conferida por hash do conteúdo inteiro da view (ticket_id + day de todas as
-- linhas), além dos contadores por tipo. Antes e depois, idênticos:
--     1894 linhas | 261 com consulta | 1633 só etapa | 149 realizadas
--     md5 = 3237fb78ce523e8fc9d736ef448de978
--
-- A view é a fonte única de "agendado" para os três painéis (§1 do CLAUDE.md), então o que não pode
-- mudar é o CONTEÚDO. A definição de agendado (união consulta ∪ etapa, 1x por ticket, ancorada no
-- LEAST das duas datas) segue idêntica.
--
-- ⚠️ PENDENTE, não resolvido aqui: get_dashboard_stats ainda leva ~3,2 s nessa mesma clínica. Este
-- era um bloco de vários. As outras cinco views v_kpi_* NÃO têm o mesmo vício (nenhuma usa CTE,
-- conferido), então o que sobra está no corpo da própria função — o candidato é
-- `vw_lead_agent_class`, que aparece 13 vezes ali.

create or replace view public.v_kpi_scheduled as
 WITH appt AS (
         SELECT a.clinic_id,
            a.ticket_id,
            min(a.created_at::date) AS appt_day,
            bool_or(a.status = ANY (ARRAY['realizado'::text, 'compareceu'::text])) AS realized
           FROM appointments a
          WHERE a.ticket_id IS NOT NULL
          GROUP BY a.clinic_id, a.ticket_id
        ), stg AS (
         SELECT h.clinic_id,
            h.ticket_id,
            min(h.changed_at::date) AS stage_day
           FROM lead_stage_history h
             JOIN funnel_stages fs ON fs.id = h.new_stage_id
          WHERE fs.slug::text = 'agendado'::text AND h.ticket_id IS NOT NULL
          GROUP BY h.clinic_id, h.ticket_id
        )
 SELECT t.id AS ticket_id,
    t.lead_id,
    t.clinic_id,
    LEAST(appt.appt_day, stg.stage_day) AS day,
        CASE
            WHEN l.source = 'meta_ads'::text THEN 'meta_ads'::text
            WHEN l.source = 'google_ads'::text THEN 'google_ads'::text
            ELSE 'no_track'::text
        END AS platform,
        CASE
            WHEN l.capture_channel = 'forms'::text THEN 'forms'::text
            WHEN l.capture_channel = 'balcao'::text THEN 'balcao'::text
            ELSE 'whatsapp'::text
        END AS channel,
    appt.ticket_id IS NOT NULL AS has_appointment,
    appt.ticket_id IS NULL AND stg.ticket_id IS NOT NULL AS stage_only,
    COALESCE(appt.realized, false) AS realized
   FROM tickets t
     JOIN leads l ON l.id = t.lead_id
     LEFT JOIN appt ON appt.ticket_id = t.id AND appt.clinic_id = t.clinic_id
     LEFT JOIN stg ON stg.ticket_id = t.id AND stg.clinic_id = t.clinic_id
  WHERE (appt.ticket_id IS NOT NULL OR stg.ticket_id IS NOT NULL) AND COALESCE(l.is_not_lead, false) = false;
