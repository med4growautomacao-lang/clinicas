// ai-agent-worker — o cerebro do Agente IA nativo. Processa turnos VENCIDOS do ai_turn_buffer:
// contexto -> loop de tool-calling (LLM config-driven) -> fan-out em bolhas -> grava memoria ->
// transicao de etapa. Substitui o loop do "AI Agent" + fan-out do workflow n8n.
//
// Disparo: (a) "kick" do ingest (espera o debounce e processa a sessao) ou (b) "sweep" do pg_cron
// (varre todos os vencidos). Claim atomico (claim_due_ai_turns) => coalescing + sem processo duplo.
// Escala: stateless, horizontal. Toda falha vai pra Central de Erros (log_system_error).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { runAgentTurn, type AgentMsg, type ModelConfig } from "../_shared/llm.ts";
import { agentToolSpecs, executeToolCall, type SessionCtx } from "../_shared/agent/tools.ts";
import { assembleSystemPrompt, fetchAgentContext } from "../_shared/agent/prompt.ts";
import { splitIntoBubbles } from "../_shared/agent/split.ts";
import { loadConversation, saveAiResponse } from "../_shared/agent/memory.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-hub-secret",
};
const UAZAPI_BASE = "https://med4growautomacao.uazapi.com";
const MEMORY_WINDOW = 10;
const MAX_TOOL_ITERS = 8;

const DEFAULT_CFG: ModelConfig = {
  provider: "gemini", model: "gemini-3.1-pro-preview-customtools", temperature: 0.6, fallback: null,
};

// deno-lint-ignore no-explicit-any
const bg = (p: Promise<any>) => { try { (globalThis as any).EdgeRuntime?.waitUntil?.(p); } catch { /* */ } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function svc() {
  return createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
}
async function registrarErro(supabase: any, code: string, title: string, level: string, clinicId: string | null, ctx: unknown) {
  try {
    await supabase.rpc("log_system_error", { p_scope: "ai-agent-worker", p_code: code, p_title: title, p_level: level, p_clinic_id: clinicId, p_context: ctx });
  } catch (e) { console.error("[ai-agent-worker] log falhou:", e); }
}

async function loadModelConfig(supabase: any): Promise<ModelConfig> {
  try {
    const { data } = await supabase.from("system_settings").select("value").eq("id", "agent_ai_config").maybeSingle();
    if (data?.value) {
      const c = JSON.parse(data.value);
      if (c?.provider && c?.model) return { provider: c.provider, model: c.model, temperature: Number(c.temperature ?? 0.6), fallback: c.fallback ?? null };
    }
  } catch { /* default */ }
  return DEFAULT_CFG;
}

async function sendText(token: string, number: string, text: string): Promise<boolean> {
  try {
    const r = await fetch(`${UAZAPI_BASE}/send/text`, {
      method: "POST",
      signal: AbortSignal.timeout(20000),
      headers: { "Content-Type": "application/json", "Accept": "application/json", "token": token },
      body: JSON.stringify({ number, text, delay: 0 }),
    });
    return r.ok;
  } catch { return false; }
}

// Fan-out: manda as bolhas em ordem, com pausa natural entre elas (typing).
async function sendBubbles(token: string, number: string, bubbles: string[]): Promise<void> {
  for (let i = 0; i < bubbles.length; i++) {
    await sendText(token, number, bubbles[i]);
    if (i < bubbles.length - 1) await sleep(Math.min(600 + bubbles[i].length * 20, 3000));
  }
}

// ── Voz (ElevenLabs) ─────────────────────────────────────────────────────────
// Config em system_settings.elevenlabs_config (enabled+voice_id+model_id); chave no Vault.
async function loadElevenLabs(supabase: any): Promise<{ enabled: boolean; voice_id: string; model_id: string; key: string | null }> {
  try {
    const { data } = await supabase.from("system_settings").select("value").eq("id", "elevenlabs_config").maybeSingle();
    const c = data?.value ? JSON.parse(data.value) : {};
    if (!c.enabled || !c.voice_id) return { enabled: false, voice_id: "", model_id: "", key: null };
    const { data: k } = await supabase.rpc("get_llm_secret", { p_name: "ELEVENLABS_API_KEY" });
    return { enabled: true, voice_id: String(c.voice_id), model_id: c.model_id || "eleven_multilingual_v2", key: (k && String(k).trim()) ? String(k) : null };
  } catch { return { enabled: false, voice_id: "", model_id: "", key: null }; }
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}

async function ttsElevenLabs(key: string, voiceId: string, modelId: string, text: string): Promise<string | null> {
  const resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: "POST",
    signal: AbortSignal.timeout(30000),
    headers: { "xi-api-key": key, "Content-Type": "application/json", "Accept": "audio/mpeg" },
    body: JSON.stringify({ text, model_id: modelId || "eleven_multilingual_v2" }),
  });
  if (!resp.ok) return null;
  return toBase64(new Uint8Array(await resp.arrayBuffer()));
}

