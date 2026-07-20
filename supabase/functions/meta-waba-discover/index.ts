// meta-waba-discover — descobre e cacheia, por CLÍNICA, a WhatsApp Business Account (WABA) e o
// dataset de Business Messaging usados para enviar as conversões de CTWA (edge meta-capi-conversions).
//
// Cada clínica anuncia com a SUA WABA — a Meta só atribui se o dataset pertencer à WABA dona do
// número que recebeu o clique. Por isso a resolução é por clínica, gravando em
// clinics.meta_waba_id + clinics.meta_capi_dataset_id (cache, para não rechamar a Graph a cada envio).
//
// Contrato: POST { clinic_id, waba_id? }  (waba_id opcional = entrada MANUAL de fallback)
// Auth (igual meta-cloud-api): verify_jwt ON; autorização reconferida no contexto do usuário
// (is_clinic_admin / is_super_admin). O clinic_id do body NÃO é confiável sozinho.
//
// Cadeia de resolução (mais barato → mais caro):
//   1) waba_id manual no body → usa direto.
//   2) meta_cloud_channels da clínica (módulo oficial) → usa o waba_id de lá.
//   3) Graph API com o clinics.meta_token: /me/businesses → owned_whatsapp_business_accounts →
//      casa por telefone (normalizado) contra clinics.phone.
//   Achada a WABA → GET /{waba}/dataset resolve o dataset.
//
// Falha que importa (não achou / token sem escopo / Graph recusou) → Central de Erros.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GRAPH_VERSION = "v22.0";
const GRAPH = "https://graph.facebook.com";
const SCOPE = "meta-waba-discover";

