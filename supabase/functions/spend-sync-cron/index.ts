// spend-sync-cron — agendador NATIVO da sincronização de investimento (Meta + Google), varrendo
// TODAS as clínicas. Substitui os fluxos manuais/agendados do n8n.
//
// Disparado pelo pg_cron a cada 15 min (sem JWT, via system_http_post). Só roda de verdade quando
// "está na hora" (config.every_hours desde o último sweep completo). Um sweep processa as clínicas
// em LOTES por cursor — cada tick pega o próximo lote; ao dar a volta, descansa até o próximo
// intervalo. Isso respeita o wall-clock da edge e os rate limits (Basic do Google = 15k ops/dia;
// throttle de app do Meta) mesmo com milhares de contas.
//
// Config (system_settings id='ad_spend_sync_config'): { enabled, every_hours, lookback_days,
// platforms, batch_size }. Estado (id='ad_spend_sync_state'): { last_run_at, cursor }.
//
// Guardrails: 1 refresh OAuth do Google por tick (reusa o token); backoff em 429/503 (no _shared);
// concorrência limitada; lookback curto (1 chamada/conta); falha por conta → Central de Erros,
// sem derrubar o lote; cursor só avança no que processou; last_run_at só no fim do sweep.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fetchMetaDaily, fetchGoogleDaily, getGoogleAccessToken, upsertSpend, applyAdStatus, fetchMetaAdBreakdown, fetchGoogleAdGroupBreakdown, upsertSpendBreakdown } from "../_shared/spend.ts";
import { type CamadaToken, comFallback, lembrarCamada, ordenarCandidatos, tokenDaPlataforma } from "../_shared/meta-token.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// breakdown_enabled: o detalhamento por campanha dobra as chamadas ao Google Ads (teto de quota
// diária) e ao Meta em TODAS as clínicas a cada tick. A condição para ligar era o front que
// consome marketing_spend_breakdown estar no ar, e ela foi cumprida em 21/07 (useCampaignInvestment
// e useCampaignPlatformSplit, usados no MarketingAnalytics), então em produção está LIGADO via
// system_settings. Segue false aqui só como padrão conservador de ambiente novo.
//
// include_today: OFF por padrão, o agendado grava só dia fechado (ver a janela, mais abaixo).
//
// lookback_days: 2, não 1, DE PROPÓSITO. Com until=ontem, lookback=1 daria a janela [ontem, ontem]
// e cada dia teria UMA só chance de ser capturado: bastava a rodada das 05:00 falhar uma vez para
// aquele dia ficar sem investimento para sempre, já que no dia seguinte a janela anda junto. Com 2
// há um dia de sobreposição, e a rodada seguinte repesca o que a anterior perdeu.
const DEFAULT_CONFIG = { enabled: false, every_hours: 24, run_hour_sp: 5, lookback_days: 2, platforms: ["meta_ads", "google_ads"], batch_size: 300, breakdown_enabled: false, include_today: false };
const CONCURRENCY = 8; // contas processadas em paralelo por lote

interface ClinicRow {
  id: string;
  organization_id: string | null;
  meta_token: string | null;
  meta_token_source: CamadaToken | null;
  meta_ad_account_id: string | null;
  google_ad_account_id: string | null;
  google_ad_mcc_id: string | null;
  google_ad_mcc_token: string | null;
  meta_status: string | null;
  google_status: string | null;
}

