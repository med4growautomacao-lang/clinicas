// _shared/agent/tools.ts — registry das tools do Agente IA.
//
// Cada tool tem schema SEMANTICO (date, time, days, doctor_id, consultation_type_id,
// patient_name, appointment_id, reason) — nada de nomes posicionais $fromAI (bug #1/#3 do n8n).
// Os campos de SESSAO (clinic_id, patient_phone/lead_phone) sao INJETADOS pelo servidor e NUNCA
// expostos ao modelo (bug #4 do n8n). A execucao reusa integralmente as actions da edge
// ai-scheduler (reuso total: readable_summary/next_step/alternativas ja prontos).

import type { AgentTool, ToolCall } from "../llm.ts";

export interface SessionCtx {
  clinic_id: string;
  lead_phone: string; // = patient_phone nas tools de agenda; = lead_phone no handoff/close
  schedulerUrl: string; // URL da edge ai-scheduler
  authToken: string; // Bearer para a ai-scheduler (service role)
}

// Mapa tool -> action da ai-scheduler + como montar o corpo a partir dos args do modelo + sessao.
type ToolDef = {
  spec: AgentTool;
  action: string;
  body: (args: Record<string, unknown>, ctx: SessionCtx) => Record<string, unknown>;
};

const s = (v: unknown): string | undefined => {
  const t = (v ?? "").toString().trim();
  return t === "" ? undefined : t;
};

