// google-spend-sync — sincroniza o INVESTIMENTO diário do Google Ads para uma clínica.
//
// Irmã da meta-spend-sync. Substitui o fluxo manual do n8n (que rodava a GAQL de UM dia por vez).
// Aqui uma ÚNICA query com segments.date na projeção devolve o gasto quebrado por dia no período.
// Faz upsert em marketing_data (platform='google_ads', onConflict clinic_id,date,platform),
// gravando SÓ investment — os campos manuais da linha ficam intactos.
//
// Contrato:
//   req  POST { clinic_id, since: "YYYY-MM-DD", until: "YYYY-MM-DD" }
//   resp { ok, days, updated, total_spend, from, to }  |  { ok:false, error, ... }
//
// Auth do CHAMADOR: JWT do usuário → verify_jwt ON; autorização reconferida no contexto do
// usuário (is_clinic_admin / is_super_admin). O clinic_id do body NÃO é confiável por si só.
//
// Auth com o GOOGLE (o pulo do gato vs. Meta): o developer-token sozinho NÃO autentica. Precisa
// de um access token OAuth2 (Bearer), gerado aqui a partir de client_id + client_secret +
// refresh_token do MCC. Esses 3 segredos vêm de SECRETS da edge (env), NUNCA de system_settings
// (cujo SELECT é público). O developer-token + mcc_id + customer_id vêm da tabela clinics.
//
// Falha que importa (Google recusou / gravação falhou → o dono fica sem o gasto e não percebe)
// → Central de Erros (log_system_error).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { applyAdStatus, fetchGoogleAdGroupBreakdown, upsertSpendBreakdown } from "../_shared/spend.ts";

