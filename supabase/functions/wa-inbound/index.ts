// wa-inbound
//
// HUB de ingestão do stream `messages` da uazapi (Fase C2 do plano do funil).
// Substitui, por clínica (canário), o webhook do n8n "Receptor de mensagens".
//
// Ordem interna (INEGOCIÁVEL): (1) validar → (2) PERSISTIR via RPC
// ingest_wa_message (resolve clínica pelo token, lead por telefone normalizado,
// dedup por wa_message_id) → (3) fan-out: forward ao Agente IA (webhook do
// wrapper n8n "Agente IA | Entrada HTTP") respeitando os gates devolvidos pela
// RPC. Falha de fan-out NUNCA desfaz a persistência.
//
// Gatilhos de etapa NÃO são fan-out daqui: disparam por trigger no INSERT
// (trg_zz_apply_stage_rules) — agnóstico de transporte.
//
// v1 = texto. Mídia (download→chat-media→transcrição) entra na C5-b; até lá,
// mensagens não-texto são persistidas com placeholder para nada se perder.
//
// Auth: ?k=<WA_INBOUND_SECRET> na URL configurada na uazapi (que não envia
// headers). Retorna 500 em falha de persistência (uazapi reenvia; o dedup torna
// o retry seguro) e 200 nos ignores.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const HUB_AI_WEBHOOK_URL = Deno.env.get("HUB_AI_WEBHOOK_URL") ?? "";
const HUB_AI_SECRET = Deno.env.get("HUB_AI_SECRET") ?? "";
const WA_INBOUND_SECRET = Deno.env.get("WA_INBOUND_SECRET") ?? "";

serve(async (req) => {
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

  const url = new URL(req.url);
  if (!WA_INBOUND_SECRET || url.searchParams.get("k") !== WA_INBOUND_SECRET) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  let body: any;
  try { body = await req.json(); } catch { return json({ ok: true, ignored: true, reason: "no_json" }); }

  if (body?.EventType !== "messages" || !body?.message) {
    return json({ ok: true, ignored: true, reason: "not_message_event" });
  }
  const msg = body.message;
  if (msg.isGroup) return json({ ok: true, ignored: true, reason: "group" });
  if (msg.wasSentByApi) return json({ ok: true, ignored: true, reason: "sent_by_api" });

  // Telefone do lead: chatid ("5511...@s.whatsapp.net"); sender_pn como fallback
  // quando o chatid vier no formato @lid.
  const rawChat = String(msg.chatid || "");
  const chatSource = rawChat.endsWith("@lid") ? String(msg.sender_pn || rawChat) : rawChat;
  const leadPhone = chatSource.split("@")[0].replace(/\D/g, "");
  if (!leadPhone) return json({ ok: true, ignored: true, reason: "no_phone" });

  const isText = (msg.type === "text" || msg.messageType === "Conversation" || msg.messageType === "ExtendedTextMessage");
  const content = isText
    ? String(msg.text ?? msg.content ?? "")
    : `[${msg.messageType || msg.mediaType || "mídia"} recebida]`; // C5-b: mídia real

  const direction = msg.fromMe ? "outbound" : "inbound";
  const waMessageId = String(msg.messageid || msg.id || "");
  const leadName = String(body.chat?.wa_contactName || body.chat?.name || msg.senderName || "").trim();

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const registrarErro = async (code: string, title: string, ctx: Record<string, unknown>, clinicId: string | null = null) => {
    try {
      await supabase.rpc("log_system_error", {
        p_scope: "wa-inbound", p_code: code, p_title: title, p_level: "error",
        p_clinic_id: clinicId, p_context: ctx, p_is_monitor: false,
      });
    } catch (_e) { /* nunca derrubar a resposta por causa do log */ }
  };

  // (2) PERSISTIR — se falhar, 500 (uazapi reenvia; dedup segura o replay)
  const { data: res, error: rpcErr } = await supabase.rpc("ingest_wa_message", {
    p_instance_token: String(body.token || ""),
    p_direction: direction,
    p_lead_phone: leadPhone,
    p_content: content,
    p_wa_message_id: waMessageId || null,
    p_lead_name: leadName || null,
    p_sender: "human",
  });
  const r = res as any;
  if (rpcErr || !r?.success) {
    await registrarErro("persist_failed", "Falha ao persistir mensagem recebida", {
      detail: rpcErr?.message || r?.error_code, lead_phone: leadPhone, wa_message_id: waMessageId,
    });
    return json({ ok: false, error: rpcErr?.message || r?.error_code || "persist_failed" }, 500);
  }
  if (r.duplicate) return json({ ok: true, duplicate: true });

  // (3) Fan-out: Agente IA (fire-and-forget lógico; SEM retry — o buffer de turno
  // concatena e um retry duplicaria texto no turno).
  let aiForwarded = false;
  if (r.forward_ai && HUB_AI_WEBHOOK_URL && HUB_AI_SECRET) {
    try {
      const fw = await fetch(HUB_AI_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-hub-secret": HUB_AI_SECRET },
        body: JSON.stringify({
          clinic_id: r.clinic_id,
          clinic_phone: r.clinic_phone,
          lead_id: r.lead_id,
          lead_phone: leadPhone,
          mensagem: content,
          uazapi_token: String(body.token || ""),
          instance_name: String(body.instanceName || r.clinic_id),
          contact_identifier: rawChat,
          handoff_enabled: r.ai?.handoff_enabled ?? false,
          handoff_rules: r.ai?.handoff_rules ?? [],
          confirm_enabled: r.ai?.confirm_enabled ?? false,
          transition_rules: r.ai?.transition_rules ?? [],
          midia_kind: isText ? "" : String(msg.mediaType || msg.messageType || ""),
          midia_mime: "",
          response_wait_seconds: r.ai?.response_wait_seconds ?? 30,
        }),
      });
      aiForwarded = fw.ok;
      if (!fw.ok) {
        await registrarErro("ai_forward_failed", "Falha ao encaminhar turno ao Agente IA",
          { status: fw.status, lead_id: r.lead_id }, r.clinic_id);
      }
    } catch (e) {
      await registrarErro("ai_forward_failed", "Erro de rede ao encaminhar turno ao Agente IA",
        { detail: String(e), lead_id: r.lead_id }, r.clinic_id);
    }
  }

  return json({
    ok: true,
    lead_id: r.lead_id,
    lead_created: r.lead_created,
    message_id: r.message_id,
    ai_forwarded: aiForwarded,
    ai_skipped_reason: r.forward_ai ? null : "gates",
  });
});