export const TOOL_DEFS: Record<string, ToolDef> = {
  LISTAR_TIPOS_CONSULTA: {
    action: "list_consultation_types",
    spec: {
      name: "LISTAR_TIPOS_CONSULTA",
      description:
        "Lista os tipos de consulta da clinica (com medico, modalidade, duracao, natureza e descricao). " +
        "Chame ANTES de VER_HORARIOS/MARCAR_HORARIO para obter o consultation_type_id correto. Cruze a " +
        "natureza (primeira/seguimento/retorno) com VER_HISTORICO_PACIENTE.",
      parameters: {
        type: "object",
        properties: {
          doctor_id: { type: "string", description: "Opcional: restringe a um medico especifico. Vazio = todos." },
        },
      },
    },
    body: (a, ctx) => ({ clinic_id: ctx.clinic_id, doctor_id: s(a.doctor_id) ?? null }),
  },

  VER_HORARIOS: {
    action: "get_availability",
    spec: {
      name: "VER_HORARIOS",
      description:
        "Busca horarios disponiveis. Forneca 'date' (YYYY-MM-DD) e 'consultation_type_id' (de " +
        "LISTAR_TIPOS_CONSULTA). Use 'days' para varrer varios dias (7='essa semana', 14, 30). Sem " +
        "consultation_type_id cai no tipo presencial padrao. Siga a REGRA DE OFERTA do retorno.",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string", description: "Data inicial no formato YYYY-MM-DD." },
          days: { type: "string", description: "Opcional: quantos dias varrer a partir de 'date' (padrao 1). Max 60." },
          doctor_id: { type: "string", description: "Opcional: um medico especifico. Vazio = todos." },
          consultation_type_id: { type: "string", description: "ID do tipo de consulta (de LISTAR_TIPOS_CONSULTA)." },
        },
        required: ["date"],
      },
    },
    body: (a, ctx) => ({
      clinic_id: ctx.clinic_id,
      date: s(a.date),
      days: s(a.days),
      doctor_id: s(a.doctor_id),
      consultation_type_id: s(a.consultation_type_id),
    }),
  },

  MARCAR_HORARIO: {
    action: "book_appointment",
    spec: {
      name: "MARCAR_HORARIO",
      description:
        "Marca a consulta na agenda. Use o mesmo consultation_type_id de VER_HORARIOS. Confirme ao " +
        "paciente EXATAMENTE a data/horario/medico do readable_summary da resposta (nunca um horario " +
        "que voce ofereceu antes). Em erro, siga o next_step.",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string", description: "Data no formato YYYY-MM-DD." },
          time: { type: "string", description: "Horario no formato HH:MM." },
          doctor_id: { type: "string", description: "ID do medico (de VER_HORARIOS ou LISTAR_TIPOS_CONSULTA)." },
          patient_name: { type: "string", description: "Nome COMPLETO do paciente desta conversa (ignore nomes de medico)." },
          consultation_type_id: { type: "string", description: "ID do tipo de consulta (mesmo de VER_HORARIOS). Obrigatorio." },
          notes: { type: "string", description: "Opcional: motivo/observacao relevante." },
        },
        required: ["date", "time", "doctor_id", "patient_name", "consultation_type_id"],
      },
    },
    body: (a, ctx) => ({
      clinic_id: ctx.clinic_id,
      patient_phone: ctx.lead_phone,
      date: s(a.date),
      time: s(a.time),
      doctor_id: s(a.doctor_id),
      patient_name: s(a.patient_name),
      consultation_type_id: s(a.consultation_type_id),
      notes: s(a.notes),
    }),
  },

  REAGENDAR_HORARIO: {
    action: "reschedule_appointment",
    spec: {
      name: "REAGENDAR_HORARIO",
      description:
        "MUDA data/horario de uma consulta JA EXISTENTE do paciente desta conversa. Obtenha o " +
        "appointment_id em VER_AGENDAMENTOS_PACIENTE (ou no existing_appointment de um erro de " +
        "MARCAR_HORARIO). Confirme o novo horario em VER_HORARIOS antes. Nao use para consulta nova.",
      parameters: {
        type: "object",
        properties: {
          appointment_id: { type: "string", description: "ID do agendamento a alterar (de VER_AGENDAMENTOS_PACIENTE)." },
          date: { type: "string", description: "NOVA data no formato YYYY-MM-DD." },
          time: { type: "string", description: "NOVO horario no formato HH:MM (livre em VER_HORARIOS)." },
          doctor_id: { type: "string", description: "Opcional: so se TROCAR de medico." },
          consultation_type_id: { type: "string", description: "Opcional: so se mudar o tipo de consulta." },
        },
        required: ["appointment_id", "date", "time"],
      },
    },
    body: (a, ctx) => ({
      clinic_id: ctx.clinic_id,
      patient_phone: ctx.lead_phone,
      appointment_id: s(a.appointment_id),
      date: s(a.date),
      time: s(a.time),
      doctor_id: s(a.doctor_id),
      consultation_type_id: s(a.consultation_type_id),
    }),
  },

  CANCELAR_HORARIO: {
    action: "cancel_appointment",
    spec: {
      name: "CANCELAR_HORARIO",
      description:
        "DESMARCA/CANCELA uma consulta do paciente desta conversa, SOMENTE apos ele confirmar " +
        "explicitamente. Pergunte antes se nao prefere reagendar. appointment_id vem de " +
        "VER_AGENDAMENTOS_PACIENTE. So consultas que ainda nao aconteceram.",
      parameters: {
        type: "object",
        properties: {
          appointment_id: { type: "string", description: "ID do agendamento a cancelar (de VER_AGENDAMENTOS_PACIENTE)." },
          reason: { type: "string", description: "Opcional: motivo dito pelo paciente." },
        },
        required: ["appointment_id"],
      },
    },
    body: (a, ctx) => ({
      clinic_id: ctx.clinic_id,
      patient_phone: ctx.lead_phone,
      appointment_id: s(a.appointment_id),
      reason: s(a.reason),
    }),
  },

  VER_AGENDAMENTOS_PACIENTE: {
    action: "get_patient_appointments",
    spec: {
      name: "VER_AGENDAMENTOS_PACIENTE",
      description:
        "Consulta agendamentos passados e futuros do paciente desta conversa (pelo telefone da sessao). " +
        "Use quando ele mencionar 'ja tenho consulta', 'quero remarcar', ou para pegar o appointment_id " +
        "antes de REAGENDAR/CANCELAR.",
      parameters: {
        type: "object",
        properties: {
          include_past: { type: "string", description: "Opcional: 'false' para omitir consultas passadas. Padrao inclui." },
          include_future: { type: "string", description: "Opcional: 'false' para omitir futuras. Padrao inclui." },
        },
      },
    },
    body: (a, ctx) => ({
      clinic_id: ctx.clinic_id,
      patient_phone: ctx.lead_phone,
      include_past: s(a.include_past) === "false" ? false : true,
      include_future: s(a.include_future) === "false" ? false : true,
    }),
  },

  VER_HISTORICO_PACIENTE: {
    action: "get_patient_history",
    spec: {
      name: "VER_HISTORICO_PACIENTE",
      description:
        "Diz se e a PRIMEIRA consulta (is_first_consultation), se ja tem consulta marcada e o historico " +
        "de jornadas encerradas. Use no inicio para decidir a natureza do tipo de consulta e nao " +
        "recoletar cadastro de quem ja e paciente.",
      parameters: { type: "object", properties: {} },
    },
    body: (_a, ctx) => ({ clinic_id: ctx.clinic_id, patient_phone: ctx.lead_phone }),
  },

  ACIONAR_HANDOFF: {
    action: "trigger_handoff",
    spec: {
      name: "ACIONAR_HANDOFF",
      description:
        "Aciona o transbordo para atendimento humano quando o paciente menciona uma palavra-chave " +
        "configurada. A tool pausa a IA, avisa a equipe e envia despedida se configurado. Leia o " +
        "next_step da resposta e siga literalmente.",
      parameters: {
        type: "object",
        properties: {
          trigger_keyword: { type: "string", description: "A palavra-chave detectada na fala do paciente." },
        },
        required: ["trigger_keyword"],
      },
    },
    body: (a, ctx) => ({ clinic_id: ctx.clinic_id, lead_phone: ctx.lead_phone, trigger_keyword: s(a.trigger_keyword) }),
  },

  SOLICITAR_LINK_CARTAO: {
    action: "request_card_link",
    spec: {
      name: "SOLICITAR_LINK_CARTAO",
      description:
        "Avisa a equipe que este paciente quer pagar no CARTAO e precisa receber o link de pagamento. " +
        "Use no momento em que ele pedir o link ou escolher cartao. Voce NUNCA envia link de pagamento " +
        "nem informa valor com taxa: quem envia e a equipe. A IA continua a conversa normalmente; " +
        "leia o next_step da resposta e siga literalmente.",
      parameters: {
        type: "object",
        properties: {
          detail: { type: "string", description: "Opcional: o que o paciente pediu (valor, parcelamento, urgencia)." },
        },
      },
    },
    body: (a, ctx) => ({ clinic_id: ctx.clinic_id, lead_phone: ctx.lead_phone, detail: s(a.detail) }),
  },

  // Nome antigo ate 10/08/2026: ENCERRAR_FORA_PERFIL. A tool nasceu so para desqualificacao
  // estrutural, mas hoje encerra por QUALQUER motivo do catalogo (preco, desinteresse,
  // concorrente...), entao o nome velho descrevia errado o que ela faz e induzia o modelo a nao
  // usa-la. `action` segue close_as_lost de proposito: e o nome interno, ja neutro, e e ele que
  // compoe o fingerprint da Central (ferramenta_quebrou_close_as_lost).
  ENCERRAR_COMO_PERDIDO: {
    action: "close_as_lost",
    spec: {
      name: "ENCERRAR_COMO_PERDIDO",
      // "negocio"/"empresa" e nao "clinica": boa parte dos tenants e loja, metalurgica, cafe ou
      // joalheria, e esta description e a UNICA superficie que chega a 100% deles (so 4 de 34
      // clinicas tem prompt template, todas medicas).
      description:
        "Encerra o atendimento como PERDIDO. Escolha em `motivo` UM item da lista, o que melhor " +
        "descreve por que este contato nao vai fechar. Depois despeca-se com gentileza e NAO " +
        "ofereca agendamento. Siga o next_step.",
      parameters: {
        type: "object",
        properties: {
          // O `enum` e injetado por agentToolSpecs() a partir do catalogo da clinica.
          motivo: { type: "string", description: "Obrigatorio: escolha UM da lista.", enum: [] },
          detalhe: {
            type: "string",
            description:
              "O caso em uma frase (ex.: 'procura cirurgia de protese testicular'). " +
              "OBRIGATORIO quando motivo = 'outro'.",
          },
        },
        required: ["motivo"],
      },
    },
    body: (a, ctx) => ({
      clinic_id: ctx.clinic_id,
      lead_phone: ctx.lead_phone,
      motivo: s(a.motivo),
      detalhe: s(a.detalhe),
    }),
  },

  // Tool do SDR: encerra o PRE-atendimento e entrega o contato ao vendedor humano.
  //
  // ⚠️ So aparece para a clinica cujo Prompt Fixo e do tipo SDR (`prompt_templates.focus='sdr'`,
  // ver clinicaEmModoSdr) E que tenha pelo menos uma etapa elegivel. Sem isso, agentToolSpecs() a
  // OMITE do spec: sem esse gate, o agente de uma clinica medica poderia "transferir" por conta
  // propria e pausar a IA de um paciente que so queria marcar consulta.
  //
  // ⚠️ O `enum` de `etapa` NUNCA inclui etapa de desfecho (ganho/perdido/entregue/faltou_cancelou).
  // Mover para 'ganho' faz o trigger fn_enforce_ticket_resolution_consistency gravar
  // tickets.outcome='ganho' + outcome_at SOZINHO — ou seja, uma alucinacao do modelo viraria
  // faturamento nos paineis. O bloqueio e repetido no servidor (a ai-scheduler nao confia no enum).
  TRANSFERIR_PARA_ESPECIALISTA: {
    action: "transfer_to_specialist",
    spec: {
      name: "TRANSFERIR_PARA_ESPECIALISTA",
      // "cliente"/"negocio" e nao "paciente"/"clinica": boa parte dos tenants e loja, metalurgica
      // ou cafe, e esta description chega igual a todos eles.
      description:
        "Encerra o SEU atendimento e entrega o cliente ao especialista humano, movendo o card para " +
        "a etapa indicada. Use SOMENTE quando ja tiver coletado TODOS os dados que o seu prompt " +
        "manda coletar. Depois de chamar, avise o cliente que os dados foram passados ao " +
        "especialista e NAO continue a conversa: voce fica em silencio para este contato.",
      parameters: {
        type: "object",
        properties: {
          // O `enum` e injetado por agentToolSpecs() a partir das etapas DA CLINICA.
          etapa: { type: "string", description: "Obrigatorio: escolha UMA da lista.", enum: [] },
          resumo: {
            type: "string",
            // Sem exemplo de ramo aqui: esta description e COMPARTILHADA por todos os tenants
            // (loja, metalurgica, cafe, clinica), e exemplo de um ramo so enviesa os outros. O
            // formato concreto do resumo e a camada da empresa que define, no prompt dela.
            description:
              "Obrigatorio: os dados que voce coletou, em UMA linha, na ordem que a empresa pede, " +
              "do jeito que o especialista precisa ler para trabalhar. Este texto vai direto para " +
              "a equipe: sem saudacao, sem enrolacao, so os dados. Dado que faltou vai como " +
              "'nao informado', nunca chutado.",
          },
          // ⚠️ Par campo/valor, e NAO um objeto de chaves fixas. Esta tool e compartilhada por
          // todos os tenants de SDR: "malha" e "fio" so existem para quem vende tela, "metragem"
          // so para quem vende piso. Cada empresa diz no prompt dela quais campos mandar, e a tela
          // mostra o que vier. O `resumo` continua obrigatorio e serve de rede: se o modelo nao
          // montar a lista, a equipe ainda recebe a linha.
          dados: {
            type: "array",
            description:
              "Os MESMOS dados do resumo, agora separados campo a campo, para a tela do orcamento " +
              "mostrar em vez de o vendedor ter que ler um paragrafo. Um item por dado, usando os " +
              "nomes de campo que a empresa pedir. Inclua so o que a pessoa informou de verdade: " +
              "dado que faltou fica FORA da lista, nao entre com 'nao informado'.",
            items: {
              type: "object",
              properties: {
                campo: { type: "string", description: "Nome do dado, como a empresa chama (ex.: Altura)." },
                valor: { type: "string", description: "O que a pessoa informou, com a unidade (ex.: 1,80 m)." },
              },
              required: ["campo", "valor"],
            },
          },
        },
        required: ["etapa", "resumo"],
      },
    },
    body: (a, ctx) => ({
      clinic_id: ctx.clinic_id,
      lead_phone: ctx.lead_phone,
      etapa: s(a.etapa),
      resumo: s(a.resumo),
      // Mesma funcao que a ai-scheduler chama antes de gravar. Higienizar nos dois pontos e
      // deliberado (a acao tambem e alcancavel por outros caminhos), mas com UMA regra so.
      dados: sanitizarDadosPreAtendimento(a.dados),
    }),
  },
};

