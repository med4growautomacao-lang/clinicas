-- Marketing: variante de marketing_funnel_cohort que ADICIONA as dimensões de UTM
-- (unificadas Meta+Google via COALESCE) ao agrupamento/retorno. Alimenta a nova seção
-- de gráficos por UTM × Etapa de Funil. Mesma contagem por ticket / última entrada na
-- etapa do funil canônico — não altera marketing_funnel_cohort (preserva o invariante
-- cards = gráfico = tabela = funil).
--
-- SECURITY INVOKER (default) + search_path fixo: o isolamento multi-tenant continua via
-- RLS de leads/lead_stage_history (ver memória rls-org-tenant-isolation-fix).
CREATE OR REPLACE FUNCTION public.marketing_utm_funnel_cohort(p_clinic_id uuid, p_start date, p_end date)
 RETURNS TABLE(stage_id uuid, platform text, channel text,
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
           l.source AS utm_source,
           COALESCE(l.fb_campaign_name, l.g_campaign_name) AS utm_campaign,
           COALESCE(l.fb_adset_name,   l.g_adset_name)     AS utm_adset,
           COALESCE(l.fb_ad_name,      l.g_ad_name)        AS utm_ad,
           l.g_term_name AS utm_term,
           max(h.changed_at) AS last_entry
    FROM lead_stage_history h
    JOIN leads l ON l.id = h.lead_id
    WHERE h.clinic_id = p_clinic_id
      AND h.new_stage_id IS NOT NULL
      AND h.ticket_id IS NOT NULL
      AND COALESCE(l.is_not_lead, false) = false
    GROUP BY h.ticket_id, h.new_stage_id, 3, 4, 5, 6, 7, 8, 9
  )
  SELECT stage_id, platform, channel, utm_source, utm_campaign, utm_adset, utm_ad, utm_term,
         (last_entry)::date AS entry_date, count(*)::bigint AS leads
  FROM entries
  WHERE last_entry::date BETWEEN p_start AND p_end
  GROUP BY stage_id, platform, channel, utm_source, utm_campaign, utm_adset, utm_ad, utm_term, (last_entry)::date;
$function$;
