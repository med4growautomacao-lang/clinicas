# CLAUDE.md

Instruções para o Claude Code neste repositório.
Aqui mora só o que é **load-bearing** e **não-descobrível num grep rápido**. Se dá pra achar em 5 segundos, não entra.

---

# 0. Diretrizes (o que NÃO muda)

Isto aqui é o contrato do produto. Módulo, função e tabela mudam toda semana; **isto não**. Quando uma decisão de implementação bater de frente com esta seção, quem cede é a implementação.

## 0.1 Idioma e fuso são fixos, não configuráveis

- **Tudo em pt-BR**: telas, mensagens ao paciente, prompts do agente, nomes de etapa, relatórios, erros da Central, comentário de código e resposta ao dono.
- **Fuso do negócio: `America/Sao_Paulo`, único.**
- ⚠️ **Não existe coluna de idioma nem de fuso em lugar nenhum do banco** (conferido 28/07: zero colunas `timezone`/`locale`/`lang` em `public`). Não invente `clinics.timezone` "para o futuro": internacionalizar é decisão de produto, não detalhe de implementação, e um campo órfão vira fonte de bug.
- Dia de negócio é dia em SP: `(now() at time zone 'America/Sao_Paulo')::date`, nunca `now()::date` cru.
- 📌 **SP é o padrão em tudo: dado, cron, relatório e tela.** Ao encontrar algo que não segue (um cron em UTC, uma coluna com hora deslocada, um relatório com corte estranho), **avise em vez de converter por conta própria**. Fora do padrão é candidato a defeito, e "consertar" no lugar errado só empurra o deslocamento para outro ponto.
- A armadilha real não é o fuso, é a **mistura de tipos** (`timestamp` sem tz já em SP × `timestamptz`). Ver §3.

## 0.2 Um sistema, duas marcas: MedDesk e WakeDesk

`clinics.category` é o discriminador. Mesmo código, mesmo banco, mesmas RPCs; **a diferença é de tela**.

| `category` | marca | tenants (28/07) | quem é |
|---|---|---|---|
| `clinica` | **MedDesk** (MED4GROW) | 20 | clínica médica/odonto |
| `outro` | **WakeDesk** (WAKEMARKETING) | 13 | loja, joalheria, metalúrgica, turismo, café |
| `meta_tester` | plano reduzido | 1 | barra cortada a 3 abas |

Quem decide o menu é `Sidebar.tsx`, por três marcas no item:

- `clinicOnly` (some no WakeDesk): **Agendamentos, Prontuários, Corpo Clínico**
- `outroOnly` (só no WakeDesk): **Produção** (estoque/PCP/manutenção), **Orçamentos**
- `metaTesterOnly` + a barra reduzida do plano Meta Tester

⚠️ **Não existe camada de vocabulário, e isso é dívida conhecida.** `activeClinicCategory` é lido em **4 arquivos** (Sidebar, Comercial, DoctorScheduleSettings, AuthContext), enquanto há **~112 ocorrências de "paciente" fixas em 20 telas**. Na prática o cliente WakeDesk lê "paciente" e "consulta" no que é transversal.

- **Texto novo em tela transversal** (funil, conversas, IA, painéis, follow-up) nasce **neutro**: contato, atendimento, cliente, profissional. Não aumente a dívida.
- Só ramifique por `category` quando o termo for mesmo incompatível (o padrão está em `DoctorScheduleSettings.tsx`).

**Régua:** feature nova é **transversal por padrão**. Vira `clinicOnly`/`outroOnly` só quando depende de um conceito que o outro lado não tem (prontuário, ordem de produção).

## 0.3 Assuma que o cliente NÃO usa o módulo

O sistema é vendido em partes. Presumir que todo mundo tem agenda ou trabalha o Kanban na mão é a origem de card zerado e de KPI mentiroso.

| módulo | uso real (90 dias, 34 tenants) |
|---|---|
| **Agenda** (`appointments`) | **5 tenants**, todos `clinica`. Zero no WakeDesk |
| **Funil/Kanban** | 34 configurados, **30** com movimento (mas muito card é movido por IA/gatilho, não pela mão) |
| **IA, follow-up, envio manual, analista** | por clínica, em `clinics.features` |

### `clinics.features` (jsonb) e a semântica que MUDA por flag

| flag | semântica | quem lê |
|---|---|---|
| `feature_ia` | opt-**out** (`!== false`) | tela Comercial |
| `feature_followup` | opt-**out** (`!== false`) | tela Comercial |
| `feature_chat_send` | opt-**in** (`=== true`) | `ChatComposer.tsx` |
| `feature_conv_ai` | opt-**in** (`=== true`) | aba do Analista Conversacional |
| `agenda_via_funil` | opt-**in**, **só no banco** | `get_commercial_dashboard` |

⚠️ Trocar `!== false` por `=== true` (ou o contrário) **liga ou desliga módulo em 34 clientes de uma vez**, sem erro nenhum. Copiar a linha de outra flag é exatamente como isso acontece.

**`agenda_via_funil = true`** = a clínica não usa `appointments`. Agendado/Realizado/Faltou saem das **etapas do funil** (`lead_stage_history`, slugs `agendado` / `ganho` / `faltou_cancelou`), ancorados em `changed_at`. Hoje: 1 clínica.

⚠️ **Nenhum formulário do app edita `agenda_via_funil`.** Super Admin e OrgAdmin fazem `{ ...clinic.features, ... }` de propósito. Reconstruir o jsonb do zero apaga a flag e **zera o painel Comercial daquela clínica em silêncio** (é a regra "nunca reconstruir JSONB" do §2, na sua forma mais cara).

**Régua:** KPI ou tela que só existe com agenda precisa de um dos dois: fallback pelo funil, ou sumir para quem não tem. Card mostrando "0" onde o módulo nem foi vendido é bug de produto.

## 0.4 WhatsApp é uazapi, e a documentação é a fonte

Receber e enviar mensagem passa pela **uazapi** (`https://med4growautomacao.uazapi.com`, base em `UAZAPI_BASE`).

📌 **Antes de criar ou alterar qualquer requisição, consulte https://docs.uazapi.com/.** Não deduza payload por analogia com outro endpoint nosso: `/send/text`, `/send/media` e `/send/menu` têm corpos diferentes, e campo errado falha com 200 em alguns casos.

| direção | estado real (28/07) |
|---|---|
| **receber** | 100% na edge **`wa-inbound`**. O n8n **não recebe mais mensagem**. ⚠️ Sobram 2 linhas com `whatsapp_instances.inbound_route = 'n8n'` (Meta Tester, Fernando Massoterapeuta): são instâncias **nunca conectadas, com zero mensagem na história**. É valor velho parado, não rota viva. **Não conte linha de `inbound_route` como se fosse tráfego** |
| **enviar** | **todo envio automático passa pelo Emissor** (`emit_message` → `outbound_messages` → `emissor-worker`). Desde 28/07 o gate `fn_emissor_ativo` está em `{enabled:true, all:true}`: vale para as 34 clínicas **e para toda clínica criada daqui em diante**, sem cadastro nenhum |

