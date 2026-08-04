// ai-bench — bancada de modelos do Agente IA. Replay de turnos REAIS, lado a lado.
//
// Responde a UMA pergunta: trocando o modelo, o agente ainda responde direito e chama as tools
// certas? Para isso ele NAO simula o agente, ele reusa as pecas de verdade (agentToolSpecs,
// assembleSystemPrompt, loadConversation, guard), porque bancada que reimplementa o sistema mede
// a reimplementacao.
//
// DOIS modos:
//   seed — congela os casos. Monta o system prompt e a janela de conversa COMO ERAM no instante do
//          turno (loadConversation com maxSeq) e grava em ai_bench_cases. Congelar e o ponto: o
//          prompt tem bloco temporal ("Hoje e ...") e Dados do Contato, que mudam por dia e por
//          analise; se cada modelo montasse o seu, medir-se-ia a diferenca de PROMPT, nao a de
//          MODELO.
//   run  — claim atomico de pares (caso, modelo) pendentes e execucao do loop de tool-calling.
//
// ⚠️ TOOLS QUE ESCREVEM SAO INTERCEPTADAS. Replay roda sobre pacientes reais: deixar MARCAR_HORARIO
// executar encheria a agenda de clinica em producao de consultas fantasma. As 4 de LEITURA rodam de
// verdade (sao SELECT via ai-scheduler) porque e o dado real que faz o modelo decidir; as 5 de
// ESCRITA devolvem um payload no MESMO formato da ai-scheduler (readable_summary + next_step) para
// o modelo conseguir fechar o turno, e a chamada fica registrada para julgamento.
//
// ⚠️ NAO registra em llm_usage de proposito: bancada nao e consumo de cliente e sujaria o painel de
// Consumo de IA (e o custo por clinica) com gasto de laboratorio.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { agentToolSpecs, TOOL_DEFS, type SessionCtx } from "../_shared/agent/tools.ts";
import { assembleSystemPrompt, fetchAgentContext } from "../_shared/agent/prompt.ts";
import { loadConversation, MEMORY_WINDOW } from "../_shared/agent/memory.ts";
import { looksTechnical, sanitizeForPatient, stripCodeFences } from "../_shared/agent/guard.ts";
import type { AgentMsg, AgentTool, ToolCall } from "../_shared/llm.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_TOOL_ITERS = 8; // mesmo teto do ai-agent-worker
const SO_LEITURA = new Set([
  "LISTAR_TIPOS_CONSULTA", "VER_HORARIOS", "VER_AGENDAMENTOS_PACIENTE", "VER_HISTORICO_PACIENTE",
]);

function svc() {
  return createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
}

async function chave(supabase: any, provider: string): Promise<string> {
  const nome = provider === "openai" ? "OPENAI_API_KEY"
    : provider === "anthropic" ? "ANTHROPIC_API_KEY" : "GEMINI_API_KEY";
  const { data } = await supabase.rpc("get_llm_secret", { p_name: nome });
  const k = (data && String(data).trim()) || Deno.env.get(nome) || "";
  if (!k) throw new Error(`sem chave para ${provider}`);
  return k;
}

// ── Runner: um passo do modelo, mantendo o estado NATIVO de cada provider ─────
//
// O loop de tool-calling e o mesmo para todos, mas o historico NAO pode ser reconvertido a cada
// passo: o Gemini 3.x exige devolver a thoughtSignature junto do functionCall, e a Responses API da
// OpenAI exige ecoar os itens de reasoning. Converter de um formato neutro perderia os dois e a
// segunda iteracao quebraria (400) ou pioraria em silencio. Por isso cada runner guarda o proprio
// estado e so recebe/devolve o que o loop precisa.
interface PassoOut { text: string; toolCalls: ToolCall[]; tokensIn: number; tokensOut: number }
interface Runner {
  passo(): Promise<PassoOut>;
  entregarResultados(rs: { call: ToolCall; output: string }[]): void;
}

// ── Gemini (generativelanguage v1beta) — espelha _shared/llm.ts ───────────────
class GeminiRunner implements Runner {
  private contents: unknown[] = [];
  constructor(
    private key: string, private model: string, private temperature: number,
    private system: string, messages: AgentMsg[], private tools: AgentTool[],
  ) {
    for (const m of messages) {
      if (m.role === "user") this.contents.push({ role: "user", parts: [{ text: m.text }] });
      else if (m.role === "assistant") {
        const parts: unknown[] = [];
        if (m.text) parts.push({ text: m.text });
        for (const tc of m.toolCalls || []) parts.push({ functionCall: { name: tc.name, args: tc.args } });
        if (parts.length) this.contents.push({ role: "model", parts });
      }
    }
  }

