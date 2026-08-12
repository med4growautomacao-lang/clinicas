-- Resgate semanal das campanhas perdidas por token bloqueado.
--
-- Semanal, e não de hora em hora, porque o gatilho real é HUMANO: alguém renovar o token da Meta.
-- Isso não acontece várias vezes ao dia. A edge já testa o token de cada clínica antes de tentar
-- qualquer clique, então uma semana sem token renovado custa 11 chamadas GET /me — praticamente nada.
--
-- Segunda-feira 09:00 (BRT = 12:00 UTC): o resultado aparece logo no começo da semana, junto com a
-- leitura dos painéis.

select cron.schedule(
  'ctwa_enrich_weekly',
  '0 12 * * 1',
  $$
    select net.http_post(
      url     := 'https://yzpclhuifquhfqpiwysh.supabase.co/functions/v1/ctwa-enrich',
      headers := jsonb_build_object('Content-Type','application/json'),
      body    := '{}'::jsonb
    );
  $$
);
