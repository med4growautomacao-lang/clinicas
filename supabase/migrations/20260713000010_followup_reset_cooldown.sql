-- Loop de perseguição do reengajamento: ticket novo reiniciava a régua do zero.
--
-- CAUSA (13/07): `fn_reset_followup_on_new_ticket` zerava `followup_count` em QUALQUER ticket novo.
-- Combinado com o fim da régua ENCERRAR o ticket (passo is_closing → finalize_ticket resolve=true,
-- ou fn_check_followup_exhausted), fechava um ciclo perverso:
--
--    régua termina → ticket encerrado (Perdido)
--         ↓
--    a pessoa responde — justamente porque acabou de ler "vou encerrar seu atendimento"
--         ↓
--    não há ticket aberto → a mensagem dela ABRE um ticket novo
--         ↓
--    trigger ZERA o contador → lead volta a ser elegível → régua RECOMEÇA do passo 1
--
-- Ou seja: RESPONDER era o gatilho para ser perseguido de novo. Quanto mais educada a pessoa
-- (responder ao encerramento), mais ela era cutucada.
--
-- ALCANCE MEDIDO: 66 leads receberam mais mensagens do que a régua tem passos (~170 mensagens
-- indevidas). Lorena: 38 de 66 reengajados (régua de 1 passo, receberam 2!) — e ela NEM TEM passo
-- de encerramento, provando que o loop não depende dele. Vaz: 27 leads; o "Cleberson" levou
-- 7 mensagens em 3 ciclos — inclusive DEPOIS de dizer "não tenho condições" e no MEIO do próprio
-- agendamento. Ele virou paciente mesmo assim. É o perfil de quem aperta "Bloquear"/"Denunciar" —
-- provável causa da punição do WhatsApp na Vaz (erro 463, ver [[forms-welcome-followup-native]]).
--
-- Por que o dado enganava: o contador é zerado a cada ciclo, então `leads.followup_count` fica
-- baixinho (o Cleberson está com 1!). A insistência só aparece contando os envios em automation_logs.
--
-- FIX: carência de 3 dias (valor escolhido pelo usuário). A régua só reinicia se o último
-- follow-up foi há mais de 3 dias — aí é tratado como retorno genuíno (oportunidade nova).
-- Resposta ao encerramento não reinicia nada.
--
-- TRADE-OFF ACEITO: com 3 dias, quem volta depois disso PODE entrar numa régua nova. No caso real
-- do "Cleberson" (voltou 6 dias após o encerramento, negociando horário), ele receberia o follow-up
-- de novo — e foi exatamente o que o cutucou no meio do agendamento. A trava de etapa
-- (`fs.slug not in ('agendado','compareceu',…)`) no selector NÃO cobre esse caso: o follow-up
-- disparou 08/07 08:00 e o agendamento só foi criado 08/07 10:58 — ele estava NEGOCIANDO, ainda
-- sem agendamento para travar. A janela "quero agendar → agendamento criado" fica desprotegida,
-- agravada pelo delay de 6h do passo 1 (Vaz/Tyago).

begin;

create or replace function public.fn_reset_followup_on_new_ticket()
returns trigger
language plpgsql
as $function$
BEGIN
  IF NEW.status = 'open' THEN
    -- Handoff continua sendo limpo SEMPRE: um ticket novo é um atendimento novo, e isso não tem
    -- relação com a régua de follow-up (não participa do loop).
    UPDATE public.leads
      SET handoff_triggered_at = NULL
      WHERE id = NEW.lead_id
        AND handoff_triggered_at IS NOT NULL;

    -- A RÉGUA, porém, só reinicia após a carência. Sem isto, responder ao "vou encerrar" abre
    -- ticket novo, zera o contador e a perseguição recomeça do passo 1.
    UPDATE public.leads
      SET followup_count   = 0,
          followup_sent_at = NULL
      WHERE id = NEW.lead_id
        AND (followup_count <> 0 OR followup_sent_at IS NOT NULL)
        AND (
          followup_sent_at IS NULL
          OR followup_sent_at < ((now() AT TIME ZONE 'America/Sao_Paulo') - interval '3 days')
        );
  END IF;
  RETURN NEW;
END;
$function$;

commit;
