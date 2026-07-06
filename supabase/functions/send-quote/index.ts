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
  const { clinic_id, lead_id, phone, text } = body ?? {};
  if (!clinic_id || !phone || !text || !String(text).trim()) {
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

  // (2) Token da instancia uazapi da clinica.
  const { data: instance } = await supabase
    .from("whatsapp_instances").select("api_token").eq("clinic_id", clinic_id).maybeSingle();
  const token = instance?.api_token;
  if (!token) return json({ ok: false, error: "whatsapp_nao_conectado" }, 409);

  // (3) Telefone do lead normalizado.
  const number = normalizeBrazilianPhone(String(phone));
  if (!number) return json({ ok: false, error: "telefone_invalido" }, 400);

  // (4) Envio via uazapi.
  try {
    const resp = await fetch(`${UAZAPI_BASE}/send/text`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json", "token": token },
      body: JSON.stringify({ number, text: String(text), delay: 0 }),
    });
    if (!resp.ok) {
      const detail = await resp.text().catch(() => "");
      return json({ ok: false, error: "uazapi_error", detail }, 502);
    }
  } catch (e) {
    return json({ ok: false, error: "send_failed", detail: String(e) }, 502);
  }

  // (5) Registra na conversa do lead (mesma forma das mensagens humanas outbound).
  //     Nao falha o envio se o log falhar. session_id/clinic_name/seq vem por trigger.
  try {
    await supabase.from("chat_messages").insert({
      clinic_id,
      lead_id: lead_id ?? null,
      phone: number,
      user_id: uid,
      sender: "human",
      direction: "outbound",
      message: { type: "human", content: String(text), additional_kwargs: {}, response_metadata: {} },
    });
  } catch (_e) {
    // ignore
  }

  return json({ ok: true });
});
