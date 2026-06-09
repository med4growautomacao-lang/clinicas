# Webhook de Teste de Gatilho — Contrato para o n8n

Permite que o MedDesk teste uma **regra de funil** (`stage_transition_rules`) sem esperar um lead real cair na condição em produção. Na aba **Automações** do Funil de Oportunidade, cada regra tem um botão **"Realizar Teste"**: o usuário informa um número, o app dispara este webhook e fica **aguardando o n8n mover o card** para a etapa destino.

> **Decisão de arquitetura (Opção B): fluxo de teste SEPARADO e ISOLADO.** Não reaproveitar o fluxo de produção de atendimento — criar um webhook dedicado. Objetivo: resultado determinístico e seguro, **sem poluir métricas** nem disparar follow-up / notificação de grupo / resposta automática da IA.

## Como o app aciona

O app chama a edge function `webhook-proxy`, que repassa o `payload` para o `target_url`:

- **URL (default):** `https://webhook.med4growautomacao.com.br/webhook/meddesk/test-gatilho`
- Pode ser sobrescrita em `system_settings` (linha `id = 'test_gatilho_webhook_url'`).

**Payload recebido pelo webhook do n8n:**

```jsonc
{
  "event": "test_transition_rule",
  "clinic_id": "<uuid da clínica>",
  "lead_phone": "<somente dígitos, ex: 5511999998888>",
  "keywords": "<o Gatilho da regra, ex: [QUALIFICADO]>",
  "message_to_send": "<a Mensagem a Enviar da regra>",
  "target_stage_id": "<uuid da etapa destino>",
  "seed_message": "Esta mensagem é um teste de Gatilhos do sistema MedDesk",
  "token": "<api_token da uazapi da clínica (whatsapp_instances.api_token)>"
}
```

## O que o fluxo de teste no n8n deve fazer

1. **Localizar o lead** pelo `lead_phone` na clínica (`clinic_id`), com a mesma normalização de telefone usada no fluxo de produção (9º dígito/formatação).
2. **Se o lead não existir:** enviar a `seed_message` pelo WhatsApp (uazapi `POST /send/text` com o `token`) e **criar o lead** pelo mesmo caminho do fluxo de entrada normal, porém **marcado como teste** (ex.: uma tag/flag ou `source = 'teste'`) para poder ser excluído das métricas e limpo depois.
3. **Rodar a MESMA detecção de gatilho da produção** sobre a `message_to_send` (reutilizar a sub-lógica/switch do fluxo real para não divergir) e **enviar a `message_to_send`** ao número.
4. **Se o gatilho casar:** mover o ticket aberto do lead para `target_stage_id` — usar a RPC `move_lead_stage(p_ticket_id, p_new_stage_id)` (gera histórico em `lead_stage_history` e mantém `vw_lead_active_stage`/funil corretos), exatamente como o nó "Atualiza etapa de funil".

## Isolamento — o que o fluxo de teste NÃO deve fazer

- **Não** notificar o grupo do WhatsApp.
- **Não** agendar follow-up de reengajamento.
- **Não** acionar resposta automática da IA para o número de teste.
- O único envio ao número é: `seed_message` (apenas se o lead for novo) **+** `message_to_send`.

## Como o app confirma o resultado

O app **não** recebe o resultado pela resposta do webhook — ele faz *polling* no Supabase: consulta a etapa atual do lead pelo telefone (lead → ticket aberto → `stage_id`) a cada ~3s, por até ~60s. Quando `stage_id == target_stage_id`, mostra **"Card movido"** + atalho **"Ver card no funil"**. Se estourar o tempo, mostra um aviso de que a mensagem foi enviada mas o card não mudou de etapa (revisar a config do gatilho no n8n).

> Portanto, o que torna o teste "verde" é o **lead realmente mudar de etapa no banco**. Garanta que o passo 4 use a `move_lead_stage` e persista a mudança.

## Como testar (manual)

1. WhatsApp da clínica conectado e este webhook ativo no n8n.
2. No MedDesk: Funil de Oportunidade → Automações → numa regra com Mensagem a Enviar e Etapa Destino → **Realizar Teste** → informar um número → **Disparar teste**.
3. **Número já lead:** confirmar a chegada da `message_to_send` e o card mover para a etapa destino (painel vira "Card movido" → "Ver card no funil").
4. **Número novo:** confirmar a `seed_message` seguida da `message_to_send`, o lead (marcado como teste) aparecer no funil e mover de etapa.

## Relacionados

- [n8n-handoff-tool-and-prompt.md](./n8n-handoff-tool-and-prompt.md) — handoff via tool `ACIONAR_HANDOFF` (mecanismo distinto, usa `ai_config.handoff_rules`).
- [README.md](./README.md) — índice dos prompts/guias do n8n.
