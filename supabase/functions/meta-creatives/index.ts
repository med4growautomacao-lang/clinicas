// meta-creatives — lista os CRIATIVOS que estão RODANDO AGORA (effective_status=ACTIVE) de uma
// clínica no Meta Ads, para a coluna "Criativos" + modal de galeria em Marketing › Investimento
// por Campanha.
//
// Por que existe: a tabela de investimento (marketing_spend_breakdown) só guarda
// campanha/conjunto/anúncio + gasto — NÃO guarda a arte (imagem/vídeo). E "quantidade de
// criativos" ≠ "quantidade de anúncios": vários anúncios costumam compartilhar a MESMA imagem
// (medido: 8 anúncios ativos da Faggioni, 1 imagem só). Então a arte precisa vir da Graph e ser
// deduplicada por ASSET (image_hash / video_id), o que o front faz a partir desta lista.
//
// Contrato:
//   req  POST { clinic_id }
//   resp { ok, creatives: CreativeItem[], count }  |  { ok:false, error, detail }
//
// Escopo = AGORA (effective_status=ACTIVE), independente de janela de datas — decisão do dono.
// Busca AO VIVO, não grava nada (galeria montada no front; nenhuma tabela/RPC/cron novo).
//
// Auth: JWT do usuário (functions.invoke manda automático) → verify_jwt ON. Autorização por
// clínica reconferida no CONTEXTO do usuário (is_clinic_admin / is_super_admin); o clinic_id do
// body NÃO é confiável por si só. Token/segredo lido com service role, nunca vai ao browser.
//
// Token em TRÊS camadas (cliente → organização → plataforma) com fallback — igual ao
// meta-spend-sync (_shared/meta-token.ts). Só registra na Central quando TODAS as camadas falham
// (alarmar uma camada coberta pelo fallback é ruído).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { candidatosDaClinica, comFallback, type ErroGraph, lembrarCamada } from "../_shared/meta-token.ts";

const GRAPH_VERSION = "v24.0";
const PAGE_CAP = 50; // teto de páginas (200/pág → ~10k anúncios ativos); guarda contra conta gigante

