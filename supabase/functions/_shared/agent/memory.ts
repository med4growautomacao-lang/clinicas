// _shared/agent/memory.ts — leitura/escrita da memoria de conversa do Agente IA.
//
// A memoria vive em chat_messages (formato langchain: message = {type:'human'|'ai', content}).
// - LEITURA: pela view vw_n8n_chat_memory (ja filtra jsonb_typeof='object', descarta malformadas),
//   ultimas N por seq. A mensagem do paciente JA foi persistida pela RPC ingest_wa_message (chamada
//   pelo wa-inbound) antes do agente rodar — por isso o worker NAO grava a linha humana.
// - ESCRITA: insere UMA linha com a resposta da IA ({type:'ai'}). Os triggers de chat_messages
//   preenchem sender/direction/clinic_id/lead_id/phone e cascateiam o resto (ticket, analista...).
//   fn_skip_ai_tool_traces mantem a resposta final (type='ai' sem tool_calls).

import type { AgentMsg } from "../llm.ts";

type Role = "user" | "assistant";

function roleOf(msg: any): Role | null {
  const t = msg?.type ?? msg?.role;
  if (t === "ai" || t === "assistant" || t === "bot") return "assistant";
  if (t === "human" || t === "user") return "user";
  return null;
}

/** Junta historico + turno atual num unico texto SEM repetir o trecho comum.
 *
 *  O ingest persiste a mensagem do paciente ANTES do agente rodar, entao o fim do historico e o
 *  comeco do buffer se sobrepoem. Concatenar cru mandava a mesma frase duas vezes ao modelo (ele
 *  passa a achar que o paciente repetiu); trocar um pelo outro apagava o historico. Aqui corta do
 *  fim do historico o maior trecho que ja abre o buffer e emenda. */
function fundirSemRepetir(historico: string, buffer: string): string {
  if (!historico) return buffer;
  if (buffer.includes(historico)) return buffer; // o turno do fim JA e o buffer inteiro
  let corte = Math.min(historico.length, buffer.length);
  while (corte > 0 && !historico.endsWith(buffer.slice(0, corte))) corte--;
  return corte > 0
    ? historico.slice(0, historico.length - corte) + buffer
    : `${historico}\n${buffer}`;
}

/** Carrega a conversa (historico + turno atual), em turnos alternados prontos para o LLM.
 *  currentUserText = bufferFinal (concatenacao debounced), tratado como o turno atual autoritativo. */
export async function loadConversation(
  supabase: any, sessionId: string, limit: number, currentUserText: string,
): Promise<AgentMsg[]> {
  let rows: any[] = [];
  try {
    const { data } = await supabase
      .from("vw_n8n_chat_memory")
      .select("message")
      .eq("session_id", sessionId)
      .order("id", { ascending: false })
      .limit(Math.max(limit, 1));
    rows = (data || []).slice().reverse(); // mais antigo primeiro
  } catch { rows = []; }

  const turns: { role: Role; text: string }[] = [];
  for (const r of rows) {
    const role = roleOf(r.message);
    const content = (r.message?.content ?? "").toString();
    if (!role || !content.trim()) continue;
    const last = turns[turns.length - 1];
    if (last && last.role === role) last.text += "\n" + content; // funde mesmo-role consecutivo
    else turns.push({ role, text: content });
  }

  // Garante um unico turno de usuario no fim, terminando no bufferFinal autoritativo.
  //
  // ⚠️ NUNCA trocar direto (`last.text = currentUserText`). Isso era APAGAR HISTORICO: a fusao
  // acima junta todos os 'user' consecutivos num turno so, e num historico sem resposta do agente
  // no meio (sessao de memoria partida, ou lead que mandou varias mensagens antes da primeira
  // resposta) esse turno unico carrega a conversa INTEIRA. O agente recebia so a mensagem atual e
  // se reapresentava no meio do atendimento: e o sintoma de 30/07/2026 chegando por outra porta.
  const last = turns[turns.length - 1];
  if (last && last.role === "user") last.text = fundirSemRepetir(last.text, currentUserText);
  else turns.push({ role: "user", text: currentUserText });

  // Anthropic exige comecar por 'user'; remove qualquer 'assistant' no inicio.
  while (turns.length && turns[0].role === "assistant") turns.shift();

  return turns.map((t) =>
    t.role === "user" ? { role: "user", text: t.text } : { role: "assistant", text: t.text }
  );
}

/** Grava a resposta final da IA como uma linha de chat_messages (formato langchain). */
export async function saveAiResponse(supabase: any, sessionId: string, text: string): Promise<void> {
  await supabase.from("chat_messages").insert({
    session_id: sessionId,
    message: { type: "ai", content: text, additional_kwargs: {}, response_metadata: {} },
  });
}