📌 **Código novo que manda mensagem produz para a fila** (`emit_message`), nunca `fetch` direto nem `system_http_post` para a uazapi. É o que dá retry, DLQ, e a garantia de só gravar em `chat_messages` depois do 200.

⚠️ **Os ramos `else` inline ainda existem no código e NÃO são código morto: são o rollback.** Cada produtor é `if fn_emissor_ativo(clinic) then emit_message(...) else <envio antigo> end if`. Voltar `all` para `false` devolve os 34 tenants ao caminho antigo sem deploy. Não "limpe" esses ramos achando que são resíduo.
- **Token nunca é constante nem variável de ambiente por clínica**: sai do gate `fn_clinic_send_token`, que exige instância `connected`.
- **Telefone: normalizar os dois lados** antes de comparar (o 9º dígito), mas o endereço de entrega vai como a uazapi devolveu. Ver §2.
- Chamada HTTP saindo do **banco** usa `system_http_post`, nunca `net.http_post` cru.

## 0.5 Se falhar em silêncio, não existe

**Não há Sentry.** O que não estiver em `system_errors` não aconteceu para ninguém.

📌 **Toda função que importa registra erro na Central.** "Importa" = se falhar, alguém perde dado, dinheiro ou atendimento. Vale para edge (`registrarErro()`), RPC, trigger e cron (`log_system_error`). `catch` que só faz `console.error` é invisível. Detalhes, formato e a regra de arquivamento: §2.

**Critério de pronto:** feature nova sem caminho de erro na Central não está pronta, mesmo funcionando.

## 0.6 Falar com o dono: resumo primeiro, linguagem de negócio sempre

**O dono não é programador.** Ele decide o rumo do produto, e só consegue decidir bem se entender o que está na mesa. Resposta que ele não entende é resposta perdida, por mais correta que esteja.

📌 **Toda resposta começa pelo resumo:** o que aconteceu, o que isso significa para o negócio e o que ele precisa decidir. O detalhe técnico vem **depois**, e só o necessário para sustentar a conclusão.

- **Traduza para consequência, não para mecanismo.** Não é "o `buttonOrListid` não era lido no parser"; é "o paciente clicou em Confirmar e o sistema ignorou". O nome técnico entra no fim, para quem for procurar depois.
- **Todo número vem com o que ele quer dizer.** "7 cliques perdidos" sozinho não decide nada. "7 cliques perdidos, mas só 1 clínica tinha a automação ligada, então 3 pacientes reais foram ignorados" decide.
- **Diga sempre quem perde o quê:** paciente, dinheiro, dado ou tempo da equipe. Se nada disso se perde, diga também, para ele não gastar atenção à toa.
- **Termo técnico inevitável vem explicado na mesma frase.** "RLS (a regra que impede uma clínica de ver dados de outra)". Uma vez, não a cada menção.
- **Fecha com a decisão dele**, quando houver: o que dá para fazer, o custo/risco de cada caminho e a sua recomendação. Uma recomendação clara, não um cardápio.
- **Não esconda o problema no meio do texto.** Se algo quebrou, está na primeira linha.
- **Erro seu se admite em uma frase e segue.** Sem autoflagelo, sem repetir o assunto.

⚠️ Isso vale **inclusive quando a notícia é ruim ou o assunto é chato**. Relatório técnico que ele não consegue ler vira decisão adiada, e decisão adiada em produção custa paciente.

## 0.7 "Está desligado" NÃO é diagnóstico. A pergunta é: ligado, funciona?

O dono **já sabe** o que está desligado, e desliga de propósito: o sistema está em fase de testes, e chave off é o estado normal de quase tudo. Entregar "a flag está off" como achado gasta a atenção dele e não responde nada.

🚫 **NÃO relate estado de chave, texto em branco nem módulo desligado como se fosse problema.** Isso não é achado, é o cenário. Se for indispensável para entender o resto, cabe em meia linha de contexto.

📌 **Relate DEFEITO DE CÓDIGO, e só.** A pergunta é sempre: no dia em que ligarem, funciona de ponta a ponta?

- **Percorra o caminho inteiro**, não o primeiro `if`. Gatilho → regra → envio → gravação → retorno. Um elo quebrado no meio só aparece quando alguém liga, e aí aparece em produção com paciente na frente.
- **Teste com a chave ligada**, não com ela como está. `begin; ... rollback;` com a flag ligada na transação, lead `is_simulation` (roteia para sandbox, não toca uazapi), e confira o efeito real: mudou o status? entrou na fila? gravou a conversa?
- **Separe as três causas, sempre**, porque a solução de cada uma é diferente:
  1. **desligado** → é só ligar, e o dono decide quando;
  2. **falta configuração** (texto vazio, grupo não cadastrado) → é preencher formulário, ninguém precisa programar;
  3. **defeito de código** → só conserta mexendo no sistema. **É o único que é problema seu.**
- **Chave que a tela grava e o backend não lê é DEFEITO**, não configuração: o cliente desliga e continua ligado, ou vice-versa. Procure isso ativamente ao mexer numa feature com toggle.
- **Diga o que está provado e o que não está.** "Testei o caminho todo com a chave ligada" é diferente de "li o código e parece certo". O segundo é palpite, e tem que ser dito como palpite.

## 0.8 Régua de decisão (rodar antes de mexer)

1. **Em que camada isso mora?** Repo, banco ou edge (§1). Comportamento do agente é prompt + edge, não tela.
2. **Vale para as duas marcas?** Se não, o que decide: `category` ou uma flag de `features`? (§0.2, §0.3)
3. **E se o cliente não tiver esse módulo?** Agenda, Kanban, IA e envio manual são opcionais. O que ele vê?
3b. **E quando LIGAREM, funciona?** Percorra o caminho todo com a chave ligada, não pare no gate (§0.7).
4. **Se falhar, quem descobre?** Se a resposta não for "a Central de Erros", falta código. (§0.5)
5. **Que número é esse?** Conceito (lead/venda/faturamento/agendado) e **eixo de data** são coisas separadas. Fonte única por conceito; divergência legítima é só de recorte. (§1)
6. **Isso é produção?** Banco e edge são **um só** para todas as sessões, com pacientes reais do outro lado. Até 4 sessões editam esta árvore ao mesmo tempo (§3).
7. **Quando parar e perguntar:** risco de dinheiro, de dado de paciente ou de mudança que o cliente enxerga. O resto, decida e siga. Pergunta em linguagem de negócio, não de banco (§0.6).
8. **Como contar o que fez:** resumo primeiro, consequência antes de mecanismo, decisão do dono no fim (§0.6).

---

# 1. Onde as coisas moram

O sistema **não vive só neste repo**. Antes de procurar um comportamento aqui, decida em qual das **três camadas** ele roda:

