-- Marketing: o coorte com UTM (marketing_utm_funnel_cohort) passa a carregar também o
-- MOTIVO DE PERDA do ticket (loss_reason). Vira o coorte "superset" único que alimenta
-- cards, Funil de Vendas, pizza, Tendência e a seção UTM × Etapa, permitindo filtros
-- GLOBAIS por UTM e por Motivo de Perda (ex.: "Fora do perfil"/"sem perfil").
--
-- loss_reason é constante por ticket (coluna de tickets), e o CTE já agrupa por ticket →
-- adicioná-lo ao GROUP BY não muda a contagem (apenas detalha as linhas). LEFT JOIN para
-- não perder tickets sem motivo (aberto/ganho => loss_reason NULL). SECURITY INVOKER +
-- search_path fixo: isolamento multi-tenant continua via RLS de leads/lead_stage_history/tickets.
-- DROP necessário: o tipo de retorno muda (nova coluna loss_reason).
DROP FUNCTION IF EXISTS public.marketing_utm_funnel_cohort(uuid, date, date);
CREATE OR REPLACE FUNCTION public.marketing_utm_funnel_cohort(p_clinic_id uuid, p_start date, p_end date)
 RETURNS TABLE(stage_id uuid, platform text, channel text, loss_reason text,
               utm_source text, utm_campaign text, utm_adset text, utm_ad text, utm_term text,
               entry_date date, leads bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH entries AS (
    SELECT h.ticket_id,
           h.new_stage_id AS stage_id,
           CASE
             WHEN l.source = 'meta_ads'   THEN 'meta_ads'
             WHEN l.source = 'google_ads' THEN 'google_ads'
             ELSE 'no_track'
           END AS platform,
           CASE
             WHEN l.capture_channel = 'forms'  THEN 'forms'
             WHEN l.capture_channel = 'balcao' THEN 'balcao'
             ELSE 'whatsapp'
           END AS channel,
           t.loss_reason AS loss_reason,
           l.source AS utm_source,
           COALESCE(l.fb_campaign_name, l.g_campaign_name) AS utm_campaign,
           COALESCE(l.fb_adset_name,   l.g_adset_name)     AS utm_adset,
           COALESCE(l.fb_ad_name,      l.g_ad_name)        AS utm_ad,
           l.g_term_name AS utm_term,
           max(h.changed_at) AS last_entry
    FROM lead_stage_history h
    JOIN leads l ON l.id = h.lead_id
    LEFT JOIN tickets t ON t.id = h.ticket_id
    WHERE h.clinic_id = p_clinic_id
      AND h.new_stage_id IS NOT NULL
      AND h.ticket_id IS NOT NULL
      AND COALESCE(l.is_not_lead, false) = false
    GROUP BY h.ticket_id, h.new_stage_id, 3, 4, 5, 6, 7, 8, 9, 10
  )
  SELECT stage_id, platform, channel, loss_reason,
         utm_source, utm_campaign, utm_adset, utm_ad, utm_term,
         (last_entry)::date AS entry_date, count(*)::bigint AS leads
  FROM entries
  WHERE last_entry::date BETWEEN p_start AND p_end
  GROUP BY stage_id, platform, channel, loss_reason, utm_source, utm_campaign, utm_adset, utm_ad, utm_term, (last_entry)::date;
$function$;
