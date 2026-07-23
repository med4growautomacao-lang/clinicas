-- Como o worker acorda. Duas vias, de proposito:
--
-- (1) KICK por trigger no INSERT. Sem isto, uma mensagem do chat manual esperaria ate 60s pelo
--     cron. O trigger da o kick para TODO produtor de graca, inclusive os 5 que vivem dentro do
--     banco, sem cada um ter que lembrar de acordar o worker. `net.http_post` (via
--     system_http_post) e assincrono, entao nao segura a transacao de quem enfileirou.
--     So acorda para mensagem que ja pode sair; agendada para o futuro fica com o cron.
--     OBS: produtores EDGE (ex.: chat-send) cutucam o worker por fetch direto (~1s); o kick por
--     pg_net e o caminho dos produtores do BANCO (~7s, aceitavel para automacao).
--
-- (2) CRON de backstop a cada minuto. Pega o que o kick perdeu (edge fora do ar, kick que falhou,
--     retry com backoff vencido, claim orfao). O mesmo desenho do ai_agent_worker_sweep.

create or replace function public.fn_outbound_kick()
returns trigger
language plpgsql security definer set search_path to 'public'
as $$
begin
  if NEW.status = 'pending' and NEW.not_before <= now() then
    begin
      perform public.system_http_post(
        'https://yzpclhuifquhfqpiwysh.supabase.co/functions/v1/emissor-worker',
        '{"Content-Type":"application/json"}'::jsonb,
        jsonb_build_object('mode', 'kick', 'outbound_id', NEW.id),
        5000
      );
    exception when others then
      -- Kick e best-effort: o cron de 1 minuto e a garantia. Falhar aqui NAO pode impedir a
      -- mensagem de entrar na fila.
      null;
    end;
  end if;
  return NEW;
end $$;

drop trigger if exists trg_outbound_kick on public.outbound_messages;
create trigger trg_outbound_kick
  after insert on public.outbound_messages
  for each row execute function public.fn_outbound_kick();

-- Backstop. Roda desde ja: com a chave desligada a fila fica vazia e o worker devolve
-- {processadas:0} em milissegundos. Ter o cron no ar ANTES de ligar a chave e de proposito.
select cron.schedule(
  'emissor_worker_sweep',
  '* * * * *',
  $cron$
    select public.system_http_post(
      'https://yzpclhuifquhfqpiwysh.supabase.co/functions/v1/emissor-worker',
      '{"Content-Type":"application/json"}'::jsonb,
      '{"mode":"sweep"}'::jsonb,
      5000
    );
  $cron$
);

-- Purga diaria da auditoria de saida (mantem 30 dias).
select cron.schedule(
  'emissor_purge_daily',
  '15 4 * * *',
  $cron$ select public.purge_outbound_messages(30); $cron$
);