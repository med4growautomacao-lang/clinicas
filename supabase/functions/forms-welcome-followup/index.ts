// forms-welcome-followup — envio NATIVO do follow-up de boas-vindas (migra o envio do n8n).
//
// Chamada por pg_net (sem JWT), 1 vez por lead, a partir do selector SQL process_forms_followup()
// (cron forms-followup-job, 1/min) que já fez os gates (welcome_message_enabled, delay,
// "ainda não respondeu"). Aqui fazemos: claim atômico (anti-duplicação) →
// resolve o número real no WhatsApp (uazapi /chat/check, tenta com/sem 9º dígito) →
// envio via uazapi → automation_logs → chat_messages (aparece em Conversas + memória).
//
// Tratamento de falha:
//   • número não está no WhatsApp (check confirma) → marca leads.whatsapp_invalid=true (sinaliza
//     no card do Kanban e em Conversas), loga o motivo, NÃO reenvia (terminal).
//   • envio falhou mas o número é válido (erro transitório do uazapi) → retry LIMITADO
//     (welcome_attempts < MAX): reverte o claim (welcome_sent=false) p/ o cron tentar de novo.
//   • falha de INFRA (a conta da clínica está fora do ar ou restrita pelo WhatsApp) → NÃO consome
//     tentativa. O lead volta para a fila e é atendido quando a conta voltar.
//     Sem isso, a culpa da infra caía no lead: em 10–13/07 o WhatsApp da Clínica Vaz caiu e depois
//     foi restringido (erro 463), e 14 leads reais gastaram as 3 tentativas contra uma parede e
//     ficaram marcados como "enviado" — nunca receberiam nada.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_ATTEMPTS = 3; // tentativas de envio p/ número válido antes de desistir (evita loop)

// A conta da clínica está fora do ar / punida pelo WhatsApp? Então o problema não é o lead.
//   503 "session is not reconnectable" → WhatsApp desconectado
//   463 / reachout_timelock            → WhatsApp restringiu a conta de iniciar conversas
//   status 0                           → a própria uazapi não respondeu
function isInfraFailure(err: { status: number; body: string } | null): boolean {
  if (!err) return false;
  if (err.status === 0 || err.status === 503) return true;
  const b = (err.body || "").toLowerCase();
  return b.includes("463")
    || b.includes("reachout_timelock")
    || b.includes("temporary restr")
    || b.includes("disconnected")
    || b.includes("not reconnectable");
}

// A uazapi informa até quando a restrição vale — usamos para não martelar a API até lá.
function blockedUntilFrom(body: string): string | null {
  try {
    const m = body.match(/"until"\s*:\s*"([^"]+)"/);
    if (m && !Number.isNaN(Date.parse(m[1]))) return new Date(m[1]).toISOString();
  } catch { /* corpo não-JSON: ignora */ }
  return null;
}

// Mesma lógica de _shared/phone.ts (inline p/ deploy sem dependência relativa):
// normaliza p/ o formato BR canônico (sem o 9º dígito), igual ao n8n.
function normalizeBrazilianPhone(rawInput: string | null | undefined): string | null {
  if (!rawInput) return null;
  let phone = String(rawInput).replace(/\D/g, "");
  if (!phone) return null;
  phone = phone.replace(/^0+/, "");
  const stripExtra9 = (digits: string): string => {
    if (digits.length === 13 && digits.startsWith("55")) {
      const country = digits.slice(0, 2);
      const ddd = digits.slice(2, 4);
      let rest = digits.slice(4);
      if (rest.startsWith("9")) rest = rest.slice(1);
      return country + ddd + rest;
    }
    return digits;
  };
  if (phone.startsWith("55")) return stripExtra9(phone);
  if (phone.length === 10 || phone.length === 11) return stripExtra9("55" + phone);
  return phone;
}

// Candidatos a jid no WhatsApp: o número normalizado (sem 9) e, p/ celular BR, a variante COM o 9.
// Muitos celulares só existem no WhatsApp com o 9 — por isso testamos os dois.
function whatsappCandidates(normalized: string): string[] {
  const out = [normalized];
  if (/^55\d{10}$/.test(normalized)) {
    out.push(normalized.slice(0, 4) + "9" + normalized.slice(4)); // 55 + DDD + 9 + resto
  }
  return out;
}

const UAZAPI_BASE = "https://med4growautomacao.uazapi.com";
const TYPING_DELAY_MS = 5000; // "digitando..." (delay uazapi) antes de cada balão

// horário de São Paulo (UTC-3) sem timezone — formato das colunas *_at em SP
function nowSP(): string {
  return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().replace("Z", "");
}

