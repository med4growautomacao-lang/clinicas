# CLAUDE.md

Instruções para o Claude Code neste repositório.
Aqui mora só o que é **load-bearing** e **não-descobrível num grep rápido**.

---

# 0. Diretrizes (o que NÃO muda)

Contrato do produto. Módulo, função e tabela mudam toda semana; **isto não**. Quando a implementação bater de frente com esta seção, quem cede é a implementação.

## 0.1 Idioma e fuso são fixos, não configuráveis

- **Tudo em pt-BR**: telas, mensagens ao paciente, prompts, nomes de etapa, relatórios, erros da Central, comentário de código e resposta ao dono.
- **Fuso do negócio: `America/Sao_Paulo`, único.** Dia de negócio é `(now() at time zone 'America/Sao_Paulo')::date`, nunca `now()::date` cru.
- ⚠️ **Não existe coluna de idioma nem de fuso no banco** (conferido 28/07/2026). Não invente `clinics.timezone` "para o futuro": internacionalizar é decisão de produto, e campo órfão vira bug.
- 📌 **SP é o padrão em dado, cron, relatório e tela.** Achou algo fora do padrão, **avise em vez de converter por conta própria**: fora do padrão é candidato a defeito, e consertar no lugar errado empurra o deslocamento para outro ponto.
- A armadilha real não é o fuso, é a **mistura de tipos** (§3).

## 0.2 Um sistema, duas marcas: MedDesk e WakeDesk

`clinics.category` é o discriminador. Mesmo código, mesmo banco, mesmas RPCs; **a diferença é de tela** (`Sidebar.tsx`).

| `category` | marca | menu |
|---|---|---|
| `clinica` | **MedDesk** (MED4GROW) | tem `clinicOnly`: Agendamentos, Prontuários, Corpo Clínico |
| `outro` | **WakeDesk** (WAKEMARKETING) | tem `outroOnly`: Produção (estoque/PCP/manutenção), Orçamentos |
| `meta_tester` | plano reduzido | barra cortada a poucas abas |

**Boa parte dos tenants não é clínica** (loja, joalheria, metalúrgica, turismo, café), e isso **não é dado de teste**.

⚠️ **Não existe camada de vocabulário, e é dívida conhecida.** `activeClinicCategory` é lido em **pouquíssimos arquivos**, contra **"paciente" fixo espalhado por dezenas de telas**: o cliente WakeDesk lê "paciente" e "consulta" no que é transversal.

- **Texto novo em tela transversal nasce neutro**: contato, atendimento, cliente, profissional. Não aumente a dívida.
- Ramifique por `category` só quando o termo for incompatível (padrão em `DoctorScheduleSettings.tsx`).

**Régua:** feature nova é **transversal por padrão**; vira exclusiva só quando depende de conceito que o outro lado não tem (prontuário, ordem de produção).

## 0.3 Assuma que o cliente NÃO usa o módulo

Presumir que todo mundo tem agenda ou trabalha o Kanban na mão é a origem de card zerado e KPI mentiroso. **A agenda é minoria** (só clínicas, e nem todas; zero no WakeDesk). O funil está configurado em todos, mas **muito card é movido por IA ou gatilho, não pela mão**.

Chave por clínica em `clinics.features` (jsonb), e **a semântica MUDA por flag**:

| flag | semântica | quem lê |
|---|---|---|
| `feature_ia`, `feature_followup` | opt-**out** (`!== false`) | tela Comercial |
| `feature_chat_send`, `feature_conv_ai` | opt-**in** (`=== true`) | `ChatComposer.tsx`, aba do Analista |
| `agenda_via_funil` | opt-**in**, **só no banco** | `get_commercial_dashboard` |

⚠️ Trocar `!== false` por `=== true` (ou o contrário) **liga ou desliga módulo em todos os clientes de uma vez**, sem erro nenhum. Copiar a linha de outra flag é como isso acontece.

**`agenda_via_funil = true`** (pouquíssimas clínicas) = não usa `appointments`; Agendado/Realizado/Faltou saem das etapas do funil (`lead_stage_history`, slugs `agendado`/`ganho`/`faltou_cancelou`), por `changed_at`.

⚠️ **Nenhum formulário edita `agenda_via_funil`.** Super Admin e OrgAdmin fazem `{ ...clinic.features, ... }` de propósito: reconstruir o jsonb apaga a flag e **zera o painel Comercial daquela clínica em silêncio**.

**Régua:** KPI que só existe com agenda precisa de fallback pelo funil, ou some para quem não tem. Card mostrando "0" onde o módulo nem foi vendido é bug de produto.

## 0.4 WhatsApp é uazapi, e a documentação é a fonte

Receber e enviar passa pela **uazapi** (`https://med4growautomacao.uazapi.com`, base em `UAZAPI_BASE`).

📌 **Antes de criar ou alterar qualquer requisição, consulte https://docs.uazapi.com/.** Não deduza payload por analogia: `/send/text`, `/send/media` e `/send/menu` têm corpos diferentes, e campo errado às vezes falha com 200.

- **Receber:** 100% na edge `wa-inbound`. ⚠️ `whatsapp_instances.inbound_route` **AINDA decide o webhook de `messages`** que o orquestrador aplica a cada conexão (`hub` = wa-inbound; `n8n` = rota morta): o default `'n8n'` fez a clínica Faaz nascer conectada e surda por 6 dias (13→19/08/2026, ~1.700 mensagens recuperadas do store). Default corrigido para `'hub'` em 19/08. Não conte linha dele como se fosse tráfego.
- **Enviar:** **todo envio automático passa pelo Emissor** (`emit_message` → `outbound_messages` → `emissor-worker`), gateado por `fn_emissor_ativo`.