  async passo(): Promise<PassoOut> {
    const body: Record<string, unknown> = {
      system_instruction: { parts: [{ text: this.system }] },
      contents: this.contents,
      generationConfig: { temperature: this.temperature },
    };
    if (this.tools.length) {
      body.tools = [{
        functionDeclarations: this.tools.map((t) => ({
          name: t.name, description: t.description, parameters: t.parameters,
        })),
      }];
    }
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.key}`,
      { method: "POST", signal: AbortSignal.timeout(120000), headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    );
    if (!r.ok) throw new Error(`gemini ${r.status}: ${(await r.text()).slice(0, 400)}`);
    const d = await r.json();
    const parts: any[] = d?.candidates?.[0]?.content?.parts ?? [];
    let text = "";
    const toolCalls: ToolCall[] = [];
    let i = 0;
    for (const p of parts) {
      if (p?.text) text += p.text;
      if (p?.functionCall) {
        toolCalls.push({
          id: `call_${i++}`, name: p.functionCall.name,
          args: (p.functionCall.args ?? {}) as Record<string, unknown>,
          signature: p.thoughtSignature,
        });
      }
    }
    if (parts.length) this.contents.push({ role: "model", parts }); // ecoa CRU (preserva assinatura)
    const u = d?.usageMetadata;
    return { text: text.trim(), toolCalls, tokensIn: u?.promptTokenCount ?? 0, tokensOut: u?.candidatesTokenCount ?? 0 };
  }

  entregarResultados(rs: { call: ToolCall; output: string }[]) {
    for (const r of rs) {
      let payload: unknown;
      try { payload = JSON.parse(r.output); } catch { payload = { result: r.output }; }
      this.contents.push({ role: "function", parts: [{ functionResponse: { name: r.call.name, response: payload } }] });
    }
  }
}

// ── OpenAI (/v1/responses) ───────────────────────────────────────────────────
//
// ⚠️ Responses e nao chat/completions por medicao, nao por gosto: o gpt-5.6-luna RECUSA function
// tools em /v1/chat/completions ("use /v1/responses or set reasoning_effort to 'none'"). Desligar o
// raciocinio para caber no endpoint antigo mediria um modelo capado, entao a bancada usa o caminho
// que a OpenAI indica. Temperatura nao vai: modelo de raciocinio rejeita.
class OpenAIRunner implements Runner {
  private input: unknown[] = [];
  constructor(
    private key: string, private model: string,
    private system: string, messages: AgentMsg[], private tools: AgentTool[],
  ) {
    for (const m of messages) {
      if (m.role === "user") this.input.push({ role: "user", content: m.text });
      else if (m.role === "assistant") {
        if (m.text) this.input.push({ role: "assistant", content: m.text });
        for (const tc of m.toolCalls || []) {
          this.input.push({ type: "function_call", call_id: tc.id, name: tc.name, arguments: JSON.stringify(tc.args) });
        }
      }
    }
  }

  async passo(): Promise<PassoOut> {
    const body: Record<string, unknown> = {
      model: this.model,
      instructions: this.system,
      input: this.input,
      store: false,
      include: ["reasoning.encrypted_content"],
    };
    if (this.tools.length) {
      body.tools = this.tools.map((t) => ({
        type: "function", name: t.name, description: t.description, parameters: t.parameters,
      }));
    }
    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST", signal: AbortSignal.timeout(120000),
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${this.key}` },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`openai ${r.status}: ${(await r.text()).slice(0, 400)}`);
    const d = await r.json();
    const saida: any[] = d?.output ?? [];
    let text = "";
    const toolCalls: ToolCall[] = [];
    for (const o of saida) {
      if (o?.type === "message") {
        for (const c of (o.content ?? [])) if (c?.type === "output_text") text += c.text ?? "";
      }
      if (o?.type === "function_call") {
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(o.arguments || "{}"); } catch { /* argumento malformado: fica {} e o julgamento pega */ }
        toolCalls.push({ id: o.call_id, name: o.name, args });
      }
    }
    // Ecoa os itens CRUS (inclusive reasoning cifrado): e o que a Responses API espera de volta.
    for (const o of saida) this.input.push(o);
    const u = d?.usage;
    return { text: text.trim(), toolCalls, tokensIn: u?.input_tokens ?? 0, tokensOut: u?.output_tokens ?? 0 };
  }

  entregarResultados(rs: { call: ToolCall; output: string }[]) {
    for (const r of rs) {
      this.input.push({ type: "function_call_output", call_id: r.call.id, output: r.output });
    }
  }
}

