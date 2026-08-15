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
// ⚠️ TRANSFORM DE IMAGEM: RECUSADO DE PROPÓSITO (14/08/2026). O contrato ainda ACEITA
// width/height/quality/resize para não quebrar aba antiga, mas eles são IGNORADOS e a
// tentativa vira aviso na Central. O motivo é dinheiro, não técnica: o Pro inclui só
// 100 imagens de ORIGEM transformadas por ciclo e cobra US$ 5 a cada mil depois,
// contando 1x por imagem distinta ABERTA no mês. Medido em 14/08/2026: 529 no ciclo,
// subindo de ~10/dia para ~130/dia conforme a equipe passou a abrir mais conversa, com
// teto de ~10.500/mês (as ~350 imagens/dia que chegam) = ~US$ 52/mês, mais que o plano.
//
// A trava mora AQUI, e não no front, por dois motivos: aba antiga fica aberta o dia
// inteiro e continua mandando o pedido velho depois do deploy, e arquivo de tela é
// revertido sem ninguém perceber que reabriu uma torneira de custo.
// Se a miniatura precisar voltar um dia (peso na memória do navegador em conversa com
// muita foto), o caminho certo NÃO é reabrir isto: é gerar a miniatura uma vez, na
// chegada da mídia, e guardá-la como arquivo próprio. Custa zero de transformação.
//
// Contrato:
//   req  POST { items: Array<{ id, path }> }   (width/height/quality/resize: IGNORADOS)
//        - id   = chave de cache do cliente (hoje sempre igual ao path)
//        - path = "<clinic_id>/<arquivo>" no bucket
//   resp { ok, urls: { [id]: signedUrl }, ttl, truncated }
//        - id negado/inexistente: ausente de urls
//        - truncated=true → o lote passou de MAX_ITEMS e o excedente NÃO foi assinado.
//          Sem esse aviso o cliente lê o id ausente como negação permanente e não
//          oferece nova tentativa, deixando mídia legítima inacessível até recarregar.
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
const MAX_ITEMS = 400;       // teto por request (1 item por mídia; o cliente já fatia o lote)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ReqItem = { id: string; path: string };

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  let body: any;
  try { body = await req.json(); } catch { body = {}; }
  const rawItems: unknown = body?.items;
  if (!Array.isArray(rawItems)) return json({ ok: false, error: "missing_items" }, 400);

  // Sanitiza: id/path strings não-vazias; dedup por id.
  const seen = new Set<string>();
  const items: ReqItem[] = [];
  let pediuTransform = false;
  for (const raw of rawItems) {
    const id = typeof raw?.id === "string" ? raw.id : "";
    const path = typeof raw?.path === "string" ? raw.path : "";
    if (!id || !path || seen.has(id)) continue;
    // ⚠️ NÃO voltar a ler width/height/quality/resize. Aceitar o campo e ignorá-lo É a
    // trava de custo (ver o topo do arquivo). Só registramos que alguém pediu.
    if (raw?.width || raw?.height || raw?.quality || raw?.resize) pediuTransform = true;
    seen.add(id);
    items.push({ id, path });
    if (items.length >= MAX_ITEMS) break;
  }
  // Sobrou item fora do teto → o cliente precisa saber, senão lê ausência como negação.
  const truncated = items.length >= MAX_ITEMS && rawItems.length > items.length;
  if (items.length === 0) return json({ ok: true, urls: {}, ttl: TTL, truncated: false });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const service = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");

  const registrarErro = async (code: string, title: string, ctx: Record<string, unknown>, clinicId: string | null, level = "error") => {
    try {
      await service.rpc("log_system_error", {
        p_scope: "chat-media-sign", p_code: code, p_title: title, p_level: level,
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

  // Alguém ainda pede miniatura → serve o original assim mesmo e avisa. Logo após o
  // deploy isso é esperado (aba antiga com o bundle anterior) e deve sumir sozinho;
  // se persistir por dias, é tela nova reabrindo a torneira de custo do topo.
  if (pediuTransform) {
    await registrarErro("transform_ignorado", "Pedido de transformação de imagem ignorado (trava de custo)",
      { detalhe: "chat-media-sign recusa transform desde 14/08/2026; original servido no lugar" }, null, "warn");
  }

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
  if (allowedItems.length === 0) return json({ ok: true, urls: {}, ttl: TTL, truncated });

  const urls: Record<string, string> = {};

  // (3) Assina o ORIGINAL de todos, sempre em LOTE. O ramo 1-a-1 com transform foi
  // removido em 14/08/2026 (trava de custo no topo); não reintroduzir.
  const paths = [...new Set(allowedItems.map((it) => it.path))];
  const { data: signed, error: signErr } = await service.storage.from(BUCKET).createSignedUrls(paths, TTL);
  if (signErr) {
    await registrarErro("sign_failed", "Falha ao assinar URLs (lote)",
      { detail: signErr.message, count: paths.length }, clinicIds[0] ?? null);
  } else {
    // Casa por igualdade normalizada (só remove barra inicial), NÃO por endsWith —
    // endsWith casaria path errado se o prefixo não fosse uuid de tamanho fixo.
    const norm = (x: string) => x.replace(/^\/+/, "");
    const byPath = new Map<string, string>();
    for (const s of signed ?? []) {
      if (s?.signedUrl && s?.path) {
        const sp = norm(String(s.path));
        const match = paths.find((p) => norm(p) === sp);
        if (match) byPath.set(match, s.signedUrl);
      }
    }
    for (const it of allowedItems) { const u = byPath.get(it.path); if (u) urls[it.id] = u; }
  }

  return json({ ok: true, urls, ttl: TTL, truncated });
});