const GAQL_VERSION = "v24";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  let body: any;
  try { body = await req.json(); } catch { body = {}; }

  const clinicId = typeof body?.clinic_id === "string" ? body.clinic_id : "";
  const since = typeof body?.since === "string" ? body.since : "";
  const until = typeof body?.until === "string" ? body.until : "";
  if (!clinicId || !DATE_RE.test(since) || !DATE_RE.test(until)) {
    return json({ ok: false, error: "bad_request", detail: "clinic_id, since e until (YYYY-MM-DD) são obrigatórios" }, 400);
  }
  if (since > until) return json({ ok: false, error: "bad_range", detail: "since não pode ser maior que until" }, 400);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const service = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");

  const registrarErro = async (code: string, title: string, level: string, ctx: Record<string, unknown>) => {
    try {
      await service.rpc("log_system_error", {
        p_scope: "google-spend-sync", p_code: code, p_title: title, p_level: level,
        p_clinic_id: clinicId, p_context: ctx, p_is_monitor: false,
      });
    } catch (_e) { /* nunca derrubar a resposta por causa do log */ }
  };

  // (1) Auth: usuário do JWT.
  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace("Bearer ", "");
  const { data: userData } = await service.auth.getUser(jwt);
  if (!userData?.user?.id) return json({ ok: false, error: "unauthorized" }, 401);

  // (2) Autorização por clínica no CONTEXTO do usuário.
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const [{ data: isAdmin }, { data: isSuper }] = await Promise.all([
    userClient.rpc("is_clinic_admin", { p_clinic_id: clinicId }),
    userClient.rpc("is_super_admin"),
  ]);
  if (isAdmin !== true && isSuper !== true) return json({ ok: false, error: "forbidden" }, 403);

  // (3) Credenciais. O customer_id é da CLÍNICA; o MCC + developer-token são da AGÊNCIA
  // (org): configurados uma vez na org e herdados. Fallback = valor da própria clínica
  // (clínica sem org, ou org sem MCC setado). Só o service_role lê.
  const { data: clinic, error: clinicErr } = await service
    .from("clinics")
    .select("google_ad_account_id, google_ad_mcc_id, google_ad_mcc_token, google_status, organization_id")
    .eq("id", clinicId)
    .single();
  if (clinicErr) {
    await registrarErro("clinica_nao_encontrada", "Falha ao ler credenciais Google Ads da clínica", "error", { detail: clinicErr.message });
    return json({ ok: false, error: "clinic_read_failed", detail: clinicErr.message }, 500);
  }
  let mccId = clinic?.google_ad_mcc_id ?? null;
  let devToken = clinic?.google_ad_mcc_token ?? null;
  if (clinic?.organization_id) {
    const { data: org } = await service
      .from("organizations")
      .select("google_ad_mcc_id, google_ad_mcc_token")
      .eq("id", clinic.organization_id)
      .maybeSingle();
    if (org?.google_ad_mcc_id && String(org.google_ad_mcc_id).trim()) mccId = org.google_ad_mcc_id;
    if (org?.google_ad_mcc_token && String(org.google_ad_mcc_token).trim()) devToken = org.google_ad_mcc_token;
  }
  if (!clinic?.google_ad_account_id || !mccId || !devToken) {
    return json({ ok: false, error: "google_not_configured", detail: "Falta a conta do Google Ads da clínica ou o MCC/developer-token (na organização ou na clínica)." }, 200);
  }
  const customerId = String(clinic.google_ad_account_id).replace(/\D/g, ""); // sem hífens
  const loginCustomerId = String(mccId).replace(/\D/g, "");

  // (4) OAuth2: refresh_token (segredo do MCC) → access_token de curta duração.
  // Os 3 valores moram no Vault (gravados pelo painel Super Admin via set_google_ads_secret);
  // só o service_role decifra (get_google_ads_secret). Fallback para env var, se um dia setado.
  const readSecret = async (name: string): Promise<string> => {
    const { data } = await service.rpc("get_google_ads_secret", { p_name: name });
    return (typeof data === "string" && data) ? data : (Deno.env.get(name) ?? "");
  };
  const [clientId, clientSecret, refreshToken] = await Promise.all([
    readSecret("GOOGLE_ADS_CLIENT_ID"),
    readSecret("GOOGLE_ADS_CLIENT_SECRET"),
    readSecret("GOOGLE_ADS_REFRESH_TOKEN"),
  ]);
  if (!clientId || !clientSecret || !refreshToken) {
    await registrarErro("oauth_nao_configurado", "Segredos OAuth do Google Ads ausentes na edge", "critical",
      { faltando: { clientId: !clientId, clientSecret: !clientSecret, refreshToken: !refreshToken } });
    return json({ ok: false, error: "google_oauth_not_configured", detail: "Os segredos OAuth do Google Ads não estão configurados no servidor." }, 200);
  }

  let accessToken = "";
  try {
    const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });
    const tokenJson = await tokenResp.json();
    if (!tokenResp.ok || !tokenJson.access_token) {
      await registrarErro("oauth_recusou", "A troca de token OAuth do Google falhou", "critical",
        { erro: tokenJson.error, descricao: tokenJson.error_description });
      return json({ ok: false, error: "oauth_error", detail: tokenJson.error_description || tokenJson.error || "falha no OAuth" }, 502);
    }
    accessToken = tokenJson.access_token;
  } catch (e) {
    await registrarErro("oauth_falhou", "Exceção ao trocar token OAuth do Google", "critical",
      { erro: e instanceof Error ? e.message : String(e) });
    return json({ ok: false, error: "oauth_failed", detail: e instanceof Error ? e.message : String(e) }, 500);
  }

  // (5) GAQL: gasto por dia no período. FROM campaign (igual ao n8n, comprovado) + segments.date
  // na projeção → 1 linha por campanha×dia; somamos por dia no cliente. searchStream devolve tudo
  // num array de lotes (sem pageToken).
  const query =
    `SELECT segments.date, metrics.cost_micros FROM campaign ` +
    `WHERE segments.date BETWEEN '${since}' AND '${until}'`;

  const byDate = new Map<string, number>(); // date → soma de cost_micros
  try {
    const resp = await fetch(
      `https://googleads.googleapis.com/${GAQL_VERSION}/customers/${customerId}/googleAds:searchStream`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "developer-token": String(devToken),
          "login-customer-id": loginCustomerId,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query }),
      },
    );
    const payload = await resp.json();
    if (!resp.ok) {
      const gErr = Array.isArray(payload) ? payload[0]?.error : payload?.error;
      await registrarErro(
        "google_api_recusou",
        "O Google recusou a busca do investimento — o gasto do período pode ficar desatualizado",
        "critical",
        { status: resp.status, erro: gErr?.message ?? gErr, customer: customerId },
      );
      await applyAdStatus(service, clinicId, "google", clinic.google_status, false);
      return json({ ok: false, error: "google_error", detail: gErr?.message ?? "erro da Google Ads API" }, 502);
    }
    // searchStream: array de lotes { results: [...] }. (search: objeto único com results.)
    const batches = Array.isArray(payload) ? payload : [payload];
    for (const batch of batches) {
      for (const r of (batch?.results ?? [])) {
        const d = r?.segments?.date;
        const micros = Number(r?.metrics?.costMicros ?? 0) || 0;
        if (d) byDate.set(d, (byDate.get(d) ?? 0) + micros);
      }
    }
  } catch (e) {
    await registrarErro("ciclo_falhou", "A sincronização de investimento do Google quebrou", "critical",
      { erro: e instanceof Error ? e.message : String(e) });
    await applyAdStatus(service, clinicId, "google", clinic.google_status, false);
    return json({ ok: false, error: "fetch_failed", detail: e instanceof Error ? e.message : String(e) }, 500);
  }

  // Busca funcionou → reativa o status se estava inativo (não mexe em 'none').
  await applyAdStatus(service, clinicId, "google", clinic.google_status, true);

  // (6) Upsert por dia (micros → moeda). onConflict atualiza SÓ investment.
  // micros → moeda, arredondado a 2 casas (centavos). Round half-up sobre centavos.
  const rows = [...byDate.entries()].map(([date, micros]) => ({ date, spend: Math.round(micros / 10_000) / 100 }));
  const totalSpend = rows.reduce((a, r) => a + r.spend, 0);
  let updated = 0;
  if (rows.length > 0) {
    const payload = rows.map(r => ({
      clinic_id: clinicId,
      date: r.date,
      platform: "google_ads",
      investment: r.spend,
    }));
    const { error: upErr } = await service
      .from("marketing_data")
      .upsert(payload, { onConflict: "clinic_id,date,platform" });
    if (upErr) {
      await registrarErro("gravacao_falhou", "Investimento do Google veio, mas NÃO foi gravado", "error",
        { detail: upErr.message, dias: rows.length });
      return json({ ok: false, error: "upsert_failed", detail: upErr.message }, 500);
    }
    updated = rows.length;
  }

  // (7) Investimento POR CAMPANHA — best-effort, NÃO bloqueia a resposta nem afeta o total acima
  // (já gravado, fonte dos painéis). Reusa o mesmo accessToken/devToken/mccId já resolvidos.
  let breakdownRows = 0;
  try {
    const bd = await fetchGoogleAdGroupBreakdown(accessToken, devToken, mccId, customerId, since, until);
    if (bd.error) {
      await registrarErro("breakdown_falhou", "Detalhamento por campanha do Google falhou (total por conta OK)", "warning", { detail: bd.error });
    } else if (bd.rows.length > 0) {
      const up = await upsertSpendBreakdown(service, clinicId, "google_ads", bd.rows);
      if (up.error) await registrarErro("breakdown_gravacao_falhou", "Detalhamento por campanha do Google veio, mas não foi gravado", "warning", { detail: up.error });
      else breakdownRows = bd.rows.length;
    }
  } catch (e) {
    await registrarErro("breakdown_excecao", "Detalhamento por campanha do Google quebrou (total por conta OK)", "warning", { detail: e instanceof Error ? e.message : String(e) });
  }

  return json({ ok: true, days: rows.length, updated, total_spend: totalSpend, from: since, to: until, breakdown_rows: breakdownRows });
});
