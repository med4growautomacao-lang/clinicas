// ctwa-enrich — preenche o NOME DA CAMPANHA dos cliques que entraram com o token da Meta bloqueado.
//
// A `ctwa-tracking` grava o clique mesmo quando a Graph API recusa: o lead fica corretamente
// marcado como pago (source=meta_ads + ad_platform), só sem saber de qual campanha veio. O id do
// anúncio fica guardado em `raw.source_id` — é ele que permite voltar depois e completar o dado.
//
// Este job é esse "depois", e roda sozinho: no dia em que a clínica renovar o token da Meta, o
// próximo tick preenche as campanhas que ficaram para trás. Sem isso, o resgate dependeria de
// alguém lembrar de rodar um script — ou seja, não aconteceria.
//
// Hoje 11 das 19 clínicas estão com o token bloqueado ("API access blocked" / app deletado).
//
// PROBE POR CLÍNICA: antes de tentar qualquer clique, testa o token UMA vez (GET /me). Se o token
// está bloqueado, pula a clínica inteira. Sem isso, o job marteleria a Graph API com dezenas de
// chamadas condenadas a falhar — que é justamente o tipo de comportamento que leva ao bloqueio.
//
// JANELA: só cliques dos últimos 90 dias. Anúncio apagado na Meta responde erro mesmo com token
// bom, então insistir eternamente em clique velho é desperdício.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { candidatosDaClinica, comFallback, lembrarCamada } from "../_shared/meta-token.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GRAPH_VERSION = "v22.0";
const MAX_ROWS_PER_CLINIC = 100;
const JANELA_DIAS = 90;

async function tokenFunciona(token: string): Promise<boolean> {
  try {
    const r = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/me?fields=id&access_token=${encodeURIComponent(token)}`,
    );
    return r.ok;
  } catch {
    return false;
  }
}

async function buscarAnuncio(token: string, sourceId: string) {
  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${sourceId}`);
  url.searchParams.set("access_token", token);
  url.searchParams.set("fields", "name,adset{id,name},campaign{id,name}");
  const r = await fetch(url.toString());
  if (!r.ok) return null;
  const d = await r.json();
  return {
    ad: d?.name ?? null,
    adset: d?.adset?.name ?? null,
    campaign: d?.campaign?.name ?? null,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const json = (o: unknown, s = 200) =>
    new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const desde = new Date(Date.now() - JANELA_DIAS * 86400_000).toISOString();

  const { data: pendentes, error } = await supabase
    .from("attribution_inbox")
    .select("id, clinic_id, raw")
    .is("fb_campaign_name", null)
    .not("external_id", "is", null)
    .gte("created_at", desde)
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) return json({ ok: false, error: error.message }, 500);
  if (!pendentes?.length) return json({ ok: true, pendentes: 0 });

  // Agrupa por clínica: o probe do token é por clínica, não por clique.
  const porClinica = new Map<string, typeof pendentes>();
  for (const p of pendentes) {
    if (!p.raw?.source_id) continue;   // sem id do anúncio não há o que buscar
    const lista = porClinica.get(p.clinic_id) ?? [];
    lista.push(p);
    porClinica.set(p.clinic_id, lista);
  }

  const resultado: Record<string, unknown>[] = [];

  for (const [clinicId, linhas] of porClinica) {
    const { data: clinic } = await supabase
      .from("clinics")
      .select("id, name, meta_token, organization_id, meta_token_source")
      .eq("id", clinicId)
      .maybeSingle();

    if (!clinic) {
      resultado.push({ clinica: clinicId, pulou: "clinica_nao_encontrada", pendentes: linhas.length });
      continue;
    }

    // TRÊS camadas (cliente → organização → plataforma). Antes, token da clínica bloqueado =
    // clínica inteira pulada, mesmo havendo um token bom na organização ao lado.
    const candidatos = await candidatosDaClinica(supabase, clinic);
    if (candidatos.length === 0) {
      resultado.push({ clinica: clinic.name, pulou: "sem_token", pendentes: linhas.length });
      continue;
    }

    // Reusa a checagem de saúde que já existia: a primeira camada que passar é a que vale.
    const escolha = await comFallback(candidatos, async (token) => ({
      dados: token,
      erro: (await tokenFunciona(token)) ? null : { message: "token nao autorizado", code: 190 },
    }));
    if (!escolha.camada) {
      resultado.push({ clinica: clinic.name, pulou: "token_bloqueado", pendentes: linhas.length, tentativas: escolha.tentativas });
      continue;
    }
    const metaToken = escolha.dados!;
    await lembrarCamada(supabase, clinicId, clinic.meta_token_source, escolha.camada);

    // O mesmo anúncio costuma trazer vários cliques — uma chamada por anúncio, não por clique.
    const cache = new Map<string, Awaited<ReturnType<typeof buscarAnuncio>>>();
    let enriquecidos = 0, semAnuncio = 0;

    for (const linha of linhas.slice(0, MAX_ROWS_PER_CLINIC)) {
      const sourceId = String(linha.raw.source_id);

      if (!cache.has(sourceId)) {
        cache.set(sourceId, await buscarAnuncio(metaToken, sourceId));
      }
      const anuncio = cache.get(sourceId);

      if (!anuncio?.campaign) { semAnuncio++; continue; }   // anúncio apagado na Meta

      const { error: rpcErr } = await supabase.rpc("ctwa_enrich_campaign", {
        p_inbox_id: linha.id,
        p_campaign: anuncio.campaign,
        p_adset: anuncio.adset,
        p_ad: anuncio.ad,
      });
      if (rpcErr) console.error("[ctwa-enrich] rpc falhou:", rpcErr);
      else enriquecidos++;
    }

    resultado.push({ clinica: clinic.name, enriquecidos, sem_anuncio: semAnuncio, pendentes: linhas.length });
  }

  return json({ ok: true, resultado });
});
