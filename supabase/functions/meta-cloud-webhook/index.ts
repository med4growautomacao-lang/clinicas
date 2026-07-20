// meta-cloud-webhook — a CALLBACK da WhatsApp Cloud API oficial (Graph API).
// URL a cadastrar no App da Meta (WhatsApp → Configuration → Webhook):
//   https://<project>.supabase.co/functions/v1/meta-cloud-webhook
//   Verify token = META_CLOUD_VERIFY_TOKEN. Assinar os campos: messages, message_template_status_update.
//
// verify_jwt = false (a Meta chama sem Authorization, igual uazapi-events/ctwa-tracking).
//
// GET  → verificação da Meta (hub.challenge).
// POST → 1ª versão: SÓ REGISTRA (log). Grava cada evento em meta_cloud_events, atualiza status
//        do disparo (meta_cloud_sends por wamid) e status do template (meta_cloud_templates por
//        name). NÃO toca no pipeline de chat/tickets/n8n. Responde 200 SEMPRE (evita reenvio).
//
// Falha de processamento → Central de Erros (log_system_error, scope='meta-cloud-webhook'),
// mas ainda 200.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const service = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

async function registrarErro(code: string, title: string, level: string, ctx: Record<string, unknown>) {
  try {
    await service.rpc("log_system_error", {
      p_scope: "meta-cloud-webhook", p_code: code, p_title: title, p_level: level,
      p_clinic_id: null, p_context: ctx, p_is_monitor: false,
    });
  } catch (_e) { /* nunca derrubar por causa do log */ }
}

// phone_number_id → { channel_id, clinic_id }. Cache curto por invocação.
async function resolveChannel(phoneNumberId: string | null): Promise<{ channel_id: string | null; clinic_id: string | null }> {
  if (!phoneNumberId) return { channel_id: null, clinic_id: null };
  const { data } = await service
    .from("meta_cloud_channels")
    .select("id, clinic_id")
    .eq("phone_number_id", phoneNumberId)
    .maybeSingle();
  return { channel_id: data?.id ?? null, clinic_id: data?.clinic_id ?? null };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // ───────────────────────── GET: verificação da Meta ─────────────────────────
  if (req.method === "GET") {
    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode");
    const verifyToken = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    const expected = Deno.env.get("META_CLOUD_VERIFY_TOKEN") ?? "";
    if (mode === "subscribe" && expected && verifyToken === expected) {
      return new Response(challenge ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
    }
    return new Response("forbidden", { status: 403, headers: { "Content-Type": "text/plain" } });
  }

  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405, headers: CORS });
  }

  // ─────────────────────────── POST: eventos da Meta ──────────────────────────
  let body: any;
  try { body = await req.json(); } catch { body = {}; }

  try {
    const entries = Array.isArray(body?.entry) ? body.entry : [];
    for (const entry of entries) {
      const changes = Array.isArray(entry?.changes) ? entry.changes : [];
      for (const change of changes) {
        const field = change?.field;
        const value = change?.value ?? {};
        const phoneNumberId = value?.metadata?.phone_number_id ?? null;
        const { channel_id, clinic_id } = await resolveChannel(phoneNumberId);

        // (a) mensagens recebidas (inbound) — só registra.
        for (const msg of (Array.isArray(value?.messages) ? value.messages : [])) {
          await service.from("meta_cloud_events").insert({
            phone_number_id: phoneNumberId,
            channel_id, clinic_id,
            event_type: "message",
            from_phone: msg?.from ?? null,
            wamid: msg?.id ?? null,
            payload: { message: msg, contacts: value?.contacts ?? null },
          });
        }

        // (b) status de entrega/leitura dos disparos — atualiza meta_cloud_sends por wamid.
        for (const st of (Array.isArray(value?.statuses) ? value.statuses : [])) {
          const wamid = st?.id ?? null;
          const status = String(st?.status ?? "").toLowerCase(); // sent|delivered|read|failed
          await service.from("meta_cloud_events").insert({
            phone_number_id: phoneNumberId,
            channel_id, clinic_id,
            event_type: "status",
            wamid,
            payload: st,
          });
          if (wamid && ["sent", "delivered", "read", "failed"].includes(status)) {
            await service.from("meta_cloud_sends")
              .update({
                status,
                error: status === "failed" ? (st?.errors ?? null) : null,
                updated_at: new Date().toISOString(),
              })
              .eq("wamid", wamid);
          }
        }

        // (c) mudança de status de template — atualiza meta_cloud_templates por name.
        if (field === "message_template_status_update") {
          const name = value?.message_template_name ?? null;
          const newStatus = value?.event ?? value?.new_status ?? null; // APPROVED/REJECTED/...
          await service.from("meta_cloud_events").insert({
            phone_number_id: phoneNumberId,
            channel_id, clinic_id,
            event_type: "template_status",
            payload: value,
          });
          if (name && newStatus) {
            const patch: Record<string, unknown> = { status: String(newStatus).toUpperCase(), synced_at: new Date().toISOString() };
            if (String(newStatus).toUpperCase() === "REJECTED") patch.rejected_reason = value?.reason ?? null;
            let q = service.from("meta_cloud_templates").update(patch).eq("name", name);
            if (clinic_id) q = q.eq("clinic_id", clinic_id); // isola por cliente quando resolvido
            await q;
          }
        }

        // (d) qualquer outro evento — guarda cru para diagnóstico.
        const known = Array.isArray(value?.messages) || Array.isArray(value?.statuses) || field === "message_template_status_update";
        if (!known) {
          await service.from("meta_cloud_events").insert({
            phone_number_id: phoneNumberId,
            channel_id, clinic_id,
            event_type: "other",
            payload: { field, value },
          });
        }
      }
    }
  } catch (e) {
    await registrarErro("processamento_falhou", "Falha ao processar evento da callback Meta", "error",
      { erro: e instanceof Error ? e.message : String(e) });
    // ainda assim 200 abaixo — não queremos reenvio infinito da Meta.
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200, headers: { ...CORS, "Content-Type": "application/json" },
  });
});