function firstNameCapitalized(name: string | null | undefined): string {
  const first = String(name || "").trim().split(/\s+/)[0] || "";
  if (!first) return "";
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

function renderMessage(text: string, firstName: string): string {
  return String(text || "")
    .replace(/\{name\}/gi, firstName)
    .replace(/\{nome\}/gi, firstName)
    .replace(/\{paciente\}/gi, firstName)
    .trim();
}

// Consulta o uazapi se algum dos candidatos existe no WhatsApp.
//   valid   → number = jid resolvido (mandar p/ esse);
//   invalid → todos responderam e nenhum está no WhatsApp (número sem WhatsApp);
//   unknown → check indisponível/parcial (não bloqueia; cai no fallback de envio).
async function checkWhatsapp(
  token: string,
  numbers: string[],
): Promise<{ status: "valid"; number: string } | { status: "invalid" } | { status: "unknown" }> {
  try {
    const resp = await fetch(`${UAZAPI_BASE}/chat/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json", "token": token },
      body: JSON.stringify({ numbers }),
    });
    if (!resp.ok) return { status: "unknown" };
    const arr = await resp.json();
    if (!Array.isArray(arr)) return { status: "unknown" };
    const hit = arr.find((x: any) => x?.isInWhatsapp === true);
    if (hit) {
      const jidNum = String(hit.jid || "").split("@")[0];
      return { status: "valid", number: jidNum || String(hit.query ?? "") };
    }
    const allAnswered = numbers.every((q) => arr.some((x: any) => String(x?.query) === q));
    return allAnswered ? { status: "invalid" } : { status: "unknown" };
  } catch (e) {
    console.error("[forms-welcome-followup] check error:", e);
    return { status: "unknown" };
  }
}

async function sendText(
  token: string,
  number: string,
  text: string,
  delay = 0,
): Promise<{ ok: boolean; status: number; body: string }> {
  try {
    const resp = await fetch(`${UAZAPI_BASE}/send/text`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json", "token": token },
      body: JSON.stringify({ number, text, delay }),
    });
    const body = await resp.text().catch(() => "");
    return { ok: resp.ok, status: resp.status, body: body.slice(0, 500) };
  } catch (e) {
    console.error("[forms-welcome-followup] uazapi send error:", e);
    return { ok: false, status: 0, body: String(e) };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  let body: any;
  try { body = await req.json(); } catch { body = {}; }
  const { lead_id, clinic_id, name, phone, clinic_phone, message_text } = body ?? {};

  const json = (obj: unknown, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  if (!lead_id || !clinic_id) return json({ ok: false, error: "lead_id e clinic_id obrigatórios" }, 400);

  // DRY-RUN: prévia da mensagem renderizada (substitui {paciente}/{name}/{nome}), SEM claim/envio/log.
  if (body?.dry_run === true) {
    const { data: lead } = await supabase.from("leads").select("name").eq("id", lead_id).maybeSingle();
    const { data: cfg } = await supabase.from("ai_config").select("welcome_message_text").eq("clinic_id", clinic_id).maybeSingle();
    const fn = firstNameCapitalized(lead?.name ?? name);
    const rendered = renderMessage(cfg?.welcome_message_text ?? message_text, fn);
    const bubbles = rendered.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
    return json({ ok: true, dry_run: true, first_name: fn, bubbles });
  }

  // (1) CLAIM ATÔMICO — trava anti-duplicação. Só quem flipar welcome_sent false→true envia.
  const { data: claimed, error: claimErr } = await supabase
    .from("leads")
    .update({ welcome_sent: true })
    .eq("id", lead_id)
    .eq("welcome_sent", false)
    .select("id, welcome_attempts");
  if (claimErr) return json({ ok: false, error: claimErr.message }, 500);
  if (!claimed || claimed.length === 0) return json({ ok: true, skipped: "already_claimed" });
  const priorAttempts = Number(claimed[0]?.welcome_attempts ?? 0);

  // (1.1) BLINDAGEM: se o lead já tem QUALQUER mensagem (recebeu ou enviou), NÃO manda welcome.
  // O selector já checa isso, mas há uma janelinha de corrida entre selecionar e chegar aqui.
  // welcome_sent fica true (terminal: já há conversa, não precisa de boas-vindas).
  const { count: msgCount } = await supabase
    .from("chat_messages").select("id", { count: "exact", head: true }).eq("lead_id", lead_id);
  if ((msgCount ?? 0) > 0) {
    return json({ ok: true, skipped: "has_messages", lead_id });
  }

  const logFail = async (reason: string, metadata: Record<string, unknown> = {}) => {
    await supabase.from("automation_logs").insert({
      clinic_id, lead_id, type: "forms_welcome", status: "failed",
      message_sent: reason, triggered_at: nowSP(), metadata,
    });
  };

  // (2) token da instância uazapi
  const { data: instance } = await supabase
    .from("whatsapp_instances").select("api_token").eq("clinic_id", clinic_id).maybeSingle();
  const token = instance?.api_token;
  if (!token) { await logFail("sem api_token (WhatsApp não conectado)", { reason: "no_token" }); return json({ ok: false, error: "no_token" }); }

  // (3) telefones
  const leadNumber = normalizeBrazilianPhone(phone);
  const clinicNumber = normalizeBrazilianPhone(clinic_phone);
  if (!leadNumber) { await logFail("telefone do lead inválido", { reason: "invalid_phone", phone }); return json({ ok: false, error: "invalid_phone" }); }

  // (3.1) resolve o número real no WhatsApp (testa sem-9 e com-9)
  const candidates = whatsappCandidates(leadNumber);
  const check = await checkWhatsapp(token, candidates);
  if (check.status === "invalid") {
    // Número confirmado SEM WhatsApp → sinaliza no card/Conversas e NÃO reenvia (terminal).
    await supabase.from("leads").update({ whatsapp_invalid: true }).eq("id", lead_id);
    await logFail("número não está no WhatsApp", { reason: "not_on_whatsapp", checked: candidates, phone });
    return json({ ok: true, whatsapp_invalid: true, lead_id });
  }
  const sendNumber = check.status === "valid" ? check.number : leadNumber; // unknown → tenta o normalizado

  // (4) mensagem (multi-balão por parágrafo)
  const rendered = renderMessage(message_text, firstNameCapitalized(name));
  const bubbles = rendered.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  if (bubbles.length === 0) { await logFail("welcome_message_text vazio", { reason: "empty_message" }); return json({ ok: false, error: "empty_message" }); }

  // (5) envio sequencial (cada balão com delay de digitação da uazapi)
  let anySent = false;
  let lastErr: { status: number; body: string } | null = null;
  for (const bubble of bubbles) {
    const r = await sendText(token, sendNumber, bubble, TYPING_DELAY_MS);
    if (r.ok) anySent = true;
    else lastErr = { status: r.status, body: r.body };
  }

  const joined = bubbles.join(" | ");

  if (anySent) {
    // sucesso
    await supabase.from("automation_logs").insert({
      clinic_id, lead_id, type: "forms_welcome", status: "sent",
      message_sent: joined, triggered_at: nowSP(), metadata: { number: sendNumber },
    });
    // limpa flag (caso estivesse marcada) e zera contador
    await supabase.from("leads").update({ whatsapp_invalid: false, welcome_attempts: 0 }).eq("id", lead_id);
    // memória/conversa — mesma escrita que o n8n fazia
    const session_id = `${clinicNumber ?? ""}${leadNumber}`;
    await supabase.from("chat_messages").insert({
      // sender/type 'system': automação não é fala do Agente IA (atribuição + memória + ícone próprio)
      session_id, clinic_id, lead_id, sender: "system", direction: "outbound",
      message: { type: "system", content: `FOLLOWUP: ${joined}`, additional_kwargs: {}, response_metadata: {} },
    });
    return json({ ok: true, sent: true, bubbles: bubbles.length, lead_id });
  }

  // (6a) A CONTA da clínica está fora do ar / restrita → a culpa não é do lead.
  // Devolve o lead à fila SEM consumir tentativa, e anota até quando a conta está bloqueada para
  // o selector parar de enfileirar (evita marteladas de 1/min contra uma parede).
  if (isInfraFailure(lastErr)) {
    const until = blockedUntilFrom(lastErr?.body ?? "");
    await logFail("conta da clínica indisponível (não conta como tentativa)", {
      reason: "infra_unavailable", uazapi: lastErr, blocked_until: until,
    });

    await supabase.from("whatsapp_instances").update({
      // sem "until" explícito (ex: desconexão), espera curta e tenta de novo
      send_blocked_until: until ?? new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    }).eq("clinic_id", clinic_id);

    // welcome_attempts NÃO é incrementado: o lead não fez nada de errado.
    await supabase.from("leads").update({ welcome_sent: false }).eq("id", lead_id);

    return json({ ok: false, sent: false, infra_unavailable: true, blocked_until: until, lead_id });
  }

  // (6b) falha de envio com número (provavelmente) válido → retry LIMITADO
  const attempts = priorAttempts + 1;
  await logFail("falha no envio (uazapi)", { reason: "send_failed", attempt: attempts, uazapi: lastErr });
  if (attempts < MAX_ATTEMPTS) {
    // reverte o claim p/ o cron tentar de novo no próximo tick
    await supabase.from("leads").update({ welcome_sent: false, welcome_attempts: attempts }).eq("id", lead_id);
  } else {
    // desiste após MAX_ATTEMPTS (welcome_sent fica true → cron não pega mais)
    await supabase.from("leads").update({ welcome_attempts: attempts }).eq("id", lead_id);
  }
  return json({ ok: false, sent: false, retry: attempts < MAX_ATTEMPTS, attempt: attempts, lead_id });
});
