-- Versiona a configuração do agendador de investimento, que até aqui só existia como UPDATE solto
-- em system_settings. Sem isto, ambiente novo sobe com o DEFAULT_CONFIG do código e as decisões
-- abaixo (tomadas com o dono em 21/07) somem sem deixar rastro.
--
-- Três decisões, todas medidas antes de aplicar:
--
-- 1) breakdown_enabled = true. O detalhamento por campanha alimenta marketing_spend_breakdown, que
--    o front já consome (useCampaignInvestment / useCampaignPlatformSplit no MarketingAnalytics),
--    que era a condição posta pelo autor para ligar. Custo medido: ~24 chamadas/dia no Meta e ~13
--    no Google, contra 0,01% de utilização da quota do Meta e 0,17% do teto do Google (15k/dia).
--
-- 2) lookback_days = 2, e NÃO 1. O agendado passou a gravar só dia fechado (until = ontem). Com
--    lookback 1 a janela seria [ontem, ontem] e cada dia teria uma única chance de ser capturado:
--    bastava a rodada das 05:00 falhar uma vez para aquele dia ficar sem investimento para sempre,
--    porque no dia seguinte a janela anda junto e nunca mais volta. Com 2 existe um dia de
--    sobreposição e a rodada seguinte repesca o que a anterior perdeu. O custo é reprocessar um dia
--    já gravado, que é upsert idempotente por (clinic_id, date, platform).
--
-- 3) include_today ausente (= false). O dia corrente é sempre parcial e, rodando às 05:00, entrava
--    quase zerado e congelava assim até a manhã seguinte. Em 21/07 isso escondia R$ 2.700 de gasto
--    real e puxava ROAS e custo por lead do dia para baixo. Quem quiser o número de hoje usa o
--    botão do Marketing, que manda a janela explícita.

update public.system_settings
   set value = jsonb_build_object(
         'enabled',           true,
         'every_hours',       24,
         'run_hour_sp',       5,
         'lookback_days',     2,
         'platforms',         jsonb_build_array('meta_ads', 'google_ads'),
         'batch_size',        300,
         'breakdown_enabled', true
       )::text,
       updated_at = now()
 where id = 'ad_spend_sync_config';

insert into public.system_settings (id, value, description)
select 'ad_spend_sync_config',
       jsonb_build_object(
         'enabled',           true,
         'every_hours',       24,
         'run_hour_sp',       5,
         'lookback_days',     2,
         'platforms',         jsonb_build_array('meta_ads', 'google_ads'),
         'batch_size',        300,
         'breakdown_enabled', true
       )::text,
       'Agendador de investimento (Meta+Google): janela, plataformas e detalhamento por campanha.'
where not exists (select 1 from public.system_settings where id = 'ad_spend_sync_config');