async function sendAudio(token: string, number: string, base64: string): Promise<boolean> {
  try {
    const r = await fetch(`${UAZAPI_BASE}/send/media`, {
      method: "POST",
      signal: AbortSignal.timeout(30000),
      headers: { "Content-Type": "application/json", "Accept": "application/json", "token": token },
      body: JSON.stringify({ number, type: "audio", file: base64, delay: 0 }),
    });
    return r.ok;
  } catch { return false; }
}

// Transicao de etapa por IA — reescrita CERTA (via ticket, nao leads.stage_id cru).
async function applyStageTransition(supabase: any, clinicId: string, leadId: string | null, text: string): Promise<void> {
  if (!leadId || !text) return;
  const { data: rules } = await supabase.from("stage_transition_rules").select("keywords, target_stage_id").eq("clinic_id", clinicId);
  if (!rules || rules.length === 0) return;
  const hay = text.toLowerCase();
  const hit = rules.find((r: any) => r.keywords && r.target_stage_id && hay.includes(String(r.keywords).toLowerCase()));
  if (!hit) return;
  const { data: ticket } = await supabase.from("tickets").select("id").eq("lead_id", leadId).eq("status", "open").order("opened_at", { ascending: false }).limit(1).maybeSingle();
  if (!ticket?.id) return;
  await supabase.rpc("set_ticket_stage", { p_ticket_id: ticket.id, p_new_stage_id: hit.target_stage_id, p_source: "ia", p_on_resolved: "block" });
}

// Uma rodada de modelo, com fallback de provider/modelo se o primario quebrar.
async function modelTurn(supabase: any, cfg: ModelConfig, system: string, messages: AgentMsg[], tools: any[]) {
  try {
    return await runAgentTurn(supabase, cfg, system, messages, tools);
  } catch (e) {
    if (cfg.fallback?.provider && cfg.fallback?.model) {
      const fb: ModelConfig = { provider: cfg.fallback.provider as any, model: cfg.fallback.model, temperature: cfg.temperature, fallback: null };
      return await runAgentTurn(supabase, fb, system, messages, tools);
    }
    throw e;
  }
}

