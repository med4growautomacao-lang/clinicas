-- Conversa não lida: marca quando o LEAD fala e só apaga quando um HUMANO lê ou responde.
--
-- Por que uma coluna nova e não `last_message_at > last_outbound_at`: aquela conta diz "falta
-- responder", e a IA respondendo já a zera — mesmo sem ninguém da equipe ter lido. O pedido é
-- outro: piscar até um HUMANO ver. São dois fatos diferentes e os dois continuam existindo.
--
-- ⚠️ TIPO: `timestamp` SEM fuso, igual a `leads.last_message_at` e a `chat_messages.created_at`
-- (já em America/Sao_Paulo). `timestamptz` aqui deslocaria 3h na comparação, sem erro nenhum.
alter table public.leads add column if not exists unread_since timestamp;

comment on column public.leads.unread_since is
  'Instante da PRIMEIRA mensagem do contato ainda não lida por um humano (NULL = lida). Marca no inbound, zera quando um humano abre a conversa na tela ou responde.';

-- Filtro "Não lidos" das telas: parcial, então só indexa o que está aberto (dezenas por clínica),
-- não a base inteira.
create index if not exists idx_leads_unread_since
  on public.leads (clinic_id, unread_since desc)
  where unread_since is not null;

create or replace function public.fn_update_lead_last_fields()
 returns trigger
 language plpgsql
 set search_path to 'public', 'extensions'
as $function$
begin
  if NEW.lead_id is not null then
    update public.leads
      set last_activity_at = NEW.created_at,
          last_message_at  = case when NEW.direction = 'inbound' then NEW.created_at else last_message_at end,
          last_outbound_at = case when NEW.direction = 'outbound' and NEW.sender is distinct from 'system'
                                  then NEW.created_at else last_outbound_at end,
          -- Não lida. Três decisões moram neste CASE:
          --  1. `coalesce(unread_since, ...)` guarda a PRIMEIRA não lida, não a última: é ela que
          --     diz há quanto tempo o cliente espera. Sobrescrever zeraria a espera a cada "?".
          --  2. Só `sender='human'` apaga. Resposta da IA e disparo automático ('system') NÃO
          --     apagam — o pedido é piscar até um humano ver. Resposta dada pelo app do WhatsApp
          --     volta como outbound/human no deep-sync, então essa saída também limpa o card.
          --  3. Importação de histórico não marca nada: sem esta guarda, a clínica que sincroniza
          --     3 meses de conversa estrearia o recurso com o quadro inteiro piscando.
          unread_since = case
            when NEW.direction = 'inbound'
                 and coalesce(current_setting('app.onboarding_import', true), '') <> 'on'
              then coalesce(unread_since, NEW.created_at)
            when NEW.direction = 'outbound' and NEW.sender = 'human'
              then null
            else unread_since
          end
      where id = NEW.lead_id;
  end if;
  return NEW;
end; $function$;

-- Estreia com o que é verdade HOJE, e só isso: contato que falou nas últimas 48h e não teve
-- resposta de ninguém (nem da IA). Janela curta de propósito — marcar meses de histórico faria
-- centenas de cards piscarem no primeiro acesso, e alerta que nasce ignorado nasce morto.
update public.leads
   set unread_since = last_message_at
 where unread_since is null
   and coalesce(is_not_lead, false) = false
   and last_message_at is not null
   and last_message_at > coalesce(last_outbound_at, '-infinity'::timestamp)
   and last_message_at > (now() at time zone 'America/Sao_Paulo') - interval '2 days';
