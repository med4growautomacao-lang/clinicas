// reengagement-followup — envio NATIVO do follow-up de reengajamento (migra o envio do n8n).
//
// Chamada por pg_net (sem JWT), 1 vez por lead, a partir do selector SQL
// process_reengagement_followup() (cron a cada 15 min) que já fez os gates duráveis.
// Aqui: claim atômico (count++ + sent_at, com re-check das exclusões duráveis) → envio multi-balão
// via uazapi → automation_logs (type=followup) → chat_messages (REENGAJAMENTO).
//
// Normalização de telefone espelha _shared/phone.ts (inline); envio espelha o ai-scheduler/welcome.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
const TYPING_DELAY_MS = 5000;

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
    console.error("[reengagement-followup] uazapi send error:", e);
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
  const { lead_id, clinic_id, name, phone, clinic_phone, message_text, step_no, expected_count, is_closing } = body ?? {};

  const json = (obj: unknown, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  if (!lead_id || !clinic_id) return json({ ok: false, error: "lead_id e clinic_id obrigatórios" }, 400);

  // DRY-RUN: prévia da mensagem renderizada, SEM claim/envio/log.
  if (body?.dry_run === true) {
    const { data: lead } = await supabase.from("leads").select("name").eq("id", lead_id).maybeSingle();
    const fn = firstNameCapitalized(lead?.name ?? name);
    const rendered = renderMessage(message_text, fn);
    const bubbles = rendered.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
    return json({ ok: true, dry_run: true, first_name: fn, step_no: step_no ?? null, bubbles });
  }

  const v_expected = Number(expected_count ?? 0);

  // (1) CLAIM ATÔMICO + re-check das exclusões duráveis. Só avança quem casar followup_count.
  const { data: claimed, error: claimErr } = await supabase
    .from("leads")
    .update({ followup_count: v_expected + 1, followup_sent_at: nowSP() })
    .eq("id", lead_id)
    .eq("followup_count", v_expected)
    .eq("followup_enabled", true)
    .eq("ai_enabled", true)
    .is("handoff_triggered_at", null)
    .is("converted_patient_id", null)
    .select("id");
  if (claimErr) return json({ ok: false, error: claimErr.message }, 500);
  if (!claimed || claimed.length === 0) return json({ ok: true, skipped: "not_claimed" });

  // (1.1) Re-check da direção da última mensagem. O selector já exige last_dir='outbound', mas há
  // uma janela entre selecionar e chegar aqui: se o lead RESPONDEU nesse meio-tempo, NÃO reengaja
  // por cima da resposta fresca (parece que o bot ignorou o cliente). Devolve o passo à régua
  // (followup_count volta ao valor anterior) — quando ele voltar a ficar em silêncio, reentra.
  const { data: lastMsg } = await supabase
    .from("chat_messages")
    .select("direction")
    .eq("lead_id", lead_id)
    .order("seq", { ascending: false })
    .limit(1);
  if (lastMsg && lastMsg.length > 0 && lastMsg[0].direction === "inbound") {
    await supabase.from("leads").update({ followup_count: v_expected }).eq("id", lead_id);
    return json({ ok: true, skipped: "lead_replied" });
  }

  const logFail = async (reason: string) => {
    await supabase.from("automation_logs").insert({
      clinic_id, lead_id, type: "followup", status: "failed",
      message_sent: reason, triggered_at: nowSP(), metadata: { step_no: step_no ?? null },
    });
  };

  // (2) token uazapi
  const { data: instance } = await supabase
    .from("whatsapp_instances").select("api_token").eq("clinic_id", clinic_id).maybeSingle();
  const token = instance?.api_token;
  if (!token) { await logFail("sem api_token (WhatsApp não conectado)"); return json({ ok: false, error: "no_token" }); }

  // (3) telefones
  const leadNumber = normalizeBrazilianPhone(phone);
  const clinicNumber = normalizeBrazilianPhone(clinic_phone);
  if (!leadNumber) { await logFail("telefone do lead inválido"); return json({ ok: false, error: "invalid_phone" }); }

  // (4) mensagem do passo (multi-balão por parágrafo)
  const rendered = renderMessage(message_text, firstNameCapitalized(name));
  const bubbles = rendered.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  if (bubbles.length === 0) { await logFail("mensagem do passo vazia"); return json({ ok: false, error: "empty_message" }); }

  // (5) envio sequencial
  let anySent = false;
  for (const bubble of bubbles) {
    const ok = await sendText(token, leadNumber, bubble, TYPING_DELAY_MS);
    anySent = anySent || ok;
  }

  const joined = bubbles.join(" | ");

  // (6) log
  await supabase.from("automation_logs").insert({
    clinic_id, lead_id, type: "followup",
    status: anySent ? "sent" : "failed",
    message_sent: joined, triggered_at: nowSP(), metadata: { step_no: step_no ?? null },
  });

  // (7) memória/conversa (só se algo saiu)
  if (anySent) {
    const session_id = `${clinicNumber ?? ""}${leadNumber}`;
    await supabase.from("chat_messages").insert({
      session_id,
      clinic_id,
      lead_id,
      // sender/type 'system': automação não é fala do Agente IA (atribuição + memória + ícone próprio)
      sender: "system",
      direction: "outbound",
      message: { type: "system", content: joined, additional_kwargs: {}, response_metadata: {} },
    });
  }

  // (8) ENCERRAMENTO: passo is_closing FECHA o ticket como Perdido via finalize_ticket (RPC canônica
  // — seta outcome=perdido + etapa + loss_reason + resolve + invariantes). resolve=true: a resposta
  // tardia abre um ticket NOVO limpo (reinicia a régua) e o Pós-Atendimento perdido pode disparar.
  let closed = false;
  if (is_closing === true) {
    const { data: openTickets } = await supabase
      .from("tickets").select("id").eq("lead_id", lead_id).eq("status", "open")
      .order("opened_at", { ascending: false }).limit(1);
    const ticketId = openTickets && openTickets.length > 0 ? openTickets[0].id : null;
    if (ticketId) {
      const { error: finErr } = await supabase.rpc("finalize_ticket", {
        p_ticket_id: ticketId,
        p_outcome: "perdido",
        p_loss_reason: "Encerrado por falta de resposta",
        p_notes: null,
        p_resolve: true,
      });
      if (finErr) console.error("[reengagement-followup] finalize_ticket:", finErr.message);
      else closed = true;
    }
  }

  return json({ ok: true, sent: anySent, step_no: step_no ?? null, bubbles: bubbles.length, closed, lead_id });
});
