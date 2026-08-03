-- Tres consertos na memoria/fila do agente, achados na revisao adversarial de 30/07/2026.
--
-- (1) A VIEW DA MEMORIA passa a expor `direction` e `sender`.
-- Defeito: `roleOf` no memory.ts mapeava message.type='human' -> papel "user" (paciente) sem olhar a
-- DIRECAO. Mensagem que o ATENDENTE digita sai como direction='outbound' + sender='human' +
-- type='human' (16.072 linhas em 7 dias) e o agente lia a fala da propria clinica como se fosse do
-- paciente: "Agendado para 04/08 as 14:30" virava coisa que o PACIENTE disse. Vale igual para o
-- historico importado no onboarding, que tambem e outbound+human. Colunas NOVAS entram no fim, o que
-- `create or replace view` permite; o trigger INSTEAD OF (fn_memory_insert_shield) insere so
-- (session_id, message) e nao e afetado.
--
-- (2) FILA DE TURNOS: merge PARCIAL do contexto em vez de sobrescrever o jsonb inteiro.
-- No ON CONFLICT o buffer era concatenado mas `context = EXCLUDED.context`, ultima mensagem vence.
-- Paciente manda AUDIO e emenda um texto dentro dos 30s de debounce: `midia_type` regredia de
-- 'audio...' para '' e a resposta saia em TEXTO em vez de voz (e no sentido inverso, um turno inteiro
-- de texto saia em voz). Reconstruir jsonb do zero e o que o CLAUDE.md proibe; agora e merge, com
-- regra explicita: se QUALQUER mensagem do turno foi audio, o turno e audio.
--
-- (3) IMPORT DO ONBOARDING: janela da trava 3 de 90 segundos para 10 MINUTOS.
-- As bolhas do agente saem com delay de 6s cada e a linha de memoria (sender='ai') nasce ANTES da
-- primeira entrega. Medido em producao: rajadas de 13 a 15 bolhas com span de entrega de 105s, 110s,
-- 122s, 123s e 219s, ou seja, a CAUDA caia fora dos 90s. Como a trava 2 depende de
-- outbound_messages.provider_message_id, apagada pelo purge de 30 dias, a partir de ~22/08/2026 a
-- cauda voltaria a ser importada como sender='human' (fala da IA assinada como atendente).
-- ⚠️ O corpo final de _onboarding_import_run NAO se repete aqui: ele foi reescrito na migration
-- seguinte (20260730173548), que acrescenta o alerta import_em_clinica_viva e ja contem a janela de
-- 10 minutos. Sao duas `create or replace` da mesma funcao; a ultima e a autoritativa.

create or replace view public.vw_n8n_chat_memory as
  select seq as id,
         session_id,
         message,
         direction,
         sender
    from public.chat_messages
   where jsonb_typeof(message) = 'object';

alter view public.vw_n8n_chat_memory set (security_invoker = on);
revoke all on table public.vw_n8n_chat_memory from anon, authenticated;

CREATE OR REPLACE FUNCTION public.enqueue_ai_turn(p_session_id text, p_clinic_id text, p_text text, p_wait_seconds integer, p_context jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.ai_turn_buffer (session_id, clinic_id, buffer, turn_marker, wait_seconds, context, updated_at)
  VALUES (p_session_id, p_clinic_id, COALESCE(p_text, ''), gen_random_uuid()::text, COALESCE(p_wait_seconds, 30), p_context, now())
  ON CONFLICT (session_id) DO UPDATE
    SET buffer       = ai_turn_buffer.buffer || E'\n' || EXCLUDED.buffer,
        turn_marker  = EXCLUDED.turn_marker,
        wait_seconds = EXCLUDED.wait_seconds,
        clinic_id    = EXCLUDED.clinic_id,
        -- merge raso (o novo vence campo a campo) e depois RESGATA a intencao de audio do turno.
        context      = (coalesce(ai_turn_buffer.context, '{}'::jsonb) || coalesce(EXCLUDED.context, '{}'::jsonb))
                       || case
                            when coalesce(ai_turn_buffer.context->>'midia_type','') ilike '%audio%'
                             and coalesce(EXCLUDED.context->>'midia_type','') not ilike '%audio%'
                            then jsonb_build_object('midia_type', ai_turn_buffer.context->>'midia_type')
                            else '{}'::jsonb
                          end,
        updated_at   = now();
END;
$function$;
