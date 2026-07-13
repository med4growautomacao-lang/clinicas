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
//   → sem clique de anúncio (nem clid, nem sourceType='ad'): conversa orgânica, ignora
//   → resolve a clínica pelo `owner` (telefone da instância, normalizado)
//   → Graph API do Meta: sourceID (id do anúncio) → nome da campanha/conjunto/anúncio
//   → INSERT em attribution_inbox (staging) — os triggers + sweep de 1 min casam com o lead
//
// O passo da Graph API é o que dá valor ao dado: o WhatsApp entrega só um id de anúncio; sem essa
// chamada teríamos o clique, mas não saberíamos de QUAL campanha veio. Mas ele NÃO é obrigatório:
// se falhar, o clique entra assim mesmo (ver abaixo) — e o criativo que o próprio WhatsApp manda
// (título, texto, link, plataforma) segue guardado, que é o que mantém a clínica enxergando algo.

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

// Plataformas que o WhatsApp reporta em `sourceApp`. "whatsapp" é o Anúncio no Status — colocação
// nova, já ativa em cliente nosso. Qualquer valor fora da lista fica nulo em vez de sujar o dado.
const AD_PLATFORMS = new Set(["instagram", "facebook", "whatsapp"]);

// `message.content` vem como STRING quando é texto puro e como OBJETO quando carrega contexto
// (é no objeto que mora o externalAdReply). Tratar os dois evita perder o clique.
function extractAdReply(message: any) {
  const content = message?.content;
  const isObj = typeof content === "object" && content !== null;
  const ctx = isObj ? content?.contextInfo?.externalAdReply : null;
  const info = isObj ? content?.contextInfo : null;

  const app = String(ctx?.sourceApp ?? "").toLowerCase();

  return {
    ctwaClid: ctx?.ctwaClid ?? null,
    sourceId: ctx?.sourceID ?? ctx?.sourceId ?? null,
    // 'ad' = anúncio pago. Precisamos disto porque o Anúncio no Status NÃO manda ctwaClid — sem
    // outro sinal de que é anúncio, não teríamos como distingui-lo de um contexto qualquer.
    isAd: String(ctx?.sourceType ?? "").toLowerCase() === "ad",
    // Instagram ou Facebook? Vem de graça em todo clique e é o que responde "onde meu anúncio
    // rende mais". Medido em 477 cliques: instagram 261, facebook 173, status do WhatsApp 8.
    adPlatform: AD_PLATFORMS.has(app) ? app : null,
    // O criativo é o que salva a clínica quando a Graph API recusa o token (11 das 19 hoje): sem
    // nome de campanha ela ainda vê QUAL anúncio trouxe o lead — título, texto e link.
    adTitle: ctx?.title ?? null,
    adBody: ctx?.body ?? null,
    adUrl: ctx?.sourceURL ?? null,
    adMediaUrl: ctx?.mediaURL ?? null,
    adThumbUrl: ctx?.thumbnailURL ?? null,
    // Por onde entrou (ctwa_ad, page_cta, click_to_chat_link…). NÃO usar para decidir se é pago:
    // verificado que page_cta/click_to_chat_link também trazem sourceType='ad' e id de anúncio real.
    entryPoint: info?.entryPointConversionSource ?? null,
    // Segundos entre ver/clicar o anúncio e mandar a mensagem — sinal de intenção.
    conversionDelay: info?.conversionDelaySeconds ?? info?.entryPointConversionDelaySeconds ?? null,
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

  const adInfo = extractAdReply(msg);
  const { ctwaClid, sourceId } = adInfo;

  // O "Anúncio no Status" (colocação nova do Meta, já rodando em cliente nosso) chega COM sourceID
  // e SEM ctwaClid. Exigir o clid — como o n8n fazia — descartava o clique inteiro e o lead pago
  // entrava como orgânico. Aceitamos o clique se há clid OU se o contexto se declara anúncio.
  if (!ctwaClid && !(sourceId && adInfo.isAd)) {
    return json({ ok: true, ignored: "no_ad_click" });   // conversa orgânica
  }

  // Chave natural do clique. Sem clid, o id da mensagem é o que temos de estável entre retries.
  const externalId = ctwaClid ?? (msg.messageid ? `wa_status:${msg.messageid}` : null);
  if (!externalId) return json({ ok: false, error: "no_external_id" }, 400);

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
  const { error } = await supabase.from("attribution_inbox").insert({
    clinic_id: clinic.id,
    phone: leadPhone,
    source: "meta_ads",
    // Fica NULO no Anúncio no Status — de propósito. Inventar um clid falso mentiria para qualquer
    // integração que devolva o clid à Meta; quem marca o lead como pago é source + ad_platform.
    ctwa_clid: ctwaClid,
    external_id: externalId,
    fb_campaign_name: campaign,
    fb_adset_name: adset,
    fb_ad_name: ad,
    ad_platform: adInfo.adPlatform,
    // `source_id` fica guardado de propósito: é o que permite reprocessar a Graph API depois e
    // preencher a campanha dos cliques que entraram com o token bloqueado.
    raw: {
      source_id: sourceId,
      ad_title: adInfo.adTitle,
      ad_body: adInfo.adBody,
      ad_url: adInfo.adUrl,
      ad_media_url: adInfo.adMediaUrl,
      ad_thumb_url: adInfo.adThumbUrl,
      entry_point: adInfo.entryPoint,
      conversion_delay_seconds: adInfo.conversionDelay,
      device: msg.source ?? null,
      sender_name: msg.senderName ?? null,
      text: msg.text ?? null,
    },
  });

  // A inbox tem UNIQUE (clinic_id, external_id). Um retry do webhook (ou um replay manual repetido)
  // bate aqui e é ignorado — antes duplicava o clique em silêncio.
  if (error && error.code === "23505") {
    return json({ ok: true, duplicate: true, clinic_id: clinic.id, phone: leadPhone });
  }
  if (error) {
    console.error("[ctwa-tracking] insert falhou:", error);
    return json({ ok: false, error: error.message }, 500);
  }

  return json({
    ok: true, clinic_id: clinic.id, phone: leadPhone,
    campaign, adset, ad, platform: adInfo.adPlatform,
  });
});
