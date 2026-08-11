-- Backfill do motivo canônico nos 6.758 tickets perdidos já existentes.
--
-- REVERSÍVEL POR CONSTRUÇÃO: só escreve em colunas NOVAS (loss_reason_slug / loss_note) e nunca
-- toca o texto original `loss_reason`, que fica como snapshot do que a clínica de fato escreveu.
-- Desfazer é `update tickets set loss_reason_slug = null`.
--
-- SEGURANÇA DE TRIGGER (conferido antes de rodar): nenhum UPDATE aqui altera `outcome` nem
-- `status`, que são as colunas que armam os gatilhos perigosos de `tickets`:
--   trg_ticket_finish_message      -> WHEN exige outcome/status mudando (não dispara)
--   fn_ticket_left_ganho           -> exige ganho->perdido
--   fn_orcamento_revert_on_sale_lost -> exige sair de ganho
--   fn_settle_reservations_on_resolve -> exige open->closed
-- Ainda assim ligamos a marca de importação em lote, que é o guard da casa para os gatilhos de
-- notificação e de religar IA (trg_notify_venda, trg_notify_encerramento_ganho,
-- trg_activate_ai_on_ticket_resolved). Mensagem para paciente real não pode sair de um backfill.
select set_config('app.onboarding_import', 'on', true);

-- ------------------------------------------------------------------ 1. tradução no atacado
update public.tickets t
   set loss_reason_slug = public.fn_resolve_loss_reason(t.loss_reason)
 where t.outcome = 'perdido'
   and t.loss_reason is not null
   and t.loss_reason_slug is null;

-- ------------------------------------------------------------------ 2. reclassificação fina da IA
-- Os 44 encerramentos da IA têm anotação em 100% dos casos, então dá para ir além do atacado
-- (que jogou todos os 'Fora do perfil' em perfil_nao_atendido). A ordem das condições É a regra
-- de desempate: contato indevido > outra unidade > convênio > perfil > serviço.
-- Discriminador IA x equipe: a IA grava só em tickets; o LossModal grava também em leads.
update public.tickets t
   set loss_reason_slug = case
     when t.notes ~* '(fornecedor|representante comercial|comercial de|distribuidora|bot de|automatizad|por engano|B2B|operadora de telefonia)'
       then 'contato_indevido'
     when t.notes ~* '(outra unidade|Largo do Machado|n[ãa]o faz parte da cl[íi]nica)'
       then 'atendido_em_outra_unidade'
     when t.notes ~* '(conv[êe]nio|Sulam[ée]rica|plano )' and t.notes !~* 'contra conv[êe]nio'
       then 'convenio_pagamento_nao_aceito'
     when t.notes ~* '([0-9]+ anos|menores de|espectro autista|del[íi]rios|sa[úu]de mental)'
       then 'perfil_nao_atendido'
     else 'servico_nao_oferecido'
   end,
   -- a anotação da IA passa a morar no campo próprio, sem sair de `notes` (não apagar histórico)
   loss_note = coalesce(t.loss_note, t.notes)
  from public.leads l
 where l.id = t.lead_id
   and t.outcome = 'perdido'
   and t.loss_reason = 'Fora do perfil'
   and l.loss_reason is null          -- <- foi a IA
   and t.notes is not null;

-- Os 28 'Fora do perfil' da EQUIPE ficam em perfil_nao_atendido pelo atacado. Fica registrado:
-- essa classificação NÃO é provada, porque o modal não tinha campo de anotação e os 28 estão
-- sem uma linha de texto sequer. A Fase 6 dá o campo; daqui pra frente o dado nasce certo.

-- ------------------------------------------------------------------ 3. follow-up esgotado
-- 360 perdas contadas e mudas (ver 20260810163900). O texto entra igual ao que a automação
-- escreve hoje, para o histórico ficar coerente com o que ela vai gravar daqui pra frente.
update public.tickets t
   set loss_reason      = 'Tentativas de follow-up esgotadas',
       loss_reason_slug = 'sem_resposta'
  from public.leads l
 where l.id = t.lead_id
   and t.outcome = 'perdido'
   and t.loss_reason is null
   and l.loss_reason = 'Tentativas de follow-up esgotadas';

-- ------------------------------------------------------------------ 4. importação sem desfecho
update public.tickets t
   set loss_reason_slug = 'importado_sem_desfecho'
 where t.outcome = 'perdido'
   and t.loss_reason is null
   and t.loss_reason_slug is null
   and (t.notes ilike '%onboarding%' or t.notes ilike '%import%');

-- ------------------------------------------------------------------ 5. limpar sujeira em 'ganho'
-- Ticket ganho não tem motivo de perda. São 13 linhas de importação/reabertura antiga; a
-- finalize_ticket nova já impede que voltem a existir.
update public.tickets
   set loss_reason = null, loss_reason_slug = null, loss_note = null
 where outcome = 'ganho'
   and (loss_reason is not null or loss_reason_slug is not null);

