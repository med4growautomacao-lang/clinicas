// _shared/llm.ts — dispatch de LLM com tool-calling para o Agente IA (edge ai-agent-worker).
//
// Representacao de conversa AGNOSTICA (AgentMsg) que serializa para cada provider:
//   - Gemini  -> generateContent (functionDeclarations / functionCall / functionResponse)
//   - Anthropic -> /v1/messages (tools / tool_use / tool_result)
// A chave vem do Vault (get_llm_secret, service role) com fallback pro Deno.env — mesmo padrao
// que o wa-inbound usa na transcricao de midia. Modelo/temperatura vem de system_settings
// (agent_ai_config), editavel no painel Super Admin.

import { comMonitor, registrarUsoIA, FEATURE } from "./llm-usage.ts";

export type JSONSchema = {
  type: "object";
  properties: Record<string, { type: string; description?: string; enum?: string[] }>;
  required?: string[];
};

export interface AgentTool {
  name: string;
  description: string;
  parameters: JSONSchema;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  // Gemini 3.x: assinatura opaca ("thought signature") que veio junto do functionCall na resposta
  // e PRECISA ser reenviada ao ecoar o turno do assistente, senao a proxima chamada da 400.
  signature?: string;
}

export type AgentMsg =
  | { role: "user"; text: string }
  /** `raw`: itens NATIVOS que o provider devolveu neste turno do assistente.
   *
   *  ⚠️ Existe pela mesma razao do `signature` do Gemini, so que para a OpenAI: na Responses API o
   *  turno vem com um bloco de `reasoning` (cifrado) que PRECISA voltar junto na proxima chamada.
   *  O loop de tool-calling e stateless (remonta o corpo a cada iteracao a partir de AgentMsg), e
   *  sem guardar o item nativo aqui o raciocinio se perderia entre um passo e outro: o modelo
   *  reabriria a analise do zero depois de cada tool, mais caro e menos coerente. */
  | { role: "assistant"; text?: string; toolCalls?: ToolCall[]; raw?: unknown[] }
  | { role: "tool"; callId: string; name: string; result: string };

export interface TurnOut {
  text: string;
  toolCalls: ToolCall[];
  /** uso de tokens quando o provider devolve, para observabilidade/custo */
  usage?: { input?: number; output?: number };
  /** itens nativos da resposta, para o chamador ecoar no proximo passo (ver AgentMsg.raw) */
  raw?: unknown[];
}

export interface ModelConfig {
  provider: "gemini" | "anthropic" | "openai";
  model: string;
  temperature: number;
  fallback?: { provider: string; model: string } | null;
}

// ── Chave (Vault + env, com cache curto) ─────────────────────────────────────
const keyCache = new Map<string, { v: string; exp: number }>();

export async function llmKey(supabase: any, provider: string): Promise<string | null> {
  const name = provider === "gemini" ? "GEMINI_API_KEY"
    : provider === "anthropic" ? "ANTHROPIC_API_KEY"
    : provider === "openai" ? "OPENAI_API_KEY" : "";
  if (!name) return null;
  const c = keyCache.get(name);
  if (c && c.exp > Date.now()) return c.v;
  let key: string | null = null;
  try {
    const { data } = await supabase.rpc("get_llm_secret", { p_name: name });
    if (data && String(data).trim()) key = String(data);
  } catch { /* sem Vault -> tenta env */ }
  if (!key) key = Deno.env.get(name) || null;
  if (key) keyCache.set(name, { v: key, exp: Date.now() + 5 * 60 * 1000 });
  return key;
}

