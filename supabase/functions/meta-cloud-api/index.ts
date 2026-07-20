// meta-cloud-api — fluxos da WhatsApp Cloud API OFICIAL (Graph API) usados no módulo
// "API Oficial Meta" (plano Meta Tester). Nativiza o workflow de teste do n8n:
//
//   action=create_template  → POST {WABA}/message_templates      (pede aprovação de template)
//   action=sync_templates    → GET  {WABA}/message_templates      (atualiza status na Meta)
//   action=send_template     → POST {phone_number_id}/messages    (dispara template aprovado)
//
// Contrato: POST { action, clinic_id, ... }.
//
// Auth (igual meta-spend-sync): verify_jwt ON → JWT do usuário. Autorização por clínica é
// reconferida no CONTEXTO do usuário (is_clinic_admin / is_super_admin); o clinic_id do body
// NÃO é confiável sozinho. Token/WABA são segredos de PLATAFORMA (env) — nunca vão ao browser.
//
// Falha que importa (Meta recusou / gravação falhou → o cliente acha que enviou/criou e não
// foi) → Central de Erros (log_system_error, scope='meta-cloud-api').

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GRAPH_VERSION = Deno.env.get("META_CLOUD_GRAPH_VERSION") ?? "v24.0";
const GRAPH = "https://graph.facebook.com";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Nome de template válido na Meta: minúsculas, dígitos e underscore.
function slugTemplateName(raw: string): string {
  return String(raw || "")
    .toLowerCase()
    .normalize("NFD").replace(/\p{Diacritic}/gu, "") // tira acentos
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 512);
}

