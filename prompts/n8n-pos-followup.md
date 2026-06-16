# Follow-up Pós-Atendimento — Query para o n8n

Dispara uma mensagem **X dias depois** que o ticket foi encerrado, com config separada por desfecho:

- **Ganho** (pós-venda): `ai_config.pos_followup_ganho_enabled`, `pos_followup_ganho_days`, `pos_followup_ganho_message`
- **Perdido** (recuperação): `ai_config.pos_followup_perdido_enabled`, `pos_followup_perdido_days`, `pos_followup_perdido_message`

> Diferente de `finish_*` (Encerramento), que dispara no instante do fechamento, o Pós espera dias.
> A config vem da tela **Follow-up → Pós-Atendimento** (AISecretary.tsx → `PosFollowupView`).

## Data de referência = `tickets.outcome_at`

A "data do fechamento" usada é **`tickets.outcome_at`** (quando o ticket virou ganho/perdido).
Motivo: `tickets.closed_at` está preenchido em pouquíssimos registros (~84 ganho / ~17 perdido),
enquanto `outcome_at` está em 100% dos ganhos/perdidos. É a fonte confiável.

## Dedup (lado n8n)

Esta query **não** controla reenvio — ela retorna todo ticket elegível enquanto a janela de dias
estiver aberta. O n8n é responsável por gravar "pós já enviado" por `ticket_id` (ex.: tabela de log
ou flag) e não reenviar. Como acordado, o controle fica no fluxo (nó de Response/registro).

## Query (rodar 1x/dia, horário comercial America/Sao_Paulo)

```sql
SELECT
  t.id                                AS ticket_id,
  t.clinic_id,
  t.outcome,                          -- 'ganho' | 'perdido'
  t.outcome_at,
  wa.phone_number                     AS clinic_phone,   -- número conectado da clínica
  wa.api_token                        AS token,          -- token uazapi da clínica
  COALESCE(t.lead_phone, l.phone)     AS lead_phone,     -- somente dígitos
  l.name                              AS lead_name,
  CASE t.outcome
    WHEN 'ganho'   THEN ac.pos_followup_ganho_days
    WHEN 'perdido' THEN ac.pos_followup_perdido_days
  END                                 AS days,
  -- mensagem já com {paciente} substituído pelo nome do lead
  replace(
    CASE t.outcome
      WHEN 'ganho'   THEN ac.pos_followup_ganho_message
      WHEN 'perdido' THEN ac.pos_followup_perdido_message
    END,
    '{paciente}', COALESCE(NULLIF(btrim(l.name), ''), 'tudo bem')
  )                                   AS message_to_send
FROM tickets t
JOIN ai_config ac          ON ac.clinic_id = t.clinic_id
JOIN leads l               ON l.id = t.lead_id
JOIN whatsapp_instances wa ON wa.clinic_id = t.clinic_id
WHERE t.outcome IN ('ganho', 'perdido')
  AND t.outcome_at IS NOT NULL
  -- janela: já passaram os dias configurados desde o fechamento
  AND t.outcome_at <= now() - make_interval(days =>
        CASE t.outcome
          WHEN 'ganho'   THEN ac.pos_followup_ganho_days
          WHEN 'perdido' THEN ac.pos_followup_perdido_days
        END)
  -- desfecho habilitado na clínica
  AND (
        (t.outcome = 'ganho'   AND ac.pos_followup_ganho_enabled   = true) OR
        (t.outcome = 'perdido' AND ac.pos_followup_perdido_enabled = true)
      )
  -- mensagem configurada
  AND btrim(COALESCE(
        CASE t.outcome
          WHEN 'ganho'   THEN ac.pos_followup_ganho_message
          WHEN 'perdido' THEN ac.pos_followup_perdido_message
        END, '')) <> ''
  -- lead não pausado individualmente
  AND COALESCE(l.followup_enabled, true) = true
  -- WhatsApp da clínica conectado e com telefone para enviar
  AND wa.status = 'connected'
  AND COALESCE(t.lead_phone, l.phone) IS NOT NULL
ORDER BY t.outcome_at;
```

## Observações

- **Substituição de tags:** a query já troca `{paciente}` pelo `leads.name` (fallback "tudo bem" se vazio).
  Se quiser fazer no n8n, retire o `replace(...)` e use `message_to_send` cru.
- **Telefone:** usa `tickets.lead_phone` (o mesmo telefone com que o ticket foi vinculado) e cai para
  `leads.phone` se nulo. Aplicar a mesma normalização de 9º dígito do fluxo de produção, se necessário.
- **Janela aberta:** com a dedup no n8n, basta a condição `>= dias`. Se preferir disparar só no dia exato,
  troque por `t.outcome_at::date = (current_date - days)`.
- **Reset por novo ticket:** se o lead abrir um ticket novo depois, ele é outro `ticket_id` (não afeta o dedup
  do ticket antigo). Relacionado: `followup-reengagement-gating`, `ticket-outcome-single-source-of-truth`.
```