/** Um motivo de perda do catalogo da clinica (vem de fn_clinic_loss_reasons). */
export interface LossReasonOption {
  slug: string;
  label: string;
  descricao: string;
  ia_pode_escolher: boolean;
}

/** Catalogo de motivos DA CLINICA.
 *
 *  ⚠️ Devolve `erro` separado da lista de proposito. Antes engolia tudo num `[]`, e ai "catalogo
 *  vazio" e "a leitura falhou" viravam a MESMA coisa: o alerta acusava a clinica de nao ter motivo
 *  cadastrado quando o problema era timeout ou permissao, e mandava o operador consertar um
 *  cadastro que ja estava certo (§0.7: desligado x falta configuracao x defeito de codigo). */
export async function carregarMotivosPerda(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  clinicId: string,
): Promise<{ lista: LossReasonOption[]; erro: string | null }> {
  try {
    const { data, error } = await supabase.rpc("fn_clinic_loss_reasons", { p_clinic_id: clinicId });
    if (error) return { lista: [], erro: error.message ?? String(error) };
    if (!Array.isArray(data)) return { lista: [], erro: "catalogo devolveu formato inesperado" };
    return { lista: data as LossReasonOption[], erro: null };
  } catch (e) {
    return { lista: [], erro: String((e as Error)?.message ?? e) };
  }
}

