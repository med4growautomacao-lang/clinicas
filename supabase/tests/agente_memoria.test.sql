-- Suite pgTAP do AGENTE IA: memoria longa, configuracao e ingestao (lado BANCO).
--
-- Como rodar: cole o conteudo inteiro numa execucao SQL. Roda em transacao e termina em ROLLBACK,
-- entao NAO deixa rastro em producao. Escrita assim de proposito: o banco e compartilhado por todas
-- as sessoes e nao existe homologacao com dados reais.
--
-- O par deste arquivo e `agente_memoria.test.ts` (roda com `deno test`), que cobre o lado TypeScript
-- (janela, rotulos, envelope, corte). Aqui fica so o que e do banco.
--
-- ⚠️ A CORRIDA DO INSERT ENGOLIDO NAO ESTA AUTOMATIZADA AQUI, DE PROPOSITO.
--
-- Tentei: reescrever `ingest_wa_message` dentro da transacao (desativando a busca inicial) para
-- forcar o estado. Funciona quando se fixa a clinica na mao, mas ao generalizar para "qualquer
-- clinica com agente ligado" o insert deixou de ser engolido e os asserts passavam por acidente,
-- sem exercitar a rede. Teste que nao percorre o caminho e PIOR que teste nenhum: ele fica verde e
-- ensina a confiar. Entao ficou de fora, e a prova mora no procedimento manual abaixo.
--
-- COMO REPRODUZIR A CORRIDA NA MAO (foi assim que a correcao foi provada, em 03/08/2026):
--   begin;
--   -- 1) desativa SO a busca inicial (1a ocorrencia), forcando o estado da corrida:
--   do $t$ declare d text; alvo text := 'normalize_br_phone(phone) = v_norm'; p int; begin
--     select pg_get_functiondef(pr.oid) into d from pg_proc pr join pg_namespace n on n.oid=pr.pronamespace
--      where n.nspname='public' and pr.proname='ingest_wa_message';
--     p := position(alvo in d); d := substr(d,1,p-1)||'false'||substr(d,p+length(alvo)); execute d;
--   end $t$;
--   -- 2) o lead JA existe (criado pela outra execucao da rajada). Use uma clinica com agente ligado
--   --    e pegue o token da MESMA clinica (clinica de um lado e token de outro nao reproduz nada):
--   insert into leads (clinic_id, name, phone, capture_channel)
--        values ('<clinic_id>', 'Corrida', '5511988887777', 'whatsapp');
--   -- 3) chega a segunda mensagem da rajada:
--   select ingest_wa_message(p_instance_token => '<token da MESMA clinica>', p_direction => 'inbound',
--          p_lead_phone => '5511988887777', p_content => 'oi', p_wa_message_id => 'corrida',
--          p_lead_name => 'Corrida', p_sender => 'human', p_media_kind => null, p_media_mime => null,
--          p_media_path => null, p_media_filename => null, p_media_duration => null, p_avatar_url => null);
--   rollback;
--   Esperado COM a rede:  lead_id preenchido e forward_ai = true.
--   Sem a rede (removendo tambem a re-busca): lead_id nulo e forward_ai = false. Era a perda silenciosa.
--
-- Cobre as invariantes que leitura de codigo nao garante, e cada uma nasceu de um DEFEITO REAL:
--   - a view da memoria roda com security_invoker (um `create or replace view` ja apagou isso)
--   - as duas RPCs de config fazem MERGE, nao reconstroem o jsonb do zero
--   - provider 'openai' e recusado (o despacho manda tudo que nao e anthropic para o Gemini,
--     entao aceitar 'openai' entregaria a chave da OpenAI ao Google)
--   - os prompts fixos nao tem a ferramenta morta do n8n nem a sintaxe $('Start')
--   - a rede de seguranca do insert engolido continua no lugar em `ingest_wa_message`

begin;
select plan(13);

-- ⚠️ Os resultados vao para `_out` em vez de sairem soltos: quem roda isto por uma execucao SQL
-- costuma ver SO o ultimo conjunto de resultados, e ai um teste que falhou no meio passa batido.
-- No fim, `select * from _out` mostra os 13 de uma vez. Mesmo padrao de `emissor.test.sql`.
create temp table _out(i serial, linha text);
-- ⚠️ Os testes de config trocam o papel para `authenticated` (as RPCs exigem is_super_admin, que le
-- o JWT). Sem este grant, a tabela temporaria continua sendo do papel original e o INSERT do
-- resultado morre com "permission denied", derrubando a suite no meio.
grant usage on sequence _out_i_seq to authenticated;
grant insert on _out to authenticated;

-- Super admin de verdade: as RPCs de config exigem `is_super_admin()`, que le o JWT da sessao.
create temp table _ctx as
  select (select id from public.clinic_users where role = 'super-admin' limit 1) as super_id;

