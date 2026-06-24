// forms-welcome-followup — envio NATIVO do follow-up de boas-vindas (migra o envio do n8n).
//
// Chamada por pg_net (sem JWT), 1 vez por lead, a partir do selector SQL process_forms_followup()
// (cron forms-followup-job, 1/min) que já fez os gates (welcome_message_enabled, delay,
// "ainda não respondeu"). Aqui fazemos: claim atômico (anti-duplicação) → envio via uazapi →
// automation_logs → chat_messages (aparece em Conversas + memória do agente).
//
// Normalização de telefone espelha _shared/phone.ts (inline); envio espelha o ai-scheduler.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

const UAZAPI_BASE = "https://med4growautomacao.uazapi.com";
const TYPING_DELAY_MS = 2500; // "digitando..." entre balões

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

async function sendText(token: string, number: string, text: string, delay = 0): Promise<boolean> {
  try {
    const resp = await fetch(`${UAZAPI_BASE}/send/text`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json", "token": token },
      body: JSON.stringify({ number, text, delay }),
    });
    return resp.ok;
  } catch (e) {
    console.error("[forms-welcome-followup] uazapi send error:", e);
    return false;
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
    .select("id");
  if (claimErr) return json({ ok: false, error: claimErr.message }, 500);
  if (!claimed || claimed.length === 0) return json({ ok: true, skipped: "already_claimed" });

  const logFail = async (reason: string) => {
    await supabase.from("automation_logs").insert({
      clinic_id, lead_id, type: "forms_welcome", status: "failed",
      message_sent: reason, triggered_at: nowSP(),
    });
  };

  // (2) token da instância uazapi
  const { data: instance } = await supabase
    .from("whatsapp_instances").select("api_token").eq("clinic_id", clinic_id).maybeSingle();
  const token = instance?.api_token;
  if (!token) { await logFail("sem api_token (WhatsApp não conectado)"); return json({ ok: false, error: "no_token" }); }

  // (3) telefones
  const leadNumber = normalizeBrazilianPhone(phone);
  const clinicNumber = normalizeBrazilianPhone(clinic_phone);
  if (!leadNumber) { await logFail("telefone do lead inválido"); return json({ ok: false, error: "invalid_phone" }); }

  // (4) mensagem (multi-balão por parágrafo)
  const rendered = renderMessage(message_text, firstNameCapitalized(name));
  const bubbles = rendered.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  if (bubbles.length === 0) { await logFail("welcome_message_text vazio"); return json({ ok: false, error: "empty_message" }); }

  // (5) envio sequencial
  let anySent = false;
  for (const bubble of bubbles) {
    const ok = await sendText(token, leadNumber, bubble, TYPING_DELAY_MS);
    anySent = anySent || ok;
  }

  const joined = bubbles.join(" | ");

  // (6) log
  await supabase.from("automation_logs").insert({
    clinic_id, lead_id, type: "forms_welcome",
    status: anySent ? "sent" : "failed",
    message_sent: joined, triggered_at: nowSP(),
  });

  // (7) memória/conversa (só se algo saiu) — mesma escrita que o n8n fazia
  if (anySent) {
    const session_id = `${clinicNumber ?? ""}${leadNumber}`;
    await supabase.from("chat_messages").insert({
      session_id,
      clinic_id,
      lead_id,
      sender: "ai",
      direction: "outbound",
      message: { type: "ai", content: `FOLLOWUP: ${joined}`, additional_kwargs: {}, response_metadata: {} },
    });
  }

  return json({ ok: true, sent: anySent, bubbles: bubbles.length, lead_id });
});