// Backoff em rate-limit (HTTP 429/503) — mesma lógica do _shared/spend.ts, replicada aqui para
// não acoplar a este módulo (que tem erros de tipo pré-existentes por falta de tipos gerados).
async function fetchWithBackoff(url: string, tries = 4): Promise<Response> {
  let delay = 500;
  for (let i = 0; i < tries; i++) {
    const resp = await fetch(url);
    if (resp.status !== 429 && resp.status !== 503) return resp;
    if (i === tries - 1) return resp;
    await new Promise((r) => setTimeout(r, delay));
    delay *= 2;
  }
  return fetch(url);
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Um anúncio ativo já normalizado para o front. O front agrupa por campaign_name/adset_name e
// deduplica por dedup_key (mesma imagem/vídeo aparece 1x na galeria e conta 1 na coluna).
interface CreativeItem {
  campaign_id: string;
  campaign_name: string;
  adset_id: string;
  adset_name: string;
  ad_id: string;
  ad_name: string;
  media_type: "image" | "video";
  dedup_key: string;            // video_id | image_hash | caminho da thumb | creative_id | ad_id
  image_url: string | null;     // arte cheia (imagem) ou pôster (vídeo)
  permalink: string | null;     // post/reel original (abre em nova aba no modal)
  cta: string | null;
}

// effective_object_story_id vem como "<pageId>_<postId>"; o post público é facebook.com/<postId>.
function fbPermalink(storyId: string | null | undefined): string | null {
  if (!storyId || !storyId.includes("_")) return null;
  const postId = storyId.split("_").pop();
  return postId ? `https://www.facebook.com/${postId}` : null;
}

// Duas imagens iguais têm o MESMO caminho no fbcdn (só a query assinada muda) — serve de chave de
// dedup quando o token não devolve image_hash. Se a URL não parsear, cai no próprio valor.
function thumbPath(url: string | null | undefined): string | null {
  if (!url) return null;
  try { return new URL(url).pathname; } catch { return url; }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  let body: any;
  try { body = await req.json(); } catch { body = {}; }

  const clinicId = typeof body?.clinic_id === "string" ? body.clinic_id : "";
  if (!clinicId) return json({ ok: false, error: "bad_request", detail: "clinic_id é obrigatório" }, 400);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const service = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");

  const registrarErro = async (code: string, title: string, level: string, ctx: Record<string, unknown>) => {
    try {
      await service.rpc("log_system_error", {
        p_scope: "meta-creatives", p_code: code, p_title: title, p_level: level,
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

  // (3) Token + conta de anúncios (service role).
  const { data: clinic, error: clinicErr } = await service
    .from("clinics")
    .select("meta_token, meta_token_source, meta_ad_account_id, organization_id")
    .eq("id", clinicId)
    .single();
  if (clinicErr) {
    await registrarErro("clinica_nao_encontrada", "Falha ao ler credenciais Meta da clínica", "error", { detail: clinicErr.message });
    return json({ ok: false, error: "clinic_read_failed", detail: clinicErr.message }, 500);
  }
  const candidatos = await candidatosDaClinica(service, clinic);
  if (candidatos.length === 0 || !clinic?.meta_ad_account_id) {
    // Sem token/conta não é erro (a clínica pode não anunciar no Meta) → silêncio, o front mostra "—".
    return json({ ok: true, creatives: [], count: 0, error: "meta_not_configured" });
  }
  const account = String(clinic.meta_ad_account_id).replace(/^act_/, "");

  // (4) Busca os anúncios ATIVOS com o criativo embutido. level=ad + creative{...} traz a
  //     hierarquia (campanha/conjunto) e a arte numa chamada só. Roda inteira com UM token; se a
  //     camada for recusada, refaz do zero com a próxima (nada foi gravado).
  const fields =
    "name,effective_status," +
    "campaign{id,name},adset{id,name}," +
    "creative{id,name,object_type,image_hash,video_id,thumbnail_url,image_url,instagram_permalink_url,effective_object_story_id,call_to_action_type}";
  const effActive = encodeURIComponent(JSON.stringify(["ACTIVE"]));

  const buscar = async (token: string): Promise<{ dados: CreativeItem[]; erro: ErroGraph | null }> => {
    const out: CreativeItem[] = [];
    let url: string | null =
      `https://graph.facebook.com/${GRAPH_VERSION}/act_${account}/ads` +
      `?fields=${encodeURIComponent(fields)}&effective_status=${effActive}` +
      `&limit=200&access_token=${encodeURIComponent(token)}`;
    let pages = 0;
    while (url && pages < PAGE_CAP) {
      pages++;
      const resp = await fetchWithBackoff(url);
      // deno-lint-ignore no-explicit-any
      const j: any = await resp.json();
      if (j.error) return { dados: out, erro: j.error as ErroGraph };
      for (const ad of (j.data ?? [])) {
        const cr = ad?.creative ?? {};
        const videoId: string | null = cr.video_id ? String(cr.video_id) : null;
        const imageHash: string | null = cr.image_hash ? String(cr.image_hash) : null;
        const imageUrl: string | null = cr.image_url ?? cr.thumbnail_url ?? null;
        const dedupKey =
          videoId ?? imageHash ?? thumbPath(cr.thumbnail_url) ?? (cr.id ? String(cr.id) : String(ad.id));
        out.push({
          campaign_id: String(ad?.campaign?.id ?? ""),
          campaign_name: String(ad?.campaign?.name ?? ""),
          adset_id: String(ad?.adset?.id ?? ""),
          adset_name: String(ad?.adset?.name ?? ""),
          ad_id: String(ad?.id ?? ""),
          ad_name: String(ad?.name ?? ""),
          media_type: videoId ? "video" : "image",
          dedup_key: dedupKey,
          image_url: imageUrl,
          permalink: cr.instagram_permalink_url ?? fbPermalink(cr.effective_object_story_id),
          cta: cr.call_to_action_type ?? null,
        });
      }
      url = j.paging?.next ?? null;
    }
    return { dados: out, erro: null };
  };

  try {
    const r = await comFallback(candidatos, buscar);
    if (!r.camada) {
      await registrarErro(
        "graph_api_recusou",
        "A Meta recusou a busca dos criativos em TODAS as camadas de token — a coluna Criativos fica vazia",
        "error",
        { erro: r.erro?.message, codigo: r.erro?.code, tentativas: r.tentativas, account },
      );
      return json({ ok: false, error: "graph_error", detail: r.erro?.message ?? "erro da Graph API" }, 502);
    }
    await lembrarCamada(service, clinicId, clinic.meta_token_source, r.camada);
    const creatives = r.dados ?? [];
    return json({ ok: true, creatives, count: creatives.length });
  } catch (e) {
    await registrarErro("ciclo_falhou", "A busca de criativos do Meta quebrou", "error",
      { erro: e instanceof Error ? e.message : String(e) });
    return json({ ok: false, error: "fetch_failed", detail: e instanceof Error ? e.message : String(e) }, 500);
  }
});
