# Prompts do Agente n8n

Pasta com as versões do system prompt usado no AI Agent do n8n (secretária virtual da clínica).

## Versões

| Versão | Arquivo | Quando | Principais mudanças |
|--------|---------|--------|---------------------|
| V2 | [agent-secretaria-v2.md](./agent-secretaria-v2.md) | até 2026-05-12 | Mecânica básica de agendamento. Sem histórico do paciente. Permitia tool Think. |
| **V3 (atual)** | [agent-secretaria-v3.md](./agent-secretaria-v3.md) | 2026-05-12 | + Regra #0 chama `VER_HISTORICO_PACIENTE` no início. + Proibição de raciocínio em voz alta. Adaptação de cumprimento por cenário. **Removido o bloco SUMMARY** (vazava no texto pro paciente). |

## Outros guias

| Arquivo | Conteúdo |
|---------|----------|
| [n8n-reset-flow.md](./n8n-reset-flow.md) | Como ligar os comandos de reset (test_reset_full / test_reset_for_rebook) no n8n |
| [n8n-handoff-tool-and-prompt.md](./n8n-handoff-tool-and-prompt.md) | Como configurar o handoff via tool `ACIONAR_HANDOFF` (substitui o texto-marcador "Gatilho:") |

## Changelog detalhado V2 → V3

**Adições:**
- **Regra #0** — toda conversa começa com `VER_HISTORICO_PACIENTE` (clinic_id + lead_phone) pra trazer contexto de jornadas anteriores. Tabela de cenários com cumprimento adaptado.
- **Encerramento com summary** — quando o atendimento acaba (marcou, desistiu, etc.), gera resumo de 1-2 frases e salva no `tickets.summary`. É o que alimenta o `VER_HISTORICO_PACIENTE` nas próximas vezes.
- **Tom** — bloco novo explicitando voz brasileira informal-educada, máx 1 emoji, mensagens curtas.

**Remoções/Restrições:**
- **Tool Think proibida** — bloco "Não use raciocínio em voz alta". Em V2 era permitido com ressalva, agora é proibido (causa poluição de memória e confusão entre rodadas).
- Removida menção a "data de nascimento" como obrigatória ao agendar — em V3 só pede se o paciente for novo (não veio do histórico).

**Esclarecimentos:**
- Tabela final de tools com quando chamar cada uma + campos essenciais.
- Erros do `MARCAR_HORARIO` ampliados (slot_conflict, doctor_not_found, missing_fields, idempotent).
- Convenção: nunca repassar texto técnico de erro pro paciente — reformular naturalmente.

## Tools disponíveis no edge function `ai-scheduler`

Versão deployada no Supabase: **v14** (`yzpclhuifquhfqpiwysh`).

| Action | Descrição |
|--------|-----------|
| `get_patient_history` | Histórico de jornadas anteriores do paciente (tickets passados com summary, total de consultas, total pago). |
| `get_availability` | Slots disponíveis em uma data/intervalo. |
| `get_patient_appointments` | Lista appointments passados/futuros do paciente. |
| `book_appointment` | Cria appointment (RPC `book_appointment` com idempotência via request_id). |

URL: `https://yzpclhuifquhfqpiwysh.supabase.co/functions/v1/ai-scheduler`

## Como usar

Cole o conteúdo do arquivo `.md` correspondente no campo **System Message** do nó **AI Agent** no n8n. Não inclua o título "# Prompt Fixo — ..." se preferir.

## Notas de manutenção

- Ao mudar comportamento, criar **nova versão (V4, V5...)**, NÃO sobrescrever a anterior. Permite rollback rápido e comparação A/B.
- Atualizar este README com o changelog.
- Manter o paralelo entre tools deployadas e tools mencionadas no prompt.
