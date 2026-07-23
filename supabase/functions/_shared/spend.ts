// _shared/spend.ts — lógica ÚNICA de "puxar o gasto diário" de Meta e Google Ads.
//
// Fonte da verdade compartilhada pelas 3 edges: meta-spend-sync / google-spend-sync (botão do
// Marketing) e spend-sync-cron (agendador). Mantém o MESMO arredondamento (2 casas) e o MESMO
// contrato de retorno em todas — evita divergência silenciosa (o botão e o cron gravando números
// diferentes seria exatamente o tipo de bug que some sem ninguém ver).
//
// Cada função retorna { rows: [{date, spend}], error? } — nunca lança; o chamador decide o que
// registrar na Central de Erros.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
type Supa = ReturnType<typeof createClient>;

export type SpendRow = { date: string; spend: number };
// errorCode = o `code` da Graph quando o erro veio dela. Sem ele, quem chama só recebe texto e não
// consegue distinguir "este token não serve" (vale tentar outra camada) de limite de requisições
// (trocar de camada só espalharia o bloqueio). Ver _shared/meta-token.ts.
export type SpendResult = { rows: SpendRow[]; error?: string; errorCode?: number };

// Investimento por CAMPANHA → CONJUNTO → ANÚNCIO × dia (Fase 2 do detalhamento — grava em
// marketing_spend_breakdown, tabela PARALELA à marketing_data; não substitui o total por conta,
// que continua vindo de fetchMetaDaily/fetchGoogleDaily acima e é a fonte única dos painéis).
// ad_platform = rede dentro do Meta (facebook/instagram/audience_network/…); '' para Google
// (não tem essa dimensão). adset_id/adset_name/ad_id/ad_name = '' quando a captura não desce
// até aquele nível (ex.: Google só desce a conjunto/ad_group nesta fase, sem anúncio individual).
export type SpendBreakdownRow = {
  date: string;
  ad_platform: string;
  campaign_id: string;
  campaign_name: string;
  adset_id: string;
  adset_name: string;
  ad_id: string;
  ad_name: string;
  spend: number;
};
// truncated=true = bateu o teto de páginas de algum bloco de data — dado PARCIAL (investimento
// subestimado nesse período). Contas grandes (ex.: milhares de anúncios) podem estourar; o
// chamador deve logar isso na Central em vez de gravar em silêncio como se fosse completo.
export type SpendBreakdownResult = { rows: SpendBreakdownRow[]; error?: string; truncated?: boolean; errorCode?: number };

// moeda → 2 casas (centavos), round half-up.
export const roundCents = (n: number) => Math.round(n * 100) / 100;

// ─── Meta ────────────────────────────────────────────────────────────────────
const META_GRAPH_VERSION = "v24.0";
const META_CHUNK_DAYS = 90; // teto da janela da insights diária

