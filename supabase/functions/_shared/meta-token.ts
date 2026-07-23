// _shared/meta-token.ts — resolucao do token da Meta em TRES camadas, com fallback e memoria.
//
// O sistema tem tres tokens possiveis para falar com a Graph API:
//   1. CLIENTE      clinics.meta_token           (o proprio cliente conectou)
//   2. ORGANIZACAO  organizations.meta_ad_token  (a agencia dona da conta)
//   3. SISTEMA      Vault META_CLOUD_TOKEN       (token da plataforma)
//
// Regra do dono (23/07/2026): quando um token da erro, TESTAR OS OUTROS, e o que funcionar vira o
// PRINCIPAL nas buscas seguintes (memoria em clinics.meta_token_source). Sem isso, um token
// vencido numa camada derruba a captacao inteira mesmo havendo outro valido ao lado — foi o que
// aconteceu com o Tyago em 21/07: 370 recusas seguidas, com a busca conhecendo so a camada do
// cliente.
//
// ⚠️ So registre erro na Central quando TODAS as camadas falharem. Alertar sobre uma camada que o
// fallback cobriu e ruido, e ruido soterra o alerta de verdade (vide os 235 alarmes falsos de
// 23/07). O que o operador precisa saber e "nao ha token que funcione", nao "o primeiro falhou".

export type CamadaToken = "clinic" | "org" | "platform";
export type CandidatoToken = { camada: CamadaToken; token: string };

export interface ErroGraph {
  message?: string;
  code?: number;
  type?: string;
  error_subcode?: number;
}

// Codigos da Graph que significam "ESTE token nao serve aqui" — vale tentar outra camada:
//   100  parametro/objeto invalido (inclui "does not exist, cannot be loaded due to missing
//        permissions", que foi exatamente o caso do Tyago)
//   190  OAuth invalido / expirado      102  sessao expirada
//   200  falta permissao                 10  permissao negada
//   2500 chamada invalida para o token
// Rate limit (4, 17, 32, 613) e erro transitorio NAO entram de proposito: trocar de token neles
// so espalharia o problema para as outras camadas e queimaria as tres.
const CODIGOS_DE_TOKEN = new Set([100, 190, 102, 200, 10, 2500]);

export function ehErroDeToken(err: ErroGraph | null | undefined): boolean {
  if (!err) return false;
  return CODIGOS_DE_TOKEN.has(Number(err.code));
}

/** Candidatos na ordem de tentativa: a camada que funcionou por ultimo vem primeiro. */
export function ordenarCandidatos(
  preferida: CamadaToken | null | undefined,
  tokens: { clinic?: string | null; org?: string | null; platform?: string | null },
): CandidatoToken[] {
  // Em duas etapas de proposito: com o .filter() colado no literal, o contexto de tipo nao chega
  // ao array e o TS infere `camada: string` em vez da uniao (TS2322).
  const todas: CandidatoToken[] = [
    { camada: "clinic", token: (tokens.clinic ?? "").trim() },
    { camada: "org", token: (tokens.org ?? "").trim() },
    { camada: "platform", token: (tokens.platform ?? "").trim() },
  ];
  const lista = todas.filter((c) => c.token !== "");

  // Memoria: evita gastar uma recusa por ciclo na camada que ja sabemos estar quebrada.
  if (preferida) {
    const i = lista.findIndex((c) => c.camada === preferida);
    if (i > 0) lista.unshift(lista.splice(i, 1)[0]);
  }

  // Dedup por VALOR: cliente e organizacao costumam guardar o MESMO token; tentar duas vezes
  // seria gastar duas recusas identicas e dobrar a chance de bater no rate limit.
  const vistos = new Set<string>();
  return lista.filter((c) => (vistos.has(c.token) ? false : (vistos.add(c.token), true)));
}

/**
 * Executa `tentar` com cada camada ate uma funcionar. E O LACO — existe aqui e nao copiado em
 * cada funcao, senao as regras (quando trocar, quando parar) divergem entre elas com o tempo.
 * Para no primeiro erro que NAO for de token: em rate limit, insistir com outra camada so
 * espalharia o bloqueio.
 */
export async function comFallback<T>(
  candidatos: CandidatoToken[],
  tentar: (token: string) => Promise<{ dados: T; erro: ErroGraph | null }>,
): Promise<{ dados: T | null; camada: CamadaToken | null; erro: ErroGraph | null; tentativas: string[] }> {
  let erro: ErroGraph | null = null;
  const tentativas: string[] = [];
  for (const c of candidatos) {
    const r = await tentar(c.token);
    if (!r.erro) return { dados: r.dados, camada: c.camada, erro: null, tentativas };
    erro = r.erro;
    tentativas.push(`${c.camada}=${r.erro.code ?? "?"}`);
    if (!ehErroDeToken(r.erro)) break;
  }
  return { dados: null, camada: null, erro, tentativas };
}

/** Candidatos prontos para UMA clinica. Em lote, use ordenarCandidatos + tokensDasOrgs direto. */
// deno-lint-ignore no-explicit-any
export async function candidatosDaClinica(supabase: any, clinica: {
  meta_token?: string | null;
  organization_id?: string | null;
  meta_token_source?: CamadaToken | null;
}): Promise<CandidatoToken[]> {
  const [plataforma, orgs] = await Promise.all([
    tokenDaPlataforma(supabase),
    tokensDasOrgs(supabase, clinica.organization_id ? [clinica.organization_id] : []),
  ]);
  return ordenarCandidatos(clinica.meta_token_source ?? null, {
    clinic: clinica.meta_token,
    org: clinica.organization_id ? orgs.get(clinica.organization_id) : null,
    platform: plataforma,
  });
}

/** Memoria: grava a camada vencedora se ela mudou. Nunca lanca — memoria e otimizacao, nao pode
 *  derrubar o fluxo que ACABOU de dar certo. */
// deno-lint-ignore no-explicit-any
export async function lembrarCamada(
  supabase: any, clinicId: string, atual: CamadaToken | null | undefined, nova: CamadaToken | null,
): Promise<void> {
  if (!nova || nova === atual) return;
  try {
    await supabase.from("clinics").update({ meta_token_source: nova }).eq("id", clinicId);
  } catch (e) {
    console.error("[meta-token] nao consegui lembrar a camada:", e);
  }
}

/** Token da plataforma (Vault). Devolve "" quando nao houver — nunca lanca. */
// deno-lint-ignore no-explicit-any
export async function tokenDaPlataforma(supabase: any): Promise<string> {
  try {
    const { data } = await supabase.rpc("get_meta_cloud_secret", { p_name: "META_CLOUD_TOKEN" });
    return typeof data === "string" ? data.trim() : "";
  } catch {
    return "";
  }
}

/** Mapa organization_id -> meta_ad_token, em UMA consulta (evita N+1 no laco de clinicas). */
// deno-lint-ignore no-explicit-any
export async function tokensDasOrgs(supabase: any, orgIds: string[]): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  const ids = [...new Set(orgIds.filter(Boolean))];
  if (ids.length === 0) return mapa;
  try {
    const { data } = await supabase.from("organizations").select("id, meta_ad_token").in("id", ids);
    for (const o of data ?? []) {
      const t = (o?.meta_ad_token ?? "").trim();
      if (t) mapa.set(o.id, t);
    }
  } catch { /* sem org token: o fallback segue para a plataforma */ }
  return mapa;
}
