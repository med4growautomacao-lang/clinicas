// chat-send
//
// Envia uma mensagem de TEXTO do operador para o lead pelo WhatsApp conectado da
// clinica (uazapi /send/text) e registra na conversa (chat_messages).
//
// Chamada pelo frontend (Conversas / drawer do Kanban) com o JWT do usuario.
// Espelha send-quote (auth + token + envio), com duas diferencas deliberadas:
//   1. gate da feature clinics.features->>'feature_chat_send' (opt-in, server-side);
//   2. falha registrada na Central de Erros (log_system_error) — send-quote nao registra,
//      e sem isso um envio que falha vira "sumiu a mensagem".
//
// A mensagem entra como sender='human' + direction='outbound': mantem a atribuicao
// comercial IA x Humano correta E dispara os gatilhos de etapa por keyword no banco.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const UAZAPI_BASE = "https://med4growautomacao.uazapi.com";
const MAX_TEXT = 4096;

// Espelha _shared/phone.ts (inline), igual send-quote/reengagement/welcome.
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
  const { clinic_id, lead_id, phone, text } = body ?? {};
  const cleanText = typeof text === "string" ? text.trim() : "";
  if (!clinic_id || !phone || !cleanText) return json({ ok: false, error: "missing_params" }, 400);
  if (cleanText.length > MAX_TEXT) return json({ ok: false, error: "texto_muito_longo" }, 400);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const registrarErro = async (code: string, title: string, ctx: Record<string, unknown>) => {
    try {
      await supabase.rpc("log_system_error", {
        p_scope: "chat-send",
        p_code: code,
        p_title: title,
        p_level: "error",
        p_clinic_id: clinic_id,
        p_context: ctx,
        p_is_monitor: false,
      });
    } catch (_e) { /* nunca deixar o log derrubar a resposta */ }
  };

  // (1) Autenticacao + autorizacao: usuario precisa pertencer a clinica (ou a org dela).
  const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  const { data: userData } = await supabase.auth.getUser(jwt);
  const uid = userData?.user?.id;
  if (!uid) return json({ ok: false, error: "unauthorized" }, 401);

  const { data: cu } = await supabase
    .from("clinic_users").select("id").eq("id", uid).eq("clinic_id", clinic_id).maybeSingle();
  let allowed = !!cu;
  // chat_messages.user_id referencia clinic_users(id); usuario de organizacao NAO esta
  // em clinic_users -> gravar o uid dele viola o FK. Preenche so quando for clinic_user.
  const messageUserId = cu?.id ?? null;

  // (2) Gate da feature (opt-in) — lido junto do organization_id p/ evitar 2 selects.
  const { data: clinic } = await supabase
    .from("clinics").select("organization_id, features").eq("id", clinic_id).maybeSingle();

  if (!allowed && clinic?.organization_id) {
    const { data: ou } = await supabase
      .from("org_users").select("user_id").eq("user_id", uid).eq("organization_id", clinic.organization_id).maybeSingle();
    allowed = !!ou;
  }
  if (!allowed) return json({ ok: false, error: "forbidden" }, 403);

  if ((clinic?.features as any)?.feature_chat_send !== true) {
    return json({ ok: false, error: "envio_desativado" }, 403);
  }

  // (3) Token da instancia uazapi da clinica.
  const { data: instance } = await supabase
    .from("whatsapp_instances").select("api_token").eq("clinic_id", clinic_id).maybeSingle();
  const token = instance?.api_token;
  if (!token) return json({ ok: false, error: "whatsapp_nao_conectado" }, 409);

  // (4) Telefone do lead normalizado (os dois lados normalizados no resto do sistema).
  const number = normalizeBrazilianPhone(String(phone));
  if (!number) return json({ ok: false, error: "telefone_invalido" }, 400);

  // (5) Envio.
  try {
    const resp = await fetch(`${UAZAPI_BASE}/send/text`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json", "token": token },
      body: JSON.stringify({ number, text: cleanText, delay: 0 }),
    });
    if (!resp.ok) {
      const detail = await resp.text().catch(() => "");
      await registrarErro("uazapi_error", "Falha ao enviar mensagem pelo chat", { status: resp.status, detail, lead_id, number });
      return json({ ok: false, error: "uazapi_error", detail }, 502);
    }
  } catch (e) {
    await registrarErro("send_failed", "Erro de rede ao enviar mensagem pelo chat", { detail: String(e), lead_id, number });
    return json({ ok: false, error: "send_failed", detail: String(e) }, 502);
  }

  // (6) Registra na conversa. session_id/clinic_name/seq vem por trigger.
  //     Aqui o log importa: a mensagem JA foi entregue ao lead, entao perder a linha
  //     significa conversa incompleta na tela e gatilho de etapa que nao dispara.
  const { data: inserted, error: insertErr } = await supabase.from("chat_messages").insert({
    clinic_id,
    lead_id: lead_id ?? null,
    phone: number,
    user_id: messageUserId,
    sender: "human",
    direction: "outbound",
    message: { type: "human", content: cleanText, additional_kwargs: {}, response_metadata: {} },
  }).select("id").single();

  if (insertErr) {
    await registrarErro("log_failed", "Mensagem enviada mas nao registrada na conversa", { detail: insertErr.message, lead_id, number });
    return json({ ok: true, logged: false });
  }

  return json({ ok: true, logged: true, message_id: inserted?.id });
});
