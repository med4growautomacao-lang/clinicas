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

/** Specs das tools para o turno. `motivos` vem do catalogo DA CLINICA: o vocabulario de perda e
 *  do cliente, nao do produto (ex.: "Fora do raio" e 76/76 WakeDesk; "Nao realizamos convenio" e
 *  100% de uma clinica so). Passar a lista pelo `enum` do schema custa ~100 tokens dentro da
 *  requisicao que ja ia sair; uma tool de listagem separada custaria um turno inteiro de LLM
 *  (medido: 13.389 tokens de entrada em media, porque o historico vai junto a cada turno). */
export function agentToolSpecs(motivos: LossReasonOption[] = []): AgentTool[] {
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

  return Object.values(TOOL_DEFS).map((d) => {
    if (d.spec.name !== "ENCERRAR_COMO_PERDIDO") return d.spec;

    // ⚠️ Catalogo vazio (falha de leitura, na pratica): devolver o spec base seria mandar
    // `enum: []` COM `required: ["motivo"]`, um schema que nenhum valor satisfaz. O Gemini pode
    // recusar a requisicao inteira com 400, e ai o paciente fica sem resposta nenhuma — nao so
    // sem esta tool. Degrada para campo livre: a ai-scheduler valida no servidor de qualquer jeito.
    if (permitidos.length === 0) {
      return {
        ...d.spec,
        parameters: {
          type: "object" as const,
          properties: {
            motivo: { type: "string", description: "Motivo do encerramento, em poucas palavras." },
            detalhe: { type: "string", description: "O caso em uma frase." },
          },
        },
      };
    }

    // Clone raso: TOOL_DEFS e modulo compartilhado e nao pode ser mutado por clinica.
    return {
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
    };
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
