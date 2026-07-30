-- Backfill da chave de memoria: une as DUAS sessoes que o mesmo paciente tinha.
--
-- De 17/07 a 30/07/2026 o agente gravou a resposta dele numa sessao montada com o telefone CRU
-- do chatid (13 digitos, COM o 9) enquanto a conversa do paciente ficou na sessao do telefone
-- normalizado (12 digitos). Corrigido o codigo (ingest_wa_message devolve a chave, wa-inbound
-- repassa, ai-agent usa), sobra alinhar o que ja esta gravado: sem isso, TODA conversa em
-- andamento continuaria comecando do zero, porque o historico ficaria na sessao velha.
--
-- ESCOPO ESTREITO DE PROPOSITO: so telefone de 13 digitos comecando em 55 com 9 na 5a posicao,
-- que e exatamente a classe que normalize_br_phone corrige (1.859 linhas / 200 leads, conferido).
-- NAO usa normalize_br_phone em cima de tudo: existem no historico telefones de 11 digitos SEM
-- DDI, e 88 linhas deles sao de fora (DDD 56/59 nao existe no Brasil, e Chile/Uruguai/Paraguai).
-- Nesses, normalize_br_phone gruda '55' na marra e o numero nunca mais casa com a pessoa
-- (CLAUDE.md 2, "a armadilha e o estrangeiro sem DDI"). Aquilo e defeito ANTIGO, de outra
-- origem, e nao entra aqui.
--
-- UPDATE nao dispara os triggers BEFORE INSERT de chat_messages, entao nada re-cascateia
-- (sem ticket novo, sem handoff, sem analista).

-- (1) conversa: telefone e sessao no padrao
update chat_messages
   set phone = substr(phone,1,4) || substr(phone,6),
       session_id = case
         when session_id like '%'||phone
           then left(session_id, length(session_id)-length(phone))
                || substr(phone,1,4) || substr(phone,6)
         else session_id   -- 26 linhas da clinica Demo, session_id nulo: so o telefone entra no padrao
       end
 where length(phone) = 13 and left(phone,2) = '55' and substr(phone,5,1) = '9';

-- (2) lead: a sessao gravada em leads.session_id e o que o fetchAgentContext usa para achar o
-- resumo do contato (Dados do Lead). Deixar a velha aqui manteria o agente sem o resumo depois
-- do backfill, trocando um buraco de memoria por outro.
-- A expressao da cauda vai repetida no lugar de um LATERAL porque em UPDATE ... FROM a tabela
-- alvo nao pode ser referenciada de dentro do FROM.
update leads l
   set session_id = wi.phone_number
                 || substr(substr(l.session_id, length(wi.phone_number)+1), 1, 4)
                 || substr(substr(l.session_id, length(wi.phone_number)+1), 6)
  from whatsapp_instances wi
 where wi.clinic_id = l.clinic_id
   and coalesce(wi.phone_number,'') <> ''
   and l.session_id is not null
   and starts_with(l.session_id, wi.phone_number)
   and length(substr(l.session_id, length(wi.phone_number)+1)) = 13
   and left(substr(l.session_id, length(wi.phone_number)+1), 2) = '55'
   and substr(substr(l.session_id, length(wi.phone_number)+1), 5, 1) = '9';

-- (3) fila de turnos: chave velha em buffer ainda nao processado responderia sem historico.
-- E fila transitoria (o claim DELETA), entao alinhar aqui e barato e evita um ultimo turno cego.
-- O NOT EXISTS evita colidir com a unica (session_id) quando as duas chaves ja estao na fila.
update ai_turn_buffer b
   set session_id = wi.phone_number
                 || substr(substr(b.session_id, length(wi.phone_number)+1), 1, 4)
                 || substr(substr(b.session_id, length(wi.phone_number)+1), 6)
  from whatsapp_instances wi
 where wi.clinic_id::text = b.clinic_id
   and coalesce(wi.phone_number,'') <> ''
   and starts_with(b.session_id, wi.phone_number)
   and length(substr(b.session_id, length(wi.phone_number)+1)) = 13
   and left(substr(b.session_id, length(wi.phone_number)+1), 2) = '55'
   and substr(substr(b.session_id, length(wi.phone_number)+1), 5, 1) = '9'
   and not exists (
     select 1 from ai_turn_buffer x
      where x.session_id = wi.phone_number
                        || substr(substr(b.session_id, length(wi.phone_number)+1), 1, 4)
                        || substr(substr(b.session_id, length(wi.phone_number)+1), 6));