| camada | o que roda ali |
|---|---|
| **Repo (React/TS)** | telas, hooks (`src/hooks/useSupabase.ts`), configuração |
| **Banco (Postgres)** | RPCs, triggers, invariantes, RLS, crons (`pg_cron`) |
| **Edge Functions** (`supabase/functions/`) | ~42 edges + `_shared/` (lista no disco). Inclui integrações externas, o **Agente IA nativo** (`ai-agent` + `ai-agent-worker`), **Analista Conversacional** (`conv-ai-analyst` + `conv-ai-learn`), **Emissor** (`emissor-worker`), follow-ups (`forms-welcome-followup`, `reengagement-followup`), assistente IA (`ai-assistant`), sandbox (`ai-sandbox`) |

⚠️ **O n8n não é mais camada deste sistema.** Não recebe, não envia, não roda o agente nem os follow-ups. Sobrou lá só o rastreamento de formulário dos sites cujo webhook ainda aponta para ele, e isso é pendência do lado dos sites, não código nosso. **Não procure comportamento no n8n**; se um dia parecer que a resposta está lá, é sinal de que a pergunta está errada.

**Regra prática:** comportamento do agente → edge (`ai-agent-worker`) + prompt. Regra de negócio → banco. Integração externa → edge. Tela → repo.

### ⚠️ O repo NÃO é a fonte completa das edge functions

Há funções **ativas em produção sem código-fonte aqui** — hoje: **`validate-medico-email`** (chamada no cadastro, Login.tsx). Antes de concluir "essa função não existe", **liste as deployadas** (MCP `list_edge_functions`), não só o disco.

⚠️ **`webhook-proxy`** já teve a fonte trazida para o repo (`supabase/functions/webhook-proxy/index.ts`) e endurecida em 27/07: era um **proxy SSRF aberto** (fetch para qualquer URL, `verify_jwt=false`). Hoje tem **allowlist** para `*.med4growautomacao.com.br` e **está sem uso** — os dois callers antigos (encerramento de ticket, teste de gatilho) migraram para trigger/RPC nativos.

### Os nomes de WhatsApp enganam

- **`whatsapp-orchestrator`** — é quem **faz o trabalho**: máquina de estados da conexão (`start`, `cancel`, `disconnect`, `reset`, `status`).
- **`whatsapp-bridge`** — **não** é "a ponte". É um **roteador fino de retrocompatibilidade** (clientes em cache): repassa conexão → `orchestrator`, e grupos → n8n. **Mexer aqui achando que é o caminho principal é perda de tempo** — o próprio arquivo diz que pode ser removido.

## Como o agente de IA é instruído

O agente é instruído por **TRÊS fontes**, e confundi-las já custou tempo. As duas primeiras se chamam prompt; **a terceira não se chama, mas é prompt do mesmo jeito**:

| | define | onde mora | escopo |
|---|---|---|---|
| **1. Prompt do Sistema** | **COMO** o agente age: tom, etapas, quando usar cada tool | `prompt_templates.content`, escolhido via `ai_config.prompt_template_id` | ⚠️ **COMPARTILHADO entre clínicas** |
| **2. Prompt da Clínica** | **O QUE** ele sabe: médicos, horários, valores, endereço | `ai_config.prompt` | só daquela clínica |
| **3. Descrição do tipo de consulta** | **QUANDO usar cada tipo**: para quem serve, o que inclui, quando não oferecer | `consultation_types.description` | só daquela clínica |

⚠️ **A terceira é a mais fácil de esquecer e a mais fácil de estragar**, porque quem escreve é a própria clínica, num campo que parece cadastro e não parece instrução de IA. Texto vago ali vira agente oferecendo o tipo errado, e ninguém procura o defeito no cadastro.

A view **`public.v_clinic_ai_prompt`** concatena: `combined_prompt = template.content + '\n\n---\n\n' + ai_config.prompt`. **Sistema primeiro, clínica depois.** Sem template, é só o da clínica.

Quem lê essa view é o pipeline nativo: `wa-inbound` → **`ai-agent`** (ingest, enfileira em `ai_turn_buffer`) → **`ai-agent-worker`** (loop LLM + tool-calling + envio). O worker monta o prompt via `_shared/agent/prompt.ts` → `fetchAgentContext` → `assembleSystemPrompt`, que puxa a view.

- **Regra de comportamento está no prompt do SISTEMA.** Procurar no da clínica não acha.
- Editar um `prompt_template` **mexe com várias clínicas ao mesmo tempo**.
- O prompt da clínica vir por último **não o torna capaz de revogar** uma regra do sistema.

**Como a terceira fonte chega:** as descrições (`consultation_types.description`) não entram no prompt montado; chegam ao agente **em tempo de execução**, pela tool `LISTAR_TIPOS_CONSULTA`. Por isso não aparecem em `v_clinic_ai_prompt` e não adianta procurá-las lá.

⚠️ Essa regra também está **explicada na UI** (Configurações IA e Super Admin › Prompts Fixos). Se ela mudar, **os textos da tela mudam junto** — senão o app passa a mentir para o cliente.

## Pipeline do Agente IA nativo (substituiu o n8n)

O agente de IA **não roda mais no n8n**. O pipeline é inteiramente de edge functions:

```
wa-inbound → ai-agent (ingest) → ai_turn_buffer → ai-agent-worker (loop LLM)
                                                         ↓
                                                    outbound_messages → emissor-worker → uazapi
```

| edge | o que faz |
|---|---|
| **`wa-inbound`** | Recebe webhook do uazapi, persiste `chat_messages`, encaminha para o agente via `HUB_AI_WEBHOOK_URL` → edge `ai-agent`. **Substituiu o workflow n8n "Receptor de mensagens", que hoje está desativado**. O chaveamento em `whatsapp_instances.inbound_route` (`hub` × `n8n`) sobrou da migração canário e não decide mais nada em produção |
| **`ai-agent`** | Ponto de entrada (ingest). Enfileira o turno em `ai_turn_buffer` e "cutuca" o worker. Retorno 200 imediato |
| **`ai-agent-worker`** | O cérebro. Claim atômico (`claim_due_ai_turns`), loop LLM com tool-calling (`_shared/agent/tools.ts`), fan-out em bolhas, grava memória, transição de etapa. **Stateless, horizontal** |
| **`emissor-worker`** | Fila de saída (`outbound_messages`). Token pelo gate canônico (`fn_clinic_send_token`), lê a resposta, só grava em `chat_messages` após 200, retry + DLQ. **Ligado para todas as clínicas desde 28/07** (§0.4). Sabe 3 formatos: `/send/text`, `/send/media` e `/send/menu` (botões, via `outbound_messages.menu_payload`) |
| **`ai-sandbox`** | Ambiente de teste (Super Admin). Injeta mensagem no mesmo pipeline mas roteia p/ `transport='sandbox'` (nunca toca uazapi real) |

**Módulos compartilhados em `_shared/agent/`:**
- `tools.ts` — specs e execução das 9 tools do agente: `LISTAR_TIPOS_CONSULTA`, `VER_HORARIOS`, `MARCAR_HORARIO`, `REAGENDAR_HORARIO`, `CANCELAR_HORARIO`, `VER_AGENDAMENTOS_PACIENTE`, `VER_HISTORICO_PACIENTE`, `ACIONAR_HANDOFF`, `ENCERRAR_FORA_PERFIL`. Todas delegam para a edge `ai-scheduler`
- `prompt.ts` — `fetchAgentContext` + `assembleSystemPrompt` (puxa `v_clinic_ai_prompt`)
- `memory.ts` — leitura/escrita de `chat_messages` como memória conversacional
- `guard.ts` — sanitização de resposta (detecta vazamento técnico, strip de code fences)
- `split.ts` — quebra resposta longa em bolhas de WhatsApp

