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

  // Esta edge é disparada por WEBHOOK, então o coletor de pg_net (que só vê o que o banco chamou)
  // não a enxerga: ela precisa registrar as próprias falhas na Central de Erros.
  const registrar = (code: string, title: string, level: string, clinicId: string | null, ctx: unknown) =>
    supabase.rpc("log_system_error", {
      p_scope: "ctwa-tracking", p_code: code, p_title: title,
      p_level: level, p_clinic_id: clinicId, p_context: ctx,
    }).then(() => {}, (e) => console.error("[ctwa-tracking] log falhou:", e));

  if (!clinic?.id) {
    console.error("[ctwa-tracking] clínica não encontrada para o telefone", clinicPhone);
    // Clique pago chegando de uma instância que não bate com nenhuma clínica: a atribuição some
    // inteira e nada mais no sistema perceberia.
    await registrar(
      "clinica_nao_encontrada",
      "Clique de anúncio de uma instância sem clínica correspondente (" + clinicPhone + ")",
      "critical", null, { telefone_instancia: clinicPhone, telefone_lead: leadPhone },
    );
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
        const corpo = (await resp.text()).slice(0, 300);
        console.error("[ctwa-tracking] graph falhou:", resp.status, corpo);
        // O monitor `campanha_nao_resolvida` já acusa o SINTOMA (cliques sem campanha). Aqui
        // registramos a CAUSA, com a mensagem da própria Meta — é a diferença entre "o token está
        // ruim" e "o app foi deletado" / "acesso bloqueado", que exigem ações diferentes.
        await registrar(
          "graph_api_recusou",
          "A Meta recusou a consulta do anúncio (" + resp.status + ") — o clique foi gravado, mas sem campanha",
          "warn", clinic.id, { status: resp.status, resposta: corpo, source_id: sourceId },
        );
      }
    } catch (e) {
      console.error("[ctwa-tracking] graph erro:", e);
      await registrar(
        "graph_api_indisponivel",
        "Não foi possível falar com a Graph API da Meta — o clique foi gravado, mas sem campanha",
        "warn", clinic.id, { erro: String(e), source_id: sourceId },
      );
    }
  }

  // Staging: os triggers (trg_inbox_reconcile / trg_lead_pull_tracking) + o sweep de 1 min casam
  // isto com o lead por clinic_id + telefone normalizado, nos dois sentidos (tracking antes ou
  // depois do lead) — ver [[lead-tracking-inbox-race-fix]].
  //
  // UPSERT, não INSERT: enquanto o n8n "Tracking Meta" seguir ligado para comparação, os dois
  // gravam o mesmo clique e um perde a corrida. Se o perdedor fosse simplesmente descartado e o
  // n8n vencesse, o clique ficaria PARA SEMPRE sem plataforma, sem criativo e sem source_id — e sem
  // source_id nem o ctwa-enrich resgata a campanha depois. A RPC completa o que falta em vez de
  // descartar, então a ordem de chegada deixa de importar. Também cobre retry de webhook.
  const { data: result, error } = await supabase.rpc("ctwa_ingest_click", {
    p_clinic_id: clinic.id,
    p_phone: leadPhone,
    p_external_id: externalId,
    // Hora REAL do clique, não a do insert. É o que decide o last-touch da atribuição — sem isso,
    // um replay de clique antigo (fizemos vários) sobrescreveria a atribuição de um clique novo.
    p_occurred_at: msg.messageTimestamp
      ? new Date(Number(msg.messageTimestamp)).toISOString()
      : null,
    // Fica NULO no Anúncio no Status — de propósito. Inventar um clid falso mentiria para qualquer
    // integração que devolva o clid à Meta; quem marca o lead como pago é source + ad_platform.
    p_ctwa_clid: ctwaClid,
    p_campaign: campaign,
    p_adset: adset,
    p_ad: ad,
    p_ad_platform: adInfo.adPlatform,
    // `source_id` fica guardado de propósito: é o que permite reprocessar a Graph API depois e
    // preencher a campanha dos cliques que entraram com o token bloqueado.
    p_raw: {
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

  if (error) {
    console.error("[ctwa-tracking] ingest falhou:", error);
    // Pior caso: o clique chegou, a Meta respondeu, e mesmo assim o lead vai ficar sem origem.
    await registrar(
      "gravacao_do_clique_falhou",
      "Clique de anúncio recebido mas NÃO gravado — o lead vai entrar sem origem",
      "critical", clinic.id, { erro: error.message, telefone_lead: leadPhone },
    );
    return json({ ok: false, error: error.message }, 500);
  }

  return json({
    ok: true, clinic_id: clinic.id, phone: leadPhone,
    inserted: result?.inserted ?? null,   // false = a linha já existia e foi COMPLETADA
    campaign, adset, ad, platform: adInfo.adPlatform,
  });
});
