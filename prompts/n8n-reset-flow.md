# Reset de Teste — Integração n8n

Dois mecanismos para resetar dados de testes da IA, ambos disparando RPCs no Supabase.

## RPCs disponíveis

| RPC | Efeito |
|-----|--------|
| `test_reset_full(p_phone text)` | Apaga TUDO de um phone: lead, chat_messages, ticket, paciente, appointments, conversions, financial_transactions, medical_records, prescriptions, exam_requests. Simula "primeiro contato absoluto". |
| `test_reset_for_rebook(p_phone text)` | Apaga lead + chat_messages, fecha tickets abertos. Mantém paciente, appointments antigos, conversions, financial, prontuário. Simula "paciente voltando para reagendar". |

Ambas retornam JSON com contagem do que foi apagado.

## Mecanismo 1 — Botões na UI

Em **Comercial → Configurações → Modo Teste IA**, cada número permitido tem dois botões:

- **ZERAR** (vermelho) → chama `test_reset_full(phone)` direto via supabase.rpc no front
- **REAGEND.** (âmbar) → chama `test_reset_for_rebook(phone)` direto via supabase.rpc no front

Pede confirmação antes (`confirm()`), mostra toast com resultado. Não precisa de n8n.

## Mecanismo 2 — Frase no WhatsApp

Configurado em `ai_config`:
- `test_reset_phrase` — frase do reset completo (ex: "reiniciar agente teste")
- `test_reset_phrase_rebook` — frase do reagendamento (ex: "simular reagendamento")
- `test_numbers` — array de números autorizados a disparar
- `test_mode_enabled` — boolean que liga a feature

### Fluxo no n8n (sugerido)

No nó que recebe mensagem do WhatsApp, ANTES do AI Agent:

```js
// Pega config da clinic
const { data: cfg } = await supabase.from('ai_config')
  .select('test_mode_enabled, test_numbers, test_reset_phrase, test_reset_phrase_rebook')
  .eq('clinic_id', clinic_id).maybeSingle();

if (!cfg?.test_mode_enabled) return { action: 'continue' };

const phone = item.json.lead_phone;
const message = String(item.json.message || '').trim().toLowerCase();

// Só números autorizados disparam reset
if (!(cfg.test_numbers || []).includes(phone)) return { action: 'continue' };

if (cfg.test_reset_phrase && message === cfg.test_reset_phrase.toLowerCase()) {
  const { data } = await supabase.rpc('test_reset_full', { p_phone: phone });
  // Responde no whatsapp:
  return { action: 'reply_and_stop', text: `✅ Reset completo executado.\n${JSON.stringify(data.deleted)}` };
}

if (cfg.test_reset_phrase_rebook && message === cfg.test_reset_phrase_rebook.toLowerCase()) {
  const { data } = await supabase.rpc('test_reset_for_rebook', { p_phone: phone });
  return { action: 'reply_and_stop', text: `✅ Reset de reagendamento executado. Paciente preservado.\n${JSON.stringify(data.deleted)}` };
}

return { action: 'continue' };
```

### Por que checar `test_numbers` primeiro

A frase de reset é guessable. Sem o filtro de `test_numbers` (lista branca), qualquer paciente que enviasse a frase apagaria seus próprios dados. O filtro garante que **só os números autorizados** disparam o reset.

### Resposta ao testador

Importante avisar no WhatsApp que o reset rolou (não silenciosamente), senão fica difícil saber se a próxima mensagem é "fresh state" ou estado anterior. Sugestão de mensagem:

```
✅ Reset completo executado.
   Apagados: 1 lead, 1 paciente, 2 agendamentos, 5 mensagens.
   Pode mandar nova mensagem como se fosse a primeira vez.
```

## Segurança

- **RPC sem proteção contra abuso por design** — supõe-se que só o backend (n8n com service role) ou a UI autenticada chamam essas RPCs. Em produção real, se você expor o app pra clientes finais, considere adicionar SECURITY DEFINER + check de role.
- **O index único `patients(clinic_id, phone)`** garante que após o reset, criar novamente o paciente não duplica.
- **Mensagens humanas perdidas** — chat_messages e conversões são deletadas sem soft-delete. Se for produção, isso é destrutivo. Por isso o `test_mode_enabled` deve ficar OFF fora de QA.