**`_shared/llm.ts`** — abstração multi-provider (Gemini/Anthropic). O modelo padrão hoje é `gemini-3.1-pro-preview-customtools`; pode ser override por clínica via `ai_config`.

⚠️ **O ai-agent-worker NÃO faz retry do envio** — quem retenta é o `emissor-worker`. Se o worker falhar no loop LLM, o erro vai para a Central e a sessão fica pendente para o sweep do `pg_cron`.

## Analista Conversacional (conv-ai)

Dois módulos que classificam conversas **sem intervenção humana**:

| edge | o que faz |
|---|---|
| **`conv-ai-analyst`** | Lê a conversa de cada atendimento com mensagem nova. Decide: (1) em que etapa do funil o ticket deveria estar, (2) se houve venda. Etapa comum → aplica sozinha (`source='ia_analise'`). Etapa de conversão → **nunca aplica**, vira sugestão pendente ("Vendas sugeridas"). Cron 5min |
| **`conv-ai-learn`** | "Aprendizado" do analista. Gera/atualiza o manual de análise **por clínica** (`conv_ai_prompt_versions`), a partir de conversas históricas rotuladas (bootstrap) ou decisões humanas recentes (learn). Cron 1×/dia |

Gates: `system_settings.conv_ai_config.mode` (`off`/`shadow`/`active`) + `conv_ai_clinic_config.enabled` por clínica. Em `shadow`, nada é aplicado — só registra o que **teria** feito.

## Agendamento

### ⚠️ `book_appointment` é a função mais crítica do sistema

Tudo que marca horário passa por ela: app, Kanban, IA e `convert_lead_to_appointment` (que **delega**). É a única coisa que insere em `appointments` (verificado). **Nunca inserir direto.**

📌 **Cuidado redobrado ao otimizar ou refatorar essa função.** Ela concentra, no mesmo corpo, a validação de disponibilidade, os buffers dos dois lados, o aviso mínimo, a trava contra marcação simultânea e a invariante de um agendamento ativo por ticket. "Simplificar" qualquer um desses trechos por parecer redundante já é, por definição, o bug: o efeito não aparece no teste, aparece como **horário vendido duas vezes** com dois pacientes na porta. Se precisar mexer, mexa num pedaço por vez e prove cada um.
  - `v_validate := COALESCE(p_validate_availability, true)` → **default seguro (valida)**; burlar é explícito.
  - `v_ignore_min := COALESCE(p_ignore_min_notice, p_source <> 'ia')` → **só a IA respeita o aviso mínimo**; o manual o ignora **de propósito** (encaixe de recepção).
- **`get_available_slots` tem 2 overloads.** A versão por **`consultation_type_id` (uuid) é a real**; a de texto é só adaptador de legado.

**De onde o motor tira cada coisa** (a divisão não é óbvia):

| vem de `consultation_types` | vem de `doctors` |
|---|---|
| duração, `slot_step`, buffers, `min_notice` | `working_hours`, `days_off`, `blocked_times` |

⚠️ `doctors.consultation_duration / slot_step / buffer_* / min_notice_*` **existem e são IGNORADOS** — letra morta. Mas o **expediente** é do médico mesmo (o tipo só pode sobrepô-lo via `working_hours_override`).

## Tickets

**Cinco caminhos de criação — e dois deles não passam por RPC:**
- WhatsApp → trigger `trg_auto_open_ticket` em `chat_messages` (fn `fn_auto_open_ticket`)
- Formulários → trigger `trg_auto_open_ticket_forms` em `leads`
- App → RPC `create_lead_with_ticket`
- App → **`insert` direto em `tickets`** (`useSupabase.ts`, criação avulsa no Kanban)
- CRM do cliente → RPC `apply_external_crm_outcome` com **`p_outcome='lead'`** (edge `external-crm-status?tipo=lead`), que também dá **`insert` direto em `tickets`**

Por isso **a invariante não pode morar na aplicação** — ela é garantida por índice (abaixo).

### ⚠️ A etapa de entrada é escolhida pela TRIGGER, não por quem chama

Todo lead criado com `capture_channel='forms'` já nasce com ticket: `trg_auto_open_ticket_forms` é **AFTER INSERT**, então quando a sua RPC chega na própria busca de etapa **o ticket já existe**, na etapa `forms`. Mexer no slug dentro da RPC não muda nada — é código morto.

Quem precisa desviar disso usa a marca de transação **`app.crm_intake`** (mesmo idioma do `app.stage_source`/`app.stage_actor` do `fn_log_ticket_stage_change`). Com ela em `'1'`, **três** triggers mudam de comportamento:

| trigger | com `app.crm_intake='1'` |
|---|---|
| `fn_auto_open_ticket_forms` | não abre o ticket (quem abre é a RPC, na etapa que ela escolher) |
| `fn_touchpoint_from_site_form` | grava o toque como "Negócio criado no CRM externo", não "Preencheu formulário" |
| `fn_handle_lead_uniqueness` | mesma troca de texto no ramo de **mesclagem** ("...novamente") |

⚠️ **`fn_reset_followup_on_new_ticket` NÃO é gateada, e isso é decisão, não esquecimento.** Chegamos a suprimi-la e o efeito foi pior: o `insert` de ticket só roda quando o lead está **sem** ticket aberto, então o `handoff_triggered_at`/`followup_count` que estão lá são do ciclo **morto**. Herdar esse estado deixa o card novo **mudo** para IA e follow-up (o `fn_ai_loop_guard` e o `fn_followup_candidates_reengagement` leem `handoff_triggered_at`), para sempre e sem erro nenhum. "Ticket novo = atendimento novo" vale para os cinco caminhos, sem exceção.

Hoje só `apply_external_crm_outcome` com `p_outcome='lead'` a liga, e a RPC a seta em **toda** chamada (`'1'` para lead, `'0'` para o resto) — sem isso, um lote rodando várias chamadas na mesma transação herdaria o valor da anterior e um `ganho` ficaria sem ticket. Com a marca ausente, `current_setting(..., true)` devolve NULL e tudo se comporta como antes.

⚠️ **A cascata de etapa mora em `fn_default_entry_stage(clinic_id, slug_preferido)`** (preferido → `whatsapp` → primeira por `position`). Era copiada em 3 lugares. Os 34 tenants com funil têm `forms` **e** `whatsapp`, então o fallback quase nunca roda: trocar a ordem muda 100% dos tenants de uma vez, não um subconjunto.

📌 **Quem escolhe o `slug_preferido` não é mais o código, é o cliente:** `fn_clinic_entry_stage_slug(clinic_id)` (§2, "Canal e etapa de entrada"). Ao mexer num caminho que abre card, passe a chave, **nunca um slug fixo** — slug fixo aqui é o que fez a decisão de 27/07 virar letra morta sem ninguém notar.

