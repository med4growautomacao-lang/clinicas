-- =============================================================================
-- Backstop do Agente IA: cron que varre turnos vencidos a cada minuto.
--
-- O caminho de BAIXA LATENCIA e o "kick" do ingest (ai-agent -> ai-agent-worker), que espera o
-- debounce e processa a sessao. Este cron so existe como REDE DE SEGURANCA: se um kick se perder
-- (edge reiniciou, etc.), o sweep pega o turno vencido no proximo minuto. O worker e idempotente
-- (claim atomico), entao sweep + kick nunca processam o mesmo turno duas vezes.
--
-- ⚠️ APLICAR SO DEPOIS de deployar a edge ai-agent-worker (senao o POST cai em 404 — inofensivo,
--    mas polui). Sem secret: o worker so drena a fila populada pelo ingest autenticado.
-- =============================================================================

do $cleanup$
begin
  perform cron.unschedule('ai_agent_worker_sweep');
exception when others then null;
end $cleanup$;

select cron.schedule(
  'ai_agent_worker_sweep',
  '* * * * *',
  $$
    select public.system_http_post(
      'https://yzpclhuifquhfqpiwysh.supabase.co/functions/v1/ai-agent-worker',
      '{"Content-Type":"application/json"}'::jsonb,
      '{"mode":"sweep"}'::jsonb,
      5000
    );
  $$
);