/** Uma etapa do funil elegivel como destino da TRANSFERIR_PARA_ESPECIALISTA. */
export interface EtapaTransferencia {
  id: string;
  name: string;
  slug: string | null;
}

/** Etapas que a transferencia NUNCA pode ter como destino. Sao TRES familias, por tres motivos
 *  diferentes, e a lista de slug sozinha so cobria a primeira:
 *
 *  1. DESFECHO (ganho/perdido/entregue/faltou_cancelou): mover para la GRAVA venda ou perda, por
 *     `fn_enforce_ticket_resolution_consistency`. Vira faturamento em painel sem ninguem aprovar.
 *     Quem encerra como perda e a ENCERRAR_COMO_PERDIDO, com motivo do catalogo da clinica.
 *  2. KPI (agendado/compareceu): `v_kpi_scheduled` conta como "Agendado" QUALQUER entrada em etapa
 *     de slug 'agendado', em todas as clinicas e sem gate nenhum — e as 28 clinicas ativas tem essa
 *     etapa. Um transbordo ali infla o indicador de agendamento na hora, sem consulta nenhuma.
 *  3. CONVERSAO (`is_conversion`, checada a parte porque nao e slug): a trigger
 *     `trg_enqueue_meta_capi_event` enfileira evento para a Meta olhando SO essa coluna, sem ler
 *     slug. E a regua que o resto da casa ja usa (conv-ai-mine e conv-ai-analyst nunca miram
 *     etapa de conversao). Duas clinicas hoje tem etapa de conversao com slug fora da lista acima.
 *
 *  ⚠️ Repetida no servidor (ai-scheduler) de proposito: o enum e dica ao provedor, nao trava. */
