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

  ENCERRAR_FORA_PERFIL: {
    action: "close_as_lost",
    spec: {
      name: "ENCERRAR_FORA_PERFIL",
      description:
        "Encerra o atendimento como PERDIDO quando o caso esta fora do perfil da clinica (ex.: pede algo " +
        "que a clinica nao atende). Depois, despeca-se com gentileza e NAO ofereca agendamento. Siga o next_step.",
      parameters: {
        type: "object",
        properties: {
          detail: { type: "string", description: "Opcional: breve motivo do fora-de-perfil." },
        },
      },
    },
    body: (a, ctx) => ({ clinic_id: ctx.clinic_id, lead_phone: ctx.lead_phone, detail: s(a.detail) }),
  },
};

export function agentToolSpecs(): AgentTool[] {
  return Object.values(TOOL_DEFS).map((d) => d.spec);
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
