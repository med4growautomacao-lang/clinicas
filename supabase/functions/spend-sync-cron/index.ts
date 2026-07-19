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
import { fetchMetaDaily, fetchGoogleDaily, getGoogleAccessToken, upsertSpend, applyAdStatus } from "../_shared/spend.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_CONFIG = { enabled: false, every_hours: 24, run_hour_sp: 5, lookback_days: 1, platforms: ["meta_ads", "google_ads"], batch_size: 300 };
const CONCURRENCY = 8; // contas processadas em paralelo por lote

interface ClinicRow {
  id: string;
  meta_token: string | null;
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

  const state = await readJson("ad_spend_sync_state", { last_run_at: null, cursor: 0 }) as { last_run_at: string | null; cursor: number };
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

  // Janela: de (hoje - lookback_days) até hoje (SP). lookback_days=1 → ONTEM + hoje — garante que
  // o total FINAL de ontem entra (rodando de manhã, ontem já fechou). Rodada agendada nunca perde
  // o fechamento do dia (era o furo com since=hoje).
  const lookback = Math.max(1, Number(cfg.lookback_days) || 1);
  const sinceDate = new Date(todaySP + "T00:00:00Z");
  sinceDate.setUTCDate(sinceDate.getUTCDate() - lookback);
  const since = sinceDate.toISOString().slice(0, 10);
  const until = todaySP;

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

  // Próximo lote de clínicas ativas com Meta OU Google configurado.
  const { data: clinics, error: clinicsErr } = await service
    .from("clinics")
    .select("id, meta_token, meta_ad_account_id, google_ad_account_id, google_ad_mcc_id, google_ad_mcc_token, meta_status, google_status")
    .eq("is_active", true)
    .or("and(meta_token.not.is.null,meta_ad_account_id.not.is.null),and(google_ad_account_id.not.is.null,google_ad_mcc_token.not.is.null,google_ad_mcc_id.not.is.null)")
    .order("id", { ascending: true })
    .range(cursor, cursor + batchSize - 1);

  if (clinicsErr) {
    await registrar("clinics_query_falhou", "Falha ao listar clínicas no agendador de investimento", "error", null, { error: clinicsErr.message });
    return json({ ok: false, error: clinicsErr.message }, 500);
  }

  const list = (clinics ?? []) as ClinicRow[];
  let metaOk = 0, googleOk = 0, errors = 0;

  await mapPool(list, CONCURRENCY, async (c) => {
    if (wantMeta && c.meta_token && c.meta_ad_account_id) {
      const { rows, error } = await fetchMetaDaily(c.meta_token, c.meta_ad_account_id, since, until);
      // Status reflete a BUSCA na API (não a gravação): erro de API → inativa; ok → reativa (se estava inativa).
      await applyAdStatus(service, c.id, "meta", c.meta_status, !error);
      if (error) { errors++; await registrar("meta_falhou", "Sincronização de investimento (Meta) falhou nesta clínica", "error", c.id, { error, since, until }); }
      else {
        const up = await upsertSpend(service, c.id, "meta_ads", rows);
        if (up.error) { errors++; await registrar("meta_upsert_falhou", "Gravação do investimento (Meta) falhou", "error", c.id, { error: up.error }); }
        else metaOk++;
      }
    }
    if (wantGoogle && googleToken && c.google_ad_account_id && c.google_ad_mcc_id && c.google_ad_mcc_token) {
      const { rows, error } = await fetchGoogleDaily(googleToken, c.google_ad_mcc_token, c.google_ad_mcc_id, c.google_ad_account_id, since, until);
      await applyAdStatus(service, c.id, "google", c.google_status, !error);
      if (error) { errors++; await registrar("google_falhou", "Sincronização de investimento (Google) falhou nesta clínica", "error", c.id, { error, since, until }); }
      else {
        const up = await upsertSpend(service, c.id, "google_ads", rows);
        if (up.error) { errors++; await registrar("google_upsert_falhou", "Gravação do investimento (Google) falhou", "error", c.id, { error: up.error }); }
        else googleOk++;
      }
    }
  });

  // Avança cursor; fim do sweep quando o lote veio menor que batchSize.
  const done = list.length < batchSize;
  const newCursor = done ? 0 : cursor + list.length;
  await writeState({ last_run_at: done ? new Date(now).toISOString() : state.last_run_at, cursor: newCursor });

  return json({ ok: true, since, until, processed: list.length, cursor: newCursor, sweep_complete: done, metaOk, googleOk, errors });
});
