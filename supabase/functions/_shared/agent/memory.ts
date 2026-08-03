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

/** Papel do turno. ⚠️ A DIRECAO MANDA, nao o `type`.
 *
 *  Mensagem que o ATENDENTE digita entra como direction='outbound' + sender='human' +
 *  message.type='human' (16.072 linhas em 7 dias, medido em 30/07/2026). Decidir pelo `type`
 *  sozinho fazia o agente ler a fala da PROPRIA CLINICA como se fosse do paciente: ele recebia
 *  "Agendado para 04/08 as 14:30" como coisa que o paciente disse e respondia em cima disso. O
 *  mesmo valia para o historico importado no onboarding, que tambem e outbound+human.
 *
 *  Regra: outbound e SEMPRE a nossa voz (agente ou atendente, tanto faz para o modelo: quem falou
 *  foi a clinica). Inbound e o paciente. Sem `direction` na linha (registro antigo/malformado),
 *  cai no `type` como antes. */
function roleOf(msg: any, direction?: string | null): Role | null {
  if (direction === "outbound") return "assistant";
  if (direction === "inbound") return "user";
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
  // ⚠️ Compara SEM whitespace de borda. `ingest_wa_message` persiste `coalesce(p_content,'')` sem
  // trim e o `ai-agent` enfileira `String(p.mensagem).trim()`: um dia em que a uazapi entregar
  // "ok\n" o historico termina com a quebra, o buffer nao, nenhum dos dois testes casa e a
  // mensagem do paciente ia DUPLICADA no prompt (o modelo passa a achar que ele insistiu).
  // Medido em 30/07: 0 em 68.831 mensagens de 30 dias, ou seja, hoje nao acontece; o contrato
  // entre as duas pontas e que nao esta escrito em lugar nenhum, e por isso a comparacao aqui
  // nao depende dele.
  const h = historico.trimEnd();
  const b = buffer.trimStart();
  if (b.includes(h)) return buffer; // o turno do fim JA e o buffer inteiro
  let corte = Math.min(h.length, b.length);
  while (corte > 0 && !h.endsWith(b.slice(0, corte))) corte--;
  return corte > 0
    ? h.slice(0, h.length - corte) + buffer
    : `${h}\n${buffer}`;
}

/** "30/07 às 13:51" a partir do `created_at` da conversa.
 *
 *  ⚠️ NAO passa por `new Date()` de proposito. `chat_messages.created_at` e `timestamp SEM
 *  timezone` e JA esta em America/Sao_Paulo (CLAUDE.md §3): o `Date` do JS leria a string sem fuso
 *  como UTC e mostraria a hora 3h adiantada ao modelo, que entao erraria a conta de "ha quanto
 *  tempo". Recorte de texto e a leitura fiel aqui. */
export function quando(ts: unknown): string {
  const m = String(ts ?? "").match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  return m ? `${m[3]}/${m[2]} às ${m[4]}:${m[5]}` : "";
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
      .select("message, direction, sender, created_at")
      .eq("session_id", sessionId)
      .order("id", { ascending: false })
      .limit(Math.max(limit, 1));
    rows = (data || []).slice().reverse(); // mais antigo primeiro
  } catch { rows = []; }

  const turns: { role: Role; text: string }[] = [];
  for (const r of rows) {
    const role = roleOf(r.message, r.direction);
    let content = (r.message?.content ?? "").toString();
    if (!role || !content.trim()) continue;
    // Follow-up/automacao (`sender='system'`: boas-vindas, reengajamento, lembrete de consulta,
    // lembrete de confirmacao, encerramento) entra ROTULADO e COM HORA. Sem o rotulo o agente le
    // como fala dele mesmo e responde "como eu disse antes"; sem a hora ele nao distingue
    // "acabamos de te escrever" de "te escrevemos ha tres dias", e o tom certo depende disso.
    if (r.direction === "outbound" && r.sender === "system") {
      const q = quando(r.created_at);
      content = `[mensagem automática enviada pela clínica${q ? ` em ${q}` : ""}]\n${content}`;
    }
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

  // A API exige comecar por 'user' (Anthropic recusa, e o `contents` do Gemini idem).
  //
  // ⚠️ Mas simplesmente DESCARTAR o inicio era perda de contexto real. Quando somos NOS que
  // procuramos a pessoa (boas-vindas de formulario, reengajamento, lembrete de consulta), a nossa
  // mensagem e a PRIMEIRA da conversa, entao ela caia aqui SEMPRE. Medido em 30/07/2026: 11
  // conversas nas 3 clinicas com IA, e em 11 de 11 o agente se apresentou do zero, sem usar o nome
  // e sem saber por que a clinica tinha procurado a pessoa. O paciente le "Oi Priscila, vi que voce
  // preencheu nosso formulario", responde, e ouve "Ola! Eu sou a Paloma, secretaria...".
  //
  // Agora a abertura entra ROTULADA no primeiro turno do contato em vez de sumir. Nao vira turno
  // 'assistant' proprio de proposito: isso reintroduziria o 'assistant' no inicio, que e justamente
  // o que a API recusa.
  const abertura: string[] = [];
  while (turns.length && turns[0].role === "assistant") {
    const t = turns.shift();
    if (t?.text?.trim()) abertura.push(t.text.trim());
  }
  if (abertura.length && turns.length) {
    // Teto para nao empurrar uma abertura enorme (mídia, texto longo de reengajamento) para dentro
    // da fala do contato: o que importa aqui e o AGENTE saber que a clinica falou primeiro e o que
    // ela disse, nao reproduzir o texto inteiro. Os rotulos "[mensagem automática ... em DD/MM às
    // HH:MM]" ja vieram colados em cada linha la em cima, entao a hora sobrevive ao recorte.
    const texto = abertura.join("\n").replace(/[ \t]+/g, " ").slice(0, 700);
    turns[0] = {
      role: "user",
      text: `[Contexto: quem iniciou esta conversa foi a clínica, com isto:]\n${texto}\n` +
        `[Fim do contexto. A partir daqui é a fala do contato:]\n${turns[0].text}`,
    };
  }

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
