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

/** Quantas LINHAS de conversa o agente enxerga, e quantas a memoria longa rele.
 *
 *  ⚠️ Mora aqui, num lugar so, de proposito. Sao LINHAS de WhatsApp, nao perguntas: quem escreve
 *  picado ("sim", "ok", "36 anos") gasta uma vaga por mensagem. Com 10, medido em 30/07/2026, a
 *  resposta "33" de um paciente saiu da janela em 8 MINUTOS e o agente respondeu "ainda nao anotei
 *  a sua idade". Subir para 20 custa pouco: a janela inteira e ~200 a 550 tokens contra 10.800 a
 *  15.600 do turno (quem domina a entrada e o prompt da clinica, nao a conversa).
 *
 *  A memoria longa PRECISA reler pelo menos o que a janela enxerga, porque ela existe para guardar
 *  o que sai da janela. Enquanto isso era uma constante em cada arquivo, so um comentario ligava as
 *  duas e quem ajustasse uma esqueceria a outra, em silencio. */
export const MEMORY_WINDOW = 20;

/** Le a janela recente da conversa, mais antiga primeiro. UMA definicao para os dois leitores
 *  (`loadConversation` e a memoria longa): as duas leituras precisam ser identicas no formato, e
 *  duplicar o `select` deixava as duas livres para divergir na proxima mudanca de schema.
 *
 *  Roda DUAS vezes por turno de proposito, e nao e desperdicio: a segunda (memoria longa) acontece
 *  depois do `saveAiResponse`, entao ela precisa enxergar a resposta que o agente acabou de dar. */
export async function lerJanela(
  supabase: any, sessionId: string, limit: number, maxSeq?: number | null,
): Promise<any[]> {
  // ⚠️ Janela vazia por FALHA e indistinguivel de conversa nova, e o agente se apresenta do zero no
  // meio do atendimento. E o incidente de 23 a 28/07/2026 (23 pacientes, 86 reapresentacoes) por
  // outra porta. Antes daqui o erro era engolido: nem alarme, nem rastro.
  //
  // A escolha deliberada e ACUSAR E SEGUIR, nao abortar: o turno ja foi APAGADO da fila no claim
  // (`claim_due_ai_turns`), entao levantar aqui deixaria o paciente sem NENHUMA resposta e sem
  // retentativa. Responder mal e ruim; nao responder e pior. O alarme e critical porque o sintoma
  // que chega ao paciente e exatamente o que o dono ja reconhece ("a IA esqueceu tudo").
  const acusar = async (erro: string) => {
    try {
      await supabase.rpc("log_system_error", {
        p_scope: "agente-memoria", p_code: "janela_ilegivel",
        p_title: "Não consegui ler o histórico da conversa: o agente respondeu SEM memória (pode ter se reapresentado)",
        p_level: "critical", p_clinic_id: null,
        p_context: { session_id: sessionId, limite: limit, erro: erro.slice(0, 300) },
      });
    } catch { /* Central fora do ar nao pode derrubar o turno */ }
  };
  try {
    // `maxSeq` NAO e usado em producao (fica undefined): existe para a bancada de modelos, que
    // precisa reconstruir a janela COMO ELA ERA no instante de um turno passado. Sem o corte, o
    // replay leria a conversa ja com a resposta que o agente deu depois e o teste ficaria viciado.
    let q = supabase
      .from("vw_n8n_chat_memory")
      .select("message, direction, sender, created_at")
      .eq("session_id", sessionId);
    if (maxSeq != null) q = q.lte("id", maxSeq);
    const { data, error } = await q
      .order("id", { ascending: false })
      .limit(Math.max(limit, 1));
    if (error) { await acusar(String(error.message ?? error)); return []; }
    return (data || []).slice().reverse(); // mais antigo primeiro
  } catch (e) {
    await acusar(String((e as Error)?.message ?? e));
    return [];
  }
}

/** Carrega a conversa (historico + turno atual), em turnos alternados prontos para o LLM.
 *  currentUserText = bufferFinal (concatenacao debounced), tratado como o turno atual autoritativo. */
export async function loadConversation(
  supabase: any, sessionId: string, limit: number, currentUserText: string, maxSeq?: number | null,
): Promise<AgentMsg[]> {
  const rows = await lerJanela(supabase, sessionId, limit, maxSeq);
  // A janela alcancou o COMECO da conversa? So sabemos que sim quando veio menos que o teto.
  const janelaAlcancaOInicio = rows.length < Math.max(limit, 1);

  const turns: { role: Role; text: string }[] = [];
  for (const r of rows) {
    const role = roleOf(r.message, r.direction);
    let content = (r.message?.content ?? "").toString();
    if (!role || !content.trim()) continue;
    // Fala da clinica que NAO foi o agente entra ROTULADA e COM HORA.
    //
    // - `system` = automacao (boas-vindas, reengajamento, lembrete de consulta, de confirmacao,
    //   encerramento).
    // - `human`  = atendente de verdade digitando.
    //
    // Fundir todo outbound como "assistant" e deliberado e costuma AJUDAR (medido em 03/08: a IA
    // aproveitou a triagem que a recepcionista ja tinha feito e nao repetiu a pergunta). O que
    // faltava era a HORA: a fala do atendente chegava sem data, e em 11 de 20 turnos expostos a
    // linha mais antiga tinha MAIS DE UM DIA (uma delas 20 dias), entrando como se fosse conversa
    // de agora. Dai sai "como combinamos" sobre algo que ninguem combinou. A justificativa ja
    // escrita para carimbar a automatica ("nao distingue 'acabamos de te escrever' de 'te
    // escrevemos ha tres dias'") vale igual para o atendente.
    if (r.direction === "outbound" && (r.sender === "system" || r.sender === "human")) {
      const q = quando(r.created_at);
      const quem = r.sender === "system" ? "mensagem automática enviada pela clínica" : "atendente da clínica escreveu";
      content = `[${quem}${q ? ` em ${q}` : ""}]\n${content}`;
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
  //
  // ⚠️ SO quando a janela alcanca o COMECO da conversa. A primeira versao (30/07) rotulava sempre, e
  // em conversa longa a janela comeca no MEIO: medido em 03/08, 245 de 442 conversas com mais de 20
  // mensagens (55%) tem uma fala nossa na primeira posicao da janela. Nesses casos o rotulo afirmava
  // que a conversa comecou com um texto do meio, e ate 700 chars de fala da CLINICA (inclusive do
  // atendente humano) iam para dentro do turno do CONTATO — o modelo podia ler "nao precisa pagar
  // antes nao" como se o paciente tivesse dito. E a mesma familia do bug do `roleOf` por direcao.
  // Janela cheia => volta a descartar, que e o comportamento seguro para o meio da conversa.
  const abertura: string[] = [];
  while (turns.length && turns[0].role === "assistant") {
    const t = turns.shift();
    if (t?.text?.trim()) abertura.push(t.text.trim());
  }
  if (janelaAlcancaOInicio && abertura.length && turns.length) {
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