Ciclo de vida: `move_lead_stage`, `finalize_ticket`, `reopen_ticket`, `move_ticket_keep_outcome`.

## Dashboards — fonte ÚNICA por conceito; divergência só de RECORTE

Três painéis, três RPCs: **Visão Geral** (`Dashboard.tsx` → `get_dashboard_stats`), **Comercial** (`ComercialDashboard.tsx` → `get_commercial_dashboard`) e **Marketing** (`MarketingAnalytics.tsx` → `marketing_kpis`/`marketing_*_funnel_cohort`).

Desde 18/07 os três **partem da MESMA definição por conceito** — as **views canônicas `v_kpi_*`** (`security_invoker=on`) são a fonte única:

| conceito | fonte única | eixo de data |
|---|---|---|
| leads | `v_kpi_leads` (exclui `is_not_lead`) | `leads.created_at` |
| vendas (nº) | `v_kpi_wins` (`tickets.outcome='ganho'`) | `COALESCE(outcome_at,closed_at)` |
| faturamento | `v_kpi_sales_value` = **vendas lançadas** (`conversions` s/ 'Orçamento Enviado') | `converted_at` |
| agendado | `v_kpi_scheduled` (união consulta ∪ etapa, 1×/ticket) | `LEAST` das duas |

⚠️ **O módulo Financeiro está DESABILITADO nos painéis, POR ENQUANTO** (decisão do dono, 18/07, reconfirmada em 28/07). Enquanto estiver assim: **não puxar de `financial_transactions`** em RPC de painel nenhuma, e faturamento é sempre o **valor lançado** (`conversions`), em todo lugar.

É pausa, não aposentadoria: a tabela continua viva e a aba está só comentada no `Sidebar.tsx`. **Para religar não basta descomentar** — o painel voltaria a mostrar dois faturamentos diferentes (o lançado e o financeiro) sem ninguém saber qual é o certo. Religar exige antes decidir **qual dos dois é a fonte única** e alinhar as views `v_kpi_*` a ela.

⚠️ **Divergência legítima agora é SÓ de recorte, nunca de definição.** Um painel pode fatiar por **criação do lead** (`created_at`), **conversão** (`outcome_at`) ou **realização da consulta** (`appointments.date`) — mesmo conceito, janela diferente → números diferentes e ambos certos. **Antes de "corrigir" uma divergência, confirme qual eixo cada lado usa.** Se as definições divergirem (não o recorte), aí é bug — as três devem bater na mesma janela.

**Atribuição IA × Humano:** régua canônica única precomputada em `lead_kpi_attribution` (cron 10min) → view `vw_lead_agent_class`. A VG já lê dela. **RESSALVA (pendente):** `get_commercial_dashboard` ainda tem cálculo inline p/ `agents.leadsTouched` e `appointments.generated` por `created_at` — até unificar, esses dois podem divergir da VG. O resto do Comercial já usa as views/precompute.

### ⚠️ Toda RPC de painel é um PAR: wrapper (guard) + `_impl` (corpo)

Desde 26/07 as **9** RPCs de painel — as 6 `marketing_*`, `get_dashboard_stats`, `get_commercial_dashboard`, `get_commercial_leads` — seguem este formato. O nome público é um wrapper fino `SECURITY DEFINER` que só chama `assert_clinic_access(p_clinic_id)` e delega; **a lógica mora em `<nome>_impl`**.

- **Mexer na regra do painel = mexer no `_impl`.** Reescrever o *wrapper* como se fosse a RPC **apaga o guard** e reabre vazamento cross-tenant.
- `_impl` **não tem EXECUTE** para anon/authenticated. Chamar direto pelo PostgREST dá erro de permissão — não é "a RPC sumiu".

> ⚠️ **Grant de função aqui vem por DOIS caminhos, e revogar um só não fecha nada.** Uma função em `public` costuma ter `=X/postgres` (o PUBLIC, que todo `create function` concede) **e** `anon=X/postgres` (nominal, vindo do `pg_default_acl` do schema). Revogar só de `public` deixa o nominal de pé; revogar só de `anon` deixa o PUBLIC de pé. **Sempre `revoke all on function ... from public, anon, authenticated`** e depois `grant` para quem deve. Foi assim que o vazamento de PII "corrigido" em 26/07 seguiu aberto sob o nome `_impl` até 27/07.
>
> **Confirme sempre com `has_function_privilege('anon', p.oid, 'EXECUTE')`, nunca lendo o DDL da migration.**
>
> Desde 27/07 o `alter default privileges` do schema já revoga EXECUTE de anon/authenticated, então **RPC nova para o front precisa de `grant execute ... to authenticated` EXPLÍCITO** — sem isso o PostgREST devolve erro de permissão e parece "a RPC não existe".
- **`assert_clinic_access` barra o navegador, não o backend.** É **fail-closed**: passa sem checar em exatamente dois casos, e barra todo o resto.
  1. **sem `request.jwt.claims`** = chamada de dentro do banco (`pg_cron`, psql, outra função) — é o que mantém `build_commercial_report` (cron 21) funcionando;
  2. **role do JWT = `service_role`** = backend (que já tem `rolbypassrls` de qualquer forma).
  Qualquer outro portador de JWT, inclusive um role novo do PostgREST, precisa provar `has_clinic_access`. **Não voltar para a forma `if v_jwt_role in ('anon','authenticated')`**: aquilo era fail-OPEN, um role desconhecido passava direto. E **não trocar por `has_clinic_access` cru**, que depende de `auth.uid()` e mata o relatório automático de hora em hora.
- Guard **nunca** é `is_clinic_admin()` sozinho: ele deixa de fora o `gestor` de `clinic_users`, que é quem mais abre o painel.

**Por que DEFINER e não a RLS:** painel de clínica grande lendo com RLS paga `is_clinic_active(clinic_id)`/`is_clinic_admin(clinic_id)` **por linha** (a policy passa a COLUNA, então o planner não resolve uma vez). Medido na "Intubação" (8.236 leads): `marketing_kpis` custava 2.328 ms com RLS contra 44 ms sem, e as RPCs da tela somavam 8.371 ms, acima do **`statement_timeout` de 8s do role `authenticated`** — o painel devolvia 500 e pintava "SEM DADOS". Sintoma de timeout se parece com lentidão: **conferir os 500 no console e `canceling statement due to statement timeout` nos logs do Postgres antes de caçar query lenta.**

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

## Telefone: normalizar SEMPRE, e nos DOIS lados

O **9º dígito** é a razão: o mesmo contato aparece com e sem ele, e comparar telefone **cru** gera "não encontrado" fantasma. Em RPC, normalize **os dois lados** da comparação, sem exceção. `patients` é normalizado no banco (`normalize_br_phone`); `leads` chega já normalizado da captação.

⚠️ **A base NÃO é só celular brasileiro.** Conferido em 28/07:

| caso | volume | como `normalize_br_phone` trata |
|---|---|---|
| celular BR | ~31 mil | 13 dígitos com `9` na 5ª posição → **tira o 9** e vira 12 |
| **fixo** (DDD + 8 dígitos) | **1.296 leads** | 10 dígitos → cola `55` e vira 12. **O 9 não é tirado**, então funciona |
| **exterior** (Argentina 54, Uruguai/Paraguai 59x, Portugal, Espanha, EUA…) | ~150 leads | com DDI, passa intacto: a regra do 9 só dispara quando começa com `55` |

⚠️ **A armadilha do exterior:** número com **10 ou 11 dígitos ganha `55` na marra**, porque a função assume Brasil. Estrangeiro digitado **sem o código do país vira um número brasileiro** e nunca mais casa com a pessoa. Ao cadastrar contato de fora, o DDI é obrigatório.

Fixo e celular não colidem por sorte estrutural (o resto do celular começa em 6-9 e o do fixo em 2-5), então o índice de telefone único não funde duas pessoas. **Não é garantia escrita em lugar nenhum**: se um dia mudar a numeração, isso quebra em silêncio.

## `rast_id` ≠ protocolo
- **`rast_id`** (UUID v4) = **identidade do lead**. **protocolo** = id **de um clique**.
- Já foram o mesmo campo, e confundi-los corrompe a jornada multi-toque.

**Todo lead NOVO nasce com `rast_id`** (gerado em `fn_handle_lead_uniqueness`) — vale a partir de **13/07/2026 15:45**, quando a migration subiu.

⚠️ **Mas ~20 mil leads ANTIGOS têm `rast_id` NULL** — o backfill foi **dispensado de propósito** (UUID inventado para lead de março não amarra jornada nenhuma). **`JOIN`/`GROUP BY` por `rast_id` descarta esses 20 mil em silêncio.** Para histórico, use o telefone normalizado.

## Rastreamento do site — uma máquina, duas chaves, uma régua de UTM

- **`attribution_inbox` tem DUAS chaves de reconciliação:** telefone (`phone_norm`, usada pelo CTWA) e **`protocolo`** (usada pelo clique do site — o lead ainda não tem telefone quando clica). Linha sem telefone é ignorada pelos reconciliadores de telefone **de propósito**.
- **`external-forms-ingest` é O caminho nativo de formulário** (token `?k=` por clínica, criado sozinho pela UI). O n8n "Webhook Forms" só existe para sites não migrados.
- ⚠️ **Hoje `capture_channel='forms'` NÃO quer dizer "veio de formulário", e isso é dívida a pagar** (ver a regra do canal, abaixo). A edge **`external-crm-status`** (webhook do CRM do cliente, ex.: Clint) cria lead com esse mesmo canal nos três tipos (`lead`/`ganho`/`perdido`), só para herdar o pipeline de forms. **Os tokens são diferentes: `capture_token` (formulário) ≠ `crm_token` (CRM)** — ligar um não liga o outro.
- **Convenção de UTM é SOURCE-AWARE e mora em `_shared/attribution.ts`** — não invente mapeamento novo: Google → adset=`utm_medium`, ad=`utm_content`, term=`utm_term`; Meta → adset=`utm_term` (`{{adset.name}}`), ad=`utm_content`, e o posicionamento (`utm_medium`) vira `ad_platform`. Meta grava em `fb_*`, o resto em `g_*`.
- **O script dos sites é SERVIDO pela edge `site-script`** (`?c=<clinic_id>`, cache 1h) a partir de `system_settings.global_tracking_script` — mudou o blob no banco, todos os sites atualizam sozinhos. **Nunca** volte a distribuir o script inline.

## Canal ≠ origem — e o vocabulário MUDA entre as tabelas
**Canal** = *como* chegou. **Origem** = *de onde* veio. **"Balcão" é canal, nunca origem.**

⚠️ **Os valores de canal não são os mesmos nas duas tabelas** — não copie de uma para a outra:

| coluna | valores reais |
|---|---|
| `leads.capture_channel` | `whatsapp` · `forms` · `manual` · `balcao` |
| `lead_touchpoints.channel` | `whatsapp` · `site_forms` · `meta_forms` · `manual` |
| `lead_touchpoints.source` (origem) | `meta_ads` · `google_ads` · `instagram` · `null` = orgânico |

Repare: `leads` diz **`forms`**; `lead_touchpoints` separa em **`site_forms`** e **`meta_forms`**.

### 📌 REGRA: `forms` é SÓ formulário. O resto entra como `whatsapp`

Decisão do dono (28/07). **`forms` significa formulário de verdade**, nativo (`external-forms-ingest`) ou de site. Nenhuma outra origem pode se pendurar nesse canal só para herdar o pipeline dele.

- **Lead que não veio de formulário nasce `whatsapp`.** É o valor de fallback do vocabulário fechado, então não inventa termo novo nem some dos painéis.
- ⚠️ **O caso aberto é o CRM externo** (`apply_external_crm_outcome`), que hoje cria lead como `forms` de propósito, com um comentário na própria função dizendo que trocar "partiria o recorte de canal ao meio". A decisão acima **derruba esse comentário**: quando a troca for feita, é para `whatsapp`. Ainda **não** foi feita.
- Efeito medido antes de mexer: **só a Intubação usa CRM de verdade** (5.574 eventos), e **nenhum lead de CRM recebe boas-vindas hoje** (o welcome só sai onde o canal é `forms` **e** a clínica tem o follow-up ligado, o que não é o caso). Ou seja, a troca **não silencia mensagem nenhuma**. O que muda é o recorte do painel dessa clínica.

### ⚠️ Canal e ETAPA DE ENTRADA são coisas separadas, e só a etapa é escolha do cliente

Confundir as duas é a armadilha desta parte do sistema, porque as duas usam as palavras "forms" e "whatsapp".

| | o que é | quem decide |
|---|---|---|
| **canal** (`leads.capture_channel`) | **fato**: como o contato chegou | a origem, nunca uma preferência |
| **etapa de entrada** | **escolha de fluxo**: em que coluna o card nasce | o cliente, em `clinic_external_integrations.entry_stage_slug` (`forms` \| `whatsapp`, default `forms`) |

Desde 28/07 a etapa é configurável por cliente, na aba Integração Externa ("Onde o card começa"). A chave vale para **os dois caminhos que criam card sem conversa**: o formulário (`fn_auto_open_ticket_forms`) e o CRM (`apply_external_crm_outcome`), ambos via **`fn_clinic_entry_stage_slug(clinic_id)`**.

📌 **A chave NÃO toca o canal, e isso é deliberado.** Amarrar um no outro faria um lead de formulário ser contado como WhatsApp nos painéis, que é exatamente a corrupção que a régua do canal existe para impedir.

⚠️ **A exceção antiga do CRM morreu.** Até 28/07 a RPC do CRM passava `'whatsapp'` fixo, por uma decisão de 27/07 que **nunca teve efeito nenhum**: as duas clínicas com CRM têm **zero** evento `outcome='lead'` (a Intubação nem tem `lead_enabled`), então aquele ramo jamais rodou. Na prática 100% dos cards entravam em `forms`. Não "restaure" o slug fixo achando que era regra viva.