export const ETAPAS_BLOQUEADAS: readonly string[] = [
  "ganho", "perdido", "entregue", "faltou_cancelou", "agendado", "compareceu",
];

/** A IA pode mandar um card para esta etapa? FONTE UNICA da regra, para os TRES caminhos em que a
 *  IA mexe em etapa (a tool de transferencia, o transbordo e o casador de palavra-chave). Antes a
 *  regra estava escrita em dois lugares e faltava no terceiro, que e como um deles fica para tras.
 *
 *  ⚠️ `is_conversion` NAO e slug e por isso nao cabia na lista acima: e a coluna que a trigger do
 *  Meta CAPI le, sozinha, sem olhar slug. */
// deno-lint-ignore no-explicit-any
export function etapaProibida(etapa: any): boolean {
  if (!etapa) return true; // sem conseguir olhar a etapa, nao move: fail-closed
  return ETAPAS_BLOQUEADAS.includes(String(etapa.slug ?? "")) || etapa.is_conversion === true;
}

/** Minuscula, sem acento e com espaco normalizado. Comparacao de texto digitado por gente.
 *
 *  U+0300..U+036F sao as marcas de acento que o NFD solta do caractere. Montado por RegExp com
 *  string escapada de proposito: caractere combinante cru dentro de um literal /.../ e invisivel no
 *  editor e desaparece num diff, entao quebraria sem ninguem ver — o que ja acontece em outra copia
 *  desta mesma funcao no projeto (conv-ai-mine). Mora aqui para as proximas nascerem certas. */
const ACENTOS_COMBINANTES = new RegExp("[\\u0300-\\u036f]", "g");
export function normalizarTexto(v: unknown): string {
  return String(v ?? "").normalize("NFD").replace(ACENTOS_COMBINANTES, "")
    .toLowerCase().replace(/\s+/g, " ").trim();
}

/** Teto de campos numa transferencia. Nao e limite de negocio, e limite de tela: o vendedor le a
 *  ficha de relance, e lista maior que isso vira rolagem que ninguem confere. */
