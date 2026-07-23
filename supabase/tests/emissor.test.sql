-- Suite pgTAP do EMISSOR (fila de saida).
--
-- Como rodar: cole o conteudo inteiro numa execucao SQL. Roda em transacao e termina em ROLLBACK,
-- entao NAO deixa rastro em producao. Foi escrita assim de proposito: o banco e compartilhado por
-- todas as sessoes e nao existe ambiente de homologacao com dados reais.
--
-- Cobre as invariantes que leitura de codigo nao garante:
--   - a chave nasce desligada (fail-closed)
--   - o telefone e normalizado UMA vez, no ponto de entrada
--   - dedup_key torna o envio idempotente (pre-requisito para retry seguro)
--   - ORDEM POR CONVERSA: a bolha 2 nao sai antes de a bolha 1 ser confirmada
--   - backoff devolve para a fila em vez de perder a mensagem
--   - a purga nao encosta em mensagem pendente
--
-- ARMADILHA aprendida ao escrever: `select ... from outbound_messages where id = emit_message(...)`
-- devolve NULL. A query externa usa o snapshot tirado no inicio e nao enxerga a linha inserida
-- pela funcao chamada dentro dela. Chame emit_message ANTES, guarde o id, depois consulte.

begin;
select plan(12);

create temp table _out(i serial, linha text);
create temp table _ctx as select (select id from public.clinics order by created_at limit 1) as clinic;

insert into _out(linha) select ok(not public.fn_emissor_ativo((select clinic from _ctx)), 'chave nasce desligada');

create temp table _n as select public.emit_message((select clinic from _ctx), '5511987654321','teste','oi') as id;
insert into _out(linha) select is((select to_addr from public.outbound_messages where id=(select id from _n)),
  public.normalize_br_phone('5511987654321'), 'normaliza telefone (tira o 9o digito)');
insert into _out(linha) select is((select length(to_addr) from public.outbound_messages where id=(select id from _n)), 12,
  'destino sai com 12 digitos, formato que a uazapi aceita hoje');
insert into _out(linha) select is((select conversation_key from public.outbound_messages where id=(select id from _n)),
  (select clinic from _ctx)::text || '|' || public.normalize_br_phone('5511987654321'),
  'conversation_key usa o telefone ja normalizado');

insert into _out(linha) select is(
  public.emit_message((select clinic from _ctx),'5511900000001','teste','a','text',null,'lead',null,null,null,null,0,'chave-x'),
  public.emit_message((select clinic from _ctx),'5511900000001','teste','b','text',null,'lead',null,null,null,null,0,'chave-x'),
  'dedup devolve mesmo id');
insert into _out(linha) select is((select count(*) from public.outbound_messages where dedup_key='chave-x')::int, 1,
  'dedup nao duplica');

select public.emit_message((select clinic from _ctx),'5511911111111','teste','bolha 1');
select public.emit_message((select clinic from _ctx),'5511911111111','teste','bolha 2');
create temp table _c1 as select * from public.claim_outbound_messages(50,'teste')
  where to_addr = public.normalize_br_phone('5511911111111');
insert into _out(linha) select is((select count(*) from _c1)::int, 1, 'uma por conversa');
insert into _out(linha) select is((select body from _c1), 'bolha 1', 'ordem: bolha 1 primeiro');
insert into _out(linha) select is((select count(*)::int from public.claim_outbound_messages(50,'teste')
  where to_addr = public.normalize_br_phone('5511911111111')), 0, 'bolha 2 espera a 1 sair');
select public.mark_outbound_sent((select id from _c1), 200, 'wamid.X', null, null, false);
insert into _out(linha) select is((select body from public.claim_outbound_messages(50,'teste')
  where to_addr = public.normalize_br_phone('5511911111111')), 'bolha 2', 'bolha 2 sai depois');

create temp table _f as select public.emit_message((select clinic from _ctx),'5511922222222','teste','x') as id;
select public.claim_outbound_messages(50,'teste');
select public.mark_outbound_failed((select id from _f),'erro simulado',500);
insert into _out(linha) select is((select status from public.outbound_messages where id=(select id from _f)),'pending',
  'backoff volta a pending');
insert into _out(linha) select is(public.purge_outbound_messages(30), 0, 'purga poupa pendente');

select string_agg(linha, E'\n' order by i) as resultado from _out;
rollback;