Hoje: Intubação em `forms` (é captação por formulário mesmo), GG Imports em `whatsapp` (loja, atende tudo por WhatsApp).

⚠️ **O canal é vocabulário FECHADO na prática, mesmo sem CHECK no banco.** Não existe constraint: um valor novo (`crm`, `parceiro`) entra sem erro e só quebra depois, de dois jeitos ao mesmo tempo. As views `v_kpi_*` e o Marketing usam `CASE ... ELSE 'whatsapp'`, então o valor novo **vira WhatsApp**; já o Visão Geral e o Comercial filtram por **igualdade** (`capture_channel = ANY(...)`), então ele **some de todos os chips**. Isso é divergência de DEFINIÇÃO entre painéis, que aqui é bug. Valor novo exige mexer nas 5 views, nas 3 RPCs de painel e nos chips de 4 telas.

## Nunca reconstruir JSONB do zero
Formulário que grava um JSONB inteiro sem reler tudo **zera silenciosamente** os campos que não conhece. Já causou 3 bugs de "salvar apaga campo". **Sempre `COALESCE` / merge parcial.**

## RLS multi-tenant
Usar **`is_clinic_admin(clinic_id)`** / **`is_super_admin()`**.
⚠️ **`is_admin()` ainda existe, mas está fora de todas as policies — não reintroduzir.** Ela dava **bypass cross-org**.

### ⚠️ Policy que passa a COLUNA roda POR LINHA (e é o que derruba clínica grande)

`is_clinic_active(clinic_id)` / `is_clinic_admin(clinic_id)` recebendo a **coluna** impedem o planner de resolver uma vez, então executam **uma vez por linha**. Desde 27/07 **`leads`, `tickets`, `chat_messages`, `lead_stage_history`, `lead_touchpoints` e ~25 tabelas de forma standard** usam a régua nova, que roda **1× por query**:

```sql
using (clinic_id in (select public.my_clinic_ids()) or (select public.is_super_admin()))
```

`my_clinic_ids()` é `setof uuid`, STABLE, DEFINER, e **sem argumento de propósito** — é a ausência de argumento que permite o `hashed SubPlan`. **Não "melhore" passando `clinic_id` para ela: isso desfaz todo o ganho.** Medido no Kanban da Metaltres: **2.548 ms → 33 ms**.

⚠️ **O braço `or (select is_super_admin())` não é enfeite:** `my_clinic_ids()` só devolve ids que existem em `clinics`, então linha com `clinic_id` NULL ou órfão sai do alcance do super-admin (`NULL in (...)` é NULL), e como a policy é `FOR ALL` o USING vale de WITH CHECK, então ele perde até o UPDATE para consertar a linha. Copiar a régua sem esse braço reintroduz a cegueira, uma tabela por vez.

- **Restam ~18 policies no padrão caro** (todas pequenas ou lidas só por RPC DEFINER, sem penhasco de escala): `clinic_users` (self-ref `id=auth.uid()`), as **admin-only** (`lead_kpi_attribution`, `meta_cloud_*`, `outbound_messages`, `report_sends/settings`, `historical_leads_import_log`), as **role-específicas** (`financial_gestor_only`, `pending_clinic_users`, `prontuario_passwords`) e as **sem `is_clinic_active`** (`consultation_types`, `external_crm_events`, `external_form_submissions`, `clinic_external_integrations`, `clinic_enc_keys`). ⚠️ **Migrar essas para `my_clinic_ids()` por cópia NÃO é seguro** — mudaria semântica ou **regrediria segurança** (ex.: `prontuario_passwords` perderia a trava de `gestor`; `clinic_enc_keys` ampliaria acesso às chaves). Migre só provando equivalência caso a caso.
- ⚠️ **`appointments_doctor_isolation` e `medical_records_doctor_isolation` foram REMOVIDAS em 27/07** (`20260727223829_fase2_fix_cross_tenant_doctor_isolation.sql`): o braço `EXISTS` sobre `clinic_users` **não correlacionava `clinic_id`** e vazava consultas/prontuários cross-tenant (medido: staff de clínica com 0 consultas enxergava 234, todas alheias). Hoje **`appointments_all` dá a agenda inteira da clínica a qualquer membro** — o "médico só vê os próprios" é **só de UI** (filtro client-side em `useSupabase.ts`), **não existe na RLS**.

  ⚠️ **E nunca existiu, apesar do nome.** Elas eram **PERMISSIVE**, e policy permissiva só **soma** acesso, nunca subtrai: rodando ao lado de `appointments_all`, jamais impediram um membro de ver a agenda de outro médico. O nome prometia isolamento; o efeito real era só o vazamento entre clínicas. Por isso removê-las **não regrediu nada** — quem procurar "a regra que existia para evitar isso" vai achar essas duas e pode concluir errado que havia proteção. **Impor de verdade exige policy `RESTRICTIVE`** (decisão de produto pendente).
- Trocar `is_clinic_active` de plpgsql para SQL **não adianta** (medido: 7%). O custo é tocar as tabelas por linha.
- **Custo de RLS pode ser GLOBAL:** embed do PostgREST (`lead:leads(*)`) **não propaga o `clinic_id`** para a tabela embutida, então a RLS dela varre o **banco inteiro**. Foi por isso que a Metaltres (3,5k) estourou antes da Intubação (8,2k).
- Antes de trocar qualquer policy, **prove equivalência**: compare a expressão velha e a nova como função de `(usuário, clínica)` num `cross join` de todos os pares, conferindo `ganharia_acesso_indevido = 0` e `perderia_acesso = 0`.

## `chat_messages` é destrutivo
`chat_messages.lead_id` é **`ON DELETE CASCADE`** — apagar um lead **apaga a conversa**. E **toda FK nova para `chat_messages` precisa de índice**, senão vira seq scan e dá timeout ao resetar lead.

## Slug de tipo de consulta não é chave
`consultation_types.slug` é **texto livre digitado pela clínica**. Use o **`id`**. Já gerou 3 bugs — incluindo liberar a exclusão de tipos com consultas futuras.

## KPI nunca nasce de array do client
O PostgREST clampa **TODA** resposta REST em `max_rows` — **inclusive quando o código pede `.limit()` maior** (qualquer `.limit()` acima do teto é cortado em silêncio). O `max_rows` do projeto é **5000** hoje (medido via REST: `Content-Range 0-4999/…`); a constante `POSTGREST_MAX_ROWS` em `useSupabase.ts` **tem que bater com ele**, senão o detector de clamp fica cego. Contar/agregar sobre um hook (`useLeads` etc.) mente em clínica grande — foi assim que o KPI do Marketing zerou com 39 leads reais no dia. **Agregação = RPC no banco** (`get_dashboard_stats`, `marketing_kpis`, `marketing_funnel_cohort`…). Lista grande = paginação com `.range()`. O helper `warnPostgrestClamp` (`useSupabase.ts`) loga na Central de Erros toda resposta que bate o teto.