📌 **Código novo que manda mensagem produz para a fila** (`emit_message`), nunca `fetch` direto nem `system_http_post` para a uazapi. As garantias de entrega moram no Emissor (§1).

⚠️ **Os ramos `else` inline não são código morto, são o rollback.** Cada produtor é `if fn_emissor_ativo(clinic) then emit_message(...) else <envio antigo> end if`. Voltar `all` para `false` devolve todos os tenants ao caminho antigo sem deploy.

- **Token nunca é constante nem variável de ambiente**: sai do gate `fn_clinic_send_token`, que exige instância `connected`.
- **Telefone: normalizar os dois lados** antes de comparar (§2), mas o endereço de entrega vai como a uazapi devolveu.

## 0.5 Se falhar em silêncio, não existe

**Não há Sentry.** O que não estiver em `system_errors` não aconteceu para ninguém.

📌 **Toda função que importa registra erro na Central.** "Importa" = se falhar, alguém perde dado, dinheiro ou atendimento. Vale para edge, RPC, trigger e cron. Mecânica em §2.

**Critério de pronto:** feature sem caminho de erro na Central não está pronta, mesmo funcionando.

## 0.6 Falar com o dono: resumo primeiro, linguagem de negócio sempre

**O dono não é programador.** Resposta que ele não entende é resposta perdida, por mais correta que esteja.

📌 **Comece pelo resumo:** o que aconteceu, o que significa para o negócio, o que ele precisa decidir. Detalhe técnico depois, e só o necessário.

- **Consequência, não mecanismo.** Não é "o `buttonOrListid` não era lido no parser", é "o paciente clicou em Confirmar e o sistema ignorou".
- **Todo número vem com o que quer dizer.** "7 cliques perdidos, mas só 1 clínica tinha a automação ligada, então 3 pacientes reais foram ignorados" decide; "7 cliques perdidos" não.
- **Diga quem perde o quê** (paciente, dinheiro, dado, tempo da equipe). Se ninguém perde nada, diga também.
- **Termo técnico inevitável vem explicado na mesma frase**, uma vez só.
- **Feche com a decisão dele:** opções, custo de cada uma e **uma** recomendação, não um cardápio.
- **Problema não se esconde no meio do texto**, e erro seu se admite em uma frase, sem repetir o assunto.

## 0.7 "Está desligado" NÃO é diagnóstico. A pergunta é: ligado, funciona?

Chave off é o estado normal de quase tudo, e o dono desliga de propósito: ele já sabe o que está desligado.

🚫 **NÃO relate chave desligada, texto em branco nem módulo off como se fosse problema.** 📌 **Relate DEFEITO DE CÓDIGO, e só.**

- **Percorra o caminho inteiro** (gatilho → regra → envio → gravação → retorno), não o primeiro `if`. Elo quebrado no meio só aparece quando alguém liga, com paciente na frente.
- **Teste com a chave ligada:** `begin; ... rollback;` com a flag ligada na transação e lead `is_simulation` (roteia para sandbox, não toca uazapi). Confira o efeito real: mudou o status, entrou na fila, gravou a conversa?
- **Separe as três causas**, porque a solução de cada uma é outra: **desligado** (é só ligar), **falta configuração** (é preencher formulário), **defeito de código** (o único que é problema seu).
- **Chave que a tela grava e o backend não lê é DEFEITO**, não configuração. Procure isso ao mexer em feature com toggle.
- **Diga o que está provado e o que é palpite.** "Li o código e parece certo" é palpite.

### 📌 Ao revisar (código, dado ou achado de outro agente)

- **Todo achado vem com a prova executada** (query, grep, teste rodado). Sem prova, entra rotulado como palpite.
- **Tente refutar cada achado antes de entregar**: só se reporta o que sobreviver.
- **Zero achado é resposta válida.** Não preencha volume; achado inventado custa mais caro que ausência.
- **Achado de terceiro é hipótese até ser confirmado** no código e no banco vivo (§3), nunca vira ação direta.
- Entregue classificado: **provado**, **palpite** ou **descartado na verificação**.

### 📌 Revisão é de agente INDEPENDENTE, e roda ANTES de entregar

Ninguém se auto-revisa: o mesmo contexto que escreveu o bug tende a re-aprová-lo. Achado só vale vindo de fora.

- **Para mudança não-trivial, antes do commit/push:** abra revisor(es) **independente(s)** (contexto fresco; lentes de correção, segurança, robustez), refute cada achado (§0.7 acima), conserte o que sobreviver, e só então entregue. Type-check e teste no banco vivo são **pré-requisito** da revisão, não substituem ela.
- **Proporcional ao risco:** baixo/médio entrega já revisado; **risco alto** (produção de verdade, dado de paciente, site de cliente, migration, irreversível) mostra o resumo e **espera o OK do dono** antes de subir.
- **O dono não é a rede de segurança da revisão.** Quando ele rodar `/code-review`, deve vir limpo. A confiança está no processo ser consistente, não em prometer "0 bug" (que seria mentira: não se entrega prova de ausência de defeito).

## 0.8 Régua de decisão (rodar antes de mexer)

