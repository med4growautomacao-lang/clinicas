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
| **Edge Functions** (`supabase/functions/`) | integrações que falam com o mundo (~18 — `supabase/functions/` é a lista) |
| **n8n** | recepção do WhatsApp, o agente de IA e os disparos de follow-up |

**Regra prática:** comportamento do agente → n8n + prompt. Regra de negócio → banco. Integração externa → edge. Tela → repo.

### ⚠️ O repo NÃO é a fonte completa das edge functions

Há funções **ativas em produção sem código-fonte aqui** — hoje: **`webhook-proxy`**, **`validate-medico-email`** e `mcp-deploy-test`. As duas primeiras **são chamadas pelo frontend**. Antes de concluir "essa função não existe", **liste as deployadas** (MCP `list_edge_functions`), não só o disco.

### Os nomes de WhatsApp enganam

- **`whatsapp-orchestrator`** — é quem **faz o trabalho**: máquina de estados da conexão (`start`, `cancel`, `disconnect`, `reset`, `status`).
- **`whatsapp-bridge`** — **não** é "a ponte". É um **roteador fino de retrocompatibilidade** (clientes em cache): repassa conexão → `orchestrator`, e grupos → n8n. **Mexer aqui achando que é o caminho principal é perda de tempo** — o próprio arquivo diz que pode ser removido.

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

⚠️ Essa regra também está **explicada na UI** (Configurações IA e Super Admin › Prompts Fixos). Se ela mudar, **os textos da tela mudam junto** — senão o app passa a mentir para o cliente.

## Agendamento

- **`book_appointment` é a única coisa que insere em `appointments`** (verificado). App, Kanban e IA passam por ela; `convert_lead_to_appointment` **delega** para ela. **Nunca inserir direto.**
  - `v_validate := COALESCE(p_validate_availability, true)` → **default seguro (valida)**; burlar é explícito.
  - `v_ignore_min := COALESCE(p_ignore_min_notice, p_source <> 'ia')` → **só a IA respeita o aviso mínimo**; o manual o ignora **de propósito** (encaixe de recepção).
- **`get_available_slots` tem 2 overloads.** A versão por **`consultation_type_id` (uuid) é a real**; a de texto é só adaptador de legado.

**De onde o motor tira cada coisa** (a divisão não é óbvia):

| vem de `consultation_types` | vem de `doctors` |
|---|---|
| duração, `slot_step`, buffers, `min_notice` | `working_hours`, `days_off`, `blocked_times` |

⚠️ `doctors.consultation_duration / slot_step / buffer_* / min_notice_*` **existem e são IGNORADOS** — letra morta. Mas o **expediente** é do médico mesmo (o tipo só pode sobrepô-lo via `working_hours_override`).

## Tickets

**Quatro caminhos de criação — e um deles não passa por RPC:**
- WhatsApp → trigger `trg_auto_open_ticket` em `chat_messages` (fn `fn_auto_open_ticket`)
- Formulários → trigger `trg_auto_open_ticket_forms` em `leads`
- App → RPC `create_lead_with_ticket`
- App → **`insert` direto em `tickets`** (`useSupabase.ts`, criação avulsa no Kanban)

Por isso **a invariante não pode morar na aplicação** — ela é garantida por índice (abaixo).

Ciclo de vida: `move_lead_stage`, `finalize_ticket`, `reopen_ticket`, `move_ticket_keep_outcome`.

## Dashboards — divergem POR CONSTRUÇÃO

Três painéis, três RPCs: **Visão Geral** (`Dashboard.tsx` → `get_dashboard_stats`), **Comercial** (`ComercialDashboard.tsx` → `get_commercial_dashboard`) e **Marketing** (`MarketingAnalytics.tsx` → `marketing_*_funnel_cohort`).

⚠️ **Eles não são três versões do mesmo número.** Dentro de um mesmo painel convivem **três eixos de data diferentes** — criação do lead (`created_at`), conversão (`outcome_at`) e realização da consulta (`appointments.date`). Duas telas podem mostrar números diferentes **e ambas estarem certas**.

**Antes de "corrigir" uma divergência, confirme qual eixo cada lado usa.** A atribuição IA × Humano também diverge entre Visão Geral e Comercial **por desenho**.

## O produto não é só clínicas

**Cerca de 40% dos tenants não são clínica** (`clinics.category = 'outro'`): loja de celular, joalheria, metalúrgica, turismo, café. Isso **não é dado de teste**.

`category = 'outro'` habilita o **módulo de Produção** (estoque, PCP, manutenção) e muda menus. Ao mexer em algo transversal (funil, IA, agenda), lembre que **"paciente" ali é cliente e "consulta" é atendimento/serviço**.

---

# 2. Invariantes e armadilhas silenciosas

## As invariantes são garantidas por ÍNDICE, não por código
Não confie na aplicação para mantê-las (vide o `insert` direto em `tickets`). Elas existem no banco — **não as derrube numa migration sem saber o que está fazendo**:

