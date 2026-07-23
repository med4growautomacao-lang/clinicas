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
//   0) lead_id (Instant Form, prioridade MAIS ALTA — em claro)  1) ctwa_clid
//   2) whatsapp_business_account_id  3) dataset correto  4) value+currency
//   5) event_time na janela  6) ph  7) external_id (rast_id)  8) em  9) fn/ln

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { type CamadaToken, type CandidatoToken, ehErroDeToken } from "../_shared/meta-token.ts";

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

// event_name para business_messaging (CTWA) é uma lista MUITO mais restrita que a do pixel/offline
// (testado direto na Graph: só "Purchase" e "LeadSubmitted" passam — "Lead", "Schedule", "Contact" e
// "CompleteRegistration" são recusados com error_subcode 2804066, mesmo sendo nomes padrão válidos no
// pixel). O seletor de evento por etapa é compartilhado pelos 2 caminhos, então mapeamos aqui — o
// caminho offline manda o nome cru (ev.event_name), só o CTWA passa por este normalizador.
const CTWA_VALID_EVENT_NAMES = new Set(["Purchase", "LeadSubmitted"]);
function ctwaEventName(raw: string | null | undefined): string {
  const n = (raw ?? "").trim() || "Purchase";
  return CTWA_VALID_EVENT_NAMES.has(n) ? n : "LeadSubmitted";
}

// Nome do CRM que vai em custom_data.lead_event_source (guia "Evento de CRM" da Meta). É a marca do
// nosso sistema; a Meta usa só como rótulo da origem. Trocar aqui se o produto mudar de nome.
const CRM_NAME = "MedDesk";

