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
// C5-b: mídia (áudio/imagem/vídeo/doc) é baixada da uazapi (POST /message/download
// -> {fileURL,mimetype}; GET fileURL -> bytes), subida no bucket PRIVADO chat-media
// e anexada à mensagem (attach_chat_media) nos campos que o MediaBubble renderiza.
// A transcrição para a IA (Gemini) fica para a próxima camada — hoje a IA recebe
// o placeholder textual. Persistência primeiro, mídia depois: falha de mídia NUNCA
// perde a mensagem (fica como placeholder + log na Central).
//
// Auth: ?k=<WA_INBOUND_SECRET> na URL configurada na uazapi (que não envia
// headers). Retorna 500 em falha de persistência (uazapi reenvia; o dedup torna
// o retry seguro) e 200 nos ignores.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const UAZAPI_BASE = "https://med4growautomacao.uazapi.com";
const HUB_AI_WEBHOOK_URL = Deno.env.get("HUB_AI_WEBHOOK_URL") ?? "";
const HUB_AI_SECRET = Deno.env.get("HUB_AI_SECRET") ?? "";
const WA_INBOUND_SECRET = Deno.env.get("WA_INBOUND_SECRET") ?? "";

function kindFromMime(mime: string): "image" | "audio" | "video" | "document" {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  return "document";
}
function extFromMime(mime: string): string {
  const map: Record<string, string> = {
    "audio/ogg": "ogg", "audio/opus": "ogg", "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/amr": "amr", "audio/wav": "wav",
    "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
    "video/mp4": "mp4", "video/3gpp": "3gp", "video/quicktime": "mov",
    "application/pdf": "pdf",
  };
  return map[mime.split(";")[0].trim()] || "bin";
}

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
    : (String(msg.caption ?? "").trim() || `[${msg.messageType || msg.mediaType || "mídia"} recebida]`);

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

  // (2a) Mídia PRIMEIRO (antes do insert): baixa da uazapi → sobe no bucket privado.
  // Assim a mensagem NASCE com a mídia e o realtime (que só escuta INSERT) já
  // entrega o player — sem depender de UPDATE pós-insert (que a tela não recebe).
  // Falha aqui NÃO impede a persistência: cai como placeholder + log.
  let mediaKind: string | null = null, mediaMime: string | null = null,
      mediaPath: string | null = null, mediaFilename: string | null = null;
  if (!isText && waMessageId) {
    try {
      const { data: inst } = await supabase.from("whatsapp_instances")
        .select("clinic_id").eq("api_token", String(body.token || "")).maybeSingle();
      const clinicId = (inst as any)?.clinic_id ?? null;
      if (clinicId) {
        const dl = await fetch(`${UAZAPI_BASE}/message/download`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "token": String(body.token || "") },
          body: JSON.stringify({ id: waMessageId }),
        });
        const dlJson = await dl.json().catch(() => ({}));
        const fileURL = (dlJson as any)?.fileURL;
        const mime = String((dlJson as any)?.mimetype || "");
        if (fileURL && mime) {
          const binResp = await fetch(fileURL);
          if (binResp.ok) {
            const bytes = new Uint8Array(await binResp.arrayBuffer());
            const path = `${clinicId}/${waMessageId}.${extFromMime(mime)}`;
            const { error: upErr } = await supabase.storage.from("chat-media")
              .upload(path, bytes, { contentType: mime, upsert: true });
            if (upErr) {
              await registrarErro("media_upload_failed", "Falha ao subir mídia no bucket",
                { detail: upErr.message, wa_message_id: waMessageId, mime }, clinicId);
            } else {
              mediaKind = kindFromMime(mime); mediaMime = mime; mediaPath = path;
              mediaFilename = msg.filename ?? null;
            }
          } else {
            await registrarErro("media_download_failed", "Falha ao baixar bytes da mídia",
              { status: binResp.status, wa_message_id: waMessageId }, clinicId);
          }
        } else {
          // Containers sem mídia própria (ex.: AlbumMessage) NÃO são erro.
          const errTxt = String((dlJson as any)?.error || "");
          if (!/downloadable|no media|not.*media/i.test(errTxt)) {
            await registrarErro("media_no_url", "uazapi /message/download sem fileURL/mimetype",
              { wa_message_id: waMessageId, detail: errTxt }, clinicId);
          }
        }
      }
    } catch (e) {
      await registrarErro("media_error", "Erro ao processar mídia recebida",
        { detail: String(e), wa_message_id: waMessageId }, null);
    }
  }

  // (2b) PERSISTIR (com a mídia já pronta) — se falhar, 500 (uazapi reenvia; dedup segura o replay)
  const { data: res, error: rpcErr } = await supabase.rpc("ingest_wa_message", {
    p_instance_token: String(body.token || ""),
    p_direction: direction,
    p_lead_phone: leadPhone,
    p_content: content,
    p_wa_message_id: waMessageId || null,
    p_lead_name: leadName || null,
    p_sender: "human",
    p_media_kind: mediaKind,
    p_media_mime: mediaMime,
    p_media_path: mediaPath,
    p_media_filename: mediaFilename,
  });
  const r = res as any;
  if (rpcErr || !r?.success) {
    await registrarErro("persist_failed", "Falha ao persistir mensagem recebida", {
      detail: rpcErr?.message || r?.error_code, lead_phone: leadPhone, wa_message_id: waMessageId,
    });
    return json({ ok: false, error: rpcErr?.message || r?.error_code || "persist_failed" }, 500);
  }
  if (r.duplicate) return json({ ok: true, duplicate: true });
  const mediaAttached = !!mediaPath;

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
    media_attached: mediaAttached,
    ai_forwarded: aiForwarded,
    ai_skipped_reason: r.forward_ai ? null : "gates",
  });
});