function dateChunks(since: string, until: string): Array<{ since: string; until: string }> {
  const out: Array<{ since: string; until: string }> = [];
  const start = new Date(since + "T00:00:00Z");
  const end = new Date(until + "T00:00:00Z");
  let cur = new Date(start);
  while (cur <= end) {
    const chunkEnd = new Date(cur);
    chunkEnd.setUTCDate(chunkEnd.getUTCDate() + META_CHUNK_DAYS - 1);
    if (chunkEnd > end) chunkEnd.setTime(end.getTime());
    out.push({ since: cur.toISOString().slice(0, 10), until: chunkEnd.toISOString().slice(0, 10) });
    cur = new Date(chunkEnd);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

// Gasto diário do Meta (insights, time_increment=1). 1 chamada por bloco ≤90d.
export async function fetchMetaDaily(
  metaToken: string, adAccountId: string, since: string, until: string,
): Promise<SpendResult> {
  const account = String(adAccountId).replace(/^act_/, "");
  const rows: SpendRow[] = [];
  for (const chunk of dateChunks(since, until)) {
    const timeRange = encodeURIComponent(JSON.stringify({ since: chunk.since, until: chunk.until }));
    let url: string | null =
      `https://graph.facebook.com/${META_GRAPH_VERSION}/act_${account}/insights` +
      `?fields=spend&level=account&time_increment=1&limit=500` +
      `&time_range=${timeRange}&access_token=${encodeURIComponent(metaToken)}`;
    while (url) {
      const resp = await fetchWithBackoff(url);
      const j = await resp.json();
      if (j.error) return { rows, error: `meta: ${j.error?.message ?? "graph error"}`, errorCode: Number(j.error?.code) || undefined };
      for (const d of (j.data ?? [])) {
        if (d?.date_start && d?.spend != null) rows.push({ date: String(d.date_start), spend: roundCents(Number(d.spend) || 0) });
      }
      url = j.paging?.next ?? null;
    }
  }
  return { rows };
}

// Gasto diário POR ANÚNCIO × rede do Meta (level=ad + breakdowns=publisher_platform). level=ad
// já devolve campaign_id/name + adset_id/name + ad_id/name JUNTOS em cada linha — 1 chamada
// captura a hierarquia INTEIRA (campanha→conjunto→anúncio), mais barato que 3 chamadas separadas
// por nível. Mesma janela/chunking de fetchMetaDaily; página com teto de segurança (best-effort,
// não deve travar o sync do total se uma conta tiver MUITOS anúncios×dias).
const META_BREAKDOWN_PAGE_CAP = 300;
export async function fetchMetaAdBreakdown(
  metaToken: string, adAccountId: string, since: string, until: string,
): Promise<SpendBreakdownResult> {
  const account = String(adAccountId).replace(/^act_/, "");
  const rows: SpendBreakdownRow[] = [];
  let truncated = false;
  for (const chunk of dateChunks(since, until)) {
    const timeRange = encodeURIComponent(JSON.stringify({ since: chunk.since, until: chunk.until }));
    let url: string | null =
      `https://graph.facebook.com/${META_GRAPH_VERSION}/act_${account}/insights` +
      `?fields=spend,campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name` +
      `&level=ad&breakdowns=publisher_platform` +
      `&time_increment=1&limit=500&time_range=${timeRange}&access_token=${encodeURIComponent(metaToken)}`;
    let pages = 0;
    while (url && pages < META_BREAKDOWN_PAGE_CAP) {
      pages++;
      const resp = await fetchWithBackoff(url);
      const j = await resp.json();
      if (j.error) return { rows, error: `meta: ${j.error?.message ?? "graph error"}`, errorCode: Number(j.error?.code) || undefined };
      for (const d of (j.data ?? [])) {
        if (d?.date_start && d?.spend != null) {
          rows.push({
            date: String(d.date_start),
            ad_platform: String(d.publisher_platform ?? "").toLowerCase(),
            campaign_id: String(d.campaign_id ?? ""),
            campaign_name: String(d.campaign_name ?? ""),
            adset_id: String(d.adset_id ?? ""),
            adset_name: String(d.adset_name ?? ""),
            ad_id: String(d.ad_id ?? ""),
            ad_name: String(d.ad_name ?? ""),
            spend: roundCents(Number(d.spend) || 0),
          });
        }
      }
      url = j.paging?.next ?? null;
    }
    if (url && pages >= META_BREAKDOWN_PAGE_CAP) truncated = true; // ainda tinha próxima página, mas o teto parou
  }
  return { rows, truncated: truncated || undefined };
}

// ─── Google ──────────────────────────────────────────────────────────────────
const GAQL_VERSION = "v24";

// OAuth2: refresh_token (Vault) → access_token curto. Chame UMA vez por rodada e reuse o token.
export async function getGoogleAccessToken(service: Supa): Promise<{ token?: string; error?: string }> {
  const read = async (name: string) => {
    const { data } = await service.rpc("get_google_ads_secret", { p_name: name });
    return (typeof data === "string" && data) ? data : (Deno.env.get(name) ?? "");
  };
  const [clientId, clientSecret, refreshToken] = await Promise.all([
    read("GOOGLE_ADS_CLIENT_ID"), read("GOOGLE_ADS_CLIENT_SECRET"), read("GOOGLE_ADS_REFRESH_TOKEN"),
  ]);
  if (!clientId || !clientSecret || !refreshToken) return { error: "google_oauth_not_configured" };
  try {
    const resp = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
    });
    const j = await resp.json();
    if (!resp.ok || !j.access_token) return { error: `oauth: ${j.error_description || j.error || "falhou"}` };
    return { token: j.access_token };
  } catch (e) {
    return { error: `oauth: ${e instanceof Error ? e.message : String(e)}` };
  }
}

