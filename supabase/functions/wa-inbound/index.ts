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
// e anexada à mensagem nos campos que o MediaBubble renderiza. Além disso, mídia
// INBOUND é transcrita para a IA (a transcrição entra no `content`, que vira a
// memória e o `mensagem` do forward). O provider/modelo por tipo (áudio/imagem)
// vêm de system_settings (media_ai_config, painel super-admin) e a chave do Vault
// (fallback Deno.env). Sem chave → placeholder (sem regressão). Falha de mídia/
// transcrição NUNCA perde a mensagem (fica como placeholder + log na Central).
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

// Transcrição de mídia (C5-b): provider/modelo por tipo vêm de system_settings
// (media_ai_config, editável no painel super-admin) e a chave vem do Vault
// (get_llm_secret, service role) com fallback pro Deno.env. Áudio: gemini|openai
// (Claude não faz áudio). Imagem: anthropic|gemini|openai.
const AUDIO_PROMPT = "Transcreva este áudio em português do Brasil. Responda APENAS com a transcrição literal, sem comentários nem aspas.";
const IMAGE_PROMPT = "Descreva de forma objetiva o que há nesta imagem enviada por um paciente/cliente no WhatsApp (foto, documento, exame, print, etc.). Se houver texto legível, transcreva-o. Responda em português, em 1 a 3 frases, sem preâmbulo.";
const DEFAULT_MEDIA_AI = {
  audio: { provider: "gemini", model: "gemini-2.0-flash" },
  image: { provider: "anthropic", model: "claude-haiku-4-5" },
};

function kindFromMime(mime: string): "image" | "audio" | "video" | "document" {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  return "document";
}
function extFromMime(mime: string): string {
  const map: Record<string, string> = {
    "audio/ogg": "ogg", "audio/opus": "ogg", "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/amr": "amr", "audio/wav": "wav", "audio/webm": "webm", "audio/aac": "aac",
    "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
    "video/mp4": "mp4", "video/3gpp": "3gp", "video/quicktime": "mov",
    "application/pdf": "pdf",
  };
  return map[mime.split(";")[0].trim()] || "bin";
}

// base64 em blocos (evita estourar a pilha no fromCharCode com arquivos grandes)
function toBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}

// ── Cache de módulo (instância quente reusa entre invocações) — TTL curto ────
// Evita 1 round-trip por mensagem p/ dados que quase nunca mudam (config global,
// chave do Vault, flag de IA da clínica). Chamada de LLM >> query, então cachear
// aqui é seguro; 60s de defasagem é aceitável.
const _cache = new Map<string, { v: any; exp: number }>();
async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const c = _cache.get(key);
  if (c && c.exp > Date.now()) return c.v as T;
  const v = await fn();
  _cache.set(key, { v, exp: Date.now() + ttlMs });
  return v;
}

// A clínica usa IA? (ai_config.auto_schedule é o gate mestre do forward_ai). Se não,
// NÃO transcreve — a transcrição só serve à IA/memória; poupa custo de LLM.
function clinicUsesAi(supabase: any, clinicId: string): Promise<boolean> {
  return cached(`ai_on:${clinicId}`, 60000, async () => {
    const { data } = await supabase.from("ai_config").select("auto_schedule").eq("clinic_id", clinicId).maybeSingle();
    return (data as any)?.auto_schedule === true;
  });
}

function getMediaAiConfig(supabase: any): Promise<{ audio: { provider: string; model: string }; image: { provider: string; model: string } }> {
  return cached("media_ai_config", 60000, async () => {
    try {
      const { data } = await supabase.from("system_settings").select("value").eq("id", "media_ai_config").maybeSingle();
      if (data?.value) {
        const c = JSON.parse(data.value);
        return { audio: c?.audio ?? DEFAULT_MEDIA_AI.audio, image: c?.image ?? DEFAULT_MEDIA_AI.image };
      }
    } catch { /* config ausente/inválida → default */ }
    return DEFAULT_MEDIA_AI;
  });
}

async function llmKey(supabase: any, provider: string): Promise<string | null> {
  const name = provider === "gemini" ? "GEMINI_API_KEY"
    : provider === "anthropic" ? "ANTHROPIC_API_KEY"
    : provider === "openai" ? "OPENAI_API_KEY" : "";
  if (!name) return null;
  const ck = `key:${name}`;
  const c = _cache.get(ck);
  if (c && c.exp > Date.now()) return c.v as string;
  let key: string | null = null;
  try {
    const { data } = await supabase.rpc("get_llm_secret", { p_name: name }); // Vault (service role)
    if (data && String(data).trim()) key = String(data);
  } catch { /* sem Vault → tenta env */ }
  if (!key) key = Deno.env.get(name) || null; // fallback: edge secret (ex.: ANTHROPIC_API_KEY já existe)
  if (key) _cache.set(ck, { v: key, exp: Date.now() + 60000 }); // só cacheia HIT (chave nova entra em <60s)
  return key;
}