// Gemini aceita "models/x" e "x"; normaliza para o path do REST.
function geminiModelPath(model: string): string {
  return model.replace(/^models\//, "");
}

// ── Gemini (generativelanguage v1beta, function calling) ─────────────────────
function geminiContents(messages: AgentMsg[]): unknown[] {
  const contents: unknown[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      contents.push({ role: "user", parts: [{ text: m.text }] });
    } else if (m.role === "assistant") {
      const parts: unknown[] = [];
      if (m.text) parts.push({ text: m.text });
      for (const tc of m.toolCalls || []) {
        const part: Record<string, unknown> = { functionCall: { name: tc.name, args: tc.args } };
        if (tc.signature) part.thoughtSignature = tc.signature; // Gemini 3.x exige reenviar
        parts.push(part);
      }
      if (parts.length) contents.push({ role: "model", parts });
    } else {
      // tool_result -> functionResponse (role "function" no v1beta)
      let payload: unknown;
      try { payload = JSON.parse(m.result); } catch { payload = { result: m.result }; }
      contents.push({ role: "function", parts: [{ functionResponse: { name: m.name, response: payload } }] });
    }
  }
  return contents;
}

async function geminiTurn(
  cfg: ModelConfig, key: string, system: string, messages: AgentMsg[], tools: AgentTool[],
): Promise<TurnOut> {
  const body: Record<string, unknown> = {
    system_instruction: { parts: [{ text: system }] },
    contents: geminiContents(messages),
    generationConfig: { temperature: cfg.temperature },
  };
  if (tools.length) {
    body.tools = [{
      functionDeclarations: tools.map((t) => ({
        name: t.name, description: t.description, parameters: t.parameters,
      })),
    }];
  }
  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${geminiModelPath(cfg.model)}:generateContent?key=${key}`,
    {
      method: "POST",
      signal: AbortSignal.timeout(60000),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!resp.ok) {
    const t = (await resp.text()).slice(0, 400);
    throw new Error(`gemini ${resp.status}: ${t}`);
  }
  const data = await resp.json();
  const parts: any[] = data?.candidates?.[0]?.content?.parts ?? [];
  let text = "";
  const toolCalls: ToolCall[] = [];
  let i = 0;
  for (const p of parts) {
    if (p?.text) text += p.text;
    if (p?.functionCall) {
      toolCalls.push({
        id: `call_${i++}`,
        name: p.functionCall.name,
        args: (p.functionCall.args ?? {}) as Record<string, unknown>,
        signature: p.thoughtSignature, // preserva a assinatura p/ reenviar no proximo turno
      });
    }
  }
  const u = data?.usageMetadata;
  return {
    text: text.trim(),
    toolCalls,
    usage: u ? { input: u.promptTokenCount, output: u.candidatesTokenCount } : undefined,
  };
}

// ── Anthropic (/v1/messages, tool use) ───────────────────────────────────────
function anthropicMessages(messages: AgentMsg[]): unknown[] {
  const out: unknown[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      out.push({ role: "user", content: [{ type: "text", text: m.text }] });
    } else if (m.role === "assistant") {
      const content: unknown[] = [];
      if (m.text) content.push({ type: "text", text: m.text });
      for (const tc of m.toolCalls || []) content.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.args });
      out.push({ role: "assistant", content });
    } else {
      out.push({ role: "user", content: [{ type: "tool_result", tool_use_id: m.callId, content: m.result }] });
    }
  }
  return out;
}

// A geração Opus 4.7+ da Anthropic (Opus 4.7/4.8/5, Sonnet 5, Fable 5, Mythos 5) REMOVEU
// temperature/top_p/top_k: mandar o campo devolve 400. Mesma régua que conv-ai-analyst,
// conv-ai-mine e conv-ai-learn já usavam; o agente era o único caminho sem ela.
//
// ⚠️ Foi o defeito de 03/08 15:34 (Clínica Vaz): o modelo primário falhou, o worker caiu no
// reserva `claude-opus-4-8` repassando a mesma temperatura e o RESERVA morreu com
//   "`temperature` is deprecated for this model"
// ou seja, a rede de proteção caiu junto com o que ela deveria salvar e o paciente ficou sem
// resposta. Fallback que repete o corpo do primário herda os campos proibidos do modelo novo.
//
// ⚠️ `opus-5` entra aqui explicitamente porque `opus-4-[78]` NÃO o cobre: a régua original é de
// antes do Opus 5 e deixaria o modelo mais novo (e mais provável de ser escolhido no painel)
// justamente de fora. As outras três funções ainda têm esse furo.
const ANTHROPIC_NO_SAMPLING = /^claude-(opus-4-[78]|opus-5|sonnet-5|fable-5|mythos-5)/;
const ANTHROPIC_THINKING_ALWAYS_ON = /^claude-(fable-5|mythos-5)/;

async function anthropicTurn(
  cfg: ModelConfig, key: string, system: string, messages: AgentMsg[], tools: AgentTool[],
): Promise<TurnOut> {
  const body: Record<string, unknown> = {
    model: cfg.model,
    max_tokens: 2048,
    system,
    messages: anthropicMessages(messages),
  };
  if (ANTHROPIC_NO_SAMPLING.test(cfg.model)) {
    // ⚠️ Desligar o "thinking" aqui não é economia, é o que impede a resposta de sair truncada:
    // no Opus 5 ele vem LIGADO por padrão e divide o mesmo teto de 2048 tokens com o texto que o
    // paciente lê. Fable/Mythos não aceitam nem o disabled, por isso a segunda régua.
    if (!ANTHROPIC_THINKING_ALWAYS_ON.test(cfg.model)) body.thinking = { type: "disabled" };
  } else {
    body.temperature = cfg.temperature;
  }
  if (tools.length) {
    body.tools = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
  }
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    signal: AbortSignal.timeout(60000),
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const t = (await resp.text()).slice(0, 400);
    throw new Error(`anthropic ${resp.status}: ${t}`);
  }
  const data = await resp.json();
  let text = "";
  const toolCalls: ToolCall[] = [];
  for (const block of (data?.content ?? [])) {
    if (block?.type === "text") text += block.text;
    if (block?.type === "tool_use") {
      toolCalls.push({ id: block.id, name: block.name, args: (block.input ?? {}) as Record<string, unknown> });
    }
  }
  const u = data?.usage;
  return {
    text: text.trim(),
    toolCalls,
    usage: u ? { input: u.input_tokens, output: u.output_tokens } : undefined,
  };
}

// ── OpenAI (/v1/responses, function calling) ─────────────────────────────────
//
// ⚠️ E a Responses API, NAO /v1/chat/completions, e isso foi MEDIDO em 04/08/2026, nao deduzido: o
// `gpt-5.6-luna` recusa function tools no endpoint antigo com
//   400 "Function tools with reasoning_effort are not supported ... use /v1/responses or set
//        reasoning_effort to 'none'"
// e desligar o raciocinio para caber la seria trocar o modelo por uma versao capada. O
// `gpt-5.4-mini` aceita os dois; um caminho so evita duas regras para manter.
//
// ⚠️ NAO manda `temperature`. Modelo de raciocinio da OpenAI rejeita, e este e exatamente o defeito
// que derrubou o fallback da Anthropic em 03/08 (o reserva herdava o corpo do primario com um campo
// proibido e morria justamente quando era acionado). Aqui o campo simplesmente nao existe.
function openaiInput(messages: AgentMsg[]): unknown[] {
  const out: unknown[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      out.push({ role: "user", content: m.text });
    } else if (m.role === "assistant") {
      // Itens nativos preservam o bloco de raciocinio; so quando nao houver, remonta na mao.
      if (m.raw && m.raw.length) { out.push(...m.raw); continue; }
      if (m.text) out.push({ role: "assistant", content: m.text });
      for (const tc of m.toolCalls || []) {
        out.push({ type: "function_call", call_id: tc.id, name: tc.name, arguments: JSON.stringify(tc.args) });
      }
    } else {
      out.push({ type: "function_call_output", call_id: m.callId, output: m.result });
    }
  }
  return out;
}

async function openaiTurn(
  cfg: ModelConfig, key: string, system: string, messages: AgentMsg[], tools: AgentTool[],
): Promise<TurnOut> {
  const body: Record<string, unknown> = {
    model: cfg.model,
    instructions: system,
    input: openaiInput(messages),
    store: false,
    include: ["reasoning.encrypted_content"],
  };
  if (tools.length) {
    body.tools = tools.map((t) => ({
      type: "function", name: t.name, description: t.description, parameters: t.parameters,
    }));
  }
  const resp = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    signal: AbortSignal.timeout(60000),
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const t = (await resp.text()).slice(0, 400);
    throw new Error(`openai ${resp.status}: ${t}`);
  }
  const data = await resp.json();
  const saida: any[] = data?.output ?? [];
  let text = "";
  const toolCalls: ToolCall[] = [];
  for (const o of saida) {
    if (o?.type === "message") {
      for (const c of (o.content ?? [])) if (c?.type === "output_text") text += c.text ?? "";
    }
    if (o?.type === "function_call") {
      let args: Record<string, unknown> = {};
      // Argumento malformado NAO derruba o turno: vira {} e a tool responde o erro de negocio,
      // que o modelo sabe tratar. Lancar aqui deixaria o paciente sem resposta nenhuma.
      try { args = JSON.parse(o.arguments || "{}"); } catch { /* fica {} */ }
      toolCalls.push({ id: o.call_id, name: o.name, args });
    }
  }
  const u = data?.usage;
  return {
    text: text.trim(),
    toolCalls,
    usage: u ? { input: u.input_tokens, output: u.output_tokens } : undefined,
    raw: saida,
  };
}

// ── Dispatch ─────────────────────────────────────────────────────────────────
/**
 * Contexto do monitor de consumo. Opcional para nao quebrar chamador antigo, mas SEM ele a linha
 * entra sem clinica e o painel do Super Admin nao consegue dizer quem gastou. Passe sempre.
 */
export interface UsoCtx {
  /** chave de system_settings que o Super Admin edita (agrupa o painel) */
  feature?: string;
  /** edge/passo de origem, para achar o culpado quando um numero pular */
  scope?: string;
  clinicId?: string | null;
  leadId?: string | null;
}

/**
 * Ponto UNICO de chamada ao LLM do agente. O monitor mora aqui de proposito: instrumentar cada
 * chamador daria 3 lugares para esquecer, e o mais caro (o loop de tool-calling, que chama isto
 * varias vezes por turno) e justamente o que mais escapa da conta.
 * Registra sucesso E falha — falha tambem consome cota e explica pico de erro no painel.
 */
export async function runAgentTurn(
  supabase: any, cfg: ModelConfig, system: string, messages: AgentMsg[], tools: AgentTool[],
  uso: UsoCtx = {},
): Promise<TurnOut> {
  const key = await llmKey(supabase, cfg.provider);
  if (!key) {
    // Registra ANTES de lancar: chave revogada/rotacionada e exatamente o caso em que o painel
    // precisa mostrar um pico de falha. Sem isto o agente simplesmente emudecia no grafico, que
    // e o sintoma mais dificil de interpretar.
    registrarUsoIA(supabase, {
      feature: uso.feature ?? FEATURE.agente, scope: uso.scope ?? "llm",
      provider: cfg.provider, model: cfg.model,
      clinicId: uso.clinicId ?? null, leadId: uso.leadId ?? null,
      ok: false, error: `sem chave de API para provider "${cfg.provider}" (Vault/env)`,
    });
    throw new Error(`sem chave de API para provider "${cfg.provider}" (Vault/env)`);
  }

  return comMonitor(
    supabase,
    {
      feature: uso.feature ?? FEATURE.agente,
      scope: uso.scope ?? "llm",
      provider: cfg.provider,
      model: cfg.model,
      clinicId: uso.clinicId ?? null,
      leadId: uso.leadId ?? null,
    },
    // ⚠️ Ternario de DOIS ramos aqui era um bug silencioso: o tipo aceita "openai" e `llmKey` ja
    // buscava OPENAI_API_KEY, mas qualquer provider != anthropic caia no Gemini. Escolher OpenAI
    // mandava o corpo do Google com a chave da OpenAI, e o agente parava. Provider desconhecido
    // continua caindo no Gemini de proposito (e o padrao da casa), mas os tres tem caminho proprio.
    () => cfg.provider === "anthropic"
      ? anthropicTurn(cfg, key, system, messages, tools)
      : cfg.provider === "openai"
      ? openaiTurn(cfg, key, system, messages, tools)
      : geminiTurn(cfg, key, system, messages, tools),
    (out) => ({ input: out.usage?.input, output: out.usage?.output }),
  );
}
