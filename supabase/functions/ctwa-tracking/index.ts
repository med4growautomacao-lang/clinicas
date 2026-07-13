// ctwa-tracking — captação NATIVA do clique em anúncio Meta que abre o WhatsApp (Click-to-WhatsApp).
// Substitui o workflow n8n "Tracking Meta" (webhook /clinica/tracking).
//
// É o canal de MAIOR volume de atribuição paga: 1.374 toques na jornada — mais que o formulário do
// site e o Meta Forms somados. Enquanto vivia no n8n, uma queda dele (como as credenciais órfãs de
// 26/06) fazia os leads continuarem entrando SEM origem, em silêncio.
//
// Fluxo (idêntico ao do n8n, agora nativo):
//   webhook uazapi (event=messages) → filtra (não-grupo, não-fromMe)
//   → extrai ctwaClid + sourceID de message.content.contextInfo.externalAdReply
//   → sem ctwaClid: não veio de anúncio, ignora
//   → resolve a clínica pelo `owner` (telefone da instância, normalizado)
//   → Graph API do Meta: sourceID (id do anúncio) → nome da campanha/conjunto/anúncio
//   → INSERT em lead_tracking_inbox (staging) — os triggers + sweep de 1 min casam com o lead
//
// O passo da Graph API é o que dá valor ao dado: o WhatsApp entrega só um id de anúncio; sem essa
// chamada teríamos o clique, mas não saberíamos de QUAL campanha veio.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GRAPH_VERSION = "v22.0";

// Mesma normalização do n8n e das outras edges: BR canônico, sem o 9º dígito.
function normalizeBrazilianPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let p = String(raw).replace(/\D/g, "");
  if (!p) return null;
  p = p.replace(/^0+/, "");
  if (!p.startsWith("55")) p = "55" + p;
  if (p.length === 13) {
    const country = p.slice(0, 2);
    const ddd = p.slice(2, 4);
    let rest = p.slice(4);
    if (rest.startsWith("9")) rest = rest.slice(1);
    p = country + ddd + rest;
  }
  if (p.length < 12 || p.length > 13) return null;
  return p;
}

// `message.content` vem como STRING quando é texto puro e como OBJETO quando carrega contexto
// (é no objeto que mora o externalAdReply). Tratar os dois evita perder o clique.
function extractAdReply(message: any): { ctwaClid: string | null; sourceId: string | null; adTitle: string | null } {
  const content = message?.content;
  const ctx = (typeof content === "object" && content !== null)
    ? content?.contextInfo?.externalAdReply
    : null;
  return {
    ctwaClid: ctx?.ctwaClid ?? null,
    sourceId: ctx?.sourceID ?? ctx?.sourceId ?? null,
    // O título é a chamada do anúncio ("Peça sua tela AGORA mesmo!"). Não substitui o nome da
    // campanha, mas é a única pista legível quando a Graph API recusa o token — e 11 das 19
    // clínicas estão hoje com o token bloqueado pela Meta.
    adTitle: ctx?.title ?? null,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const json = (o: unknown, s = 200) =>
    new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, error: "invalid_json" }, 400); }

  // Só mensagens reais recebidas: ignora grupo e o que a própria clínica enviou.
  const msg = body?.message;
  if (body?.EventType !== "messages" || !msg) return json({ ok: true, ignored: "not_a_message" });
  if (msg.isGroup === true || msg.fromMe === true) return json({ ok: true, ignored: "group_or_from_me" });

  const { ctwaClid, sourceId, adTitle } = extractAdReply(msg);
  if (!ctwaClid) return json({ ok: true, ignored: "no_ad_click" });  // conversa orgânica

  const leadPhone = normalizeBrazilianPhone(msg.chatid);
  const clinicPhone = normalizeBrazilianPhone(body?.owner);
  if (!leadPhone || !clinicPhone) return json({ ok: false, error: "invalid_phone", leadPhone, clinicPhone });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const { data: clinic } = await supabase
    .from("clinics")
    .select("id, meta_token")
    .eq("phone", clinicPhone)
    .maybeSingle();

  if (!clinic?.id) {
    console.error("[ctwa-tracking] clínica não encontrada para o telefone", clinicPhone);
    return json({ ok: false, error: "clinic_not_found", clinicPhone }, 404);
  }

  // Graph API: traduz o id do anúncio em campanha/conjunto/anúncio.
  // Se falhar (token expirado, anúncio apagado), gravamos o clique MESMO ASSIM — perder a campanha
  // é ruim, perder a atribuição do lead é pior. A inbox já reconhece source='meta_ads' pelo clid.
  let campaign: string | null = null, adset: string | null = null, ad: string | null = null;

  if (sourceId && clinic.meta_token) {
    try {
      const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${sourceId}`);
      url.searchParams.set("access_token", clinic.meta_token);
      url.searchParams.set("fields", "name,adset{id,name},campaign{id,name}");
      const resp = await fetch(url.toString());
      if (resp.ok) {
        const d = await resp.json();
        ad = d?.name ?? null;
        adset = d?.adset?.name ?? null;
        campaign = d?.campaign?.name ?? null;
      } else {
        console.error("[ctwa-tracking] graph falhou:", resp.status, (await resp.text()).slice(0, 200));
      }
    } catch (e) {
      console.error("[ctwa-tracking] graph erro:", e);
    }
  }

  // Staging: os triggers (trg_inbox_reconcile / trg_lead_pull_tracking) + o sweep de 1 min casam
  // isto com o lead por clinic_id + telefone normalizado, nos dois sentidos (tracking antes ou
  // depois do lead) — ver [[lead-tracking-inbox-race-fix]].
  const { error } = await supabase.from("lead_tracking_inbox").insert({
    clinic_id: clinic.id,
    phone: leadPhone,
    source: "meta_ads",
    ctwa_clid: ctwaClid,
    fb_campaign_name: campaign,
    fb_adset_name: adset,
    fb_ad_name: ad,
    // `source_id` fica guardado de propósito: é o que permite reprocessar a Graph API depois e
    // preencher a campanha dos cliques que entraram com o token bloqueado.
    raw: {
      source_id: sourceId,
      ad_title: adTitle,
      sender_name: msg.senderName ?? null,
      text: msg.text ?? null,
    },
  });

  if (error) {
    console.error("[ctwa-tracking] insert falhou:", error);
    return json({ ok: false, error: error.message }, 500);
  }

  return json({ ok: true, clinic_id: clinic.id, phone: leadPhone, campaign, adset, ad });
});
