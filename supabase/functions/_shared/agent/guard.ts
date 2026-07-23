// _shared/agent/guard.ts — trava de saida do Agente IA.
//
// O retorno de tool NUNCA vira resposta por construcao (o worker so envia turno sem tool_calls).
// A brecha que sobra e outra: as vezes o modelo ESCREVE a chamada em vez de EXECUTA-LA — devolve
// {"name":"MARCAR_HORARIO","args":{...}}, um bloco ```json ou <tool_call> como TEXTO. Ai toolCalls
// vem vazio, aquilo vira a resposta final e iria picotado pro paciente (e pro TTS, e pro painel).
// Era o que acontecia no n8n. Aqui: (1) tira o artefato; (2) diz se o que sobrou ainda e tecnico.
//
// ⚠️ INVARIANTE: tudo que a limpeza sabe REMOVER, a deteccao precisa saber RECONHECER. O worker so
// chama a limpeza quando a deteccao acusa, entao qualquer coisa que esteja numa e nao na outra
// vaza calada — foi assim que <thinking> chegou a passar. Por isso cada lista abaixo tem UMA
// fonte, e nome de tool/argumento sai do proprio registry em vez de ser redigitado aqui.

import { TOOL_DEFS } from "./tools.ts";

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Do registry, nao da memoria: lista manual envelhece calada (tool nova ou argumento novo deixaria
// de ser detectado, e detectar de menos aqui significa JSON no WhatsApp do paciente).
const TOOL_NAMES = Object.keys(TOOL_DEFS);
const ARGS_TOOLS = [
  ...new Set(
    Object.values(TOOL_DEFS).flatMap((d) =>
      Object.keys((d.spec.parameters as { properties?: Record<string, unknown> })?.properties ?? {})
    ),
  ),
];

// Chaves que so aparecem em payload de ferramenta/retorno, nunca numa frase pro paciente. Os
// ARGS_TOOLS entram porque o modelo as vezes escreve SO os argumentos, sem a chave "name" em volta
// (ex.: {"date":"2026-07-25","time":"14:00"}), e sem eles esse payload passava direto.
const CHAVES_BASE = [
  "name", "args", "arguments", "parameters", "tool", "tool_name", "tool_call", "function",
  "functionCall", "action", "success", "error", "slots", "available_slots", "clinic_id",
  "patient_phone",
];
const CHAVES_TECNICAS = new RegExp(`"(${[...CHAVES_BASE, ...ARGS_TOOLS].map(esc).join("|")})"\\s*:`, "i");

// Fragmentos de REGEX (o ultimo traz classe de caractere), por isso NAO passam por esc().
// Uma fonte so para as duas pontas do invariante: TAGS_TECNICAS remove, TAG_TECNICA detecta.
const TAGS_NOMES = [
  "thinking", "tool_call", "tool_use", "function_call", "invoke", "parameter", "antml:[a-z_]+",
];
const TAGS_TECNICAS = new RegExp(`</?(${TAGS_NOMES.join("|")})[^>]*>`, "gi");
const TAG_TECNICA = new RegExp(`</?(${TAGS_NOMES.join("|")})`, "i");
// Elemento INTEIRO: abertura + CONTEUDO + fechamento. Tirar so os marcadores deixaria o
// raciocinio interno solto no meio da frase ("<thinking>o paciente quer terca</thinking> Oi!"
// viraria "o paciente quer terca Oi!"), e o vazamento e justamente o conteudo, nao a tag.
const ELEMENTOS_TECNICOS = new RegExp(`<(${TAGS_NOMES.join("|")})\\b[^>]*>[\\s\\S]*?</\\1[^>]*>`, "gi");

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

// A partir de `i` (um "{" ou "["), o proximo caractere nao-branco abre JSON de verdade?
// '{"' e '[{' e '["' abrem; '[[' NAO abre — e bloco protegido do split.ts, texto legitimo.
function aberturaJson(t: string, i: number): boolean {
  let j = i + 1;
  while (j < t.length && (t[j] === " " || t[j] === "\n" || t[j] === "\r" || t[j] === "\t")) j++;
  return j < t.length && (t[j] === '"' || t[j] === "{");
}

// Caminhada UNICA pelos blocos {..}/[..], em ordem, sem reexaminar o que ja foi medido: bloco
// fechado e pulado inteiro. `fim` vem -1 quando o bloco nao fecha. Quem remove (tiraBlocosTecnicos)
// e quem detecta bloco aberto (temJsonAberto) consomem daqui, entao "o que e um bloco" mora num
// lugar so e nenhum dos dois re-escaneia o interior do outro.
function* blocos(t: string): Generator<{ ini: number; fim: number }> {
  let i = 0;
  while (i < t.length) {
    const ch = t[i];
    if (ch !== "{" && ch !== "[") { i++; continue; }
    const fim = fimBalanceado(t, i);
    yield { ini: i, fim };
    i = fim === -1 ? i + 1 : fim + 1;
  }
}

function blocoEhTecnico(bloco: string): boolean {
  return CHAVES_TECNICAS.test(bloco) || TOOL_NAMES.some((n) => bloco.includes(n));
}

// Remove os blocos {..}/[..] que sao payload tecnico, preservando o resto da frase. Um "{" solto
// numa frase normal nao fecha balanceado (ou nao tem chave tecnica) e por isso NAO e removido.
// Bloco aberto tambem fica: nao da pra recortar com seguranca — quem barra esse caso e o
// looksTechnical, via temJsonAberto.
function tiraBlocosTecnicos(texto: string): string {
  let out = "";
  let cursor = 0;
  for (const { ini, fim } of blocos(texto)) {
    if (fim === -1) continue;
    if (!blocoEhTecnico(texto.slice(ini, fim + 1))) continue;
    out += texto.slice(cursor, ini);
    cursor = fim + 1;
  }
  return out + texto.slice(cursor);
}

// Bloco JSON que ABRE e nao fecha. E o vazamento mais insidioso: o modelo estourou o teto de
// tokens no meio da chamada escrita como texto, o bloco fica desbalanceado e por isso
// tiraBlocosTecnicos nao consegue tirar. Se ainda por cima nao tiver nome de tool nem chave
// conhecida, passaria direto pro paciente.
function temJsonAberto(t: string): boolean {
  for (const { ini, fim } of blocos(t)) if (fim === -1 && aberturaJson(t, ini)) return true;
  return false;
}

// Tira o que for artefato tecnico e devolve so o que da pra mandar pro paciente.
export function sanitizeForPatient(texto: string): string {
  if (!texto) return "";
  let t = texto;
  t = t.replace(/```[\s\S]*?```/g, " ");  // bloco de codigo inteiro (com cerca fechada)
  t = t.replace(/```[a-z]*\s*/gi, " ");   // cerca orfa (o modelo abriu e nao fechou)
  t = t.replace(ELEMENTOS_TECNICOS, " ");  // elemento inteiro, com o conteudo dentro
  t = t.replace(TAGS_TECNICAS, " ");       // marcador orfao que sobrou (sem par)
  t = tiraBlocosTecnicos(t);
  return t.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

// Tira SO a cerca de markdown, PRESERVANDO o conteudo — o modelo as vezes embrulha a resposta
// inteira em ``` e o conteudo E a resposta. Diferente de sanitizeForPatient, que DELETA o bloco
// cercado (la o conteudo e lixo). Ponto unico pro caminho de voz nao divergir da trava de texto.
export function stripCodeFences(t: string): string {
  return (t || "").replace(/^\s*```[a-z]*\s*/i, "").replace(/\s*```\s*$/, "").trim();
}

// Depois de limpar, o que sobrou ainda cheira a tecnico? Sinais PRECISOS de proposito: um falso
// positivo aqui deixa o paciente sem resposta, entao nada de heuristica frouxa.
export function looksTechnical(texto: string): boolean {
  const t = (texto || "").trim();
  if (!t) return true;
  // Comeca abrindo JSON de verdade ('{"', '[{', '["'). Repare que "comeca com [" NAO basta:
  // "[[Ola!]] Vamos marcar" e bloco protegido do split.ts e tem que PASSAR — bloquear isso
  // deixaria o paciente sem resposta, que e o pior falso positivo possivel aqui.
  if ((t[0] === "{" || t[0] === "[") && aberturaJson(t, 0)) return true;
  if (temJsonAberto(t)) return true;
  if (TOOL_NAMES.some((n) => t.includes(n))) return true;
  if (CHAVES_TECNICAS.test(t)) return true;
  if (TAG_TECNICA.test(t)) return true;
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

// Exportado SO para a bancada afirmar o invariante (tudo que a limpeza remove, a deteccao ve).
export const _internals = { TOOL_NAMES, ARGS_TOOLS, TAGS_NOMES, CHAVES_BASE };