// ── Execucao de tool: leitura de verdade, escrita interceptada ────────────────
async function executarNaBancada(
  call: ToolCall, ctx: SessionCtx,
): Promise<{ output: string; simulada: boolean }> {
  const def = TOOL_DEFS[call.name];
  if (!def) {
    return { output: JSON.stringify({ success: false, error: `Tool desconhecida: ${call.name}` }), simulada: false };
  }
  if (SO_LEITURA.has(call.name)) {
    const payload = { action: def.action, ...def.body(call.args || {}, ctx) };
    try {
      const r = await fetch(ctx.schedulerUrl, {
        method: "POST", signal: AbortSignal.timeout(45000),
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${ctx.authToken}` },
        body: JSON.stringify(payload),
      });
      return { output: await r.text(), simulada: false };
    } catch (e) {
      return { output: JSON.stringify({ success: false, error_code: "tool_network_error", error: String(e) }), simulada: false };
    }
  }
  // Escrita: devolve no formato da ai-scheduler para o modelo conseguir fechar o turno.
  const a = (call.args || {}) as Record<string, unknown>;
  const quando = `${a.date ?? "?"} ${String(a.time ?? "").slice(0, 5)}`.trim();
  const canned: Record<string, unknown> = {
    MARCAR_HORARIO: {
      success: true, appointment_id: "00000000-0000-0000-0000-000000000000",
      readable_summary: `Consulta MARCADA na agenda para ${quando} (data ${a.date ?? "?"}, horario ${String(a.time ?? "").slice(0, 5)}).`,
      next_step: "Confirme ao paciente EXATAMENTE a data, o horario e o medico que estao em readable_summary.",
    },
    REAGENDAR_HORARIO: {
      success: true, appointment_id: a.appointment_id ?? null,
      readable_summary: `Consulta REAGENDADA na agenda para ${quando}.`,
      next_step: "Confirme ao paciente EXATAMENTE a data e o horario de readable_summary. NAO repita o horario antigo.",
    },
    CANCELAR_HORARIO: {
      success: true, readable_summary: "Consulta CANCELADA na agenda.",
      next_step: "Avise o paciente que o cancelamento foi feito e ofereca remarcar quando ele quiser.",
    },
    ACIONAR_HANDOFF: {
      success: true, readable_summary: "Transbordo acionado: a IA foi pausada e a equipe avisada.",
      next_step: "Nao escreva mais nada alem de uma despedida curta. Nao ofereca agendamento.",
    },
    ENCERRAR_FORA_PERFIL: {
      success: true, readable_summary: "Atendimento encerrado como PERDIDO (fora do perfil).",
      next_step: "Despeca-se com gentileza e NAO ofereca agendamento.",
    },
  };
  return { output: JSON.stringify(canned[call.name] ?? { success: true }), simulada: true };
}

// ── seed ─────────────────────────────────────────────────────────────────────
async function semear(supabase: any, corpo: any) {
  const runLabel: string = corpo.run_label || "bancada";
  const modelos: { provider: string; model: string; temperature?: number }[] = corpo.models || [];
  const casos: { lead_id: string; cutoff_seq: number; nota?: string }[] = corpo.cases || [];
  const criados: any[] = [];

  for (const c of casos) {
    const { data: lead } = await supabase.from("leads")
      .select("id, clinic_id, session_id, phone").eq("id", c.lead_id).maybeSingle();
    if (!lead) { criados.push({ lead_id: c.lead_id, erro: "lead nao encontrado" }); continue; }

    const { data: msg } = await supabase.from("chat_messages")
      .select("seq, session_id, message, direction").eq("seq", c.cutoff_seq).maybeSingle();
    if (!msg) { criados.push({ lead_id: c.lead_id, erro: "mensagem de corte nao encontrada" }); continue; }

    const sessionId = msg.session_id || lead.session_id;
    const userText = String(msg.message?.content ?? "").trim();
    if (!userText) { criados.push({ lead_id: c.lead_id, erro: "mensagem de corte vazia" }); continue; }

    const { data: cfg } = await supabase.from("ai_config")
      .select("handoff_rules, handoff_enabled").eq("clinic_id", lead.clinic_id).maybeSingle();

    const agentCtx = await fetchAgentContext(
      supabase, lead.clinic_id, sessionId, cfg?.handoff_rules ?? [], !!cfg?.handoff_enabled, lead.id,
    );
    const system = assembleSystemPrompt(agentCtx);
    const messages = await loadConversation(supabase, sessionId, MEMORY_WINDOW, userText, c.cutoff_seq);

    // Baseline: o que o agente de producao respondeu logo depois deste mesmo turno.
    const { data: base } = await supabase.from("chat_messages")
      .select("message").eq("lead_id", lead.id).gt("seq", c.cutoff_seq)
      .order("seq", { ascending: true }).limit(6);
    const baselineReply = (base ?? [])
      .map((b: any) => (b.message?.type === "ai" ? String(b.message?.content ?? "") : null))
      .filter(Boolean)[0] ?? null;

    const { data: caso, error } = await supabase.from("ai_bench_cases").insert({
      run_label: runLabel, clinic_id: lead.clinic_id, lead_id: lead.id, session_id: sessionId,
      cutoff_seq: c.cutoff_seq, user_text: userText, system_prompt: system,
      messages, baseline_reply: baselineReply, nota: c.nota ?? null,
    }).select("id").single();
    if (error) { criados.push({ lead_id: c.lead_id, erro: error.message }); continue; }

    const linhas = modelos.map((m) => ({ case_id: caso.id, provider: m.provider, model: m.model }));
    await supabase.from("ai_bench_results").insert(linhas);
    criados.push({ case_id: caso.id, lead_id: lead.id, turnos: (messages as any[]).length, prompt_chars: system.length });
  }
  return { semeados: criados.length, casos: criados };
}

// ── run ──────────────────────────────────────────────────────────────────────
async function rodar(supabase: any, corpo: any) {
  const limite = Math.min(Number(corpo.limit ?? 3), 10);
  const budgetMs = Number(corpo.budget_ms ?? 110000);
  const t0 = Date.now();
  const { data: pares, error } = await supabase.rpc("ai_bench_claim", { p_limit: limite });
  if (error) throw new Error(`claim: ${error.message}`);
  const feitos: any[] = [];

  for (const par of (pares ?? [])) {
    if (Date.now() - t0 > budgetMs) {
      await supabase.from("ai_bench_results").update({ status: "pending" }).eq("id", par.id);
      continue;
    }
    const inicio = Date.now();
    try {
      const { data: caso } = await supabase.from("ai_bench_cases").select("*").eq("id", par.case_id).single();
      const { data: lead } = await supabase.from("leads").select("phone").eq("id", caso.lead_id).maybeSingle();
      const key = await chave(supabase, par.provider);
      const tools = agentToolSpecs();
      const messages = caso.messages as AgentMsg[];
      const runner: Runner = par.provider === "openai"
        ? new OpenAIRunner(key, par.model, caso.system_prompt, messages, tools)
        : new GeminiRunner(key, par.model, Number(corpo.temperature ?? 0.6), caso.system_prompt, messages, tools);

      const ctx: SessionCtx = {
        clinic_id: caso.clinic_id,
        lead_phone: lead?.phone ?? "",
        schedulerUrl: `${Deno.env.get("SUPABASE_URL")}/functions/v1/ai-scheduler`,
        authToken: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      };

      let texto = "";
      let tin = 0, tout = 0, iters = 0;
      const trilha: any[] = [];
      for (let i = 0; i < MAX_TOOL_ITERS; i++) {
        iters = i + 1;
        const out = await runner.passo();
        tin += out.tokensIn; tout += out.tokensOut;
        if (out.toolCalls.length === 0) { texto = out.text; break; }
        const execs = await Promise.all(out.toolCalls.map((c) => executarNaBancada(c, ctx)));
        out.toolCalls.forEach((c, k) => trilha.push({
          passo: i + 1, tool: c.name, args: c.args, simulada: execs[k].simulada,
          resposta: execs[k].output.slice(0, 600),
        }));
        runner.entregarResultados(out.toolCalls.map((c, k) => ({ call: c, output: execs[k].output })));
        if (i === MAX_TOOL_ITERS - 1) texto = out.text; // estourou o teto: fica o que houver
      }

      const limpo = sanitizeForPatient(stripCodeFences(texto || "")).trim();
      await supabase.from("ai_bench_results").update({
        status: "done", reply_text: limpo, tool_calls: trilha, iters,
        tokens_in: tin, tokens_out: tout, latency_ms: Date.now() - inicio,
        guard_hit: looksTechnical(limpo), error: null,
      }).eq("id", par.id);
      feitos.push({ modelo: par.model, ok: true, tools: trilha.length, ms: Date.now() - inicio });
    } catch (e) {
      await supabase.from("ai_bench_results").update({
        status: "error", error: String((e as Error)?.message ?? e).slice(0, 900),
        latency_ms: Date.now() - inicio,
      }).eq("id", par.id);
      feitos.push({ modelo: par.model, ok: false, erro: String((e as Error)?.message ?? e).slice(0, 200) });
    }
  }
  const { count } = await supabase.from("ai_bench_results")
    .select("id", { count: "exact", head: true }).eq("status", "pending");
  return { processados: feitos.length, restam: count ?? 0, detalhe: feitos };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supabase = svc();
  try {
    const corpo = await req.json().catch(() => ({}));
    const modo = corpo.mode || "run";
    const out = modo === "seed" ? await semear(supabase, corpo) : await rodar(supabase, corpo);
    return new Response(JSON.stringify(out), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200,
    });
  } catch (e) {
    return new Response(JSON.stringify({ erro: String((e as Error)?.message ?? e) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500,
    });
  }
});