1. **Em que camada mora?** Repo, banco ou edge (§1). Comportamento do agente é prompt + edge, não tela.
2. **Vale para as duas marcas?** Se não, quem decide: `category` ou flag de `features`? (§0.2, §0.3)
3. **E se o cliente não tiver o módulo?** Agenda, Kanban, IA e envio manual são opcionais.
4. **E quando LIGAREM, funciona?** Caminho todo com a chave ligada, sem parar no gate (§0.7).
5. **Se falhar, quem descobre?** Se não for a Central de Erros, falta código (§0.5).
6. **Que número é esse?** Conceito e eixo de data são coisas separadas (§1).
7. **Isso é produção?** Banco e edge são um só para todas as sessões, com pacientes reais (§3).
8. **Parar e perguntar** só em risco de dinheiro, dado de paciente ou mudança que o cliente enxerga. O resto, decida e siga, e conte como manda a §0.6.

---

# 1. Onde as coisas moram

**Três camadas.** Repo (React/TS): telas, hooks (`src/hooks/useSupabase.ts`), configuração. Banco (Postgres): RPCs, triggers, invariantes, RLS, crons. Edge Functions (`supabase/functions/` + `_shared/`): integrações externas, agente IA, analista, Emissor, follow-ups, sandbox.

**Regra prática:** comportamento do agente → edge + prompt. Regra de negócio → banco. Integração externa → edge. Tela → repo.

⚠️ **O n8n não é mais camada deste sistema.** Não recebe, não envia, não roda agente nem follow-up. Sobrou lá o rastreamento de formulário dos sites cujo webhook ainda aponta para ele, e isso é pendência do lado dos sites. **Não procure comportamento no n8n.**

⚠️ **O repo não é a fonte completa das edges:** há função rodando em produção sem código aqui. Antes de concluir "essa função não existe", liste as deployadas (MCP `list_edge_functions`).

**Conexão do WhatsApp:** quem faz o trabalho é `whatsapp-orchestrator` (máquina de estados: start, cancel, disconnect, reset, status). A antiga `whatsapp-bridge` foi **removida em 28/07/2026**, depois de provado que nada a chamava (front, banco, cron, outras edges e registros de uso).

## Como o agente de IA é instruído

**TRÊS fontes.** As duas primeiras se chamam prompt; **a terceira não se chama, mas é prompt do mesmo jeito**:

| | define | onde mora | escopo |
|---|---|---|---|
| **1. Prompt do Sistema** | **COMO** age: tom, etapas, quando usar cada tool | `prompt_templates.content` (via `ai_config.prompt_template_id`) | ⚠️ **COMPARTILHADO entre clínicas** |
| **2. Prompt da Clínica** | **O QUE** sabe: médicos, horários, valores, endereço | `ai_config.prompt` | só daquela clínica |
| **3. Descrição do tipo de consulta** | **QUANDO** usar cada tipo: para quem serve, o que inclui | `consultation_types.description` | só daquela clínica |

⚠️ **A terceira é a mais fácil de esquecer e de estragar**, porque quem escreve é a clínica, num campo que parece cadastro. Texto vago ali vira agente oferecendo o tipo errado, e ninguém procura o defeito no cadastro. Ela **não** entra no prompt montado: chega em execução, pela tool `LISTAR_TIPOS_CONSULTA`, então não adianta procurá-la em `v_clinic_ai_prompt`.

A view `v_clinic_ai_prompt` concatena **sistema primeiro, clínica depois**. Regra de comportamento mora no prompt do **sistema** (procurar no da clínica não acha), editar um template **mexe em várias clínicas**, e o prompt da clínica vir por último **não o torna capaz de revogar** regra do sistema.

⚠️ Essa regra também está explicada na UI (Configurações IA, Super Admin › Prompts Fixos). Se mudar, **os textos da tela mudam junto**, senão o app mente para o cliente.

## Pipeline do Agente IA (nativo, substituiu o n8n)

```
wa-inbound → ai-agent (ingest) → ai_turn_buffer → ai-agent-worker (loop LLM)
                                                        ↓
                                                  outbound_messages → emissor-worker → uazapi
```

- **`wa-inbound`**: recebe webhook do uazapi, persiste `chat_messages`, encaminha ao agente.
- **`ai-agent`**: ingest. Enfileira o turno em `ai_turn_buffer`, cutuca o worker, devolve 200.
- **`ai-agent-worker`**: o cérebro. Claim atômico, loop LLM com tool-calling (todas as tools delegam para `ai-scheduler`), fan-out em bolhas, memória, transição de etapa. Stateless.
- **`emissor-worker`**: fila de saída. Token pelo gate `fn_clinic_send_token`, só grava em `chat_messages` após 200, retry + DLQ. Sabe `/send/text`, `/send/media` e `/send/menu` (botões, via `outbound_messages.menu_payload`).
- **`ai-sandbox`**: teste do Super Admin. Mesmo pipeline, `transport='sandbox'`, nunca toca uazapi real.

Modelo padrão em `_shared/llm.ts` (multi-provider), com override por clínica em `ai_config`.

⚠️ **O worker NÃO faz retry do envio**, quem retenta é o Emissor. Falha no loop LLM vai para a Central e a sessão fica pendente para o sweep do cron.

## Analista Conversacional (conv-ai)