async function processTurn(supabase: any, turn: { session_id: string; clinic_id: string | null; buffer: string; context: any }) {
  const clinicId = turn.clinic_id || turn.context?.clinic_id || null;
  const ctx = turn.context || {};
  const token: string = ctx.token || "";
  const number: string = ctx.contact_identifier || ctx.lead_phone || "";
  const leadPhone: string = ctx.lead_phone || "";
  const buffer = (turn.buffer || "").trim();
  if (!clinicId || !buffer) return;

  try {
    const cfg = await loadModelConfig(supabase);
    const schedulerUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/ai-scheduler`;
    const authToken = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const session: SessionCtx = { clinic_id: clinicId, lead_phone: leadPhone, schedulerUrl, authToken };

    const agentCtx = await fetchAgentContext(supabase, clinicId, turn.session_id, ctx.handoff_rules ?? [], !!ctx.handoff_enabled);
    const system = assembleSystemPrompt(agentCtx);
    const tools = agentToolSpecs();

    const messages = await loadConversation(supabase, turn.session_id, MEMORY_WINDOW, buffer);

    // Loop de tool-calling
    let finalText = "";
    for (let iter = 0; iter < MAX_TOOL_ITERS; iter++) {
      const out = await modelTurn(supabase, cfg, system, messages, tools);
      if (out.toolCalls.length === 0) { finalText = out.text; break; }

      // registra o passo do assistente (texto + tool_calls) e executa as tools em paralelo
      messages.push({ role: "assistant", text: out.text || undefined, toolCalls: out.toolCalls });
      const results = await Promise.all(out.toolCalls.map((c) => executeToolCall(c, session)));
      out.toolCalls.forEach((c, i) => messages.push({ role: "tool", callId: c.id, name: c.name, result: results[i] }));

      if (iter === MAX_TOOL_ITERS - 1) {
        // ultimo passo: forca uma resposta textual sem mais tools
        const closing = await modelTurn(supabase, cfg, system, messages, []);
        finalText = closing.text;
      }
    }

    finalText = (finalText || "").trim();
    if (!finalText) {
      await registrarErro(supabase, "resposta_vazia", "O agente terminou o turno sem texto para enviar ao paciente", "warning", clinicId, { session_id: turn.session_id });
      return;
    }

    // Fan-out: se o paciente mandou AUDIO e o ElevenLabs esta ligado, responde em VOZ; qualquer
    // falha (desligado, sem chave, sem credito, erro de TTS) cai para TEXTO e registra na Central.
    let sentAudio = false;
    const audioWanted = String(ctx.midia_type || "").toLowerCase().includes("audio");
    if (audioWanted && token && number) {
      const el = await loadElevenLabs(supabase);
      if (el.enabled && el.voice_id && el.key) {
        try {
          const b64 = await ttsElevenLabs(el.key, el.voice_id, el.model_id, finalText);
          if (b64) sentAudio = await sendAudio(token, number, b64);
        } catch { sentAudio = false; }
        if (!sentAudio) await registrarErro(supabase, "audio_fallback_texto", "TTS ElevenLabs falhou; a resposta saiu em texto (fallback)", "warning", clinicId, { session_id: turn.session_id });
      }
    }
    if (!sentAudio) {
      const bubbles = splitIntoBubbles(finalText);
      if (token && number && bubbles.length) await sendBubbles(token, number, bubbles);
      else await registrarErro(supabase, "envio_sem_credenciais", "Resposta pronta mas sem token/numero para enviar", "error", clinicId, { session_id: turn.session_id, tem_token: !!token, tem_numero: !!number });
    }

    await saveAiResponse(supabase, turn.session_id, finalText);
    await applyStageTransition(supabase, clinicId, ctx.lead_id ?? null, finalText);
  } catch (e) {
    await registrarErro(supabase, "turno_quebrou", "O turno do Agente IA quebrou no worker — paciente pode ter ficado sem resposta", "critical", clinicId, { session_id: turn.session_id, erro: (e as Error).message, stack: (e as Error).stack?.slice(0, 500) });
  }
}

async function drainDue(supabase: any, sessionId: string | null) {
  // Claim + processa em lotes ate esvaziar (bounded).
  for (let round = 0; round < 20; round++) {
    const { data, error } = await supabase.rpc("claim_due_ai_turns", { p_session_id: sessionId, p_limit: 25 });
    if (error) { await registrarErro(supabase, "claim_falhou", "Nao deu para reivindicar turnos vencidos", "error", null, { erro: error.message }); return; }
    const turns = (data || []) as any[];
    if (turns.length === 0) return;
    await Promise.all(turns.map((t) => processTurn(supabase, t)));
    if (sessionId) return; // kick de sessao unica: um round basta
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  // Sem gate de secret DE PROPOSITO: o worker so DRENA a fila (ai_turn_buffer), que apenas o
  // ingest autenticado popula (via enqueue_ai_turn, service_role). O claim e atomico e idempotente
  // — nao da pra injetar mensagem, reprocessar turno nem escolher destino. Uma chamada externa so
  // adianta o processamento de um turno JA vencido, que o cron faria de qualquer forma.
  const supabase = svc();
  let body: any = {};
  try { body = await req.json(); } catch { /* cron pode chamar sem corpo */ }
  const mode = body.mode || "sweep";

  if (mode === "kick" && body.session_id) {
    // Espera o debounce vencer, entao processa a sessao (em background; responde ja).
    const wait = (Number(body.wait_seconds) || 30) * 1000 + 750;
    bg((async () => { await sleep(wait); await drainDue(supabase, body.session_id); })());
    return json({ ok: true, scheduled: true });
  }

  // sweep (cron): drena todos os vencidos, em background.
  bg(drainDue(supabase, null));
  return json({ ok: true, swept: true });
});
