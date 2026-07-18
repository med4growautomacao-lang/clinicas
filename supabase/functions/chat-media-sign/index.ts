// chat-media-sign
//
// Assina, EM LOTE, URLs do bucket PRIVADO chat-media para o frontend renderizar
// mídia de conversa (áudio/imagem/vídeo/doc). Substitui o createSignedUrl que o
// frontend fazia direto contra o storage — que dependia da RLS de storage.objects
// (folder-based, frágil: já custou 2 bugs) e do plumbing JWT do cliente.
//
// Por que edge (robustez): a autorização vira UM predicado testável no banco
// (can_access_clinic_media) e a assinatura usa service role (bypassa RLS de storage,
// nunca "Carregando…" eterno por policy). Por que lote (velocidade): abrir uma
// conversa com N mídias vira 1 request, não N — e o frontend só pede o que entra
// na viewport.
//
// THUMBNAIL (item 3): cada item pode pedir uma versão reduzida (transform do Storage:
// width/height/quality). A imagem no thread pede o thumb; o full-res só ao clicar.
// Se o transform estiver indisponível no plano, cai no full-res (fallback) — a
// imagem SEMPRE carrega.
//
// Contrato:
//   req  POST { items: Array<{ id, path, width?, height?, quality?, resize? }> }
//        - id   = chave de cache do cliente (ex.: "<path>" p/ full, "<path>@thumb" p/ thumb)
//        - path = "<clinic_id>/<arquivo>" no bucket
//        - width/height/quality/resize ausentes → assina o original (em lote)
//   resp { ok, urls: { [id]: signedUrl }, ttl }   (id negado/inexistente: ausente)
//
// Auth: JWT do usuário no Authorization (functions.invoke manda automático) →
// verify_jwt ON. Acesso reconferido por clínica via can_access_clinic_media no
// CONTEXTO do usuário (auth.uid resolve). Assinar é com service role.
//
// Falha que importa (não assinar mídia existente do usuário) → Central de Erros.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BUCKET = "chat-media";
const TTL = 3600;            // 1h — PII de paciente; frontend re-assina sob demanda (lote+lazy é barato)
const MAX_ITEMS = 400;       // teto por request (conversa longa: full+thumb por imagem)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ReqItem = { id: string; path: string; width?: number; height?: number; quality?: number; resize?: string };

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  let body: any;
  try { body = await req.json(); } catch { body = {}; }
  const rawItems: unknown = body?.items;
  if (!Array.isArray(rawItems)) return json({ ok: false, error: "missing_items" }, 400);

  // Sanitiza: id/path strings não-vazias; dimensões numéricas positivas; dedup por id.
  const seen = new Set<string>();
  const items: ReqItem[] = [];
  for (const raw of rawItems) {
    const id = typeof raw?.id === "string" ? raw.id : "";
    const path = typeof raw?.path === "string" ? raw.path : "";
    if (!id || !path || seen.has(id)) continue;
    seen.add(id);
    const num = (v: unknown) => (typeof v === "number" && v > 0 && v <= 4000 ? Math.round(v) : undefined);
    items.push({
      id, path,
      width: num(raw?.width), height: num(raw?.height),
      quality: typeof raw?.quality === "number" ? Math.min(100, Math.max(20, Math.round(raw.quality))) : undefined,
      resize: raw?.resize === "cover" || raw?.resize === "contain" || raw?.resize === "fill" ? raw.resize : undefined,
    });
    if (items.length >= MAX_ITEMS) break;
  }
  if (items.length === 0) return json({ ok: true, urls: {}, ttl: TTL });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const service = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");

  const registrarErro = async (code: string, title: string, ctx: Record<string, unknown>, clinicId: string | null) => {
    try {
      await service.rpc("log_system_error", {
        p_scope: "chat-media-sign", p_code: code, p_title: title, p_level: "error",
        p_clinic_id: clinicId, p_context: ctx, p_is_monitor: false,
      });
    } catch (_e) { /* nunca derrubar a resposta por causa do log */ }
  };

  // (1) Auth: usuário do JWT.
  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace("Bearer ", "");
  const { data: userData } = await service.auth.getUser(jwt);
  const uid = userData?.user?.id;
  if (!uid) return json({ ok: false, error: "unauthorized" }, 401);

  // (2) Autorização por clínica distinta, no CONTEXTO do usuário (auth.uid resolve
  // dentro do predicado). clinic_id = 1º segmento do path; segmento não-uuid é
  // ignorado (path inválido, nunca assinado).
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const clinicIds = [...new Set(items.map((i) => i.path.split("/")[0]).filter((c) => UUID_RE.test(c)))];

  const allowed = new Set<string>();
  await Promise.all(clinicIds.map(async (clinicId) => {
    const { data, error } = await userClient.rpc("can_access_clinic_media", { p_clinic_id: clinicId });
    if (error) {
      await registrarErro("authz_check_failed", "Falha ao checar acesso à mídia da clínica",
        { detail: error.message, clinic_id: clinicId }, clinicId);
      return;
    }
    if (data === true) allowed.add(clinicId);
  }));

  const allowedItems = items.filter((it) => allowed.has(it.path.split("/")[0]));
  if (allowedItems.length === 0) return json({ ok: true, urls: {}, ttl: TTL });

  const urls: Record<string, string> = {};

  // (3a) Itens SEM transform → assina o original em LOTE (createSignedUrls).
  const plainItems = allowedItems.filter((it) => !it.width && !it.height);
  if (plainItems.length > 0) {
    const plainPaths = [...new Set(plainItems.map((it) => it.path))];
    const { data: signed, error: signErr } = await service.storage.from(BUCKET).createSignedUrls(plainPaths, TTL);
    if (signErr) {
      await registrarErro("sign_failed", "Falha ao assinar URLs (lote)",
        { detail: signErr.message, count: plainPaths.length }, clinicIds[0] ?? null);
    } else {
      const byPath = new Map<string, string>();
      for (const s of signed ?? []) {
        if (s?.signedUrl && s?.path) {
          const match = plainPaths.find((p) => p === s.path || p.endsWith(s.path!));
          if (match) byPath.set(match, s.signedUrl);
        }
      }
      for (const it of plainItems) { const u = byPath.get(it.path); if (u) urls[it.id] = u; }
    }
  }

  // (3b) Itens COM transform → assina 1 a 1 (createSignedUrls plural NÃO aceita
  // transform). Falha do transform (plano sem render) → fallback p/ original.
  const tItems = allowedItems.filter((it) => it.width || it.height);
  await Promise.all(tItems.map(async (it) => {
    const transform: Record<string, unknown> = {};
    if (it.width) transform.width = it.width;
    if (it.height) transform.height = it.height;
    if (it.quality) transform.quality = it.quality;
    if (it.resize) transform.resize = it.resize;
    const { data, error } = await service.storage.from(BUCKET).createSignedUrl(it.path, TTL, { transform });
    if (data?.signedUrl && !error) { urls[it.id] = data.signedUrl; return; }
    // fallback: assina o original (imagem ainda carrega, só sem redução)
    const fb = await service.storage.from(BUCKET).createSignedUrl(it.path, TTL);
    if (fb.data?.signedUrl) { urls[it.id] = fb.data.signedUrl; return; }
    await registrarErro("sign_failed", "Falha ao assinar mídia (transform + fallback)",
      { detail: error?.message || fb.error?.message, path_tail: it.path.split("/").slice(1).join("/") },
      it.path.split("/")[0]);
  }));

  return json({ ok: true, urls, ttl: TTL });
});
