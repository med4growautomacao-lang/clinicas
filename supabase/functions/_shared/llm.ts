// _shared/llm.ts — dispatch de LLM com tool-calling para o Agente IA (edge ai-agent-worker).
//
// Representacao de conversa AGNOSTICA (AgentMsg) que serializa para cada provider:
//   - Gemini  -> generateContent (functionDeclarations / functionCall / functionResponse)
//   - Anthropic -> /v1/messages (tools / tool_use / tool_result)
// A chave vem do Vault (get_llm_secret, service role) com fallback pro Deno.env — mesmo padrao
// que o wa-inbound usa na transcricao de midia. Modelo/temperatura vem de system_settings
// (agent_ai_config), editavel no painel Super Admin.

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
  | { role: "assistant"; text?: string; toolCalls?: ToolCall[] }
  | { role: "tool"; callId: string; name: string; result: string };

export interface TurnOut {
  text: string;
  toolCalls: ToolCall[];
  /** uso de tokens quando o provider devolve, para observabilidade/custo */
  usage?: { input?: number; output?: number };
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

async function anthropicTurn(
  cfg: ModelConfig, key: string, system: string, messages: AgentMsg[], tools: AgentTool[],
): Promise<TurnOut> {
  const body: Record<string, unknown> = {
    model: cfg.model,
    max_tokens: 2048,
    temperature: cfg.temperature,
    system,
    messages: anthropicMessages(messages),
  };
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

// ── Dispatch ─────────────────────────────────────────────────────────────────
export async function runAgentTurn(
  supabase: any, cfg: ModelConfig, system: string, messages: AgentMsg[], tools: AgentTool[],
): Promise<TurnOut> {
  const key = await llmKey(supabase, cfg.provider);
  if (!key) throw new Error(`sem chave de API para provider "${cfg.provider}" (Vault/env)`);
  if (cfg.provider === "anthropic") return anthropicTurn(cfg, key, system, messages, tools);
  return geminiTurn(cfg, key, system, messages, tools);
}