// Gasto diário do Google (GAQL, searchStream). Soma cost_micros por dia (todas as campanhas).
export async function fetchGoogleDaily(
  accessToken: string, devToken: string, mccId: string, customerId: string, since: string, until: string,
): Promise<SpendResult> {
  const customer = String(customerId).replace(/\D/g, "");
  const loginCustomerId = String(mccId).replace(/\D/g, "");
  const query =
    `SELECT segments.date, metrics.cost_micros FROM campaign WHERE segments.date BETWEEN '${since}' AND '${until}'`;
  const byDate = new Map<string, number>();
  try {
    const resp = await fetchWithBackoff(
      `https://googleads.googleapis.com/${GAQL_VERSION}/customers/${customer}/googleAds:searchStream`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "developer-token": devToken,
          "login-customer-id": loginCustomerId,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query }),
      },
    );
    const payload = await resp.json();
    if (!resp.ok) {
      const gErr = Array.isArray(payload) ? payload[0]?.error : payload?.error;
      return { rows: [], error: `google: ${gErr?.message ?? "api error"}` };
    }
    const batches = Array.isArray(payload) ? payload : [payload];
    for (const batch of batches) {
      for (const r of (batch?.results ?? [])) {
        const d = r?.segments?.date;
        const micros = Number(r?.metrics?.costMicros ?? 0) || 0;
        if (d) byDate.set(d, (byDate.get(d) ?? 0) + micros);
      }
    }
  } catch (e) {
    return { rows: [], error: `google: ${e instanceof Error ? e.message : String(e)}` };
  }
  const rows = [...byDate.entries()].map(([date, micros]) => ({ date, spend: roundCents(micros / 1_000_000) }));
  return { rows };
}

// Gasto diário POR CAMPANHA → CONJUNTO (ad_group) do Google — FROM ad_group já devolve 1 linha
// por conjunto×dia com campaign.id/name JUNTO (não precisa de query separada por nível, igual ao
// Meta). Sem anúncio individual nesta fase (exigiria o recurso ad_group_ad, com sua própria
// paginação/custo — fica pra depois se for útil). Sem breakdown de rede (Google não tem
// Facebook/Instagram — outra dimensão, rede de veiculação, fora do escopo desta fase).
export async function fetchGoogleAdGroupBreakdown(
  accessToken: string, devToken: string, mccId: string, customerId: string, since: string, until: string,
): Promise<SpendBreakdownResult> {
  const customer = String(customerId).replace(/\D/g, "");
  const loginCustomerId = String(mccId).replace(/\D/g, "");
  const query =
    `SELECT segments.date, campaign.id, campaign.name, ad_group.id, ad_group.name, metrics.cost_micros FROM ad_group ` +
    `WHERE segments.date BETWEEN '${since}' AND '${until}'`;
  const rows: SpendBreakdownRow[] = [];
  try {
    const resp = await fetchWithBackoff(
      `https://googleads.googleapis.com/${GAQL_VERSION}/customers/${customer}/googleAds:searchStream`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "developer-token": devToken,
          "login-customer-id": loginCustomerId,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query }),
      },
    );
    const payload = await resp.json();
    if (!resp.ok) {
      const gErr = Array.isArray(payload) ? payload[0]?.error : payload?.error;
      return { rows: [], error: `google: ${gErr?.message ?? "api error"}` };
    }
    const batches = Array.isArray(payload) ? payload : [payload];
    for (const batch of batches) {
      for (const r of (batch?.results ?? [])) {
        const d = r?.segments?.date;
        const micros = Number(r?.metrics?.costMicros ?? 0) || 0;
        if (d) {
          rows.push({
            date: String(d),
            ad_platform: "",
            campaign_id: String(r?.campaign?.id ?? ""),
            campaign_name: String(r?.campaign?.name ?? ""),
            adset_id: String(r?.ad_group?.id ?? ""),
            adset_name: String(r?.ad_group?.name ?? ""),
            ad_id: "",
            ad_name: "",
            spend: roundCents(micros / 1_000_000),
          });
        }
      }
    }
  } catch (e) {
    return { rows: [], error: `google: ${e instanceof Error ? e.message : String(e)}` };
  }
  return { rows };
}

