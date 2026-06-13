# Tools de Reagendamento e Cancelamento para a IA (n8n)

Novas actions da edge `ai-scheduler` (v26) para a IA **alterar** e **desmarcar** consultas
do próprio paciente da conversa. Antes, "quero mudar minha consulta" era beco sem saída
(a IA só sabia marcar). Agora o ciclo completo é coberto:

| Tool (sugestão de nome) | action | O que faz |
|---|---|---|
| `REAGENDAR_HORARIO` | `reschedule_appointment` | muda data/hora (e opcionalmente médico/tipo) de uma consulta existente |
| `CANCELAR_HORARIO` | `cancel_appointment` | desmarca uma consulta pendente/confirmada |

## Segurança (titularidade) — por que `patient_phone` é da SESSÃO

As duas actions exigem `patient_phone` e a RPC valida que a consulta **pertence ao
paciente daquele telefone** (match por `normalize_br_phone`). Se não pertencer:
`not_your_appointment`. Por isso, igual ao `MARCAR_HORARIO`, o campo `patient_phone`
deve ser **amarrado à sessão** — NUNCA `$fromAI`:

```
{{ $('Start').item.json.lead_phone }}
```

Regras extras: a IA **não** consegue cancelar/reagendar consulta já realizada
(`appointment_not_cancellable` / `appointment_not_reschedulable`).

## De onde vem o `appointment_id`

1. **`CONSULTAR_AGENDAMENTOS`** (`get_patient_appointments`): o `readable_summary` agora
   inclui `[id: <uuid>]` em cada consulta e instrui o modelo a usá-lo.
2. **Erro de `MARCAR_HORARIO`**: quando o paciente já tem consulta marcada, o erro
   `ticket_has_active_appointment` devolve `existing_appointment.appointment_id` e o
   `next_step` já manda usar REAGENDAR/CANCELAR com esse id.

## REAGENDAR_HORARIO — bodyParameters (httpRequestTool, POST {SUPABASE_URL}/functions/v1/ai-scheduler)

| name | value | origem |
|---|---|---|
| `clinic_id` | `={{ $('Start').item.json.body_instanceName }}` | sessão |
| `action` | `reschedule_appointment` | fixo |
| `patient_phone` | `={{ $('Start').item.json.lead_phone }}` | **sessão (nunca $fromAI)** |
| `appointment_id` | `$fromAI` — "ID do agendamento a alterar (obtido em CONSULTAR_AGENDAMENTOS ou no erro de MARCAR_HORARIO)" | IA |
| `date` | `$fromAI` — "Nova data YYYY-MM-DD" | IA |
| `time` | `$fromAI` — "Novo horário HH:MM (de VER_HORARIOS)" | IA |
| `doctor_id` | `$fromAI` — "Opcional: só se for TROCAR de médico; senão deixe vazio" | IA (opcional) |
| `consultation_type_id` | `$fromAI` — "Opcional: só se mudar o tipo; senão deixe vazio" | IA (opcional) |

**toolDescription sugerida:** "Use para MUDAR data/horário de uma consulta JÁ MARCADA do
paciente. Antes, confirme o novo horário com VER_HORARIOS. Não use para marcar consulta
nova (use MARCAR_HORARIO)."

## CANCELAR_HORARIO — bodyParameters

| name | value | origem |
|---|---|---|
| `clinic_id` | `={{ $('Start').item.json.body_instanceName }}` | sessão |
| `action` | `cancel_appointment` | fixo |
| `patient_phone` | `={{ $('Start').item.json.lead_phone }}` | **sessão (nunca $fromAI)** |
| `appointment_id` | `$fromAI` — "ID do agendamento a cancelar" | IA |
| `reason` | `$fromAI` — "Motivo dito pelo paciente (opcional)" | IA (opcional) |

**toolDescription sugerida:** "Use para DESMARCAR uma consulta do paciente, SOMENTE após
ele confirmar explicitamente que quer cancelar. Pergunte se ele prefere reagendar antes
de cancelar."

## Respostas que a IA recebe (contrato)

Toda resposta de erro agora traz `error` (mensagem) + **`next_step`** (instrução direta
para o modelo decidir a próxima ação) e, quando aplicável:
- `alternatives: { date, slots[] }` — horários livres do mesmo médico (mesma data ou
  próximo dia com vaga, até 14 dias) em `slot_conflict`/`slot_unavailable`;
- `existing_appointment: { appointment_id, date, time, status, doctor_name, modality }` +
  `reason` em `ticket_has_active_appointment`:
  - `reason='upcoming_appointment'` → paciente já tem consulta marcada → next_step orienta
    informar/REAGENDAR/CANCELAR;
  - `reason='awaiting_finalization'` → atendimento anterior sem desfecho na recepção →
    next_step orienta explicar e ACIONAR_HANDOFF.

Sucesso de reagendamento/cancelamento traz `readable_summary` pronto para confirmar ao
paciente.

## Ajuste sugerido no prompt do agente (Comportamento)

Adicionar à seção de agendamento:

> Se o paciente quiser MUDAR ou DESMARCAR uma consulta: use CONSULTAR_AGENDAMENTOS para
> achar a consulta (o id vem no resumo), confirme com o paciente qual é, e use
> REAGENDAR_HORARIO (mudança) ou CANCELAR_HORARIO (desmarcar, só após confirmação
> explícita). Sempre siga o `next_step` retornado pelas ferramentas em caso de erro.

## Relacionados

- `n8n-test-gatilho.md` — padrão dos webhooks/payloads.
- Migrations `20260613000011..13` — contexto rico no bloqueio, titularidade nas RPCs e
  lookup por telefone normalizado (`find_patient_by_phone`).
