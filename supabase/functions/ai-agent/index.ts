// ai-agent (INGEST) — ponto de entrada do Agente IA nativo. Substitui o webhook n8n
// "Agente IA | Entrada HTTP". Recebe o payload do wa-inbound (auth x-hub-secret), enfileira o
// turno em ai_turn_buffer (com o contexto necessario pro worker) e da um "kick" no worker.
// Retorno 200 imediato (fire-and-forget): quem responde ao paciente e o ai-agent-worker.
//
// Escala: O(1), sem bloquear. O debounce e o loop de LLM vivem no worker, desacoplados.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-hub-secret",
};

// deno-lint-ignore no-explicit-any
const bg = (p: Promise<any>) => {
  try { (globalThis as any).EdgeRuntime?.waitUntil?.(p); } catch { /* fallback: nao aguarda */ }
};

async function registrarErro(supabase: any, code: string, title: string, level: string, clinicId: string | null, ctx: unknown) {
  try {
    await supabase.rpc("log_system_error", {
      p_scope: "ai-agent", p_code: code, p_title: title, p_level: level,
      p_clinic_id: clinicId, p_context: ctx,
    });
  } catch (e) { console.error("[ai-agent] log falhou:", e); }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const secret = Deno.env.get("HUB_AI_SECRET") || "";
  if (secret && req.headers.get("x-hub-secret") !== secret) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  let clinicId: string | null = null;
  try {
    const p = await req.json();
    clinicId = p.clinic_id ?? null;

    const clinicPhone = String(p.clinic_phone ?? "");
    const leadPhone = String(p.lead_phone ?? "");
    const mensagem = String(p.mensagem ?? "").trim();
    const sessionId = clinicPhone + leadPhone;

    if (!p.clinic_id || !leadPhone || !sessionId) {
      return json({ ok: false, error: "missing clinic_id/lead_phone" }, 400);
    }
    // Sem texto (ex.: midia sem transcricao) -> nada a responder; nao enfileira.
    if (!mensagem) return json({ ok: true, skipped: "empty_message" });

    const waitSeconds = Number(p.response_wait_seconds) || 30;
    const midiaType = ((p.midia_kind ?? "") + " " + (p.midia_mime ?? "")).trim();

    const context = {
      token: p.uazapi_token ?? null,
      contact_identifier: p.contact_identifier ?? leadPhone,
      lead_phone: leadPhone,
      clinic_phone: clinicPhone,
      lead_id: p.lead_id ?? null,
      handoff_enabled: p.handoff_enabled ?? false,
      handoff_rules: p.handoff_rules ?? [],
      transition_rules: p.transition_rules ?? [],
      confirm_enabled: p.confirm_enabled ?? false,
      midia_type: midiaType,
    };

    const { error } = await supabase.rpc("enqueue_ai_turn", {
      p_session_id: sessionId,
      p_clinic_id: String(p.clinic_id),
      p_text: mensagem,
      p_wait_seconds: waitSeconds,
      p_context: context,
    });
    if (error) {
      await registrarErro(supabase, "enqueue_falhou", "Nao deu para enfileirar o turno do Agente IA", "error", clinicId, { erro: error.message, session_id: sessionId });
      return json({ ok: false, error: "enqueue_failed" }, 500);
    }

    // Kick do worker (best-effort, em background): o worker espera o debounce e processa.
    const workerUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/ai-agent-worker`;
    bg(fetch(workerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-hub-secret": secret },
      body: JSON.stringify({ mode: "kick", session_id: sessionId, wait_seconds: waitSeconds }),
    }).catch(() => {/* backstop: o cron varre os vencidos */}));

    return json({ ok: true, enqueued: true });
  } catch (e) {
    await registrarErro(supabase, "ingest_quebrou", "A ingest do Agente IA quebrou", "error", clinicId, { erro: String(e) });
    return json({ ok: false, error: String(e) }, 500);
  }
});