// custom_data do caminho OFFLINE. Para o formato de CRM (action_source=system_generated) a Meta EXIGE
// event_source='crm' + lead_event_source. physical_store é evento de loja física e não leva isso.
function buildOfflineCustomData(actionSource: string, value: number | null, ticketId: string): Record<string, unknown> {
  const cd: Record<string, unknown> = {};
  if (actionSource === "system_generated") {
    cd.event_source = "crm";
    cd.lead_event_source = CRM_NAME;
  }
  if (value != null) { cd.currency = "BRL"; cd.value = value; cd.order_id = ticketId; }
  return cd;
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
  let enabled = false, batch = 25, providerMode = false, sendOffline = false, offlineActionSource = "system_generated";
  try {
    const cfg = cfgRow?.value ? JSON.parse(cfgRow.value) : {};
    enabled = cfg.enabled === true;
    batch = Math.min(Math.max(Number(cfg.batch_size) || 25, 1), 500);
    // provider_mode: a plataforma é Tech Provider → o token de plataforma acessa as WABAs de todos
    // os clientes; ele passa à frente do token da clínica. Default false = clínica-primeiro (interim).
    providerMode = cfg.provider_mode === true;
    // send_offline: leads SEM ctwa_clid (orgânicos) viram conversão OFFLINE no pixel (casa por PII).
    sendOffline = cfg.send_offline === true;
    if (typeof cfg.offline_action_source === "string" && cfg.offline_action_source) offlineActionSource = cfg.offline_action_source;
  } catch { /* config malformada → tratado como desligado */ }

  // ── Modo DEBUG (TEMPORÁRIO, p/ aprovação na Meta) ─────────────────────────────────────────────
  // POST { debug_ticket_id } → envia ESSE ticket na hora e devolve payload + resposta crua, para o
  // modal exibir e o dono printar. Ignora os gates (enabled/send_offline): é envio EXPLÍCITO de teste.
  // Autocontido de propósito: não toca no fluxo em lote. Remover este bloco + o painel do modal
  // depois da aprovação volta ao comportamento normal (envio só pelo cron).
  let body: any = {};
  try { body = await req.json(); } catch { /* cron chama sem corpo */ }
  const debugTicketId = typeof body?.debug_ticket_id === "string" ? body.debug_ticket_id : "";
  if (debugTicketId) {
    const authHeader = req.headers.get("Authorization") ?? "";
    const { data: userData } = await service.auth.getUser(authHeader.replace("Bearer ", ""));
    if (!userData?.user?.id) return json({ ok: false, error: "unauthorized" }, 401);
    const { data: t } = await service.from("tickets").select("id, clinic_id, lead_id, outcome_at").eq("id", debugTicketId).maybeSingle();
    if (!t) return json({ ok: false, error: "ticket_not_found" }, 404);
    const userClient = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "", { global: { headers: { Authorization: authHeader } } });
    const [{ data: isAdmin }, { data: isSuper }] = await Promise.all([
      userClient.rpc("is_clinic_admin", { p_clinic_id: t.clinic_id }),
      userClient.rpc("is_super_admin"),
    ]);
    if (isAdmin !== true && isSuper !== true) return json({ ok: false, error: "forbidden" }, 403);

    const { data: clinic } = await service.from("clinics")
      .select("id, meta_waba_id, meta_capi_dataset_id, meta_token, meta_pixel_id, organization_id").eq("id", t.clinic_id).maybeSingle();
    const { data: lead } = t.lead_id
      ? await service.from("leads").select("id, name, phone, email, ctwa_clid, rast_id").eq("id", t.lead_id).maybeSingle()
      : { data: null };
    // lead_id da Meta (Instant Form) para esse lead, se houver — vai em claro no user_data.
    const { data: formSub } = t.lead_id
      ? await service.from("meta_form_submissions").select("external_id").eq("lead_id", t.lead_id).limit(1).maybeSingle()
      : { data: null };
    const metaLeadId = String(formSub?.external_id ?? "").trim() || null;
    const { data: convRow } = await service.from("conversions").select("value, converted_at").eq("ticket_id", debugTicketId).order("converted_at", { ascending: false }).limit(1).maybeSingle();
    const { data: outbox } = await service.from("meta_capi_events").select("id, event_name").eq("ticket_id", debugTicketId).maybeSingle();
    const eventName = outbox?.event_name ?? null;

    const { data: platRaw } = await service.rpc("get_meta_cloud_secret", { p_name: "META_CLOUD_TOKEN" });
    const platformToken = (typeof platRaw === "string" ? platRaw : "").trim();
    let orgToken = "";
    if (clinic?.organization_id) {
      const { data: org } = await service.from("organizations").select("meta_ad_token").eq("id", clinic.organization_id).maybeSingle();
      orgToken = (org?.meta_ad_token ?? "").trim();
    }

    const nowSecD = Math.floor(Date.now() / 1000);
    const rawTime = convRow?.converted_at ?? t.outcome_at ?? null;
    const value = (convRow?.value != null && Number.isFinite(Number(convRow.value)) && Number(convRow.value) > 0) ? Number(convRow.value) : null;
    const eventTime = (w: number) => { let x = rawTime ? Math.floor(new Date(rawTime).getTime() / 1000) : nowSecD; if (!Number.isFinite(x) || x > nowSecD || x < nowSecD - w * 86400) x = nowSecD; return x; };
    const clid = (lead?.ctwa_clid ?? "").trim();
    const dataset = (clinic?.meta_capi_dataset_id ?? "").trim();
    const waba = (clinic?.meta_waba_id ?? "").trim();
    const ctwaToken = providerMode ? (platformToken || (clinic?.meta_token ?? "").trim()) : ((clinic?.meta_token ?? "").trim() || platformToken);

    let endpoint = "", token = "", kind = "", skip = "";
    let payload: Record<string, unknown> | null = null;
    // CTWA só quando a clínica TEM WABA/dataset; senão (inclusive lead de anúncio sem WABA) → offline.
    if (clid && dataset && waba && ctwaToken) {
      token = ctwaToken;
      kind = "ctwa";
      const ud: Record<string, unknown> = { whatsapp_business_account_id: waba, ctwa_clid: clid };
      const ph = phoneDigits(lead?.phone); if (ph) ud.ph = await sha256(ph);
      if (lead?.email) ud.em = await sha256(String(lead.email));
      const nameParts = String(lead?.name ?? "").trim().split(/\s+/).filter(Boolean);
      if (nameParts.length) { ud.fn = await sha256(nameParts[0]); if (nameParts.length > 1) ud.ln = await sha256(nameParts[nameParts.length - 1]); }
      if (lead?.rast_id) ud.external_id = await sha256(String(lead.rast_id));
      if (metaLeadId) ud.lead_id = metaLeadId;
      payload = { event_name: ctwaEventName(eventName), event_time: eventTime(7), action_source: "business_messaging", messaging_channel: "whatsapp", event_id: debugTicketId, user_data: ud };
      if (value != null) payload.custom_data = { currency: "BRL", value, order_id: debugTicketId };
      endpoint = dataset;
    } else {
      const pixel = (clinic?.meta_pixel_id ?? "").trim();
      token = (clinic?.meta_token ?? "").trim() || orgToken || platformToken;
      const ph = phoneDigits(lead?.phone);
      kind = "offline";
      if (!pixel || !token || !(ph || lead?.email)) { skip = "offline sem pixel/token/telefone-ou-email"; }
      else {
        const ud: Record<string, unknown> = {};
        if (ph) ud.ph = await sha256(ph);
        if (lead?.email) ud.em = await sha256(String(lead.email));
        const parts = String(lead?.name ?? "").trim().split(/\s+/).filter(Boolean);
        if (parts.length) { ud.fn = await sha256(parts[0]); if (parts.length > 1) ud.ln = await sha256(parts[parts.length - 1]); }
        if (lead?.rast_id) ud.external_id = await sha256(String(lead.rast_id));
        if (metaLeadId) ud.lead_id = metaLeadId;
        payload = { event_name: eventName || "Lead", event_time: eventTime(offlineActionSource === "physical_store" ? 62 : 7), action_source: offlineActionSource, event_id: debugTicketId, user_data: ud };
        payload.custom_data = buildOfflineCustomData(offlineActionSource, value, debugTicketId);
        endpoint = pixel;
      }
    }
    if (skip || !payload) return json({ ok: false, kind, skip: skip || "sem payload" });

    // O token vai no header (nunca no corpo/URL) → seguro devolver url + request para print.
    const url = `${GRAPH}/${GRAPH_VERSION}/${endpoint}/events`;
    const request = { data: [payload] };
    let response: any = { error: "sem resposta" }, status = 0, ok = false;
    try {
      const resp = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(request) });
      status = resp.status;
      response = await resp.json().catch(() => ({}));
      ok = resp.ok && !response?.error;
    } catch (e) { response = { error: String(e) }; }

    if (outbox?.id) {
      await service.from("meta_capi_events").update({
        status: ok ? "sent" : "error", sent_at: ok ? new Date().toISOString() : null,
        meta_response: response, last_error: ok ? null : (response?.error?.message ?? `HTTP ${status}`),
      }).eq("id", outbox.id);
    }
    return json({ ok, kind, endpoint, url, status, request, response });
  }
  // ── fim do modo DEBUG ─────────────────────────────────────────────────────────────────────────

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

  const [{ data: clinics }, { data: leads }, { data: convs }, { data: tickets }, { data: platTokenRaw }, { data: formSubs }] = await Promise.all([
    service.from("clinics").select("id, meta_waba_id, meta_capi_dataset_id, meta_token, meta_pixel_id, organization_id").in("id", clinicIds),
    leadIds.length ? service.from("leads").select("id, name, phone, email, ctwa_clid, rast_id").in("id", leadIds) : Promise.resolve({ data: [] as any[] }),
    service.from("conversions").select("ticket_id, value, converted_at").in("ticket_id", ticketIds).order("converted_at", { ascending: false }),
    service.from("tickets").select("id, outcome_at").in("id", ticketIds),
    service.rpc("get_meta_cloud_secret", { p_name: "META_CLOUD_TOKEN" }),
    // lead_id da Meta (id de 15-17 dígitos do Instant Form): mora em meta_form_submissions.external_id,
    // ligado ao nosso lead por lead_id. Só existe p/ leads captados por Formulário Meta — os de anúncio
    // que caem no WhatsApp (CTWA) não têm. É o dado de match de prioridade MAIS ALTA da Meta.
    leadIds.length ? service.from("meta_form_submissions").select("lead_id, external_id").in("lead_id", leadIds) : Promise.resolve({ data: [] as any[] }),
  ]);

  const platformToken = (typeof platTokenRaw === "string" ? platTokenRaw : "").trim();
  // Ordem do token: provider → plataforma primeiro (acessa WABAs de clientes); senão clínica primeiro.
  const pickToken = (clinicToken: string) =>
    providerMode ? (platformToken || clinicToken) : (clinicToken || platformToken);
  const clinicById = new Map((clinics ?? []).map((c: any) => [c.id, c]));
  const leadById = new Map((leads ?? []).map((l: any) => [l.id, l]));
  const ticketById = new Map((tickets ?? []).map((t: any) => [t.id, t]));
  // lead_id da Meta por lead (mantido como STRING: 16-17 dígitos estouram o inteiro seguro do JS e
  // perderiam precisão se convertidos p/ Number — a Meta aceita o lead_id como texto numérico).
  const metaLeadIdByLead = new Map<string, string>();
  for (const s of formSubs ?? []) {
    const ext = String(s?.external_id ?? "").trim();
    if (s?.lead_id && ext && !metaLeadIdByLead.has(s.lead_id)) metaLeadIdByLead.set(s.lead_id, ext);
  }
  // Conversão mais recente por ticket (já veio ordenado desc).
  const convByTicket = new Map<string, any>();
  for (const c of convs ?? []) if (!convByTicket.has(c.ticket_id)) convByTicket.set(c.ticket_id, c);

  // Token do caminho OFFLINE (pixel = coisa de anúncio/métricas): clínica → org → plataforma.
  // Diferente do CTWA (que usa o token do Tech Provider via pickToken) — o pixel pertence à conta de
  // anúncios, então o token de métricas (clínica/org) é quem costuma ter acesso a ele.
  const orgIds = [...new Set((clinics ?? []).map((c: any) => c.organization_id).filter(Boolean))] as string[];
  const orgTokenById = new Map<string, string>();
  if (sendOffline && orgIds.length) {
    const { data: orgs } = await service.from("organizations").select("id, meta_ad_token").in("id", orgIds);
    for (const o of orgs ?? []) if (o.meta_ad_token) orgTokenById.set(o.id, String(o.meta_ad_token).trim());
  }
  // (a escolha do token offline virou lista de camadas montada no laço, com listarCamadas abaixo:
  //  mesma ordem clínica → org → plataforma, mas agora as seguintes são TENTADAS, não só default)

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
  const loggedMissingConfig = new Set<string>();   // 1 log por clínica/caminho por execução
  let sent = 0, skipped = 0, errored = 0;

  // Envia 1 evento (para um dataset da WABA OU um pixel) e trata a resposta: sucesso, ou retry/erro
  // na Central. Reusado pelos dois caminhos (CTWA e offline), com o MESMO contrato de status/tentativas.
  // Ordem das camadas = a MESMA de antes (pickToken / offlineToken). A novidade é que as camadas
  // seguintes agora são TENTADAS quando a Meta recusa por token, em vez de servirem só de default.
  // ⚠️ Aqui NÃO gravamos clinics.meta_token_source: essa memória é por CLÍNICA, e o CAPI fala com
  // dataset da WABA / pixel, que são recursos diferentes da conta de anúncios e do formulário. Um
  // token bom para o pixel pode não servir para o gasto, e apontar a memória para ele estragaria a
  // escolha das outras funções.
  const listarCamadas = (...pares: Array<[CamadaToken, string]>): CandidatoToken[] => {
    const vistos = new Set<string>();
    const out: CandidatoToken[] = [];
    for (const [camada, t] of pares) {
      const v = (t ?? "").trim();
      if (!v || vistos.has(v)) continue;
      vistos.add(v);
      out.push({ camada, token: v });
    }
    return out;
  };

  const deliverAndRecord = async (
    evId: string, clinicId: string, ticketId: string, targetId: string, candidatos: CandidatoToken[], payload: unknown, kind: string,
  ): Promise<"sent" | "error"> => {
    const bumpFail = async (errMsg: string, jResp: unknown, status: number | null) => {
      const { data: cur } = await service.from("meta_capi_events").select("attempts").eq("id", evId).maybeSingle();
      const attemptsNow = ((cur?.attempts as number) ?? 0) + 1;
      const giveUp = attemptsNow >= MAX_ATTEMPTS;
      await service.from("meta_capi_events").update({
        status: giveUp ? "error" : "pending", attempts: attemptsNow, last_error: errMsg, meta_response: jResp ?? null,
      }).eq("id", evId);
      await registrar("envio_recusado",
        `A Meta recusou o evento de conversão (${kind}${status ? ", " + status : ""})` + (giveUp ? " — desistindo após várias tentativas" : ""),
        giveUp ? "error" : "warn", clinicId, { ticket_id: ticketId, kind, tentativa: attemptsNow, erro: errMsg });
    };
    try {
      // deno-lint-ignore no-explicit-any
      let ultimo: { msg: string; corpo: any; status: number | null } | null = null;

      for (const cand of candidatos) {
        const resp = await fetch(`${GRAPH}/${GRAPH_VERSION}/${targetId}/events`, {
          method: "POST",
          headers: { Authorization: `Bearer ${cand.token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ data: [payload] }),
        });
        // deno-lint-ignore no-explicit-any
        const j: any = await resp.json().catch(() => ({}));

        if (resp.ok && !j?.error) {
          await service.from("meta_capi_events").update({
            status: "sent", sent_at: new Date().toISOString(), meta_response: j ?? null, last_error: null,
          }).eq("id", evId);
          return "sent";
        }

        ultimo = {
          msg: j?.error?.error_user_msg || j?.error?.message || `HTTP ${resp.status}`,
          corpo: j, status: resp.status,
        };
        // Recusa que não é de token (evento inválido, pixel errado): trocar de camada não resolve.
        if (!ehErroDeToken(j?.error)) break;
      }

      // Só conta tentativa e alerta quando NENHUMA camada passou — bumpFail marca o evento e a
      // Central; fazer isso a cada camada inflaria attempts e daria alarme já coberto pelo fallback.
      await bumpFail(ultimo?.msg ?? "sem token que funcione", ultimo?.corpo ?? null, ultimo?.status ?? null);
      return "error";
    } catch (e) {
      await bumpFail(String(e), null, null);
      return "error";
    }
  };

  for (const ev of pend) {
    const clinic: any = clinicById.get(ev.clinic_id);
    const lead: any = ev.lead_id ? leadById.get(ev.lead_id) : null;

    const conv = convByTicket.get(ev.ticket_id);
    const ticket: any = ticketById.get(ev.ticket_id);
    const rawTime = conv?.converted_at ?? ticket?.outcome_at ?? null;
    const value = (conv?.value != null && Number.isFinite(Number(conv.value)) && Number(conv.value) > 0) ? Number(conv.value) : null;
    // event_time real, nunca no futuro nem fora da janela (mensageria 7d; offline 62d) → senão "agora".
    const eventTime = (windowDays: number) => {
      let t = rawTime ? Math.floor(new Date(rawTime).getTime() / 1000) : nowSec;
      if (!Number.isFinite(t) || t > nowSec || t < nowSec - windowDays * 24 * 3600) t = nowSec;
      return t;
    };

    const clid = (lead?.ctwa_clid ?? "").trim();
    const dataset = (clinic?.meta_capi_dataset_id ?? "").trim();
    const waba = (clinic?.meta_waba_id ?? "").trim();
    // Mesma ordem do pickToken: em provider_mode a plataforma vem primeiro (acessa as WABAs dos
    // clientes); fora dele, a clinica primeiro. A diferenca e que agora a segunda e TENTADA.
    const clinicTok = (clinic?.meta_token ?? "").trim();
    const ctwaCands = providerMode
      ? listarCamadas(["platform", platformToken], ["clinic", clinicTok])
      : listarCamadas(["clinic", clinicTok], ["platform", platformToken]);

    // ── Caminho 1: CTWA (lead de anúncio COM WABA/dataset) → dataset da WABA, business_messaging ──
    if (clid && dataset && waba && ctwaCands.length > 0) {
      const userData: Record<string, unknown> = { whatsapp_business_account_id: waba, ctwa_clid: clid };
      const ph = phoneDigits(lead?.phone);
      if (ph) userData.ph = await sha256(ph);
      if (lead?.email) userData.em = await sha256(String(lead.email));
      // fn/ln (nome) — a Meta recomenda mandar o máximo de dados de match; temos o nome do lead.
      const nameParts = String(lead?.name ?? "").trim().split(/\s+/).filter(Boolean);
      if (nameParts.length) {
        userData.fn = await sha256(nameParts[0]);
        if (nameParts.length > 1) userData.ln = await sha256(nameParts[nameParts.length - 1]);
      }
      if (lead?.rast_id) userData.external_id = await sha256(String(lead.rast_id));
      // lead_id vai em CLARO (não hasheado) — é o id do Instant Form da Meta, ela casa pelo valor exato.
      const metaLeadId = lead?.id ? metaLeadIdByLead.get(lead.id) : null;
      if (metaLeadId) userData.lead_id = metaLeadId;
      const payload: Record<string, unknown> = {
        event_name: ctwaEventName(ev.event_name),
        event_time: eventTime(7),
        action_source: "business_messaging",
        messaging_channel: "whatsapp",
        event_id: ev.ticket_id,                 // dedup do lado Meta
        user_data: userData,
      };
      if (value != null) payload.custom_data = { currency: "BRL", value, order_id: ev.ticket_id };
      const r = await deliverAndRecord(ev.id, ev.clinic_id, ev.ticket_id, dataset, ctwaCands, payload, "ctwa");
      if (r === "sent") sent++; else errored++;
      continue;
    }

    // ── Caminho 2: OFFLINE (pixel) — lead ORGÂNICO ou lead de ANÚNCIO SEM WABA (fallback) ──
    // A Meta dobrou a Offline Conversions API na Conversions API unificada (mai/2025). Lead de anúncio
    // de clínica sem WABA (uazapi não onboardada) também cai aqui: perde o clid determinístico, mas a
    // conversão ainda chega ao Meta pelo pixel (casa por telefone/e-mail/nome). Só se ligado.
    if (!sendOffline) {
      await service.from("meta_capi_events").update({
        status: "skipped",
        last_error: clid ? "lead de anúncio sem WABA e envio offline desligado" : "lead sem ctwa_clid e envio offline desligado",
      }).eq("id", ev.id);
      skipped++;
      continue;
    }
    const pixel = (clinic?.meta_pixel_id ?? "").trim();
    const offCands = listarCamadas(
      ["clinic", (clinic?.meta_token ?? "").trim()],
      ["org", clinic?.organization_id ? (orgTokenById.get(clinic.organization_id) ?? "") : ""],
      ["platform", platformToken],
    );
    const ph = phoneDigits(lead?.phone);
    const hasMatch = !!ph || !!lead?.email;
    if (!pixel || offCands.length === 0 || !hasMatch) {
      await service.from("meta_capi_events").update({
        status: "skipped", last_error: "offline sem pixel/token/chave de match (telefone ou e-mail)",
      }).eq("id", ev.id);
      if (!loggedMissingConfig.has(ev.clinic_id + ":off")) {
        loggedMissingConfig.add(ev.clinic_id + ":off");
        await registrar("offline_sem_config", "Conversão offline pronta mas falta pixel/token/chave de match",
          "warn", ev.clinic_id, { tem_pixel: !!pixel, tem_token: offCands.length > 0, tem_match: hasMatch });
      }
      skipped++;
      continue;
    }
    const userData: Record<string, unknown> = {};
    if (ph) userData.ph = await sha256(ph);
    if (lead?.email) userData.em = await sha256(String(lead.email));
    const nameParts = String(lead?.name ?? "").trim().split(/\s+/).filter(Boolean);
    if (nameParts.length) {
      userData.fn = await sha256(nameParts[0]);
      if (nameParts.length > 1) userData.ln = await sha256(nameParts[nameParts.length - 1]);
    }
    if (lead?.rast_id) userData.external_id = await sha256(String(lead.rast_id));
    const metaLeadIdOff = lead?.id ? metaLeadIdByLead.get(lead.id) : null;
    if (metaLeadIdOff) userData.lead_id = metaLeadIdOff;
    const payload: Record<string, unknown> = {
      event_name: ev.event_name || "Lead",
      // Janela por action_source: physical_store aceita 62 dias (backfill de vendas passadas);
      // system_generated/other só ~7 dias (senão a Meta recusa o event_time — subcode 2804003).
      event_time: eventTime(offlineActionSource === "physical_store" ? 62 : 7),
      action_source: offlineActionSource,
      event_id: ev.ticket_id,
      user_data: userData,
    };
    // Evento de CRM (guia oficial da Meta): action_source=system_generated exige custom_data com
    // event_source='crm' + lead_event_source (nome do CRM). physical_store é evento de loja, sem isso.
    payload.custom_data = buildOfflineCustomData(offlineActionSource, value, ev.ticket_id);
    const r = await deliverAndRecord(ev.id, ev.clinic_id, ev.ticket_id, pixel, offCands, payload, "offline");
    if (r === "sent") sent++; else errored++;
  }

  return json({ ok: true, processed: pend.length, sent, skipped, errored });
});