// Mesma normalização do n8n e das outras edges (BR canônico, sem o 9º dígito). Inline de propósito,
// como a ctwa-tracking faz, para o deploy ser autossuficiente.
function normalizeBrazilianPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let p = String(raw).replace(/\D/g, "");
  if (!p) return null;
  p = p.replace(/^0+/, "");
  if (!p.startsWith("55")) p = "55" + p;
  if (p.length === 13) {
    const country = p.slice(0, 2), ddd = p.slice(2, 4);
    let rest = p.slice(4);
    if (rest.startsWith("9")) rest = rest.slice(1);
    p = country + ddd + rest;
  }
  if (p.length < 12 || p.length > 13) return null;
  return p;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const json = (o: unknown, s = 200) =>
    new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

  let body: any;
  try { body = await req.json(); } catch { body = {}; }
  const clinicId = typeof body?.clinic_id === "string" ? body.clinic_id : "";
  const manualWaba = typeof body?.waba_id === "string" ? body.waba_id.trim() : "";
  if (!clinicId) return json({ ok: false, error: "bad_request", detail: "clinic_id é obrigatório" }, 400);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const service = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");

  const registrar = (code: string, title: string, level: string, ctx: unknown) =>
    service.rpc("log_system_error", {
      p_scope: SCOPE, p_code: code, p_title: title, p_level: level,
      p_clinic_id: clinicId, p_context: ctx, p_is_monitor: false,
    }).then(() => {}, (e) => console.error(`[${SCOPE}] log falhou:`, e));

  // Auth: usuário do JWT + autorização por clínica no contexto dele.
  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace("Bearer ", "");
  const { data: userData } = await service.auth.getUser(jwt);
  if (!userData?.user?.id) return json({ ok: false, error: "unauthorized" }, 401);
  const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const [{ data: isAdmin }, { data: isSuper }] = await Promise.all([
    userClient.rpc("is_clinic_admin", { p_clinic_id: clinicId }),
    userClient.rpc("is_super_admin"),
  ]);
  if (isAdmin !== true && isSuper !== true) return json({ ok: false, error: "forbidden" }, 403);

  const { data: clinic } = await service
    .from("clinics").select("id, phone, meta_token, meta_waba_id, meta_capi_dataset_id")
    .eq("id", clinicId).maybeSingle();
  if (!clinic) return json({ ok: false, error: "clinic_not_found" }, 404);

  // Modo Tech Provider (flag em meta_capi_config): quando a PLATAFORMA é provedor, o token de
  // plataforma acessa as WABAs de clientes → vai à frente do token da clínica. Default false.
  const { data: cfgRow } = await service.from("system_settings").select("value").eq("id", "meta_capi_config").maybeSingle();
  let providerMode = false;
  try { providerMode = cfgRow?.value ? JSON.parse(cfgRow.value).provider_mode === true : false; } catch { /* config malformada = off */ }

  const { data: platRaw } = await service.rpc("get_meta_cloud_secret", { p_name: "META_CLOUD_TOKEN" });
  const platformToken = (typeof platRaw === "string" ? platRaw : "").trim();
  const clinicToken = (clinic.meta_token ?? "").trim();  // campo "Token de Acesso (CAPI)" em Configurações › Meta Ads
  const token = providerMode ? (platformToken || clinicToken) : (clinicToken || platformToken);

  let waba = manualWaba;
  let source: "manual" | "channel" | "graph" | null = manualWaba ? "manual" : null;

  // (2) Atalho do módulo oficial: WABA já cadastrada em meta_cloud_channels.
  if (!waba) {
    const { data: ch } = await service
      .from("meta_cloud_channels").select("waba_id").eq("clinic_id", clinicId)
      .not("waba_id", "is", null).limit(1).maybeSingle();
    if (ch?.waba_id) { waba = String(ch.waba_id).trim(); source = "channel"; }
  }

  // (3) Descoberta pela Graph API, casando pelo telefone da clínica.
  if (!waba) {
    if (!token) {
      await registrar("sem_token", "Clínica sem token Meta para descobrir a WABA", "warn", {});
      return json({ ok: false, error: "not_configured", needs_manual: true,
        detail: "Sem Token de Acesso (CAPI). Preencha o token em Configurações › Meta Ads ou informe a WABA manualmente." }, 200);
    }
    const clinicPhone = normalizeBrazilianPhone(clinic.phone);
    try {
      const url = new URL(`${GRAPH}/${GRAPH_VERSION}/me/businesses`);
      url.searchParams.set("access_token", token);
      // owned = WABAs próprias; client = WABAs de clientes compartilhadas ao provedor (Tech Provider).
      url.searchParams.set("fields", "name,owned_whatsapp_business_accounts{id,name,phone_numbers{display_phone_number}},client_whatsapp_business_accounts{id,name,phone_numbers{display_phone_number}}");
      const resp = await fetch(url.toString());
      const j = await resp.json().catch(() => ({}));
      if (!resp.ok || j?.error) {
        const msg = j?.error?.error_user_msg || j?.error?.message || `HTTP ${resp.status}`;
        await registrar("graph_recusou", "A Meta recusou a listagem de WABAs (token sem escopo?)", "warn",
          { status: resp.status, erro: msg });
        return json({ ok: false, error: "graph_error", needs_manual: true,
          detail: `A Meta recusou a consulta (${msg}). Verifique o escopo whatsapp_business_management do token, ou informe a WABA manualmente.` }, 200);
      }
      // Varre os negócios → WABAs → números; casa o número normalizado com o da clínica.
      const businesses = j?.data ?? [];
      let matched: string | null = null;
      let firstWaba: string | null = null;
      for (const biz of businesses) {
        const bizWabas = [
          ...(biz?.owned_whatsapp_business_accounts?.data ?? []),
          ...(biz?.client_whatsapp_business_accounts?.data ?? []),
        ];
        for (const w of bizWabas) {
          if (!firstWaba && w?.id) firstWaba = String(w.id);
          for (const pn of w?.phone_numbers?.data ?? []) {
            if (normalizeBrazilianPhone(pn?.display_phone_number) === clinicPhone && clinicPhone) {
              matched = String(w.id); break;
            }
          }
          if (matched) break;
        }
        if (matched) break;
      }
      // Casou por telefone → certeza. Não casou mas só existe UMA WABA → usa como palpite forte.
      waba = matched ?? (firstWaba && businesses.length ? firstWaba : "") ?? "";
      if (waba) source = "graph";
      if (!waba) {
        await registrar("waba_nao_encontrada", "Nenhuma WABA da clínica casou pelo telefone", "warn",
          { telefone_clinica: clinicPhone });
        return json({ ok: false, error: "waba_not_found", needs_manual: true,
          detail: "Não encontrei a WABA desta clínica automaticamente. Informe o WABA ID manualmente." }, 200);
      }
    } catch (e) {
      await registrar("graph_indisponivel", "Falha ao falar com a Graph API para descobrir a WABA", "warn", { erro: String(e) });
      return json({ ok: false, error: "graph_unavailable", needs_manual: true, detail: String(e) }, 200);
    }
  }

  // Provisiona o dataset de Business Messaging a partir da WABA. POST /{waba}/dataset é IDEMPOTENTE:
  // cria se não existe, senão devolve o id atual (precisa do escopo whatsapp_business_manage_events).
  let dataset = "";
  if (token) {
    try {
      const url = new URL(`${GRAPH}/${GRAPH_VERSION}/${waba}/dataset`);
      url.searchParams.set("access_token", token);
      const resp = await fetch(url.toString(), { method: "POST" });
      const j = await resp.json().catch(() => ({}));
      if (resp.ok && !j?.error) {
        // A Meta pode devolver { id } direto ou { data: [{ id }] }.
        dataset = String(j?.id ?? j?.data?.[0]?.id ?? "").trim();
      } else {
        const msg = j?.error?.error_user_msg || j?.error?.message || `HTTP ${resp.status}`;
        await registrar("dataset_recusado", "A Meta recusou a consulta do dataset da WABA", "warn",
          { waba_id: waba, status: resp.status, erro: msg });
      }
    } catch (e) {
      await registrar("dataset_indisponivel", "Falha ao resolver o dataset da WABA", "warn", { waba_id: waba, erro: String(e) });
    }
  }

  // Grava o cache (service role → ignora RLS). Sempre grava a WABA; o dataset só se resolveu.
  const upd: Record<string, string> = { meta_waba_id: waba };
  if (dataset) upd.meta_capi_dataset_id = dataset;
  const { error: upErr } = await service.from("clinics").update(upd).eq("id", clinicId);
  if (upErr) {
    await registrar("gravar_cache_falhou", "Não foi possível gravar WABA/dataset na clínica", "error",
      { waba_id: waba, dataset_id: dataset, erro: upErr.message });
    return json({ ok: false, error: upErr.message }, 500);
  }

  return json({
    ok: true, source, waba_id: waba, dataset_id: dataset || null,
    ready: !!(waba && dataset),
    detail: dataset
      ? "WABA e dataset resolvidos — pronto para enviar conversões."
      : "WABA gravada, mas não consegui resolver o dataset. Verifique se a Conversions API de Business Messaging está habilitada para esta WABA.",
  });
});
