-- DEFEITO SEPARADO, achado ao validar a correcao de performance de 06/08/2026.
-- O tempo de resposta (Visao Geral: avgResponseTime; Comercial: sla.*) percorre a conversa com
-- LAG(...) OVER (PARTITION BY lead_id ORDER BY created_at). Quando duas mensagens do MESMO lead
-- caem no MESMO segundo (11 grupos, 23 mensagens, 3 clinicas em 541.516 — vem do import do
-- onboarding, que grava segundo inteiro), o ORDER BY nao sabe qual veio antes e o par
-- "recebida -> respondida" e montado conforme a ordem que o PLANO devolveu.
-- Ou seja: o numero mudava sozinho quando o plano mudava, sem ninguem mexer em nada. Foi assim
-- que apareceu (MedDesk Comercial: 143 ciclos antes, 142 depois, com o conjunto de linhas
-- PROVADO identico: 750 = 750, zero de diferenca dos dois lados).
-- Conserto: desempatar por chat_messages.seq, que e a ordem real de chegada e e unico na tabela
-- inteira (541.520 valores distintos em 541.520 linhas). Deixa de depender do plano.
--
-- A troca e feita por substituicao EXATA sobre o texto que esta no banco agora, com verificacao
-- de que cada trecho existia, justamente para nao arrastar nenhuma outra alteracao junto.
do $$
declare
  f text;
  src text;
  novo text;
  antes text;
begin
  foreach f in array array['get_dashboard_stats_impl','get_commercial_dashboard_impl'] loop
    select pg_get_functiondef(p.oid) into src
      from pg_proc p where p.pronamespace='public'::regnamespace and p.proname=f;

    -- Idempotente: reaplicar a cadeia num banco que ja passou por aqui nao pode ABORTAR, senao
    -- as migrations seguintes nem chegam a rodar.
    if position('ORDER BY created_at, seq) AS prev_kind' in src) > 0 then
      raise notice 'ja aplicado em %, pulando', f;
      continue;
    end if;
    novo := src;

    novo := replace(novo,
      'SELECT cm.lead_id, cm.created_at, cm.sender,',
      'SELECT cm.lead_id, cm.created_at, cm.seq, cm.sender,');
    novo := replace(novo,
      'SELECT lead_id, created_at, sender, kind,',
      'SELECT lead_id, created_at, seq, sender, kind,');
    novo := replace(novo,
      'LAG(kind)       OVER (PARTITION BY lead_id ORDER BY created_at) AS prev_kind,',
      'LAG(kind)       OVER (PARTITION BY lead_id ORDER BY created_at, seq) AS prev_kind,');
    novo := replace(novo,
      'LAG(created_at) OVER (PARTITION BY lead_id ORDER BY created_at) AS prev_at',
      'LAG(created_at) OVER (PARTITION BY lead_id ORDER BY created_at, seq) AS prev_at');

    if f = 'get_dashboard_stats_impl' then
      novo := replace(novo,
        'SELECT lead_id, prev_at AS in_at,',
        'SELECT lead_id, prev_at AS in_at, seq AS out_seq,');
    else
      novo := replace(novo,
        'SELECT lead_id, prev_at AS in_at, created_at AS out_at,',
        'SELECT lead_id, prev_at AS in_at, created_at AS out_at, seq AS out_seq,');
    end if;

    novo := replace(novo,
      'FROM cyc ORDER BY lead_id, in_at',
      'FROM cyc ORDER BY lead_id, in_at, out_seq');

    -- Fail-closed: se algum trecho nao existia, o texto sai igual e a correcao teria entrado muda.
    if novo = src then
      raise exception 'Nenhuma substituicao aplicada em %; texto da funcao mudou, revisar a mao', f;
    end if;
    -- ⚠️ 'seq AS out_seq' PRECISA estar na lista: e a projecao que CRIA a coluna consumida pelo
    -- ORDER BY logo abaixo. Sem esta checagem, se so a ancora do bloco cyc falhasse, a funcao
    -- seria criada referenciando uma coluna inexistente (plpgsql nao resolve nome de coluna no
    -- CREATE) e o painel so quebraria no primeiro acesso, com 42703 e a migration "aplicada".
    if position('ORDER BY created_at, seq) AS prev_kind' in novo) = 0
       or position('ORDER BY created_at, seq) AS prev_at' in novo) = 0
       or position('seq AS out_seq' in novo) = 0
       or position('ORDER BY lead_id, in_at, out_seq' in novo) = 0
       or position('cm.seq, cm.sender' in novo) = 0 then
      raise exception 'Substituicao incompleta em %', f;
    end if;

    execute novo;
  end loop;
end $$;

revoke all on function public.get_dashboard_stats_impl(uuid, date, date, text, text, text) from public, anon, authenticated;
revoke all on function public.get_commercial_dashboard_impl(uuid, date, date, date, date, text, text, text, date, date, text, text) from public, anon, authenticated;
