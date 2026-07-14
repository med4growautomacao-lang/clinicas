# CLAUDE.md

Instruções para o Claude Code neste repositório.
Aqui mora só o que é **load-bearing** e **não-descobrível num grep rápido**. Se dá pra achar em 5 segundos, não entra.

## Idioma

Responder sempre em **português (pt-BR)**.

---

# 1. Onde as coisas moram

O sistema **não vive só neste repo**. Antes de procurar um comportamento aqui, decida em qual das quatro camadas ele roda:

| camada | o que roda ali |
|---|---|
| **Repo (React/TS)** | telas, hooks (`src/hooks/useSupabase.ts`), configuração |
| **Banco (Postgres)** | RPCs, triggers, invariantes, RLS, crons (`pg_cron`) |
| **Edge Functions** (`supabase/functions/`) | integrações que falam com o mundo: `ai-scheduler`, `ctwa-tracking`, `whatsapp-redirect`, `meta-forms-sync`, `whatsapp-orchestrator` |
| **n8n** | recepção do WhatsApp, o agente de IA e os disparos de follow-up |

**Regra prática:** comportamento do agente → n8n + prompt. Regra de negócio → banco. Integração externa → edge. Tela → repo.

## Como o agente de IA é instruído

O agente recebe **DOIS prompts**, e confundi-los já custou tempo:

| | define | onde mora | escopo |
|---|---|---|---|
| **1. Prompt do Sistema** | **COMO** o agente age: tom, etapas, quando usar cada tool | `prompt_templates.content`, escolhido via `ai_config.prompt_template_id` | ⚠️ **COMPARTILHADO entre clínicas** |
| **2. Prompt da Clínica** | **O QUE** ele sabe: médicos, horários, valores, endereço | `ai_config.prompt` | só daquela clínica |

A view **`public.v_clinic_ai_prompt`** concatena: `combined_prompt = template.content + '\n\n---\n\n' + ai_config.prompt`. **Sistema primeiro, clínica depois.** Sem template, é só o da clínica.

O n8n já lê essa view: workflow **"Agente IA"** → `Puxa dados Prompt` → `Prompt Combinado` → `systemMessage` do `AI Agent`.

- **Regra de comportamento está no prompt do SISTEMA.** Procurar no da clínica não acha.
- Editar um `prompt_template` **mexe com várias clínicas ao mesmo tempo**.
- O prompt da clínica vir por último **não o torna capaz de revogar** uma regra do sistema.

**Uma terceira fonte, que não é prompt:** as **descrições dos tipos de consulta** (`consultation_types.description`) chegam ao agente em tempo de execução, pela tool `LISTAR_TIPOS_CONSULTA`. **É lá que se ensina quando usar cada tipo.**

Espelhado na UI (manter em sincronia): `AISecretary.tsx` → `PromptLayersExplainer`; `SuperAdmin.tsx` → `PromptTemplatesManager`.

## Agendamento

- **`book_appointment` é a RPC única** — app, Kanban e IA passam por ela. Não inserir em `appointments` direto.
  - `p_validate_availability` tem **default seguro (valida)**; burlar é explícito.
  - `p_source = 'ia'` respeita aviso mínimo; manual o ignora **de propósito** (encaixe de recepção).
- **`get_available_slots` tem 2 overloads.** A versão por **`consultation_type_id` (uuid) é a real**; a de texto é só adaptador de legado.
- O motor lê a config de **`consultation_types`**, **não** de `doctors`. Campos de agendamento no médico são **letra morta**.

## Tickets

**Três caminhos de criação, nenhum no mesmo lugar:**
- WhatsApp → trigger `trg_auto_open_ticket` em `chat_messages` (fn `fn_auto_open_ticket`)
- Formulários → trigger `trg_auto_open_ticket_forms` em `leads`
- App → RPC

Ciclo de vida: `move_lead_stage`, `finalize_ticket`, `reopen_ticket`.

## Dashboards — divergem POR CONSTRUÇÃO

Não são três versões do mesmo número. **Antes de "corrigir" uma divergência, confirme que ela não é o desenho:**

| painel | arquivo | eixo |
|---|---|---|
| Visão Geral | `Dashboard.tsx` (`get_dashboard_stats`) | por **período** |
| Comercial | `ComercialDashboard.tsx` (`get_commercial_dashboard`) | por **coorte** |
| Marketing | `MarketingAnalytics.tsx` | funil por **ticket** |

⚠️ A atribuição IA × Humano **também diverge entre Visão Geral e Comercial por construção**.

## O produto não é só clínicas

`clinics.category = 'outro'` habilita o **módulo de Produção** (estoque, PCP, manutenção) e muda menus.

---

# 2. Invariantes — violar aqui quebra em silêncio

## `tickets.outcome` é a fonte única da verdade
Venda = **1 ticket ganho**. `stage` e `outcome` são **acoplados** — mexer num sem o outro corrompe todos os painéis. Invariantes: **1 ticket aberto por lead**, **1 agendamento ativo por ticket**.

## Telefone: normalizar os DOIS lados, sempre
`leads` é normalizado **no n8n**; `patients`, **no banco** (`normalize_br_phone`). Comparar telefone cru gera "não encontrado" fantasma — é o 9º dígito. Em RPC, normalize os dois lados da comparação.

## `rast_id` ≠ protocolo
- **`rast_id`** (UUID v4) = **identidade do lead**. Todo lead nasce com um. `UNIQUE (clinic_id, rast_id)`.
- **protocolo** = id **de um clique**.

Já foram o mesmo campo, e confundi-los corrompe a jornada multi-toque.

## Canal ≠ origem
`capture_channel` (whatsapp / site_forms / meta_forms / **balcao**) é **como** chegou.
Origem (meta_ads / google_ads / instagram / null=orgânico) é **de onde** veio.
**"Balcão" é canal, nunca origem.**

## Nunca reconstruir JSONB do zero
Formulário que grava um JSONB inteiro sem reler tudo **zera silenciosamente** os campos que não conhece. Já causou 3 bugs de "salvar apaga campo". **Sempre `COALESCE` / merge parcial.**

## RLS multi-tenant
Usar **`is_clinic_admin(clinic_id)`** / **`is_super_admin()`**.
⚠️ **`is_admin()` ainda existe, mas está fora de todas as policies — não reintroduzir.** Ela dava **bypass cross-org**.

## `chat_messages` é destrutivo
`chat_messages.lead_id` é **`ON DELETE CASCADE`** — apagar um lead **apaga a conversa**. E **toda FK nova para `chat_messages` precisa de índice**, senão vira seq scan e dá timeout ao resetar lead.

## Slug de tipo de consulta não é chave
`consultation_types.slug` é **texto livre digitado pela clínica**. Use o **`id`**. Já gerou 3 bugs — incluindo liberar a exclusão de tipos com consultas futuras.

## Observabilidade
- Toda chamada HTTP saindo do banco usa **`system_http_post`** (não `net.http_post` cru) — é o que deixa a Central de Erros saber **qual URL** falhou.
- Erros vão para `system_errors` via **`log_system_error`** → **Super Admin › Central de Erros**.

---

# 3. n8n — produção, com pacientes reais

- **Não alterar "Receptor de mensagens" sem permissão explícita** — alimenta a IA.
- **Não alterar "Agente IA" sem ordem explícita.**
- n8n tem modelo **draft/publish**: editar salva **rascunho**. Sempre confirmar com **`mode: 'active'`** que a mudança está na versão publicada.