- **`conv-ai-analyst`** (cron): lê a conversa e decide etapa do funil e se houve venda. Etapa comum ele **aplica sozinho** (`source='ia_analise'`); etapa de conversão ele **nunca aplica**, vira sugestão pendente.
- **`conv-ai-learn`** (cron): gera o manual de análise **por clínica** (`conv_ai_prompt_versions`) a partir de conversas rotuladas ou de decisões humanas recentes.

Gates: `system_settings.conv_ai_config.mode` (`off`/`shadow`/`active`) + `conv_ai_clinic_config.enabled`. Em `shadow` nada é aplicado, só registra o que **teria** feito.

## Agendamento

### ⚠️ `book_appointment` é a função mais crítica do sistema

Tudo que marca horário passa por ela: app, Kanban, IA e `convert_lead_to_appointment` (que delega). É a única coisa que insere em `appointments`. **Nunca inserir direto.**

📌 **Cuidado redobrado ao otimizar ou refatorar.** Ela concentra no mesmo corpo a validação de disponibilidade, os buffers dos dois lados, o aviso mínimo, a trava contra marcação simultânea e a invariante de um agendamento ativo por ticket. "Simplificar" um trecho por parecer redundante já é, por definição, o bug: não aparece no teste, aparece como **horário vendido duas vezes**, com dois pacientes na porta. Se precisar mexer, mexa num pedaço por vez e prove cada um.

- `p_validate_availability` tem **default seguro (valida)**; burlar é explícito.
- `p_ignore_min_notice` faz com que **só a IA respeite o aviso mínimo**; o manual ignora **de propósito** (encaixe de recepção).
- `get_available_slots` tem 2 overloads: a de **`consultation_type_id` (uuid) é a real**, a de texto é adaptador de legado.

**A divisão não é óbvia:** duração, `slot_step`, buffers e `min_notice` vêm de `consultation_types`; `working_hours`, `days_off` e `blocked_times` vêm de `doctors`.

⚠️ **`doctors.consultation_duration` NÃO é letra morta**, apesar do nome repetido em `consultation_types`. Ela é o fallback lido por `book_appointment`, `reschedule_appointment` e pela trigger `trg_appointment_inherit_doctor_duration` quando o tipo não define duração. **Dropar essa coluna não falha na migration, falha na primeira marcação de consulta.** As irmãs (`slot_step`, `buffer_*`, `min_notice_*`) eram mesmo letra morta e foram removidas de `doctors` em 28/07/2026; os nomes iguais em `consultation_types` continuam valendo. O expediente é do médico (o tipo só sobrepõe via `working_hours_override`).

## Tickets

**Cinco caminhos de criação, e dois não passam por RPC:** trigger em `chat_messages` (WhatsApp), trigger em `leads` (formulários), RPC `create_lead_with_ticket`, **`insert` direto** do Kanban (`useSupabase.ts`) e **`insert` direto** de `apply_external_crm_outcome` (CRM do cliente). Por isso **a invariante não pode morar na aplicação**: é índice (§2).

### ⚠️ A etapa de entrada é escolhida pela TRIGGER, não por quem chama

Lead com `capture_channel='forms'` já nasce com ticket, porque `trg_auto_open_ticket_forms` é AFTER INSERT: quando a RPC chega na busca de etapa, **o ticket já existe**. Mexer no slug dentro da RPC é código morto.

Quem precisa desviar usa a marca de transação **`app.crm_intake='1'`**, que muda o comportamento de várias triggers. Quem a liga precisa setá-la em **toda** chamada, senão um lote na mesma transação herda o valor anterior.

⚠️ **`fn_reset_followup_on_new_ticket` NÃO é gateada, e isso é decisão.** Suprimi-la foi pior: o ticket novo herdaria `handoff_triggered_at`/`followup_count` do ciclo morto e o card nasceria **mudo** para IA e follow-up, para sempre e sem erro. **"Ticket novo = atendimento novo" vale para todos os caminhos.**

⚠️ **A cascata de etapa mora em `fn_default_entry_stage(clinic_id, slug_preferido)`** (preferido → `whatsapp` → primeira por `position`). Todos os tenants têm `forms` e `whatsapp`, então trocar a ordem muda 100% deles de uma vez.

📌 **Quem escolhe o `slug_preferido` não é o código, é o cliente** (`fn_clinic_entry_stage_slug`, §2). Ao mexer num caminho que abre card, passe a chave, **nunca um slug fixo**.

## Dashboards: fonte ÚNICA por conceito, divergência só de RECORTE

Visão Geral (`get_dashboard_stats`), Comercial (`get_commercial_dashboard`) e Marketing (`marketing_*`). Os três partem da mesma definição, nas **views canônicas `v_kpi_*`**:

| conceito | fonte única | eixo de data |
|---|---|---|
| leads | `v_kpi_leads` (exclui `is_not_lead`) | `leads.created_at` |
| vendas (nº) | `v_kpi_wins` (`tickets.outcome='ganho'`) | `COALESCE(outcome_at,closed_at)` |
| faturamento | `v_kpi_sales_value` = vendas lançadas (`conversions`) | `converted_at` |
| agendado | `v_kpi_scheduled` (consulta ∪ etapa, 1×/ticket) | `LEAST` das duas |

⚠️ **Divergência legítima é só de RECORTE, nunca de definição.** Fatiar por criação do lead, por conversão ou por realização da consulta dá números diferentes e ambos certos. **Confirme o eixo de cada lado antes de "corrigir".** Se as definições divergirem, aí é bug.

