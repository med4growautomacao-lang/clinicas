// _shared/agent/guard.ts — trava de saida do Agente IA.
//
// O retorno de tool NUNCA vira resposta por construcao (o worker so envia turno sem tool_calls).
// A brecha que sobra e outra: as vezes o modelo ESCREVE a chamada em vez de EXECUTA-LA — devolve
// {"name":"MARCAR_HORARIO","args":{...}}, um bloco ```json ou <tool_call> como TEXTO. Ai toolCalls
// vem vazio, aquilo vira a resposta final e iria picotado pro paciente (e pro TTS, e pro painel).
// Era o que acontecia no n8n. Aqui: (1) tira o artefato; (2) diz se o que sobrou ainda e tecnico.

const TOOL_NAMES = [
  "LISTAR_TIPOS_CONSULTA", "VER_HORARIOS", "MARCAR_HORARIO", "REAGENDAR_HORARIO", "CANCELAR_HORARIO",
  "VER_AGENDAMENTOS_PACIENTE", "VER_HISTORICO_PACIENTE", "ACIONAR_HANDOFF", "ENCERRAR_FORA_PERFIL",
];

// Chaves que so aparecem em payload de ferramenta/retorno, nunca numa frase pro paciente.
const CHAVES_TECNICAS =
  /"(name|args|arguments|parameters|tool|tool_name|tool_call|function|functionCall|action|success|error|slots|available_slots|appointment_id|doctor_id|consultation_type_id|clinic_id|patient_phone)"\s*:/i;

const TAGS_TECNICAS =
  /<\/?(thinking|tool_call|tool_use|function_call|invoke|parameter|antml:[a-z_]+)[^>]*>/gi;

// Fim do bloco balanceado que comeca em `ini` ({ ou [), respeitando string e escape. -1 se nao fecha.
function fimBalanceado(s: string, ini: number): number {
  const abre = s[ini];
  const fecha = abre === "{" ? "}" : "]";
  let depth = 0, inStr = false, esc = false;
  for (let i = ini; i < s.length; i++) {
    const ch = s[i];
    if (esc) { esc = false; continue; }
    if (ch === "\\") { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === abre) depth++;
    else if (ch === fecha) { depth--; if (depth === 0) return i; }
  }
  return -1;
}

function blocoEhTecnico(bloco: string): boolean {
  return CHAVES_TECNICAS.test(bloco) || TOOL_NAMES.some((n) => bloco.includes(n));
}

// Remove os blocos {..}/[..] que sao payload tecnico, preservando o resto da frase. Um "{" solto
// numa frase normal nao fecha balanceado (ou nao tem chave tecnica) e por isso NAO e removido.
function tiraBlocosTecnicos(texto: string): string {
  let out = "";
  let i = 0;
  while (i < texto.length) {
    const ch = texto[i];
    if (ch === "{" || ch === "[") {
      const fim = fimBalanceado(texto, i);
      if (fim > i && blocoEhTecnico(texto.slice(i, fim + 1))) { i = fim + 1; continue; }
    }
    out += ch;
    i++;
  }
  return out;
}

// Tira o que for artefato tecnico e devolve so o que da pra mandar pro paciente.
export function sanitizeForPatient(texto: string): string {
  if (!texto) return "";
  let t = texto;
  t = t.replace(/```[\s\S]*?```/g, " ");  // bloco de codigo inteiro (com cerca fechada)
  t = t.replace(/```[a-z]*\s*/gi, " ");   // cerca orfa (o modelo abriu e nao fechou)
  t = t.replace(TAGS_TECNICAS, " ");
  t = tiraBlocosTecnicos(t);
  return t.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

// Depois de limpar, o que sobrou ainda cheira a tecnico? Sinais PRECISOS de proposito: um falso
// positivo aqui deixa o paciente sem resposta, entao nada de heuristica frouxa.
export function looksTechnical(texto: string): boolean {
  const t = (texto || "").trim();
  if (!t) return true;
  if (t.startsWith("{") || t.startsWith("[")) return true;
  if (TOOL_NAMES.some((n) => t.includes(n))) return true;
  if (CHAVES_TECNICAS.test(t)) return true;
  if (/<\/?(tool_call|tool_use|function_call|invoke|antml:)/i.test(t)) return true;
  if (/```/.test(t)) return true;
  return false;
}

// Instrucao do turno de reparo: uma chance de reescrever em linguagem de gente.
export const REPAIR_INSTRUCTION =
  "Sua ultima resposta saiu em formato tecnico (JSON, nome de ferramenta ou bloco de codigo) e NAO " +
  "pode ser enviada ao paciente. Reescreva agora APENAS a mensagem final para o paciente, em " +
  "portugues natural, sem JSON, sem nome de ferramenta, sem bloco de codigo e sem explicar o que " +
  "voce fez internamente. Se as ferramentas ja trouxeram o que precisava, apenas comunique o " +
  "resultado ao paciente com naturalidade.";
