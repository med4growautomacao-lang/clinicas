-- Ajusta as duas CHECKs de `outbound_messages` que foram escritas quando so existiam texto e
-- midia. Pego por teste antes de qualquer mensagem real entrar na fila:
--
--   1. `outbound_messages_kind_check` so aceitava ('text','media','audio') -> 'menu' era recusado.
--   2. `outbound_body_ou_midia` exigia media_url/media_base64 para TUDO que nao fosse texto ->
--      um menu (que nao tem midia nenhuma, so botoes) nunca entraria.
--
-- Sem isto, `process_confirmation_reminders` no ramo do Emissor levantaria excecao, cairia no
-- exception handler do loop e viraria "send_failed" na Central: o lembrete SUMIRIA para toda
-- clinica com a chave ligada. Barulhento, mas ainda assim uma perda de atendimento.
--
-- LICAO: ao adicionar um `kind` novo, varrer TODAS as CHECKs da tabela, nao so a que voce
-- acabou de escrever.

alter table public.outbound_messages drop constraint if exists outbound_messages_kind_check;
alter table public.outbound_messages
  add constraint outbound_messages_kind_check
  check (kind = any (array['text','media','audio','menu']));

-- Mesma ideia de antes: linha que nao tem o que enviar nao entra na fila. Ganha o ramo do menu,
-- cujo "conteudo" sao os botoes em menu_payload->choices, nao body nem midia.
-- Os status terminais continuam isentos (o worker esvazia base64 apos entregar).
alter table public.outbound_messages drop constraint if exists outbound_body_ou_midia;
alter table public.outbound_messages
  add constraint outbound_body_ou_midia
  check (
    status = any (array['sent','simulated','dropped','failed'])
    or (kind = 'text' and coalesce(btrim(body), '') <> '')
    or (kind = 'menu' and menu_payload is not null and menu_payload ? 'choices')
    or (kind <> 'text' and kind <> 'menu' and (media_url is not null or media_base64 is not null))
  );