⚠️ **Financeiro DESABILITADO nos painéis, POR ENQUANTO** (decisão do dono, 18/07/2026, reconfirmada em 28/07/2026): **não puxar de `financial_transactions`**, faturamento é sempre o valor lançado. É pausa, não aposentadoria, mas **religar não é descomentar a aba**: exige antes decidir qual dos dois faturamentos é a fonte única e alinhar as views a ela.

**Atribuição IA × Humano:** régua canônica única, precomputada em `lead_kpi_attribution` (cron) → `vw_lead_agent_class`. Não recalcule inline.

### ⚠️ Toda RPC de painel é um PAR: wrapper (guard) + `_impl` (corpo)

As RPCs de painel têm nome público como wrapper fino `SECURITY DEFINER` que só chama `assert_clinic_access(p_clinic_id)` e delega. **A lógica mora no `_impl`.**

- **Mexer na regra = mexer no `_impl`.** Reescrever o wrapper como se fosse a RPC **apaga o guard** e reabre vazamento entre clínicas.
- `_impl` não tem EXECUTE para anon/authenticated: chamar direto pelo PostgREST dá erro de permissão, não é "a RPC sumiu".
- ⚠️ **Grant vem por DOIS caminhos e revogar um só não fecha nada:** o PUBLIC (que todo `create function` concede) e o nominal de `anon`. **Sempre `revoke all on function ... from public, anon, authenticated`**, depois `grant` para quem deve. Foi assim que um vazamento de PII "corrigido" seguiu aberto sob o nome `_impl` por 17 horas. **Confirme com `has_function_privilege('anon', p.oid, 'EXECUTE')`, nunca lendo o DDL.** E RPC nova para o front precisa de `grant execute ... to authenticated` **explícito**.
- **`assert_clinic_access` é fail-closed** e passa sem checar em dois casos só: sem `request.jwt.claims` (chamada de dentro do banco, é o que mantém o relatório automático) e role `service_role` (backend). **Não voltar para `if v_jwt_role in ('anon','authenticated')`**, que era fail-open, nem trocar por `has_clinic_access` cru, que depende de `auth.uid()` e mata o cron.
- Guard **nunca** é `is_clinic_admin()` sozinho: deixa de fora o `gestor`, que é quem mais abre o painel.

**Por que DEFINER e não RLS:** com RLS o painel paga a checagem **por linha** e estoura o `statement_timeout` do role `authenticated` (medido: 2.328 ms contra 44 ms numa clínica de 8 mil leads). O painel devolvia 500 e pintava "SEM DADOS". **Timeout se parece com lentidão:** confira os 500 no console antes de caçar query lenta.

---

# 2. Invariantes e armadilhas silenciosas

## As invariantes são garantidas por ÍNDICE, não por código

Não confie na aplicação (vide o `insert` direto em `tickets`). **Não derrube estes numa migration:**

| índice | garante |
|---|---|
| `uq_tickets_one_open_per_lead` | 1 ticket aberto por lead |
| `appointments_one_active_per_ticket` | 1 agendamento ativo por ticket |
| `uq_leads_clinic_rast_id` | `rast_id` único na clínica |
| `uq_leads_normalized_phone` | lead único por telefone normalizado |

**`tickets.outcome` é a fonte única da verdade.** Venda = 1 ticket ganho. `stage` e `outcome` são acoplados: mexer num sem o outro corrompe todos os painéis.

## Telefone: normalizar SEMPRE, e nos DOIS lados

O **9º dígito** é a razão: o mesmo contato aparece com e sem ele, e comparar cru gera "não encontrado" fantasma. Em RPC, normalize **os dois lados**, sem exceção.

⚠️ **A base não é só celular brasileiro** (conferido 28/07/2026): **leads com telefone fixo em volume relevante** e **uma minoria do exterior** (Argentina, Uruguai, Paraguai, Portugal, Espanha, EUA). Os dois funcionam hoje: fixo vira 12 dígitos sem passar pela regra do 9, e estrangeiro com DDI passa intacto porque a regra só dispara em `55`.

⚠️ **A armadilha é o estrangeiro sem DDI:** número de **10 ou 11 dígitos ganha `55` na marra**, porque a função assume Brasil, e vira um número brasileiro que nunca mais casa com a pessoa. **Ao cadastrar contato de fora, o DDI é obrigatório.**

Fixo e celular não colidem por sorte estrutural (celular sem o 9 começa em 6-9, fixo em 2-5). **Isso não está escrito em lugar nenhum**: se a numeração mudar, quebra em silêncio.

## `rast_id` ≠ protocolo

`rast_id` (UUID) é **identidade do lead**; protocolo é id **de um clique**. Já foram o mesmo campo, e confundi-los corrompe a jornada multi-toque. Todo lead novo nasce com `rast_id`, mas ⚠️ **~20 mil leads antigos têm `rast_id` NULL** (backfill dispensado de propósito). **`JOIN`/`GROUP BY` por `rast_id` descarta esses 20 mil em silêncio**; para histórico, use o telefone normalizado.

## Rastreamento do site

- **`attribution_inbox` tem DUAS chaves:** telefone (CTWA) e **`protocolo`** (clique do site, onde o lead ainda não tem telefone). Linha sem telefone é ignorada pelos reconciliadores de telefone **de propósito**.
- **`external-forms-ingest` é O caminho nativo de formulário** (token `?k=` por clínica). O n8n "Webhook Forms" só existe para sites não migrados.
- **Convenção de UTM é source-aware e mora em `_shared/attribution.ts`.** Não invente mapeamento novo. Meta grava em `fb_*`, o resto em `g_*`.
- **O script dos sites é servido pela edge `site-script`** a partir de `system_settings.global_tracking_script`: mudou no banco, todos os sites atualizam. **Nunca** volte a distribuir inline.

