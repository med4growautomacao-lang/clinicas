// meta-capi-conversions — envia à Meta os eventos de CONVERSÃO (venda) via Conversions API de
// Business Messaging, fechando o loop do Click-to-WhatsApp. Substitui, nativo, o fluxo-modelo n8n.
//
// Disparo: cron (a cada 2 min) via system_http_post → SEM JWT → verify_jwt=false (igual spend-sync-cron).
// Gate: system_settings.meta_capi_config.enabled — nada sai até o go-live deliberado.
// Fila: tabela meta_capi_events (outbox), preenchida pelo trigger trg_enqueue_meta_capi_event quando
// um lead entra na etapa de conversão (funnel_stages.is_conversion).
//
// Por que os 3 defeitos do fluxo-modelo somem aqui:
//   • Endpoint: POST /{dataset_id}/events — o dataset de Business Messaging (derivado da WABA),
//     NÃO o pixel de site. dataset resolvido/cacheado em clinics.meta_capi_dataset_id.
//   • Chave de match: user_data.whatsapp_business_account_id (é de WhatsApp), não page_id (Messenger).
//   • Observabilidade: toda falha vai para a Central de Erros (log_system_error, scope abaixo).
//
// Ordem de importância dos dados de atribuição (o que sobe a nota da Meta), montados abaixo:
//   1) ctwa_clid  2) whatsapp_business_account_id  3) dataset correto  4) value+currency
//   5) event_time na janela  6) ph  7) external_id (rast_id)  8) em

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GRAPH_VERSION = "v22.0";
const GRAPH = "https://graph.facebook.com";
const SCOPE = "meta-capi-conversions";
const MAX_ATTEMPTS = 5;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// SHA-256 hex de um valor de PII, normalizado como a Meta exige (trim + minúsculas).
async function sha256(raw: string): Promise<string> {
  const norm = raw.trim().toLowerCase();
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(norm));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Telefone para o `ph`: só dígitos, com DDI 55. Mandamos na forma CANÔNICA do WhatsApp (a mesma que
// leads.phone guarda), que é como a Meta conhece o usuário no evento de mensageria.
function phoneDigits(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let p = String(raw).replace(/\D/g, "");
  if (!p) return null;
  if (!p.startsWith("55")) p = "55" + p;
  return p.length >= 12 ? p : null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const json = (o: unknown, s = 200) =>
    new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

  const service = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const registrar = (code: string, title: string, level: string, clinicId: string | null, ctx: unknown) =>
    service.rpc("log_system_error", {
      p_scope: SCOPE, p_code: code, p_title: title, p_level: level,
      p_clinic_id: clinicId, p_context: ctx, p_is_monitor: false,
    }).then(() => {}, (e) => console.error(`[${SCOPE}] log falhou:`, e));

  // Gate: liga/desliga + tamanho do lote + modo Tech Provider.
  const { data: cfgRow } = await service.from("system_settings").select("value").eq("id", "meta_capi_config").maybeSingle();
  let enabled = false, batch = 25, providerMode = false;
  try {
    const cfg = cfgRow?.value ? JSON.parse(cfgRow.value) : {};
    enabled = cfg.enabled === true;
    batch = Math.min(Math.max(Number(cfg.batch_size) || 25, 1), 500);
    // provider_mode: a plataforma é Tech Provider → o token de plataforma acessa as WABAs de todos
    // os clientes; ele passa à frente do token da clínica. Default false = clínica-primeiro (interim).
    providerMode = cfg.provider_mode === true;
  } catch { /* config malformada → tratado como desligado */ }
  if (!enabled) return json({ ok: true, skipped: "disabled" });

  // Lote de pendentes (mais antigos primeiro).
  const { data: pend, error: pendErr } = await service
    .from("meta_capi_events")
    .select("id, clinic_id, ticket_id, lead_id, event_name")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(batch);
  if (pendErr) {
    await registrar("ler_fila_falhou", "Não foi possível ler a fila de conversões CAPI", "error", null, { erro: pendErr.message });
    return json({ ok: false, error: pendErr.message }, 500);
  }
  if (!pend?.length) return json({ ok: true, processed: 0 });

  // Dados relacionados em lote (batch pequeno → sem risco de clamp do PostgREST).
  const clinicIds = [...new Set(pend.map((p) => p.clinic_id))];
  const leadIds = [...new Set(pend.map((p) => p.lead_id).filter(Boolean))] as string[];
  const ticketIds = [...new Set(pend.map((p) => p.ticket_id))];

  const [{ data: clinics }, { data: leads }, { data: convs }, { data: tickets }, { data: platTokenRaw }] = await Promise.all([
    service.from("clinics").select("id, meta_waba_id, meta_capi_dataset_id, meta_token").in("id", clinicIds),
    leadIds.length ? service.from("leads").select("id, phone, email, ctwa_clid, rast_id").in("id", leadIds) : Promise.resolve({ data: [] as any[] }),
    service.from("conversions").select("ticket_id, value, converted_at").in("ticket_id", ticketIds).order("converted_at", { ascending: false }),
    service.from("tickets").select("id, outcome_at").in("id", ticketIds),
    service.rpc("get_meta_cloud_secret", { p_name: "META_CLOUD_TOKEN" }),
  ]);

  const platformToken = (typeof platTokenRaw === "string" ? platTokenRaw : "").trim();
  // Ordem do token: provider → plataforma primeiro (acessa WABAs de clientes); senão clínica primeiro.
  const pickToken = (clinicToken: string) =>
    providerMode ? (platformToken || clinicToken) : (clinicToken || platformToken);
  const clinicById = new Map((clinics ?? []).map((c: any) => [c.id, c]));
  const leadById = new Map((leads ?? []).map((l: any) => [l.id, l]));
  const ticketById = new Map((tickets ?? []).map((t: any) => [t.id, t]));
  // Conversão mais recente por ticket (já veio ordenado desc).
  const convByTicket = new Map<string, any>();
  for (const c of convs ?? []) if (!convByTicket.has(c.ticket_id)) convByTicket.set(c.ticket_id, c);

  // Auto-provisiona o dataset a partir da WABA quando faltar (1×/clínica; cacheia em clinics). POST
  // /{waba}/dataset é IDEMPOTENTE: cria se não existe, senão devolve o id atual (precisa do escopo
  // whatsapp_business_manage_events no token). Assim o go-live não exige passo manual no Events
  // Manager por clínica, e a edge meta-waba-discover vira opcional.
  for (const c of clinics ?? []) {
    const cWaba = (c.meta_waba_id ?? "").trim();
    const cToken = pickToken((c.meta_token ?? "").trim());
    if (cWaba && cToken && !(c.meta_capi_dataset_id ?? "").trim()) {
      try {
        const u = new URL(`${GRAPH}/${GRAPH_VERSION}/${cWaba}/dataset`);
        u.searchParams.set("access_token", cToken);
        const r = await fetch(u.toString(), { method: "POST" });
        const dj = await r.json().catch(() => ({}));
        const ds = String(dj?.id ?? dj?.data?.[0]?.id ?? "").trim();
        if (ds) {
          c.meta_capi_dataset_id = ds;   // muta a referência usada no loop
          await service.from("clinics").update({ meta_capi_dataset_id: ds }).eq("id", c.id);
        } else {
          await registrar("dataset_nao_resolvido", "Não consegui resolver o dataset da WABA no envio", "warn",
            c.id, { waba_id: cWaba, resposta: dj?.error?.message ?? null });
        }
      } catch (e) {
        await registrar("dataset_resolve_falhou", "Falha ao resolver o dataset da WABA no envio", "warn", c.id, { erro: String(e) });
      }
    }
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const loggedMissingConfig = new Set<string>();   // 1 log por clínica por execução
  let sent = 0, skipped = 0, errored = 0;

  for (const ev of pend) {
    const clinic: any = clinicById.get(ev.clinic_id);
    const lead: any = ev.lead_id ? leadById.get(ev.lead_id) : null;

    const dataset = (clinic?.meta_capi_dataset_id ?? "").trim();
    const waba = (clinic?.meta_waba_id ?? "").trim();
    const token = pickToken((clinic?.meta_token ?? "").trim());

    // Gate de config: clínica sem WABA/dataset/token ainda não pode enviar. Marca skipped e loga
    // (1×/clínica) — o go-live é: resolver WABA (edge meta-waba-discover) → só então enabled=true.
    if (!dataset || !waba || !token) {
      await service.from("meta_capi_events").update({
        status: "skipped", last_error: "clínica sem WABA/dataset/token de CAPI configurados",
      }).eq("id", ev.id);
      if (!loggedMissingConfig.has(ev.clinic_id)) {
        loggedMissingConfig.add(ev.clinic_id);
        await registrar("clinica_sem_config", "Conversão pronta mas a clínica não tem WABA/dataset CAPI configurados",
          "warn", ev.clinic_id, { tem_dataset: !!dataset, tem_waba: !!waba, tem_token: !!token });
      }
      skipped++;
      continue;
    }

    // ctwa_clid é a chave determinística do CTWA. Sem ele (lead orgânico / não-anúncio) o evento de
    // mensageria não atribui — pulamos sem poluir a Central (é esperado e de alto volume).
    const clid = (lead?.ctwa_clid ?? "").trim();
    if (!clid) {
      await service.from("meta_capi_events").update({
        status: "skipped", last_error: "lead sem ctwa_clid (não veio de anúncio Click-to-WhatsApp)",
      }).eq("id", ev.id);
      skipped++;
      continue;
    }

    // event_time: hora real da conversão, mas nunca no futuro e nunca fora da janela de 7 dias
    // (a Meta rejeita eventos antigos) — nesse caso reportamos "agora".
    const conv = convByTicket.get(ev.ticket_id);
    const ticket: any = ticketById.get(ev.ticket_id);
    const rawTime = conv?.converted_at ?? ticket?.outcome_at ?? null;
    let et = rawTime ? Math.floor(new Date(rawTime).getTime() / 1000) : nowSec;
    if (!Number.isFinite(et) || et > nowSec || et < nowSec - 7 * 24 * 3600) et = nowSec;

    // user_data — em ordem de importância. clid e waba em claro; PII com SHA-256.
    const userData: Record<string, unknown> = {
      whatsapp_business_account_id: waba,
      ctwa_clid: clid,
    };
    const ph = phoneDigits(lead?.phone);
    if (ph) userData.ph = await sha256(ph);
    if (lead?.email) userData.em = await sha256(String(lead.email));
    if (lead?.rast_id) userData.external_id = await sha256(String(lead.rast_id));

    const event: Record<string, unknown> = {
      event_name: ev.event_name || "Purchase",
      event_time: et,
      action_source: "business_messaging",
      messaging_channel: "whatsapp",
      event_id: ev.ticket_id,                 // dedup do lado Meta
      user_data: userData,
    };
    // value + currency: habilita otimização por ROAS. Só quando há valor de venda registrado.
    const value = conv?.value != null ? Number(conv.value) : null;
    if (value != null && Number.isFinite(value) && value > 0) {
      event.custom_data = { currency: "BRL", value, order_id: ev.ticket_id };
    }

    try {
      const resp = await fetch(`${GRAPH}/${GRAPH_VERSION}/${dataset}/events`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ data: [event] }),
      });
      const j = await resp.json().catch(() => ({}));

      if (!resp.ok || j?.error) {
        const errMsg = j?.error?.error_user_msg || j?.error?.message || `HTTP ${resp.status}`;
        // Busca attempts atual para decidir se ainda tenta de novo ou desiste.
        const { data: cur } = await service.from("meta_capi_events").select("attempts").eq("id", ev.id).maybeSingle();
        const attemptsNow = (cur?.attempts ?? 0) + 1;
        const giveUp = attemptsNow >= MAX_ATTEMPTS;
        await service.from("meta_capi_events").update({
          status: giveUp ? "error" : "pending",
          attempts: attemptsNow,
          last_error: errMsg,
          meta_response: j ?? null,
        }).eq("id", ev.id);
        await registrar("envio_recusado",
          `A Meta recusou o evento de conversão (${resp.status})` + (giveUp ? " — desistindo após várias tentativas" : ""),
          giveUp ? "error" : "warn", ev.clinic_id,
          { ticket_id: ev.ticket_id, tentativa: attemptsNow, erro: errMsg, codigo: j?.error?.code });
        errored++;
        continue;
      }

      await service.from("meta_capi_events").update({
        status: "sent", sent_at: new Date().toISOString(), meta_response: j ?? null, last_error: null,
      }).eq("id", ev.id);
      sent++;
    } catch (e) {
      const { data: cur } = await service.from("meta_capi_events").select("attempts").eq("id", ev.id).maybeSingle();
      const attemptsNow = (cur?.attempts ?? 0) + 1;
      const giveUp = attemptsNow >= MAX_ATTEMPTS;
      await service.from("meta_capi_events").update({
        status: giveUp ? "error" : "pending", attempts: attemptsNow, last_error: String(e),
      }).eq("id", ev.id);
      await registrar("envio_indisponivel", "Não foi possível falar com a Graph API para enviar a conversão",
        giveUp ? "error" : "warn", ev.clinic_id, { ticket_id: ev.ticket_id, tentativa: attemptsNow, erro: String(e) });
      errored++;
    }
  }

  return json({ ok: true, processed: pend.length, sent, skipped, errored });
});
