# CLAUDE.md

Instruções para o Claude Code neste repositório.

## Idioma

Responder sempre em **português (pt-BR)**.

---

## Como o agente de IA é instruído (leia antes de mexer em prompt/IA)

O agente do WhatsApp recebe **DOIS prompts**, e confundi-los já custou tempo. A distinção:

| | define | onde mora | escopo |
|---|---|---|---|
| **1. Prompt do Sistema** | **COMO** o agente age: tom, etapas da conversa, quando usar cada tool | `prompt_templates.content`, escolhido por `ai_config.prompt_template_id` | ⚠️ **COMPARTILHADO entre clínicas** — editar afeta todas as que usam aquele modelo |
| **2. Prompt da Clínica** | **O QUE** ele sabe: médicos, horários, valores, endereço, convênios | `ai_config.prompt` | só daquela clínica |

**A composição é feita pela view `public.v_clinic_ai_prompt`:**

```
combined_prompt = template.content + '\n\n---\n\n' + ai_config.prompt
```

**Sistema primeiro, clínica depois.** Sem template, `combined_prompt` é só o da clínica (retrocompatível).

O n8n **já lê essa view**: workflow **"Agente IA"** → nó `Puxa dados Prompt` → nó `Prompt Combinado` (`prompt_fixo_SDR = combined_prompt`) → `systemMessage` do nó `AI Agent`.

### Consequências práticas

- **Regra de comportamento do agente está no prompt do SISTEMA.** Procurar no prompt da clínica não acha. (Foi exatamente esse o erro em 14/07.)
- **Mudar o prompt do sistema mexe com várias clínicas ao mesmo tempo.** Nunca editar um `prompt_template` achando que se está ajustando uma clínica só.
- O prompt da clínica vir por último **não o torna capaz de revogar** uma regra do sistema. Se o comportamento precisa mudar, é o template que muda.

### Uma TERCEIRA fonte, que não é prompt

As **descrições dos tipos de consulta** (`consultation_types.description`) chegam ao agente **em tempo de execução**, pela tool `LISTAR_TIPOS_CONSULTA` — não estão em nenhum dos dois prompts. **É lá que se ensina quando usar cada tipo de consulta.**

Onde isso está documentado na UI (mantenha em sincronia se a regra mudar):
- `src/components/AISecretary.tsx` → `PromptLayersExplainer` (banner na aba Configurações IA)
- `src/components/SuperAdmin.tsx` → `PromptTemplatesManager` (aviso de escopo compartilhado)

---

## n8n — regras de segurança

O n8n roda em produção e **conversa com pacientes reais**.

- **Não alterar o workflow "Receptor de mensagens" sem permissão explícita** — ele alimenta a IA.
- **Não alterar o workflow "Agente IA" sem ordem explícita** do usuário.
- n8n tem modelo **draft/publish**: editar pela API/UI salva **rascunho**. Sempre conferir com `mode: 'active'` que a mudança está na versão **publicada**.

---

## Agendamento

- **Nunca usar `consultation_types.slug` como chave em lógica nova.** É **texto livre digitado pela clínica** (slugify do nome, editável à mão). Use o **`id`**. O slug como chave semântica já gerou 3 bugs — inclusive liberar a exclusão de tipos com consultas futuras.
- O motor (`get_available_slots`) lê a config do **`consultation_types`**, não do `doctors`. Campos de agendamento no médico são **letra morta**.

---

## Banco / Supabase

- Toda chamada HTTP saindo do banco deve usar **`system_http_post`** (não `net.http_post` cru) — é o que permite à **Central de Erros** saber qual URL falhou.
- Erros de edge functions e RPCs críticas vão para **`system_errors`** via `log_system_error`, exibidos em **Super Admin › Central de Erros**.