## Canal ≠ origem, e o vocabulário MUDA entre as tabelas

**Canal** = como chegou. **Origem** = de onde veio. **"Balcão" é canal, nunca origem.** Os valores **não são os mesmos nas duas tabelas**, não copie de uma para a outra:

| coluna | valores reais |
|---|---|
| `leads.capture_channel` | `whatsapp` · `forms` · `manual` · `balcao` |
| `lead_touchpoints.channel` | `whatsapp` · `site_forms` · `meta_forms` · `manual` |
| `lead_touchpoints.source` (origem) | `meta_ads` · `google_ads` · `instagram` · `null` = orgânico |

### 📌 REGRA: `forms` é SÓ formulário. O resto entra como `whatsapp`

Decisão do dono (28/07/2026). `forms` significa formulário de verdade, nativo ou de site; nenhuma outra origem se pendura nesse canal para herdar o pipeline dele.

⚠️ **O caso aberto é o CRM externo** (`apply_external_crm_outcome`), que hoje cria lead como `forms` de propósito. Na medição de 28/07/2026 a troca **não silenciava mensagem nenhuma** (nenhum lead de CRM recebia boas-vindas) e só mudava o recorte do painel da clínica afetada; **antes de trocar, meça de novo**.

### ⚠️ Canal e ETAPA DE ENTRADA são coisas separadas, e só a etapa é escolha do cliente

Confundir as duas é a armadilha desta parte, porque ambas usam as palavras "forms" e "whatsapp".

| | o que é | quem decide |
|---|---|---|
| **canal** (`leads.capture_channel`) | **fato**: como o contato chegou | a origem, nunca uma preferência |
| **etapa de entrada** | **escolha de fluxo**: em que coluna o card nasce | o cliente, em `clinic_external_integrations.entry_stage_slug` (default `forms`) |

A etapa é configurável na aba Integração Externa ("Onde o card começa"), e vale para **os dois caminhos que criam card sem conversa**: formulário e CRM, ambos via **`fn_clinic_entry_stage_slug(clinic_id)`**.

📌 **A chave NÃO toca o canal, e isso é deliberado.** Amarrar um no outro faria lead de formulário ser contado como WhatsApp nos painéis, que é a corrupção que a régua do canal existe para impedir.

⚠️ **Não "restaure" slug fixo no CRM.** A exceção antiga passava `'whatsapp'` fixo e **nunca teve efeito**: as clínicas com CRM têm zero evento `outcome='lead'`, então aquele ramo jamais rodou.

### ⚠️ O canal é vocabulário FECHADO na prática, mesmo sem CHECK no banco

Valor novo (`crm`, `parceiro`) entra sem erro e quebra de dois jeitos ao mesmo tempo: as views `v_kpi_*` e o Marketing usam `ELSE 'whatsapp'` e ele **vira WhatsApp**; a Visão Geral e o Comercial filtram por igualdade e ele **some dos chips**. Isso é divergência de definição entre painéis, que aqui é bug. Valor novo exige varrer todas as views, RPCs e telas que enumeram o canal.

## Nunca reconstruir JSONB do zero

Formulário que grava um JSONB inteiro sem reler **zera em silêncio** os campos que não conhece. Já causou 3 bugs de "salvar apaga campo". **Sempre merge parcial.**

## RLS multi-tenant

Usar `is_clinic_admin(clinic_id)` / `is_super_admin()`. ⚠️ `is_admin()` foi dropada em 27/07/2026 (fase1b do hardening): **não reintroduzir**, dava bypass entre organizações.

### ⚠️ Policy que passa a COLUNA roda POR LINHA (é o que derruba clínica grande)

`is_clinic_active(clinic_id)` recebendo a **coluna** impede o planner de resolver uma vez. A régua nova, já em `leads`, `tickets`, `chat_messages` e em dezenas de outras tabelas, roda 1× por query:

```sql
using (clinic_id in (select public.my_clinic_ids()) or (select public.is_super_admin()))
```

`my_clinic_ids()` é **sem argumento de propósito**: é isso que permite o `hashed SubPlan`. **Não "melhore" passando `clinic_id`**, desfaz todo o ganho (medido: 2.548 ms → 33 ms).

⚠️ **O braço `or (select is_super_admin())` não é enfeite:** linha com `clinic_id` NULL ou órfão sai do alcance do super-admin, e como a policy é `FOR ALL` ele perde até o UPDATE para consertar.

- ⚠️ **Sobrou um punhado de policies no padrão antigo, e migrar por cópia NÃO é seguro**: mudaria semântica ou **regrediria segurança** (`prontuario_passwords` perderia a trava de `gestor`, `clinic_enc_keys` ampliaria acesso às chaves). Migre só provando equivalência caso a caso.
- ⚠️ **Não existe isolamento por médico, e NUNCA existiu.** `appointments_doctor_isolation` e `medical_records_doctor_isolation` foram removidas em 27/07/2026 porque vazavam entre clínicas (staff com 0 consultas enxergava 234, todas alheias), mas elas eram **PERMISSIVE**, e policy permissiva só **soma** acesso, nunca subtrai: ao lado de `appointments_all`, jamais impediram um membro de ver a agenda de outro médico. Hoje o "médico só vê os próprios" é **só de UI**. Quem procurar "a regra que evitava isso" acha essas duas e conclui errado que havia proteção. **Impor de verdade exige policy `RESTRICTIVE`** (decisão de produto pendente).
- **Custo de RLS pode ser GLOBAL:** embed do PostgREST (`lead:leads(*)`) **não propaga o `clinic_id`**, então a RLS da tabela embutida varre o banco inteiro.
- Antes de trocar qualquer policy, **prove equivalência** num `cross join` de todos os pares (usuário, clínica), conferindo que ninguém ganha nem perde acesso.