-- ── 1. A view da memoria: security_invoker + fechada ─────────────────────────
-- Sem `security_invoker` a view roda com os privilegios do DONO e NAO aplica a RLS de
-- chat_messages: no dia em que alguem conceder SELECT, ela devolve conversa de todas as clinicas.
insert into _out(linha) select ok(
  (select reloptions from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'vw_n8n_chat_memory') @> array['security_invoker=on'],
  'vw_n8n_chat_memory roda com security_invoker');

insert into _out(linha) select ok(not has_table_privilege('anon', 'public.vw_n8n_chat_memory', 'SELECT'),
  'anon nao le a view da memoria');
insert into _out(linha) select ok(not has_table_privilege('authenticated', 'public.vw_n8n_chat_memory', 'SELECT'),
  'authenticated nao le a view da memoria');

-- ── 2. A rede de seguranca da ingestao ───────────────────────────────────────
insert into _out(linha) select ok(
  (select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'ingest_wa_message') like '%lead_nao_resolvido%',
  'ingest_wa_message tem a rede de seguranca do insert engolido');

-- ── 3. Prompts fixos limpos ──────────────────────────────────────────────────
-- A ferramenta MEMORIA_LONGA era sub-workflow do n8n e nao existe no agente nativo; a expressao
-- $('Start') chega ao modelo como texto literal. O template e trocavel num menu da aba Comercial.
insert into _out(linha) select is((select count(*)::int from public.prompt_templates where content like '%MEMORIA_LONGA%'), 0,
  'nenhum prompt fixo cita a ferramenta morta do n8n');
insert into _out(linha) select is((select count(*)::int from public.prompt_templates where content like '%$(''Start'')%'), 0,
  'nenhum prompt fixo tem a sintaxe do n8n');
insert into _out(linha) select is(
  (select count(*)::int from public.prompt_templates where content not like '%memoria_do_contato%'), 0,
  'todo prompt fixo ensina o agente a usar a ficha');

-- ── 4. Config: MERGE parcial, nunca reconstruir do zero (CLAUDE.md §2) ───────
select set_config('request.jwt.claims',
  json_build_object('sub', (select super_id from _ctx), 'role', 'authenticated')::text, true);
select set_config('role', 'authenticated', true);

-- memoria longa: chave que a funcao nao conhece tem que sobreviver ao "Salvar"
update public.system_settings set value = (value::jsonb || '{"_teste_chave_futura": 1}'::jsonb)::text
 where id = 'long_memory_config';
select public.set_long_memory_config('{"model":"claude-haiku-4-5","provider":"anthropic"}'::jsonb);
insert into _out(linha) select ok((select value::jsonb ? '_teste_chave_futura' from public.system_settings where id = 'long_memory_config'),
  'set_long_memory_config preserva chave desconhecida');
insert into _out(linha) select is((select value::jsonb ->> 'temperature' from public.system_settings where id = 'long_memory_config'),
  '0.2', 'set_long_memory_config preserva o que nao foi enviado');

-- `enabled` ausente PRESERVA o atual: era assim que uma gravacao parcial religava a memoria de todo
-- mundo sem ninguem pedir.
select public.set_long_memory_config('{"enabled": false}'::jsonb);
select public.set_long_memory_config('{"model":"gemini-3.1-flash-lite"}'::jsonb);
insert into _out(linha) select is((select value::jsonb ->> 'enabled' from public.system_settings where id = 'long_memory_config'),
  'false', 'enabled ausente NAO religa a memoria sozinho');

-- modelo do agente: mesmo contrato
update public.system_settings set value = (value::jsonb || '{"_teste_chave_futura": 1}'::jsonb)::text
 where id = 'agent_ai_config';
select public.set_agent_ai_config('{"model":"claude-sonnet-5","provider":"anthropic"}'::jsonb);
insert into _out(linha) select ok((select value::jsonb ? '_teste_chave_futura' from public.system_settings where id = 'agent_ai_config'),
  'set_agent_ai_config preserva chave desconhecida');

-- ── 5. provider 'openai' e recusado nas DUAS ─────────────────────────────────
-- `llm.ts` despacha `provider === 'anthropic' ? anthropic : gemini`, ou seja tudo que nao e
-- Anthropic vai para o Gemini. Aceitar 'openai' faria a chave da OpenAI ser postada na URL do
-- Google. Se um dia entrar OpenAI de verdade, comece pelo DESPACHO, nao por esta lista.
insert into _out(linha) select throws_ok(
  $$ select public.set_long_memory_config('{"provider":"openai","model":"gpt-4o"}'::jsonb) $$,
  null, null, 'memoria longa recusa provider openai');
insert into _out(linha) select throws_ok(
  $$ select public.set_agent_ai_config('{"provider":"openai","model":"gpt-4o"}'::jsonb) $$,
  null, null, 'modelo do agente recusa provider openai');

reset role;
select set_config('request.jwt.claims', null, true);

insert into _out(linha) select * from finish();
select linha from _out order by i;
rollback;