export const MAX_CAMPOS_PRE_ATENDIMENTO = 15;

export interface CampoPreAtendimento {
  campo: string;
  valor: string;
}

/** FONTE UNICA da limpeza dos campos coletados no pre-atendimento, usada aqui (ao montar a chamada)
 *  E na ai-scheduler (antes de gravar no ticket).
 *
 *  ⚠️ Existia em duas copias NAO equivalentes: esta e um filtro fraco no servidor, que so olhava
 *  se o valor era truthy. Duas copias da mesma regra e como o teto sobe num lado e continua
 *  cortando no outro — e como o servidor passa a parecer que valida sem validar forma nenhuma.
 *
 *  Converte para texto de proposito: o que sai daqui vai direto para a tela do vendedor, e valor
 *  que nao for string quebra o render inteiro (modal em branco). */
export function sanitizarDadosPreAtendimento(v: unknown): CampoPreAtendimento[] {
  if (!Array.isArray(v)) return [];
  return (v as unknown[])
    .map((d) => {
      const o = (d ?? {}) as Record<string, unknown>;
      // O modelo as vezes devolve item pela metade, e um {campo:"Altura"} sem valor viraria
      // uma linha vazia na ficha.
      return { campo: s(o.campo) ?? "", valor: s(o.valor) ?? "" };
    })
    .filter((d) => d.campo !== "" && d.valor !== "")
    .slice(0, MAX_CAMPOS_PRE_ATENDIMENTO);
}

/** A CHAVE do modo SDR e o TIPO do Prompt Fixo que a clinica usa (`prompt_templates.focus='sdr'`,
 *  exposto como `template_focus` em v_clinic_ai_prompt), escolhido no Super Admin › Prompts Fixos
 *  no campo "Tipo", que ja nascia com SDR na lista.
 *
 *  ⚠️ Amarrar a tool ao MODELO DE PROMPT em vez de a uma flag separada e o que impede os dois de
 *  divergirem. Com duas chaves independentes existiam dois estados quebrados e silenciosos:
 *  prompt de SDR sem a tool (o agente promete transferir e nao consegue) e tool sem prompt de SDR
 *  (o modelo ganha um poder que ninguem explicou quando usar). Escolher o modelo SDR liga as duas
 *  pontas de uma vez; trocar de modelo desliga as duas.
 *
 *  Normaliza caixa e espaco porque o campo aceita valor digitado a mao ("Outro (personalizado)").
 *  Valor customizado diferente de 'sdr' NAO liga, de proposito: a regra tem que ser exata, senao
 *  vira adivinhacao de texto livre — o mesmo defeito de `consultation_types.slug`. */
export const FOCUS_SDR = "sdr";

/** A clinica opera em modo SDR? FONTE UNICA do gate, usada pelo worker (para decidir se a tool
 *  entra no spec) E pela ai-scheduler (que revalida antes de executar). Duas copias da mesma regra
 *  e como elas passam a divergir, e aqui divergir significa "a tool aparece mas recusa" ou o
 *  contrario.
 *
 *  ⚠️ Le `template_focus` da MESMA view que monta o prompt (`v_clinic_ai_prompt`), e nao as tabelas
 *  cruas. Isso nao e economia de consulta, e correcao: a view faz LEFT JOIN em prompt_templates SEM
 *  filtrar `is_active`. Ler `is_active` aqui criava o estado que este desenho existe para impedir —
 *  desativar o modelo na tela TIRAVA a tool e MANTINHA o prompt de SDR rodando, ou seja, o agente
 *  seguia prometendo transferir sem conseguir. Enquanto o gate e o prompt lerem a mesma fonte, os
 *  dois ligam e desligam juntos por construcao. Se um dia a view passar a filtrar `is_active`, o
 *  gate acompanha sozinho.
 *
 *  Fail-CLOSED com erro separado: `erro` preenchido significa "nao consegui saber", nao "esta
 *  desligado", e quem chama registra na Central e NAO trata como recusa de negocio. */
export async function clinicaEmModoSdr(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  clinicId: string,
): Promise<{ sdr: boolean; erro: string | null }> {
  const { data, error } = await supabase
    .from("v_clinic_ai_prompt").select("template_focus").eq("clinic_id", clinicId).maybeSingle();
  if (error) return { sdr: false, erro: error.message ?? String(error) };
  // Sem Prompt Fixo vinculado, template_focus vem NULL (o LEFT JOIN da view) e nao e SDR.
  return { sdr: String((data as any)?.template_focus ?? "").trim().toLowerCase() === FOCUS_SDR, erro: null };
}