// Extrai o texto do BODY de um array de components da Graph API.
function bodyTextFromComponents(components: unknown): string | null {
  if (!Array.isArray(components)) return null;
  const body = components.find((c: any) => String(c?.type).toUpperCase() === "BODY");
  return body?.text ?? null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  let body: any;
  try { body = await req.json(); } catch { body = {}; }

  const action = typeof body?.action === "string" ? body.action : "";
  const clinicId = typeof body?.clinic_id === "string" ? body.clinic_id : "";
  if (!clinicId) return json({ ok: false, error: "bad_request", detail: "clinic_id é obrigatório" }, 400);
  if (!["create_template", "sync_templates", "send_template"].includes(action)) {
    return json({ ok: false, error: "bad_action", detail: "action inválida" }, 400);
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const service = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");

  const registrarErro = async (code: string, title: string, level: string, ctx: Record<string, unknown>) => {
    try {
      await service.rpc("log_system_error", {
        p_scope: "meta-cloud-api", p_code: code, p_title: title, p_level: level,
        p_clinic_id: clinicId, p_context: { action, ...ctx }, p_is_monitor: false,
      });
    } catch (_e) { /* nunca derrubar a resposta por causa do log */ }
  };

  // (1) Auth: usuário do JWT.
  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace("Bearer ", "");
  const { data: userData } = await service.auth.getUser(jwt);
  if (!userData?.user?.id) return json({ ok: false, error: "unauthorized" }, 401);
  const userId = userData.user.id;

  // (2) Autorização por clínica no CONTEXTO do usuário.
  const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const [{ data: isAdmin }, { data: isSuper }] = await Promise.all([
    userClient.rpc("is_clinic_admin", { p_clinic_id: clinicId }),
    userClient.rpc("is_super_admin"),
  ]);
  if (isAdmin !== true && isSuper !== true) return json({ ok: false, error: "forbidden" }, 403);

  // (3) Credenciais globais de plataforma, guardadas no Vault (Super Admin › API Meta) e lidas
  // só pelo service role. Fallback para secret de env. Nunca vão ao browser.
  let token = "";
  let vaultWaba = "";
  {
    const [{ data: tk }, { data: wb }] = await Promise.all([
      service.rpc("get_meta_cloud_secret", { p_name: "META_CLOUD_TOKEN" }),
      service.rpc("get_meta_cloud_secret", { p_name: "META_CLOUD_WABA_ID" }),
    ]);
    token = (typeof tk === "string" ? tk : "").trim();
    vaultWaba = (typeof wb === "string" ? wb : "").trim();
  }
  if (!token) token = Deno.env.get("META_CLOUD_TOKEN") ?? "";
  const envWaba = vaultWaba || (Deno.env.get("META_CLOUD_WABA_ID") ?? "");
  if (!token) {
    await registrarErro("sem_token", "Token da API Meta não configurado (Vault nem env)", "error", {});
    return json({ ok: false, error: "not_configured", detail: "Token da API Meta não configurado. Preencha em Super Admin › Configurações › API Meta." }, 200);
  }
  const authGraph = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  try {
    // ───────────────────────────── create_template ─────────────────────────────
    if (action === "create_template") {
      const rawName = typeof body?.name === "string" ? body.name : "";
      const language = typeof body?.language === "string" && body.language ? body.language : "pt_BR";
      const category = ["MARKETING", "UTILITY", "AUTHENTICATION"].includes(body?.category) ? body.category : "MARKETING";
      const content = typeof body?.content === "string" ? body.content : (typeof body?.body_text === "string" ? body.body_text : "");
      const name = slugTemplateName(rawName);
      if (!name || !content.trim()) {
        return json({ ok: false, error: "bad_request", detail: "name e conteúdo do template são obrigatórios" }, 400);
      }
      const waba = (typeof body?.waba_id === "string" && body.waba_id) || envWaba;
      if (!waba) {
        await registrarErro("sem_waba", "META_CLOUD_WABA_ID não configurado", "error", {});
        return json({ ok: false, error: "not_configured", detail: "WABA não configurada." }, 200);
      }

      const components = [{ type: "BODY", text: content }];
      const resp = await fetch(`${GRAPH}/${GRAPH_VERSION}/${waba}/message_templates`, {
        method: "POST",
        headers: authGraph,
        body: JSON.stringify({ name, language, category, components }),
      });
      const j = await resp.json();
      if (j?.error) {
        await registrarErro("criar_template_recusado", "A Meta recusou a criação do template", "warn",
          { erro: j.error?.message, codigo: j.error?.code, detalhe: j.error?.error_user_msg, name });
        return json({ ok: false, error: "graph_error", detail: j.error?.error_user_msg || j.error?.message || "erro da Graph API" }, 200);
      }

      const { data: saved, error: upErr } = await service
        .from("meta_cloud_templates")
        .upsert({
          clinic_id: clinicId,
          meta_template_id: j?.id ?? null,
          name, language, category,
          body_text: content,
          components,
          status: j?.status ?? "PENDING",
          synced_at: new Date().toISOString(),
        }, { onConflict: "clinic_id,name,language" })
        .select()
        .single();
      if (upErr) {
        await registrarErro("gravacao_template_falhou", "Template criado na Meta, mas NÃO gravado no banco", "error", { detail: upErr.message, name });
        return json({ ok: false, error: "upsert_failed", detail: upErr.message }, 500);
      }
      return json({ ok: true, template: saved, meta: { id: j?.id, status: j?.status } });
    }

    // ───────────────────────────── sync_templates ──────────────────────────────
    // IMPORTA TODOS os templates da WABA para a visão desta clínica (não só os criados
    // aqui) — assim os aprovados pré-existentes aparecem na tela e no dropdown de envio.
    if (action === "sync_templates") {
      const waba = (typeof body?.waba_id === "string" && body.waba_id) || envWaba;
      if (!waba) return json({ ok: false, error: "not_configured", detail: "WABA não configurada." }, 200);

      const url = `${GRAPH}/${GRAPH_VERSION}/${waba}/message_templates?fields=id,name,status,category,language,components,quality_score&limit=200`;
      const resp = await fetch(url, { headers: authGraph });
      const j = await resp.json();
      if (j?.error) {
        await registrarErro("sync_recusado", "A Meta recusou a leitura dos templates", "warn", { erro: j.error?.message, codigo: j.error?.code });
        return json({ ok: false, error: "graph_error", detail: j.error?.message ?? "erro da Graph API" }, 200);
      }

      const now = new Date().toISOString();
      const rows = (j?.data ?? [])
        .filter((t: any) => t?.name)
        .map((t: any) => ({
          clinic_id: clinicId,
          meta_template_id: t?.id ?? null,
          name: t.name,
          language: t?.language ?? "pt_BR",
          category: ["MARKETING", "UTILITY", "AUTHENTICATION"].includes(t?.category) ? t.category : "MARKETING",
          body_text: bodyTextFromComponents(t?.components),
          components: t?.components ?? null,
          status: t?.status ?? "PENDING",
          rejected_reason: t?.status === "REJECTED" ? (t?.quality_score?.reasons?.join?.("; ") ?? null) : null,
          synced_at: now,
        }));

      let updated = 0;
      if (rows.length > 0) {
        const { error: upErr } = await service
          .from("meta_cloud_templates")
          .upsert(rows, { onConflict: "clinic_id,name,language" });
        if (upErr) {
          await registrarErro("sync_gravacao_falhou", "Templates vieram da Meta mas NÃO foram gravados", "error", { detail: upErr.message, qtd: rows.length });
          return json({ ok: false, error: "upsert_failed", detail: upErr.message }, 500);
        }
        updated = rows.length;
      }

      // Reconcilia: remove da visão os templates que NÃO existem mais na WABA (deletados na Meta).
      // Poupa os criados nos últimos 2min — a lista da Meta pode demorar a refletir um recém-criado.
      const keepKeys = new Set(rows.map((r: any) => `${r.name}|${r.language}`));
      const { data: existing } = await service
        .from("meta_cloud_templates")
        .select("id, name, language, created_at")
        .eq("clinic_id", clinicId);
      const cutoff = Date.now() - 120_000;
      const toDelete = (existing ?? [])
        .filter((e: any) => !keepKeys.has(`${e.name}|${e.language}`) && new Date(e.created_at).getTime() < cutoff)
        .map((e: any) => e.id);
      let removed = 0;
      if (toDelete.length > 0) {
        const { error: delErr } = await service.from("meta_cloud_templates").delete().in("id", toDelete);
        if (!delErr) removed = toDelete.length;
      }
      return json({ ok: true, updated, removed, fetched: (j?.data ?? []).length });
    }

    // ───────────────────────────── send_template ───────────────────────────────
    if (action === "send_template") {
      const templateName = typeof body?.template_name === "string" ? body.template_name : "";
      const channelId = typeof body?.channel_id === "string" ? body.channel_id : "";
      const language = typeof body?.language === "string" && body.language ? body.language : "pt_BR";
      const toPhone = String(body?.to_phone ?? "").replace(/\D/g, "");
      if (!templateName || !channelId || !toPhone) {
        return json({ ok: false, error: "bad_request", detail: "template_name, channel_id e to_phone são obrigatórios" }, 400);
      }

      const { data: channel, error: chErr } = await service
        .from("meta_cloud_channels")
        .select("id, clinic_id, phone_number_id")
        .eq("id", channelId).eq("clinic_id", clinicId)
        .single();
      if (chErr || !channel?.phone_number_id) {
        return json({ ok: false, error: "channel_not_found", detail: "Canal (remetente) não encontrado para esta clínica." }, 404);
      }

      const payload = {
        messaging_product: "whatsapp",
        to: toPhone,
        type: "template",
        template: { name: templateName, language: { code: language } },
      };
      const resp = await fetch(`${GRAPH}/${GRAPH_VERSION}/${channel.phone_number_id}/messages`, {
        method: "POST", headers: authGraph, body: JSON.stringify(payload),
      });
      const j = await resp.json();
      const wamid = j?.messages?.[0]?.id ?? null;
      const ok = !j?.error && !!wamid;

      const { data: sent } = await service
        .from("meta_cloud_sends")
        .insert({
          clinic_id: clinicId,
          channel_id: channel.id,
          template_name: templateName,
          to_phone: toPhone,
          wamid,
          status: ok ? "sent" : "failed",
          error: j?.error ?? null,
          sent_by: userId,
        })
        .select().single();

      if (!ok) {
        await registrarErro("envio_recusado", "A Meta recusou o disparo do template", "warn",
          { erro: j.error?.message, codigo: j.error?.code, detalhe: j.error?.error_user_msg, to: toPhone, template: templateName });
        return json({ ok: false, error: "graph_error", detail: j.error?.error_user_msg || j.error?.message || "erro da Graph API", send: sent }, 200);
      }
      return json({ ok: true, wamid, send: sent });
    }

    return json({ ok: false, error: "bad_action" }, 400);
  } catch (e) {
    await registrarErro("excecao", "A meta-cloud-api quebrou", "critical", { erro: e instanceof Error ? e.message : String(e) });
    return json({ ok: false, error: "exception", detail: e instanceof Error ? e.message : String(e) }, 500);
  }
});