// ── Provedores ──────────────────────────────────────────────────────────────
async function geminiGenerate(model: string, key: string, prompt: string, bytes: Uint8Array, mime: string): Promise<string | null> {
  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    {
      method: "POST",
      signal: AbortSignal.timeout(25000), // não segurar o caminho de entrada se a IA travar
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType: mime.split(";")[0].trim(), data: toBase64(bytes) } }] }],
        generationConfig: { temperature: 0 },
      }),
    },
  );
  if (!resp.ok) throw new Error(`gemini ${resp.status}: ${(await resp.text().catch(() => "")).slice(0, 300)}`);
  const j = await resp.json().catch(() => ({}));
  const text = (j?.candidates?.[0]?.content?.parts ?? []).map((p: any) => p?.text).filter(Boolean).join(" ").trim();
  return text || null;
}

async function anthropicImage(model: string, key: string, bytes: Uint8Array, mime: string): Promise<string | null> {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    signal: AbortSignal.timeout(25000),
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model, max_tokens: 400,
      messages: [{ role: "user", content: [
        { type: "text", text: IMAGE_PROMPT },
        { type: "image", source: { type: "base64", media_type: mime.split(";")[0].trim(), data: toBase64(bytes) } },
      ] }],
    }),
  });
  if (!resp.ok) throw new Error(`anthropic ${resp.status}: ${(await resp.text().catch(() => "")).slice(0, 300)}`);
  const j = await resp.json().catch(() => ({}));
  return (j?.content ?? []).map((b: any) => b?.text).filter(Boolean).join(" ").trim() || null;
}

async function openaiTranscribe(model: string, key: string, bytes: Uint8Array, mime: string): Promise<string | null> {
  const base = mime.split(";")[0].trim();
  // extensão que a OpenAI reconhece: usa o map se conhecido, senão o subtipo do mime
  const mapped = extFromMime(base);
  const ext = mapped !== "bin" ? mapped : (base.split("/")[1] || "ogg");
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: base }), `audio.${ext}`);
  form.append("model", model);
  const resp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    signal: AbortSignal.timeout(25000),
    headers: { "Authorization": `Bearer ${key}` },
    body: form,
  });
  if (!resp.ok) throw new Error(`openai-stt ${resp.status}: ${(await resp.text().catch(() => "")).slice(0, 300)}`);
  const j = await resp.json().catch(() => ({}));
  return (j?.text ? String(j.text).trim() : null) || null;
}

async function openaiImage(model: string, key: string, bytes: Uint8Array, mime: string): Promise<string | null> {
  const dataUri = `data:${mime.split(";")[0].trim()};base64,${toBase64(bytes)}`;
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(25000),
    headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model, max_tokens: 400,
      messages: [{ role: "user", content: [
        { type: "text", text: IMAGE_PROMPT },
        { type: "image_url", image_url: { url: dataUri } },
      ] }],
    }),
  });
  if (!resp.ok) throw new Error(`openai-vision ${resp.status}: ${(await resp.text().catch(() => "")).slice(0, 300)}`);
  const j = await resp.json().catch(() => ({}));
  const text = j?.choices?.[0]?.message?.content;
  return (text ? String(text).trim() : null) || null;
}

// Despacho por tipo+provider. Provider incompatível com o tipo → null (placeholder).
async function transcribeMedia(kind: string, bytes: Uint8Array, mime: string, provider: string, model: string, key: string): Promise<string | null> {
  if (kind === "audio") {
    if (provider === "gemini") return geminiGenerate(model, key, AUDIO_PROMPT, bytes, mime);
    if (provider === "openai") return openaiTranscribe(model, key, bytes, mime);
    return null;
  }
  if (kind === "image") {
    if (provider === "anthropic") return anthropicImage(model, key, bytes, mime);
    if (provider === "gemini") return geminiGenerate(model, key, IMAGE_PROMPT, bytes, mime);
    if (provider === "openai") return openaiImage(model, key, bytes, mime);
    return null;
  }
  return null;
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
  // `content` pode ser enriquecido com a transcrição da mídia (C5-b) antes do insert.
  let content = isText
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

              // Transcrição p/ a IA (C5-b): só INBOUND e só se a clínica usa IA
              // (senão a transcrição não teria consumidor — poupa custo de LLM).
              // Enriquece o `content` (memória + forward). Falha NUNCA quebra o fluxo.
              if (direction === "inbound" && (mediaKind === "audio" || mediaKind === "image")) {
                try {
                  if (await clinicUsesAi(supabase, clinicId)) {
                    const cfg = await getMediaAiConfig(supabase);
                    const spec = mediaKind === "audio" ? cfg.audio : cfg.image;
                    const key = spec?.provider ? await llmKey(supabase, spec.provider) : null;
                    const t = key ? await transcribeMedia(mediaKind, bytes, mime, spec.provider, spec.model, key) : null;
                    if (t) {
                      const cap = String(msg.caption ?? "").trim();
                      content = mediaKind === "image"
                        ? (cap ? `${cap}\n[Imagem] ${t}` : `[Imagem] ${t}`)
                        : t; // áudio: transcrição limpa (a IA lê como fala do paciente)
                    }
                  }
                } catch (e) {
                  await registrarErro("transcribe_failed", "Falha ao transcrever mídia recebida",
                    { detail: String(e), kind: mediaKind, mime, wa_message_id: waMessageId }, clinicId);
                }
              }
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
          midia_mime: mediaMime ?? "",
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