## Outras armadilhas

- **`chat_messages` é destrutivo:** `lead_id` é `ON DELETE CASCADE`, apagar um lead **apaga a conversa**. E **toda FK nova para `chat_messages` precisa de índice**, senão dá timeout ao resetar lead.
- **Slug de tipo de consulta não é chave:** `consultation_types.slug` é texto livre digitado pela clínica. Use o `id`. Já gerou 3 bugs.
- **KPI nunca nasce de array do client:** o PostgREST clampa toda resposta no `max_rows` do projeto, **inclusive quando o código pede `.limit()` maior**, em silêncio. Agregar sobre um hook mente em clínica grande. **Agregação = RPC no banco**; lista grande = `.range()`. `POSTGREST_MAX_ROWS` em `useSupabase.ts` **tem que bater** com o teto real, senão o detector fica cego.

## Observabilidade: a Central de Erros é o único olho que temos

Quase todo bug grave deste sistema foi **perda silenciosa**, não exceção barulhenta.

📌 **Toda função nova que importa registra erro na Central**, seja edge, RPC, trigger ou cron. Edge: copie o helper `registrarErro()` de qualquer edge existente. Banco: `log_system_error(...)`. HTTP saindo do banco: **`system_http_post`**, nunca `net.http_post` cru (é o que permite saber qual URL falhou).

⚠️ **Não engula o erro no `catch`.** `console.error` sozinho é invisível: o log da edge some, a Central não vê, e o bug vira "sumiu o lead".

### 📌 Quatro regras deste arquivo são VIGIADAS, não só escritas

Desde 28/07/2026 o `run_system_monitors` (cron) acende na Central sozinho se alguém regredir: **função interna aberta para anon/authenticated** (o vazamento das 17 horas), **chamada HTTP crua** no lugar de `system_http_post`, **sumiço de um dos 4 índices invariantes**, e **wrapper de painel sem `assert_clinic_access`**.

- Hoje os quatro devolvem zero: entraram mudos e só falam quando houver regressão.
- Cada um roda no seu próprio `begin/exception`, e se um quebrar acende `monitor_falhou_*` em vez de derrubar os outros. ⚠️ **Ao acrescentar bloco novo, empilhe o fingerprint em `v_tocados`**: sem isso o alerta é criado e resolvido na mesma execução, e o monitor parece funcionar sem nunca aparecer nada.

### 📌 REGRA: erro resolvido SAI do painel

Decisão do dono (27/07/2026). A Central mostra **só o que está aberto**, e a contagem da tela **é** a fila de trabalho. É **remoção, não filtro de UI**: o trigger `trg_system_error_arquiva_resolvido` copia para `system_errors_archive` e apaga de `system_errors`, nos três caminhos (botão, auto-resolve, `update` na mão).

- **Não restaure a aba de resolvidos** nem troque o trigger por um `where status <> 'resolved'`: o painel voltaria a acumular.
- O histórico não se perde, está no arquivo. E como o `fingerprint` fica livre, problema que reincide entra como **episódio novo**, que para CONDIÇÃO é o certo.

### 📌 REGRA: toda chamada a provedor de IA passa pelo monitor de consumo

Desde 28/07/2026 existe **`llm_usage`**: uma linha por chamada a provedor de IA. Painel em **Super Admin › Consumo de IA** (RPC `get_llm_usage_summary`, que agrega no banco; custo vem de `system_settings.llm_prices`, editável sem deploy).

- **Nunca chame provedor sem registrar.** Use `comMonitor()` ou `registrarUsoIA()` de **`_shared/llm-usage.ts`**. O agente já é coberto no ponto único (`runAgentTurn`); os demais registram no próprio call site.
- **`feature` é a chave de `system_settings`** que o Super Admin edita, e é o que faz o painel agrupar pelas mesmas funções que ele configura. Use as constantes `FEATURE.*` de `_shared/llm-usage.ts`, não string solta: nome errado não dá erro, só some do grupo certo.
- **Falha também é registrada** (`ok=false`): chamada que falha consome cota, e pico de erro no painel é o sintoma mais barato de "acabou o crédito" ou "modelo fora do ar".
- **O monitor é mudo por design**: `log_llm_usage` engole exceção e o chamador não dá `await`. Monitor que derruba a função monitorada é pior que não ter monitor.
- ⚠️ **Modelo sem preço em `llm_prices` entra com custo ZERO** e aparece em `modelos_sem_preco`. Ao trocar de modelo, cadastre o preço junto, senão o total do painel encolhe em silêncio.

⚠️ **A conta é dominada pela ENTRADA, não pela resposta.** Medido no agente: uma única mensagem de paciente custou **14.845 tokens de entrada contra 15 de saída**, porque todo o histórico da conversa vai junto a cada turno. É por isso que conversa longa não custa o dobro, custa muito mais, e por que ranking por volume de mensagens engana.