/** Etapas para as quais o SDR pode transferir.
 *
 *  Como o `carregarMotivosPerda`, separa `erro` de "lista vazia": falha de leitura e cadastro vazio
 *  tem causas e donos diferentes, e confundi-los manda o operador consertar o que ja esta certo. */
export async function carregarEtapasTransferencia(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  clinicId: string,
  /** `template_focus` JA LIDO pelo chamador (o worker o recebe junto do prompt, da mesma view e da
   *  mesma linha). Passando-o, esta funcao NAO repete a consulta: sao 34 tenants por turno, e 33
   *  deles nem sao SDR. `undefined` = nao foi lido, entao busca aqui. */
  focusJaLido?: string | null,
): Promise<{ lista: EtapaTransferencia[]; erro: string | null; erroDe: "gate" | "funil" | null; ativo: boolean }> {
  try {
    // Falha de LEITURA sai com `ativo: true` para o worker registrar na Central. Se saisse false,
    // uma clinica em modo SDR perderia a transferencia em silencio (a tool some do turno) e o
    // sintoma seria "a IA parou de passar para o vendedor", sem nenhum erro em lugar nenhum.
    //
    // `erroDe` diz QUAL leitura falhou. Sem isso, falha ao ler o modelo de prompt saia com a
    // mensagem do funil, e o operador ia consertar a coluna errada do problema errado.
    let sdr: boolean;
    if (focusJaLido !== undefined) {
      sdr = String(focusJaLido ?? "").trim().toLowerCase() === FOCUS_SDR;
    } else {
      const modo = await clinicaEmModoSdr(supabase, clinicId);
      if (modo.erro) return { lista: [], erro: modo.erro, erroDe: "gate", ativo: true };
      sdr = modo.sdr;
    }
    if (!sdr) return { lista: [], erro: null, erroDe: null, ativo: false };

    const { data, error } = await supabase
      .from("funnel_stages").select("id, name, slug, position, is_hidden, is_conversion")
      .eq("clinic_id", clinicId).order("position", { ascending: true });
    if (error) return { lista: [], erro: error.message ?? String(error), erroDe: "funil", ativo: true };

    const lista = (data ?? [])
      .filter((e: any) => e?.id && e?.name && e.is_hidden !== true)
      .filter((e: any) => !etapaProibida(e))
      .map((e: any) => ({ id: e.id, name: String(e.name), slug: e.slug ?? null }));
    return { lista, erro: null, erroDe: null, ativo: true };
  } catch (e) {
    // `ativo: true` de proposito: aqui a leitura QUEBROU, e nao se sabe se a clinica usa o SDR.
    // Devolver false esconderia a falha do worker, que so registra na Central quando `ativo`.
    // Entre alertar a toa e perder um defeito calado, a casa escolhe alertar (§0.5).
    return { lista: [], erro: String((e as Error)?.message ?? e), erroDe: null, ativo: true };
  }
}

/** Specs das tools para o turno. `motivos` vem do catalogo DA CLINICA: o vocabulario de perda e
 *  do cliente, nao do produto (ex.: "Fora do raio" e 76/76 WakeDesk; "Nao realizamos convenio" e
 *  100% de uma clinica so). Passar a lista pelo `enum` do schema custa ~100 tokens dentro da
 *  requisicao que ja ia sair; uma tool de listagem separada custaria um turno inteiro de LLM
 *  (medido: 13.389 tokens de entrada em media, porque o historico vai junto a cada turno).
 *
 *  `etapas` segue a mesma logica e ainda decide se a TRANSFERIR_PARA_ESPECIALISTA existe no turno:
 *  lista vazia = tool OMITIDA (clinica fora do modo SDR ou sem etapa elegivel). */