// ─── util ──────────────────────────────────────────────────────────────────
// Backoff exponencial em rate-limit (Google RESOURCE_EXHAUSTED/HTTP 429, Meta code 17/HTTP 429/613).
// Guardrail contra estourar QPS quando o cron varre muitas contas em sequência.
export async function fetchWithBackoff(url: string, init?: RequestInit, tries = 4): Promise<Response> {
  let delay = 500;
  for (let i = 0; i < tries; i++) {
    const resp = await fetch(url, init);
    if (resp.status !== 429 && resp.status !== 503) return resp;
    if (i === tries - 1) return resp;
    await new Promise((r) => setTimeout(r, delay));
    delay *= 2;
  }
  return fetch(url, init);
}

// Decide o próximo meta_status/google_status a partir do atual + se a busca deu certo.
// Regra: 'none' ("Não tem") NUNCA é tocado. Erro de API → 'inactive'. Sucesso → 'active' (só p/
// curar quem estava 'inactive'). Retorna null quando não há mudança (evita write desnecessário).
export function nextAdStatus(current: string | null | undefined, ok: boolean): "active" | "inactive" | null {
  const cur = current ?? "none";
  if (cur === "none") return null;               // "Não tem" → ignora sempre
  if (!ok && cur !== "inactive") return "inactive";
  if (ok && cur === "inactive") return "active";
  return null;
}

// Aplica a transição de status (se houver) para a clínica/plataforma. `ok` = a BUSCA na API
// funcionou (não é erro de gravação no banco — esse não reflete saúde da conta).
export async function applyAdStatus(
  service: Supa, clinicId: string, platform: "meta" | "google", current: string | null | undefined, ok: boolean,
): Promise<void> {
  const next = nextAdStatus(current, ok);
  if (!next) return;
  const col = platform === "meta" ? "meta_status" : "google_status";
  await service.from("clinics").update({ [col]: next }).eq("id", clinicId);
}

// Upsert de N linhas de gasto de uma clínica/plataforma. Grava só investment (onConflict).
export async function upsertSpend(
  service: Supa, clinicId: string, platform: "meta_ads" | "google_ads", rows: SpendRow[],
): Promise<{ error?: string }> {
  if (rows.length === 0) return {};
  const payload = rows.map((r) => ({ clinic_id: clinicId, date: r.date, platform, investment: r.spend }));
  const { error } = await service.from("marketing_data").upsert(payload, { onConflict: "clinic_id,date,platform" });
  return { error: error?.message };
}

// Upsert do detalhamento por campanha. Agrega por chave ANTES de montar o payload — defesa
// contra a mesma chave aparecer 2x na resposta da API (paginação): um upsert em lote com chave
// de conflito duplicada NO MESMO statement falha ("cannot affect row a second time").
export async function upsertSpendBreakdown(
  service: Supa, clinicId: string, platform: "meta_ads" | "google_ads", rows: SpendBreakdownRow[],
): Promise<{ error?: string }> {
  if (rows.length === 0) return {};
  const byKey = new Map<string, SpendBreakdownRow>();
  for (const r of rows) {
    const key = `${r.date}|${r.ad_platform}|${r.campaign_id}|${r.adset_id}|${r.ad_id}`;
    const acc = byKey.get(key);
    if (acc) acc.spend = roundCents(acc.spend + r.spend);
    else byKey.set(key, { ...r });
  }
  const payload = [...byKey.values()].map((r) => ({
    clinic_id: clinicId, date: r.date, platform,
    ad_platform: r.ad_platform, campaign_id: r.campaign_id, campaign_name: r.campaign_name,
    adset_id: r.adset_id, adset_name: r.adset_name, ad_id: r.ad_id, ad_name: r.ad_name,
    investment: r.spend,
  }));
  const { error } = await service.from("marketing_spend_breakdown")
    .upsert(payload, { onConflict: "clinic_id,date,platform,ad_platform,campaign_id,adset_id,ad_id" });
  return { error: error?.message };
}