---

# 3. Ambiente

## Supabase
- **project_id: `yzpclhuifquhfqpiwysh`**, exigido pelo MCP em toda chamada.
- **Migrations:** via MCP `apply_migration`, **não rodar SQL solto** para mudança de schema.
- **Nome de migration = timestamp real** (`YYYYMMDDHHMMSS_nome.sql`), **nunca sequencial**: sequencial **colide entre sessões paralelas** (já aconteceu) e faz a ordem dos arquivos mentir sobre a ordem real de aplicação.
- 📌 **Aplicou migration? Grave o ARQUIVO no repo, na mesma sessão.** O MCP `apply_migration` escreve no banco e **não cria o arquivo**: foi assim que 842 migrations passaram a existir só no banco (março/26: 7 arquivos para 60 aplicadas). O arquivo vai em `supabase/migrations/` com **exatamente o `version` que o banco registrou** (confira em `supabase_migrations.schema_migrations`, não invente o timestamp): nome divergente faz a ordem dos arquivos mentir sobre a ordem real. Sem esse passo, `supabase start` e `db reset` reconstroem um banco **que não é o seu** e ainda parecem ter funcionado.
  - **Backfill de 11/08/2026:** exportou as 842 que faltavam e moveu para `supabase/migrations_legado/` os 402 arquivos que o banco nunca aplicou (nada apagado; as 27 versões duplicadas saíram junto). `supabase/migrations/` passou a ter **1 arquivo por migration aplicada, 980 para 980, sem duplicata**. As 3 sem SQL guardado (30/07 e 03/08) são inexportáveis e só existem como nome. ⚠️ Isso é uma foto de 11/08: **só continua verdade se a regra acima for cumprida**.
  - ⚠️ **Reconstruir num banco novo ainda exige um passo à mão:** nenhuma migration cria role, e 5 delas dão `grant` para **`assistant_ro`**, que existe só em produção. Sem criar o role antes, o primeiro `grant` falha com *role does not exist* e o sintoma aponta para o lugar errado.
- ⚠️ **Não rodar `supabase db pull`, `db push`, `migration repair` nem `db reset` nesta pasta.** Ela está vinculada à produção (`supabase/.temp/linked-project.json`) e o `db pull` **escreve no histórico de migrations do banco**, que é a cópia boa da qual o repo depende. Para ler o schema sem risco, use `db dump` (é `pg_dump`, só leitura).
- 📌 **Migration é história, não estado.** `create or replace` posterior sobrescreve o anterior sem rastro no arquivo velho (um fix já foi revertido assim sem ninguém notar). **Afirmação sobre o banco se prova no banco vivo** (`to_regclass`, `pg_get_viewdef`, `has_function_privilege`, `cron.job`), nunca lendo migration; migration serve para arqueologia (intenção e data), não para estado atual.
- **Deploy de edge:** Supabase CLI. O PAT está no `.mcp.json`, que é gitignored. ⚠️ **Nunca** commitar o token nem colá-lo em arquivo rastreado.

## Type-check e Windows
- **`npm run lint` é `tsc --noEmit`**, não é ESLint, e **não existe** script `typecheck`. ⚠️ **E não cobre as edge functions** (o tsconfig exclui `supabase/functions`): edge se confere com `deno check`.
- Mensagem de commit: **`git commit -F <arquivo>`**. Here-string quebra com acento e aspas.
- PowerShell 5.1 **não tem `&&`/`||`**: encadeie com `;` ou `if ($?) { }`.

## Várias sessões editam este repo AO MESMO TEMPO

📌 **Não commitar nem dar push por conta própria**, só quando o dono pedir. ⚠️ **Push na `main` dispara o deploy da Vercel.**

Você não enxerga as outras e elas não te avisam. **Nunca `git add -A`, `git add .` nem `git commit -a`:** rode `git status` e liste no `git add` **só os arquivos que ESTA sessão editou**, mesmo que outro pareça pronto. Já houve commit levando junto a frente de outra sessão.

Editar arquivo é seguro (o harness recusa sobrescrever o que você não leu). **O ponto cego é o índice do git.**

⚠️ **Banco e edge function são UM só para todas as sessões**, e worktree nenhum isola isso. Antes de `apply_migration` ou deploy, lembre que outra sessão pode estar no mesmo objeto, **em produção com pacientes reais**.

## Fuso horário: o banco MISTURA os dois tipos

Tudo é `America/Sao_Paulo`, mas as colunas não são uniformes. **Confira o tipo antes de converter**, porque converter duas vezes desloca 3h e ninguém percebe:

| `timestamp` **sem** tz (já é SP, não converter) | `timestamptz` (converter para exibir) |
|---|---|
| `leads.created_at`, `lead_stage_history.changed_at`, **`chat_messages.created_at`** | `tickets.outcome_at`, `lead_touchpoints.occurred_at`, `attribution_inbox.occurred_at`, **`outbound_messages.created_at`** |

⚠️ **As duas metades da MESMA conversa caem em lados opostos:** `chat_messages` é SP sem tz, `outbound_messages` é timestamptz. Numa consulta que cruza as duas, cada lado precisa da sua régua (`(now() at time zone 'America/Sao_Paulo')` de um lado, `now()` cru do outro). Trocar **não dá erro**: devolve zero linha, e zero linha aqui se parece exatamente com "o sistema parou de mandar mensagem". Já custou um diagnóstico errado de fila travada, com o sistema 100% no ar.
