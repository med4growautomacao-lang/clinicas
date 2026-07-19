// meta-spend-sync — sincroniza o INVESTIMENTO diário do Meta Ads para uma clínica.
//
// Substitui o fluxo manual do n8n (que chamava a Graph API 1x POR DIA num Loop + Wait).
// Aqui uma ÚNICA chamada com time_increment=1 já devolve o gasto quebrado por dia — bem
// mais rápido e sem estourar rate limit. Faz upsert em marketing_data (platform='meta_ads',
// onConflict clinic_id,date,platform), preservando os demais campos manuais da linha.
//
// Contrato:
//   req  POST { clinic_id, since: "YYYY-MM-DD", until: "YYYY-MM-DD" }
//   resp { ok, days, updated, total_spend, from, to }  |  { ok:false, error, ... }
//
// Auth: JWT do usuário (functions.invoke manda automático) → verify_jwt ON. A autorização
// por clínica é reconferida no CONTEXTO do usuário (is_clinic_admin / is_super_admin) — o
// clinic_id do body NÃO é confiável por si só. A leitura do token e o upsert usam service role.
//
// Falha que importa (Meta recusou / gravação falhou → o dono fica sem o número do gasto e não
// percebe) → Central de Erros (log_system_error).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { applyAdStatus } from "../_shared/spend.ts";

const GRAPH_VERSION = "v24.0";
const CHUNK_DAYS = 90;              // a insights diária tem teto de janela; fatiar em blocos ≤90d
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Fatia [since, until] em janelas de até CHUNK_DAYS dias (inclusivas).
function dateChunks(since: string, until: string): Array<{ since: string; until: string }> {
  const out: Array<{ since: string; until: string }> = [];
  const start = new Date(since + "T00:00:00Z");
  const end = new Date(until + "T00:00:00Z");
  let cur = new Date(start);
  while (cur <= end) {
    const chunkEnd = new Date(cur);
    chunkEnd.setUTCDate(chunkEnd.getUTCDate() + CHUNK_DAYS - 1);
    if (chunkEnd > end) chunkEnd.setTime(end.getTime());
    out.push({
      since: cur.toISOString().slice(0, 10),
      until: chunkEnd.toISOString().slice(0, 10),
    });
    cur = new Date(chunkEnd);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

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
        p_scope: "meta-spend-sync", p_code: code, p_title: title, p_level: level,
        p_clinic_id: clinicId, p_context: ctx, p_is_monitor: false,
      });
    } catch (_e) { /* nunca derrubar a resposta por causa do log */ }
  };

  // (1) Auth: usuário do JWT.
  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace("Bearer ", "");
  const { data: userData } = await service.auth.getUser(jwt);
  if (!userData?.user?.id) return json({ ok: false, error: "unauthorized" }, 401);

  // (2) Autorização por clínica no CONTEXTO do usuário (auth.uid resolve dentro do predicado).
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const [{ data: isAdmin }, { data: isSuper }] = await Promise.all([
    userClient.rpc("is_clinic_admin", { p_clinic_id: clinicId }),
    userClient.rpc("is_super_admin"),
  ]);
  if (isAdmin !== true && isSuper !== true) return json({ ok: false, error: "forbidden" }, 403);

  // (3) Token + conta de anúncios da clínica (service role — segredo nunca vai ao browser).
  const { data: clinic, error: clinicErr } = await service
    .from("clinics")
    .select("meta_token, meta_ad_account_id, meta_status")
    .eq("id", clinicId)
    .single();
  if (clinicErr) {
    await registrarErro("clinica_nao_encontrada", "Falha ao ler credenciais Meta da clínica", "error", { detail: clinicErr.message });
    return json({ ok: false, error: "clinic_read_failed", detail: clinicErr.message }, 500);
  }
  if (!clinic?.meta_token || !clinic?.meta_ad_account_id) {
    return json({ ok: false, error: "meta_not_configured", detail: "Esta clínica não tem token/conta de anúncios do Meta configurados." }, 200);
  }

  const account = String(clinic.meta_ad_account_id).replace(/^act_/, "");

  // (4) Busca o gasto DIÁRIO (time_increment=1) por blocos ≤90d, paginando se preciso.
  const rows: Array<{ date: string; spend: number }> = [];
  try {
    for (const chunk of dateChunks(since, until)) {
      const timeRange = encodeURIComponent(JSON.stringify({ since: chunk.since, until: chunk.until }));
      let url: string | null =
        `https://graph.facebook.com/${GRAPH_VERSION}/act_${account}/insights` +
        `?fields=spend&level=account&time_increment=1&limit=500` +
        `&time_range=${timeRange}&access_token=${encodeURIComponent(clinic.meta_token)}`;

      while (url) {
        const resp = await fetch(url);
        const j = await resp.json();
        if (j.error) {
          await registrarErro(
            "graph_api_recusou",
            "A Meta recusou a busca do investimento — o gasto do período pode ficar desatualizado",
            "critical",
            { erro: j.error?.message, codigo: j.error?.code, chunk, account },
          );
          await applyAdStatus(service, clinicId, "meta", clinic.meta_status, false);
          return json({ ok: false, error: "graph_error", detail: j.error?.message ?? "erro da Graph API" }, 502);
        }
        for (const d of (j.data ?? [])) {
          if (d?.date_start && d?.spend != null) {
            // arredonda a 2 casas (centavos) — o Meta já manda em moeda, mas com casas extras às vezes.
            rows.push({ date: String(d.date_start), spend: Math.round((Number(d.spend) || 0) * 100) / 100 });
          }
        }
        url = j.paging?.next ?? null;
      }
    }
  } catch (e) {
    await registrarErro("ciclo_falhou", "A sincronização de investimento do Meta quebrou", "critical",
      { erro: e instanceof Error ? e.message : String(e) });
    await applyAdStatus(service, clinicId, "meta", clinic.meta_status, false);
    return json({ ok: false, error: "fetch_failed", detail: e instanceof Error ? e.message : String(e) }, 500);
  }

  // Busca funcionou → reativa o status se estava inativo (não mexe em 'none').
  await applyAdStatus(service, clinicId, "meta", clinic.meta_status, true);

  // (5) Upsert por dia. onConflict (clinic_id,date,platform) atualiza SÓ investment — os campos
  // manuais da linha (manual_leads_count, conversions_value…) não entram no payload e ficam intactos.
  const totalSpend = rows.reduce((a, r) => a + r.spend, 0);
  let updated = 0;
  if (rows.length > 0) {
    const payload = rows.map(r => ({
      clinic_id: clinicId,
      date: r.date,
      platform: "meta_ads",
      investment: r.spend,
    }));
    const { error: upErr } = await service
      .from("marketing_data")
      .upsert(payload, { onConflict: "clinic_id,date,platform" });
    if (upErr) {
      await registrarErro("gravacao_falhou", "Investimento do Meta veio, mas NÃO foi gravado", "error",
        { detail: upErr.message, dias: rows.length });
      return json({ ok: false, error: "upsert_failed", detail: upErr.message }, 500);
    }
    updated = rows.length;
  }

  return json({ ok: true, days: rows.length, updated, total_spend: totalSpend, from: since, to: until });
});