// pool de concorrência simples
async function mapPool<T>(items: T[], limit: number, fn: (t: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; await fn(items[idx]); }
  });
  await Promise.all(workers);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const service = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");

  const registrar = (code: string, title: string, level: string, clinicId: string | null, ctx: unknown) =>
    service.rpc("log_system_error", {
      p_scope: "spend-sync-cron", p_code: code, p_title: title, p_level: level,
      p_clinic_id: clinicId, p_context: ctx, p_is_monitor: false,
    }).then(() => {}, (e) => console.error("[spend-sync-cron] log falhou:", e));

  const readJson = async (id: string, fallback: unknown) => {
    const { data } = await service.from("system_settings").select("value").eq("id", id).maybeSingle();
    if (!data?.value) return fallback;
    try { return JSON.parse(data.value); } catch { return fallback; }
  };
  const writeState = (state: unknown) =>
    service.from("system_settings").upsert(
      { id: "ad_spend_sync_state", value: JSON.stringify(state), description: "Estado do agendador de investimento (cursor + last_run_at)", updated_at: new Date().toISOString() },
      { onConflict: "id" },
    );

  const cfg = { ...DEFAULT_CONFIG, ...(await readJson("ad_spend_sync_config", {})) };
  if (!cfg.enabled) return json({ ok: true, skipped: "disabled" });

  // since/until ficam no state enquanto um sweep está em andamento (ver a janela, mais abaixo).
  const state = await readJson("ad_spend_sync_state", { last_run_at: null, cursor: 0 }) as
    { last_run_at: string | null; cursor: number; since?: string; until?: string };
  const now = Date.now();
  const sweeping = (Number(state.cursor) || 0) > 0;
  const everyHours = Math.max(1, Number(cfg.every_hours) || 24);
  const runHour = Math.min(23, Math.max(0, Number(cfg.run_hour_sp ?? 5))); // hora fixa (SP) p/ rodada diária

  // Datas em America/Sao_Paulo.
  const spDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const todaySP = spDay(new Date());
  const spHour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", hourCycle: "h23" }).format(new Date()));
  const lastRunSpDay = state.last_run_at ? spDay(new Date(state.last_run_at)) : null;

  if (!sweeping) {
    let due: boolean;
    if (everyHours >= 24) {
      // 1×/dia ancorado numa HORA fixa (SP): dispara quando passa da hora e ainda não rodou hoje.
      // >= (não ==) torna robusto a tick perdido; o guard lastRunSpDay evita rodar 2× no mesmo dia.
      due = spHour >= runHour && lastRunSpDay !== todaySP;
    } else {
      due = !state.last_run_at || (now - Date.parse(state.last_run_at)) >= everyHours * 3600_000;
    }
    if (!due) return json({ ok: true, skipped: "not_due", sp_hour: spHour, run_hour: runHour, last_run_sp_day: lastRunSpDay });
  }
  const cursor = Number(state.cursor) || 0;

  // Janela: de (hoje - lookback_days) até ONTEM (SP), inclusive.
  //
  // O agendado grava só dia FECHADO, de propósito. O dia corrente é sempre parcial e, rodando às
  // 05:00, entraria quase zerado e ficaria congelado assim até a manhã seguinte: em 21/07 isso
  // escondia R$ 2.700 de gasto real (uma clínica marcava 1.148 quando já eram 2.982), e o número
  // errado ainda contaminava ROAS e custo por lead do dia, sempre para menos.
  // Quem quiser o número de hoje usa o botão do Marketing, que manda a janela explícita.
  // include_today: true volta ao comportamento antigo (ontem + hoje) sem precisar de deploy.
  //
  // A sobreposição vem de lookback_days >= 2 (ver DEFAULT_CONFIG): a janela precisa cobrir mais de
  // um dia fechado para que a rodada de amanhã repesque o dia que a de hoje eventualmente perdeu.
  //
  // A janela é CONGELADA no state no início do sweep e reusada pelos lotes seguintes. Derivar de
  // todaySP a cada tick parece equivalente e não é: um sweep multi-lote que atravesse a meia-noite
  // calcularia uma janela para as clínicas do primeiro lote e outra para as do segundo, gravando
  // dias diferentes na mesma rodada, sem erro nenhum aparecendo. Com poucas clínicas o sweep cabe
  // num tick só e isso fica dormente, mas acorda sozinho quando a base crescer.
  const lookback = Math.max(1, Number(cfg.lookback_days) || 1);
  const dayOffset = (base: string, days: number) => {
    const d = new Date(base + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - days);
    return d.toISOString().slice(0, 10);
  };
  // Sweep herdado de antes deste código (ou state corrompido) não tem janela: recalcula.
  const retomando = sweeping && !!state.since && !!state.until;
  const since = retomando ? state.since! : dayOffset(todaySP, lookback);
  const until = retomando ? state.until! : dayOffset(todaySP, cfg.include_today === true ? 0 : 1);

  const platforms: string[] = Array.isArray(cfg.platforms) ? cfg.platforms : DEFAULT_CONFIG.platforms;
  const wantMeta = platforms.includes("meta_ads");
  const wantGoogle = platforms.includes("google_ads");
  const batchSize = Math.max(1, Math.min(2000, Number(cfg.batch_size) || 300));

  // Token do Google UMA vez por tick (reuso nas N contas). Se OAuth não configurado, pula Google.
  let googleToken: string | null = null;
  if (wantGoogle) {
    const { token, error } = await getGoogleAccessToken(service);
    if (error) { if (error !== "google_oauth_not_configured") await registrar("google_oauth_falhou", "OAuth do Google falhou no agendador", "critical", null, { error }); }
    else googleToken = token ?? null;
  }

  // Credenciais de AGÊNCIA (org), herdadas por todas as clínicas dela: MCC + developer-token do
  // Google, e o token do Meta. Um mapa por org; a clínica pode sobrepor com valor próprio.
  // Só o customer_id (Google) e o meta_ad_account_id (Meta) são por-clínica.
  const orgAds = new Map<string, { mccId: string | null; mccToken: string | null; metaToken: string | null }>();
  {
    const { data: orgs } = await service
      .from("organizations")
      .select("id, google_ad_mcc_id, google_ad_mcc_token, meta_ad_token");
    for (const o of orgs ?? []) orgAds.set(o.id, { mccId: o.google_ad_mcc_id, mccToken: o.google_ad_mcc_token, metaToken: o.meta_ad_token });
  }
  const resolveGoogle = (c: ClinicRow) => {
    const o = c.organization_id ? orgAds.get(c.organization_id) : undefined;
    return {
      mcc: (o?.mccId && String(o.mccId).trim() ? o.mccId : null) ?? c.google_ad_mcc_id,
      token: (o?.mccToken && String(o.mccToken).trim() ? o.mccToken : null) ?? c.google_ad_mcc_token,
    };
  };
  // Token do Meta em TRÊS camadas (cliente → organização → plataforma), com a que funcionou por
  // último na frente. Antes daqui a resolução era só clínica-ou-org e SEM tentar outra em caso de
  // erro: token vencido = investimento do dia perdido, mesmo havendo token bom ao lado.
  const platformToken = await tokenDaPlataforma(service);
  const candidatosMeta = (c: ClinicRow) => ordenarCandidatos(c.meta_token_source ?? null, {
    clinic: c.meta_token,
    org: c.organization_id ? orgAds.get(c.organization_id)?.metaToken : null,
    platform: platformToken,
  });

  // Próximo lote de clínicas ativas com Meta OU Google configurado.
  // O gate exige só o id por-clínica (meta_ad_account_id / google customer_id); o token pode vir
  // da org — por isso NÃO filtramos por meta_token aqui (a resolução token clínica→org é em código).
  const { data: clinics, error: clinicsErr } = await service
    .from("clinics")
    .select("id, organization_id, meta_token, meta_token_source, meta_ad_account_id, google_ad_account_id, google_ad_mcc_id, google_ad_mcc_token, meta_status, google_status")
    .eq("is_active", true)
    .or("meta_ad_account_id.not.is.null,google_ad_account_id.not.is.null")
    .order("id", { ascending: true })
    .range(cursor, cursor + batchSize - 1);

  if (clinicsErr) {
    await registrar("clinics_query_falhou", "Falha ao listar clínicas no agendador de investimento", "error", null, { error: clinicsErr.message });
    return json({ ok: false, error: clinicsErr.message }, 500);
  }

  const list = (clinics ?? []) as ClinicRow[];
  let metaOk = 0, googleOk = 0, errors = 0;
  const breakdownEnabled = cfg.breakdown_enabled === true;

  await mapPool(list, CONCURRENCY, async (c) => {
    const cands = candidatosMeta(c);
    if (wantMeta && cands.length > 0 && c.meta_ad_account_id) {
      const conta = c.meta_ad_account_id;
      const r = await comFallback(cands, async (token) => {
        const res = await fetchMetaDaily(token, conta, since, until);
        return { dados: res, erro: res.error ? { message: res.error, code: res.errorCode } : null };
      });
      const rows = r.dados?.rows ?? [];
      // Só é falha depois que TODAS as camadas recusaram; antes disso o fallback cobriu.
      const error = r.camada ? undefined : (r.erro?.message ?? "nenhuma camada de token funcionou");
      const metaTok = cands.find((x) => x.camada === r.camada)?.token ?? "";
      // Status reflete a BUSCA na API (não a gravação): erro de API → inativa; ok → reativa (se estava inativa).
      await applyAdStatus(service, c.id, "meta", c.meta_status, !error);
      if (error) { errors++; await registrar("meta_falhou", "Sincronização de investimento (Meta) falhou nesta clínica em TODAS as camadas de token", "error", c.id, { error, tentativas: r.tentativas, since, until }); }
      else {
        await lembrarCamada(service, c.id, c.meta_token_source, r.camada);
        const up = await upsertSpend(service, c.id, "meta_ads", rows);
        if (up.error) { errors++; await registrar("meta_upsert_falhou", "Gravação do investimento (Meta) falhou", "error", c.id, { error: up.error }); }
        else metaOk++;
        // Detalhamento por anúncio × rede — best-effort, atrás do flag; não conta em errors/metaOk.
        if (breakdownEnabled) {
          const bd = await fetchMetaAdBreakdown(metaTok, c.meta_ad_account_id, since, until);
          if (bd.error) await registrar("meta_breakdown_falhou", "Detalhamento por anúncio (Meta) falhou nesta clínica", "warning", c.id, { error: bd.error });
          else {
            if (bd.truncated) await registrar("meta_breakdown_truncado", "Detalhamento por anúncio (Meta) veio PARCIAL nesta clínica (muitos anúncios×dias)", "warning", c.id, { since, until, rows: bd.rows.length });
            if (bd.rows.length > 0) {
              const upBd = await upsertSpendBreakdown(service, c.id, "meta_ads", bd.rows);
              if (upBd.error) await registrar("meta_breakdown_gravacao_falhou", "Detalhamento por anúncio (Meta) veio, mas não foi gravado", "warning", c.id, { error: upBd.error });
            }
          }
        }
      }
    }
    const g = resolveGoogle(c);
    if (wantGoogle && googleToken && c.google_ad_account_id && g.mcc && g.token) {
      const { rows, error } = await fetchGoogleDaily(googleToken, g.token, g.mcc, c.google_ad_account_id, since, until);
      await applyAdStatus(service, c.id, "google", c.google_status, !error);
      if (error) { errors++; await registrar("google_falhou", "Sincronização de investimento (Google) falhou nesta clínica", "error", c.id, { error, since, until }); }
      else {
        const up = await upsertSpend(service, c.id, "google_ads", rows);
        if (up.error) { errors++; await registrar("google_upsert_falhou", "Gravação do investimento (Google) falhou", "error", c.id, { error: up.error }); }
        else googleOk++;
        // Detalhamento por campanha — best-effort, atrás do flag; dobra as chamadas ao Google Ads
        // (teto de quota diária), por isso fica OFF por padrão (ver breakdown_enabled).
        if (breakdownEnabled) {
          const bd = await fetchGoogleAdGroupBreakdown(googleToken, g.token, g.mcc, c.google_ad_account_id, since, until);
          if (bd.error) await registrar("google_breakdown_falhou", "Detalhamento por campanha (Google) falhou nesta clínica", "warning", c.id, { error: bd.error });
          else if (bd.rows.length > 0) {
            const upBd = await upsertSpendBreakdown(service, c.id, "google_ads", bd.rows);
            if (upBd.error) await registrar("google_breakdown_gravacao_falhou", "Detalhamento por campanha (Google) veio, mas não foi gravado", "warning", c.id, { error: upBd.error });
          }
        }
      }
    }
  });

  // Avança cursor; fim do sweep quando o lote veio menor que batchSize.
  const done = list.length < batchSize;
  const newCursor = done ? 0 : cursor + list.length;
  // Sweep continuando: guarda a janela para o próximo lote usar a MESMA (ver acima). Terminou:
  // solta, para a rodada seguinte calcular a dela e não herdar uma janela velha.
  await writeState({
    last_run_at: done ? new Date(now).toISOString() : state.last_run_at,
    cursor: newCursor,
    ...(done ? {} : { since, until }),
  });

  return json({ ok: true, since, until, processed: list.length, cursor: newCursor, sweep_complete: done, metaOk, googleOk, errors });
});
