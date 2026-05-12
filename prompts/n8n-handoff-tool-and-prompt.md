# Handoff via Tool — Trechos para colar no n8n

Substitui a abordagem de "Gatilho:" no texto pela tool dedicada `ACIONAR_HANDOFF`. Resolve definitivamente o vazamento.

## 1. Novo Set: `prompt transbordo`

Substitui o conteúdo do nó `prompt transbordo` (o que tinha `"acrescente no final do output: Gatilho: ..."`). Cola **exatamente** isso no campo `value`:

```js
={{(() => {
  const rules = ($('Start').item.json.handoff_rules || []).filter(r => r && r.keywords);
  if (rules.length === 0 || !$('Start').item.json.handoff_enabled) return '';
  const kws = rules.map(r => `- ${r.keywords}`).join('\n');
  return `## Transbordo para humano\n\nSe o cliente mencionar QUALQUER uma das palavras-chave abaixo (ou variações claras delas), CHAME IMEDIATAMENTE a tool ACIONAR_HANDOFF passando trigger_keyword com a palavra detectada.\n\nPalavras-chave configuradas:\n${kws}\n\nA tool cuida de tudo: pausa a IA, avisa a equipe e envia despedida ao cliente se configurado. Você NÃO deve escrever \"Gatilho:\", \"vou transferir\" ou qualquer marcador no texto.\n\nAo chamar a tool, leia o campo next_step retornado e siga ele literalmente.`;
})()}}
```

Guard de vazio: se `handoff_enabled` é false ou não há regras, retorna string vazia (nada é injetado no system message).

## 2. Nova Tool: `ACIONAR_HANDOFF` (HTTP Request Tool)

Adicione um novo HTTP Request Tool conectado ao AI Agent (mesma forma que `MARCAR_HORARIO`):

| Campo | Valor |
|-------|-------|
| **Name** | `ACIONAR_HANDOFF` |
| **Description** | `Aciona o transbordo de handoff configurado pela clínica (pausa IA, notifica equipe, despede o cliente, muda etapa do funil). Chame quando o cliente mencionar qualquer palavra-chave de handoff_rules. Passe a palavra detectada no campo trigger_keyword.` |
| **Method** | POST |
| **URL** | `https://yzpclhuifquhfqpiwysh.supabase.co/functions/v1/ai-scheduler` |
| **Headers** | `Authorization: Bearer <SUPABASE_ANON_KEY>` |
| **Send Body** | ON, Content-Type: JSON |
| **Body** | Ver JSON abaixo |

Body:

```json
{
  "action": "trigger_handoff",
  "clinic_id": "{{ $('Start').item.json.clinic_id }}",
  "lead_phone": "{{ $('Start').item.json.lead_phone }}",
  "trigger_keyword": "<<value que o LLM passa via $fromAI>>"
}
```

Parâmetro do LLM (defina como `defined automatically by the model`):
- `trigger_keyword` (string): A palavra-chave detectada na mensagem do cliente

## 3. Limpeza no n8n após o AI Agent

Os seguintes nós podem ser **removidos** porque a lógica deles agora vive dentro da action `trigger_handoff`:

- `Switch` (a que checa "Gatilho: transfer")
- `Desativa IA`
- `Envia resposta do Transbordo`
- `Puxa dados Clinica`
- `Envia aviso GP`
- `Atualiza etapa de funil`

O output do `AI Agent` passa direto pro nó que envia a mensagem do agente pro WhatsApp.

## 4. Limpa output (preventivo)

Mesmo com a tool no lugar, vale um sanitizador final no output do AI Agent. Adiciona um nó **Set** depois do AI Agent (antes do envio pro WhatsApp):

| Campo | Valor |
|-------|-------|
| **Name** | `cleaned_output` |
| **Value** | `={{ ($json.output || '').replace(/^\s*Gatilho:.*$/gm, '').trim() }}` |

E no nó que envia pro WhatsApp, troca `$json.output` por `$json.cleaned_output`. Garante que **nenhum** "Gatilho:" residual de um prompt antigo ou alucinação ainda chegue ao cliente.

## Como testar

1. Habilite o handoff no MedDesk (botão ATIVO no card Gatilhos de Handoff)
2. Configure uma regra:
   - Palavras-chave: `humano, atendente, falar com pessoa`
   - Mover para etapa: alguma
   - Ação: `Transferir Atendimento`
   - Mensagem despedida: ativa, com texto
   - Mensagem grupo: com {lead_name}, {trigger_keyword}
3. No número de teste, mande: "quero falar com humano"
4. Verificar:
   - Lead.ai_enabled passou pra false
   - Lead.stage_id mudou
   - Grupo recebeu notificação
   - Cliente recebeu mensagem de despedida
   - **Não apareceu "Gatilho:" ou "SUMMARY:" no chat do cliente**

## Resposta da tool

```json
{
  "success": true,
  "applied": true,
  "action_taken": "transfer",
  "matched_keyword": "humano",
  "actions": ["ai_paused", "stage_moved", "group_notified", "farewell_sent"],
  "stage_changed": true,
  "farewell_sent": true,
  "notified": true,
  "next_step": "Transbordo executado. A despedida já foi enviada ao cliente e a equipe foi avisada. NÃO responda mais nada — a IA está pausada para este lead."
}
```

Quando não aplica (handoff desligado, sem regra, sem match):

```json
{
  "success": true,
  "applied": false,
  "reason": "handoff_disabled" | "no_rules_configured" | "no_rule_matched",
  "next_step": "Continue a conversa normalmente."
}
```
