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

    const leadPhone = String(p.lead_phone ?? "");
    const mensagem = String(p.mensagem ?? "").trim();
    // ⚠️ CHAVE DA MEMORIA. Vem PRONTA de quem gravou a conversa: ingest_wa_message devolve
    // fn_chat_session_id(clinica, telefone NORMALIZADO), a mesma funcao que o trigger
    // fn_fill_chat_session_id usa. Telefone e chave, e chave tem um dono so, que e o banco.
    //
    // NAO EXISTE MAIS FALLBACK, e isso e decisao. Ate 30/07/2026 esta linha montava
    // `clinic_phone + lead_phone` com o telefone CRU do chatid (13 digitos, COM o 9) enquanto a
    // conversa era gravada sem o 9: o agente lia e escrevia numa sessao onde so existiam as falas
    // dele mesmo, o loadConversation descartava os 'assistant' do inicio, sobrava UMA mensagem sem
    // historico, e o modelo se reapresentava e repergunta o nome no meio do atendimento
    // (Clinica Vaz: 49 de 59 leads com IA em 14 dias).
    //
    // Remontar aqui tinha um segundo risco, pior: quando a instancia da clinica esta sem
    // phone_number (15 das 34 clinicas hoje, e toda clinica na janela entre conectar e o cron de
    // deteccao preencher), `clinic_phone` vinha vazio e a chave virava SO o telefone do paciente.
    // A unica de `ai_turn_buffer` e por session_id, e o ON CONFLICT sobrescreve clinic_id e
    // context: o mesmo paciente falando com duas clinicas colapsaria numa linha de fila e o turno
    // de uma seria respondido com o contexto e o token da outra. Silencio com alerta e melhor que
    // atendimento cruzado entre clinicas.
    const sessionId = String(p.session_id ?? "").trim();

    if (!p.clinic_id || !leadPhone) {
      return json({ ok: false, error: "missing clinic_id/lead_phone" }, 400);
    }
    // Sem texto (ex.: midia sem transcricao) -> nada a responder; nao enfileira.
    if (!mensagem) return json({ ok: true, skipped: "empty_message" });

    if (!sessionId) {
      // bg(): o alerta e diagnostico e nao pode entrar no caminho critico do paciente. O
      // wa-inbound espera esta resposta antes de devolver 200 a uazapi.
      bg(registrarErro(supabase, "turno_sem_chave_de_memoria",
        "O turno do paciente NAO foi processado: a clinica esta sem o telefone da instancia do WhatsApp, e sem ele nao existe chave de memoria",
        "critical", clinicId, {
          lead_phone: leadPhone,
          obs: "Conferir whatsapp_instances.phone_number desta clinica (o cron de deteccao roda 09h/18h). "
             + "O turno foi recusado de proposito: sem prefixo da clinica a chave colide entre clinicas na fila.",
        }));
      return json({ ok: true, skipped: "sem_chave_de_memoria" });
    }

    const waitSeconds = Number(p.response_wait_seconds) || 30;
    const midiaType = ((p.midia_kind ?? "") + " " + (p.midia_mime ?? "")).trim();

    const context = {
      token: p.uazapi_token ?? null,
      contact_identifier: p.contact_identifier ?? leadPhone,
      lead_phone: leadPhone,
      clinic_phone: String(p.clinic_phone ?? ""),
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