## Observabilidade — a Central de Erros é o único olho que temos

**Não há Sentry.** O que não for registrado em `system_errors` **não existe**: falha em silêncio, e ninguém fica sabendo. Quase todo bug grave deste sistema foi **perda silenciosa**, não exceção barulhenta.

### 📌 REGRA: toda função nova que importa PRECISA registrar erro na Central

Vale para **edge function, RPC, trigger e cron**. "Importa" = **se falhar, alguém perde dado, dinheiro ou atendimento** — e ninguém percebe na hora.

- **Edge function:** copie o helper **`registrarErro()`** (veja `ai-agent/index.ts` ou qualquer edge existente) — chama `log_system_error`.
  A maioria das edges já tem `registrarErro`. Exemplos: `ai-agent`, `ai-agent-worker`, `ai-scheduler`, `conv-ai-analyst`, `conv-ai-learn`, `emissor-worker`, `external-crm-status`, `external-forms-ingest`, `forms-welcome-followup`, `google-spend-sync`, `meta-cloud-webhook`, `meta-creatives`, `meta-spend-sync`, `onboarding-rehost-avatars`, `reengagement-followup`, `site-script`, `site-tracking`, `wa-inbound`, `whatsapp-group`.
- **Banco:** chame **`log_system_error(scope, code, title, level, clinic_id, context, is_monitor)`**.
- **Chamada HTTP saindo do banco:** use **`system_http_post`**, nunca `net.http_post` cru — é o que permite saber **qual URL** falhou. Hoje **nenhuma** função usa o cru: **mantenha assim.**

⚠️ **Não engula o erro no `catch`.** Um `catch` que só faz `console.error` é **invisível** — o log da edge some, a Central não vê, e o bug vira "sumiu o lead".

Aparece em **Super Admin › Central de Erros** (fingerprint agregado; EVENTO conta ocorrências, CONDIÇÃO se auto-resolve).

### 📌 REGRA: erro resolvido SAI do painel

Decisão do dono (27/07). A Central mostra **só o que está aberto** — não há aba, contador nem filtro de "resolvidos". A contagem da tela **é** a fila de trabalho.

Isso é **remoção, não filtro de UI**: o trigger **`trg_system_error_arquiva_resolvido`** copia a linha para **`system_errors_archive`** e a apaga de `system_errors`. Vale para os três caminhos (botão do painel, auto-resolve do `run_system_monitors`, `update` na mão) — a invariante mora no trigger de propósito.

- **Não "restaure" a aba de resolvidos** ao mexer no `ErrorCenter.tsx`, e não troque o trigger por um `where status <> 'resolved'` na consulta: o painel voltaria a acumular.
- O histórico **não** se perde: está em `system_errors_archive` (RLS de super admin, fora do painel).
- Como o `fingerprint` volta a ficar livre, um problema que reincide entra como **episódio novo** (`first_seen_at` e contador próprios). Para CONDIÇÃO isso é o certo: ela sumiu e voltou, não é a mesma ocorrência arrastada. Para série histórica de um mesmo erro, consulte o arquivo.

---

# 3. Ambiente

## Supabase
- **project_id: `yzpclhuifquhfqpiwysh`** — o MCP **exige** esse parâmetro em toda chamada; sem ele a chamada falha.
- **Migrations:** aplicar via MCP `apply_migration` — **não rodar SQL solto** para mudança de schema.
- **Nome de migration = timestamp real** (`YYYYMMDDHHMMSS_nome.sql`, ex.: `20260722203227_...`), **nunca sequencial** (`...000004`).
  ⚠️ Sequencial **colide entre sessões paralelas**: cada uma escolhe "o próximo livre" e chega no mesmo número. Já aconteceu — há duas `20260722000004_*` no repo. O `apply_migration` grava no banco o timestamp **da hora da aplicação**, então nome sequencial também faz a ordem dos arquivos **mentir** sobre a ordem real.
- **Deploy de edge function:** Supabase CLI. O **PAT já está no `.mcp.json`** — que é **gitignored**.
  ⚠️ **Nunca** commitar o token, nem colá-lo em arquivo rastreado. Referencie a origem, não o valor.

## Type-check
**`npm run lint` é `tsc --noEmit`** — **não** é ESLint, e **não existe** script `typecheck`. (Os demais scripts estão no `package.json`.)

## Windows / PowerShell
- Mensagem de commit: **usar `git commit -F <arquivo>`**. Here-string (`@'...'@`) **quebra** com acento e aspas — já custou chamadas perdidas.
- PowerShell 5.1: **não existe `&&`/`||`**. Encadear com `;` ou `if ($?) { }`.

## ⚠️ Até 4 sessões editam este repo AO MESMO TEMPO

Você **não enxerga as outras sessões** e elas não te avisam. Trabalhe assumindo que há trabalho alheio, pela metade, na mesma árvore.

**Nunca `git add -A`, `git add .` nem `git commit -a`.** Rode `git status` e **liste no `git add` só os arquivos que ESTA sessão editou** — arquivo que você não tocou fica de fora, mesmo que pareça pronto. Já houve commit levando junto a frente de outra sessão.

O que **não** precisa de cuidado: editar arquivo. O harness recusa sobrescrever o que você não leu e avisa quando mudou no disco. **O ponto cego é o índice do git.**

⚠️ **Banco e edge function são UM só para todas as sessões** — worktree e regra nenhuma isolam isso. Antes de `apply_migration` ou de um deploy, lembre que outra sessão pode estar no mesmo objeto, **em produção com pacientes reais**.

## Fuso horário — o banco MISTURA os dois tipos
O negócio é todo em **`America/Sao_Paulo`**, mas as colunas **não são uniformes**. **Confira o tipo antes de converter** — converter duas vezes desloca em 3h e **ninguém percebe**:

| `timestamp` **sem** tz (já é SP — não converter) | `timestamptz` (converter para exibir) |
|---|---|
| `leads.created_at`, `lead_stage_history.changed_at`, **`chat_messages.created_at`** | `tickets.outcome_at`, `lead_touchpoints.occurred_at`, `attribution_inbox.occurred_at`, **`outbound_messages.created_at`** |

⚠️ **As duas metades da MESMA conversa caem em lados opostos desta tabela:** `chat_messages` é SP sem tz, `outbound_messages` é timestamptz. Numa consulta que cruza as duas, cada lado precisa da sua régua:

```sql
-- chat_messages: comparar com a hora de SP
where m.created_at > (now() at time zone 'America/Sao_Paulo') - interval '30 minutes'
-- outbound_messages: comparar com now() cru
where o.created_at > now() - interval '30 minutes'
```

Trocar isso **não dá erro**: devolve zero linha, e zero linha aqui se parece exatamente com "o sistema parou de mandar mensagem". Já custou um diagnóstico errado de fila travada em 28/07, com o sistema 100% no ar.

## Dados que parecem bug e não são
**"MedDesk Demonstrativa" é um clone anonimizado da Clínica Vaz.** Registros "duplicados" entre essas duas clínicas (inclusive `rast_id`) são **esperados** — não investigar como corrupção.