export function agentToolSpecs(
  motivos: LossReasonOption[] = [],
  etapas: EtapaTransferencia[] = [],
): AgentTool[] {
  const permitidos = motivos.filter((m) => m.ia_pode_escolher);
  const temSlug = (s: string) => permitidos.some((m) => m.slug === s);

  // Regra de desempate montada a partir do que REALMENTE esta no enum. Citar um slug que a clinica
  // desligou (clinic_loss_reasons) ou que a marca dela nao tem (categorias) manda o modelo escolher
  // um valor inexistente, que cai no fallback e ainda acende alerta acusando o modelo.
  const desempate = [
    temSlug("perfil_nao_atendido") && temSlug("servico_nao_oferecido")
      ? "se a empresa oferece o servico mas nao para essa pessoa, use perfil_nao_atendido; se nao oferece a ninguem, use servico_nao_oferecido"
      : null,
    temSlug("atendido_em_outra_unidade") ? "se oferece em outro lugar, use atendido_em_outra_unidade" : null,
  ].filter(Boolean).join("; ");

  return Object.values(TOOL_DEFS).flatMap((d) => {
    if (d.spec.name === "TRANSFERIR_PARA_ESPECIALISTA") {
      // Sem etapa elegivel a tool nao existe neste turno. Mandar `enum: []` COM `required` seria um
      // schema que nenhum valor satisfaz, e o Gemini responde 400 a requisicao INTEIRA — o paciente
      // ficaria sem resposta nenhuma, nao so sem esta tool (mesma armadilha do catalogo de motivos).
      if (etapas.length === 0) return [];
      return [{
        ...d.spec,
        parameters: {
          ...d.spec.parameters,
          properties: {
            ...d.spec.parameters.properties,
            etapa: {
              type: "string",
              // Valor do enum = NOME da etapa (o que o dono ve no Kanban), nao o slug: etapa criada
              // pela tela nasce com slug NULL, entao slug nao serve como chave universal aqui.
              enum: etapas.map((e) => e.name),
              description: "Obrigatorio: a etapa para onde mover o card. Escolha UMA da lista.",
            },
          },
        },
      }];
    }
    if (d.spec.name !== "ENCERRAR_COMO_PERDIDO") return [d.spec];

    // ⚠️ Catalogo vazio (falha de leitura, na pratica): devolver o spec base seria mandar
    // `enum: []` COM `required: ["motivo"]`, um schema que nenhum valor satisfaz. O Gemini pode
    // recusar a requisicao inteira com 400, e ai o paciente fica sem resposta nenhuma — nao so
    // sem esta tool. Degrada para campo livre: a ai-scheduler valida no servidor de qualquer jeito.
    if (permitidos.length === 0) {
      return [{
        ...d.spec,
        parameters: {
          type: "object" as const,
          properties: {
            motivo: { type: "string", description: "Motivo do encerramento, em poucas palavras." },
            detalhe: { type: "string", description: "O caso em uma frase." },
          },
        },
      }];
    }

    // Clone raso: TOOL_DEFS e modulo compartilhado e nao pode ser mutado por clinica.
    return [{
      ...d.spec,
      parameters: {
        ...d.spec.parameters,
        properties: {
          ...d.spec.parameters.properties,
          motivo: {
            type: "string",
            enum: permitidos.map((m) => m.slug),
            description:
              "Obrigatorio: escolha UM." +
              (desempate ? ` Regra de desempate: ${desempate}.` : "") +
              "\n" + permitidos.map((m) => `- ${m.slug}: ${m.descricao}`).join("\n"),
          },
        },
      },
    }];
  });
}

/** Executa uma tool call do modelo contra a ai-scheduler. Devolve a resposta (JSON string) que
 *  volta pro modelo. Nunca lanca: erro de rede vira um resultado que o modelo consegue tratar. */
export async function executeToolCall(call: ToolCall, ctx: SessionCtx): Promise<string> {
  const def = TOOL_DEFS[call.name];
  if (!def) return JSON.stringify({ success: false, error: `Tool desconhecida: ${call.name}` });
  const payload = { action: def.action, ...def.body(call.args || {}, ctx) };
  try {
    const resp = await fetch(ctx.schedulerUrl, {
      method: "POST",
      signal: AbortSignal.timeout(45000),
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${ctx.authToken}` },
      body: JSON.stringify(payload),
    });
    const text = await resp.text();
    // A ai-scheduler devolve 200 com {success:false,...} para erros de negocio (a IA sabe tratar).
    // 5xx (ferramenta quebrou) tambem vem com corpo; repassamos para o modelo pedir desculpas.
    return text;
  } catch (e) {
    return JSON.stringify({
      success: false, error_code: "tool_network_error",
      error: `Falha ao chamar a ferramenta ${call.name}: ${String(e)}`,
      next_step: "Peca desculpas pelo imprevisto e, se persistir, acione o atendimento humano (ACIONAR_HANDOFF).",
    });
  }
}