| índice | garante |
|---|---|
| `uq_tickets_one_open_per_lead` | **1 ticket aberto por lead** |
| `appointments_one_active_per_ticket` | **1 agendamento ativo por ticket** |
| `uq_leads_clinic_rast_id` | `rast_id` único na clínica |
| `uq_leads_normalized_phone` | **lead único por telefone normalizado** |

## `tickets.outcome` é a fonte única da verdade
Venda = **1 ticket ganho**. `stage` e `outcome` são **acoplados** — mexer num sem o outro corrompe todos os painéis.

## Telefone: normalizar os DOIS lados, sempre
`leads` chega normalizado **do n8n**; `patients` é normalizado **no banco** (`normalize_br_phone`). Comparar telefone **cru** gera "não encontrado" fantasma — é o **9º dígito**. Em RPC, normalize **os dois lados** da comparação.

## `rast_id` ≠ protocolo
- **`rast_id`** (UUID v4) = **identidade do lead**. **protocolo** = id **de um clique**.
- Já foram o mesmo campo, e confundi-los corrompe a jornada multi-toque.

**Todo lead NOVO nasce com `rast_id`** (gerado em `fn_handle_lead_uniqueness`) — vale a partir de **13/07/2026 15:45**, quando a migration subiu.

⚠️ **Mas ~20 mil leads ANTIGOS têm `rast_id` NULL** — o backfill foi **dispensado de propósito** (UUID inventado para lead de março não amarra jornada nenhuma). **`JOIN`/`GROUP BY` por `rast_id` descarta esses 20 mil em silêncio.** Para histórico, use o telefone normalizado.

## Canal ≠ origem — e o vocabulário MUDA entre as tabelas
**Canal** = *como* chegou. **Origem** = *de onde* veio. **"Balcão" é canal, nunca origem.**

⚠️ **Os valores de canal não são os mesmos nas duas tabelas** — não copie de uma para a outra:

| coluna | valores reais |
|---|---|
| `leads.capture_channel` | `whatsapp` · `forms` · `manual` · `balcao` |
| `lead_touchpoints.channel` | `whatsapp` · `site_forms` · `meta_forms` · `manual` |
| `lead_touchpoints.source` (origem) | `meta_ads` · `google_ads` · `instagram` · `null` = orgânico |

Repare: `leads` diz **`forms`**; `lead_touchpoints` separa em **`site_forms`** e **`meta_forms`**.

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
- Toda chamada HTTP saindo do banco usa **`system_http_post`** (não `net.http_post` cru) — é o que deixa a Central de Erros saber **qual URL** falhou. Hoje **nenhuma** função usa `net.http_post` cru: **mantenha assim.**
- Erros vão para `system_errors` via **`log_system_error`** → **Super Admin › Central de Erros**.

---

# 3. n8n — produção, com pacientes reais

- **Não alterar "Receptor de mensagens" sem permissão explícita** — alimenta a IA.
- **Não alterar "Agente IA" sem ordem explícita.**
- n8n tem modelo **draft/publish**: editar salva **rascunho**. Sempre confirmar com **`mode: 'active'`** que a mudança está na versão publicada.

---

# 4. Ambiente

## Supabase
- **project_id: `yzpclhuifquhfqpiwysh`** — o MCP **exige** esse parâmetro em toda chamada; sem ele a chamada falha.
- **Migrations:** aplicar via MCP `apply_migration` — **não rodar SQL solto** para mudança de schema.
- **Deploy de edge function:** Supabase CLI. O **PAT já está no `.mcp.json`** — que é **gitignored**.
  ⚠️ **Nunca** commitar o token, nem colá-lo em arquivo rastreado. Referencie a origem, não o valor.

## Type-check
**`npm run lint` é `tsc --noEmit`** — **não** é ESLint, e **não existe** script `typecheck`. (Os demais scripts estão no `package.json`.)

## Windows / PowerShell
- Mensagem de commit: **usar `git commit -F <arquivo>`**. Here-string (`@'...'@`) **quebra** com acento e aspas — já custou chamadas perdidas.
- PowerShell 5.1: **não existe `&&`/`||`**. Encadear com `;` ou `if ($?) { }`.

## Fuso horário — o banco MISTURA os dois tipos
O negócio é todo em **`America/Sao_Paulo`**, mas as colunas **não são uniformes**. **Confira o tipo antes de converter** — converter duas vezes desloca em 3h e **ninguém percebe**:

| `timestamp` **sem** tz (já é SP — não converter) | `timestamptz` (converter para exibir) |
|---|---|
| `leads.created_at`, `lead_stage_history.changed_at` | `tickets.outcome_at`, `lead_touchpoints.occurred_at`, `attribution_inbox.occurred_at` |

## Dados que parecem bug e não são
**"MedDesk Demonstrativa" é um clone anonimizado da Clínica Vaz.** Registros "duplicados" entre essas duas clínicas (inclusive `rast_id`) são **esperados** — não investigar como corrupção.
