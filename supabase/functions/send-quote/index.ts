// send-quote
//
// Envia o texto do orcamento pelo WhatsApp conectado da clinica (uazapi /send/text)
// e registra a mensagem na conversa do lead (chat_messages, como msg humana outbound).
//
// Chamada pelo frontend (Kanban > modal de Orcamento > etapa 2 "Enviar por WhatsApp")
// com o JWT do usuario. Verifica se o usuario tem acesso a clinica antes de enviar.
// Espelha o caminho de envio do reengagement-followup / forms-welcome.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const UAZAPI_BASE = "https://med4growautomacao.uazapi.com";

// Espelha _shared/phone.ts (inline), igual reengagement/welcome.
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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  let body: any;
  try { body = await req.json(); } catch { body = {}; }
  const { clinic_id, lead_id, phone, text, media_url, media_type, filename, delay } = body ?? {};
  const hasMedia = !!media_url;
  const hasText = !!(text && String(text).trim());
  if (!clinic_id || !phone || (!hasMedia && !hasText)) {
    return json({ ok: false, error: "missing_params" }, 400);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  // (1) Autenticacao + autorizacao: o usuario precisa pertencer a clinica (ou a org dela).
  const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  const { data: userData } = await supabase.auth.getUser(jwt);
  const uid = userData?.user?.id;
  if (!uid) return json({ ok: false, error: "unauthorized" }, 401);

  const { data: cu } = await supabase
    .from("clinic_users").select("id").eq("id", uid).eq("clinic_id", clinic_id).maybeSingle();
  let allowed = !!cu;
  // chat_messages.user_id referencia clinic_users(id); usuario de organizacao NAO esta
  // em clinic_users -> gravar o uid dele viola o FK e a mensagem some da conversa
  // (mesmo bug corrigido no chat-send). Preenche so quando for clinic_user.
  const messageUserId = cu?.id ?? null;
  if (!allowed) {
    const { data: clinic } = await supabase
      .from("clinics").select("organization_id").eq("id", clinic_id).maybeSingle();
    if (clinic?.organization_id) {
      const { data: ou } = await supabase
        .from("org_users").select("user_id").eq("user_id", uid).eq("organization_id", clinic.organization_id).maybeSingle();
      allowed = !!ou;
    }
  }
  if (!allowed) return json({ ok: false, error: "forbidden" }, 403);

  // (2) Telefone do lead normalizado (necessário nos dois caminhos).
  const number = normalizeBrazilianPhone(String(phone));
  if (!number) return json({ ok: false, error: "telefone_invalido" }, 400);

  const uaDelay = Math.max(0, Math.min(60000, Number(delay) || 0));
  // Conteúdo que aparece na conversa (mesma forma das mensagens humanas outbound de hoje).
  const logContent = hasMedia
    ? `${hasText ? String(text).trim() + "\n\n" : ""}📎 Orçamento (${media_type === "document" ? "PDF" : "imagem"}): ${media_url}`
    : String(text);
  const chatPayload = {
    sender: "human",
    user_id: messageUserId,
    phone: number,
    message: { type: "human", content: logContent, additional_kwargs: {}, response_metadata: {} },
  };

  // (3) EMISSOR (opt-in por clínica). Enfileira; o worker resolve o token pelo gate canônico,
  //     entrega (texto ou mídia, preservando docName) e só então grava a conversa. Com a chave
  //     DESLIGADA (default) cai no envio inline de sempre.
  const { data: viaEmissor } = await supabase.rpc("fn_emissor_ativo", { p_clinic_id: clinic_id });

  if (viaEmissor === true) {
    const { data: outboundId, error: filaErr } = await supabase.rpc("emit_message", {
      p_clinic_id: clinic_id,
      p_to_addr: number,
      p_producer: "send_quote",
      p_body: hasText ? String(text) : null,
      p_kind: hasMedia ? "media" : "text",
      p_lead_id: lead_id ?? null,
      p_media_url: hasMedia ? String(media_url) : null,
      p_media_kind: hasMedia ? (media_type === "document" ? "document" : "image") : null,
      p_media_filename: hasMedia ? (filename ? String(filename) : "orcamento") : null,
      p_delay_ms: uaDelay,
      p_chat_payload: chatPayload,
    });
    if (filaErr) return json({ ok: false, error: "fila_falhou", detail: filaErr.message }, 502);

    // kick imediato do worker (best-effort; cron de 1 min é o backstop)
    try {
      const workerUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/emissor-worker`;
      const kick = fetch(workerUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "kick", clinic_id }) }).catch(() => {});
      (globalThis as any).EdgeRuntime?.waitUntil?.(kick);
    } catch { /* backstop cobre */ }
    return json({ ok: true, queued: true, outbound_id: outboundId });
  }

  // ---- Caminho antigo (chave desligada): envio inline. ----
  const { data: instance } = await supabase
    .from("whatsapp_instances").select("api_token").eq("clinic_id", clinic_id).maybeSingle();
  const token = instance?.api_token;
  if (!token) return json({ ok: false, error: "whatsapp_nao_conectado" }, 409);

  // Envio via uazapi. Texto -> /send/text; imagem/PDF -> /send/media (file = URL publica).
  //   `delay` (ms) e o mecanismo NATIVO da uazapi: espera no servidor E mostra presenca
  //   ("digitando/enviando") antes de disparar. Mesma abordagem do forms-welcome-followup.
  const endpoint = hasMedia ? "/send/media" : "/send/text";
  const payload = hasMedia
    ? {
        number,
        type: media_type === "document" ? "document" : "image",
        file: String(media_url),
        text: hasText ? String(text) : "",
        docName: filename ? String(filename) : "orcamento",
        delay: uaDelay,
      }
    : { number, text: String(text), delay: uaDelay };
  try {
    const resp = await fetch(`${UAZAPI_BASE}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json", "token": token },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      const detail = await resp.text().catch(() => "");
      return json({ ok: false, error: "uazapi_error", detail }, 502);
    }
  } catch (e) {
    return json({ ok: false, error: "send_failed", detail: String(e) }, 502);
  }

  // Registra na conversa do lead. Nao falha o envio se o log falhar. session_id/clinic_name/seq
  // vem por trigger.
  try {
    await supabase.from("chat_messages").insert({
      clinic_id,
      lead_id: lead_id ?? null,
      phone: number,
      user_id: messageUserId,
      sender: "human",
      direction: "outbound",
      message: { type: "human", content: logContent, additional_kwargs: {}, response_metadata: {} },
    });
  } catch (_e) {
    // ignore
  }

  return json({ ok: true });
});
