// meta-forms-sync — captação nativa de leads do Formulário Nativo do Meta (Lead Ads).
//
// Disparada pelo pg_cron a cada 1 min (sem JWT). Para cada clínica com meta_forms_id + meta_token,
// busca os leads novos na Graph API (a partir de um CURSOR incremental por clínica), mapeia os
// campos do formulário e chama a RPC ingest_meta_form_lead (dedup idempotente + cria/vincula o lead
// + dual-write em leads).
//
// CURSOR (clinics.meta_forms_last_synced_at): created_time do lead mais recente já sincronizado.
//   - Lê com time_created > (cursor − OVERLAP) para tolerar clock skew; a dedup absorve a repetição.
//   - 1ª ativação (cursor nulo): pega a última INITIAL_LOOKBACK; não importa o histórico inteiro.
//   - Só AVANÇA o cursor se o ciclo da clínica foi 100% ok (sem erro de Graph/RPC). Qualquer erro
//     => não avança => re-busca tudo no próximo minuto (idempotente). Isso recupera leads após
//     token expirado / queda longa sem perder nada.
//
// Substitui o fluxo de captação que ficaria no n8n. NÃO faz follow-up (fase futura).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import {
  type CamadaToken, ehErroDeToken, type ErroGraph,
  ordenarCandidatos, tokenDaPlataforma, tokensDasOrgs,
} from '../_shared/meta-token.ts'

const GRAPH_VERSION = 'v24.0'
const OVERLAP_MINUTES = 5           // re-leitura de segurança a partir do cursor (dedup absorve)
const INITIAL_LOOKBACK_MINUTES = 60 // 1ª ativação (cursor nulo): pega a última hora, sem inundar com histórico

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface ClinicRow {
  id: string
  meta_forms_id: string
  meta_token: string | null          // pode ser nulo: a clinica pode usar o token da org ou da plataforma
  organization_id: string | null
  meta_token_source: CamadaToken | null
  meta_forms_last_synced_at: string | null
}
interface MetaField { name?: string; values?: string[] }

function pickField(fieldData: MetaField[] | undefined, names: string[]): string | null {
  for (const n of names) {
    const f = fieldData?.find((x) => (x.name || '').toLowerCase() === n)
    if (f && Array.isArray(f.values) && f.values.length > 0 && f.values[0]) return String(f.values[0])
  }
  return null
}

// Busca TODAS as paginas com UM token, sem gravar nada. Separar busca de gravacao e o que permite
// trocar de camada e refazer a busca do zero: se gravassemos durante a paginacao, um token que
// morre na pagina 2 deixaria metade dos leads gravados por um token e metade por outro.
async function buscarLeads(
  formsId: string, token: string, filtering: string,
// deno-lint-ignore no-explicit-any
): Promise<{ leads: any[]; erro: ErroGraph | null }> {
  // deno-lint-ignore no-explicit-any
  const leads: any[] = []
  let url: string | null =
    `https://graph.facebook.com/${GRAPH_VERSION}/${formsId}/leads` +
    `?fields=id,created_time,field_data,campaign_name,adset_name,ad_name` +
    `&limit=100&filtering=${filtering}` +
    `&access_token=${encodeURIComponent(token)}`

  while (url) {
    // Anotacoes explicitas: url e reatribuida a partir de json.paging, entao sem elas o TS entra
    // em inferencia circular (url -> resp -> json -> url) e reclama de TS7022.
    const resp: Response = await fetch(url)
    // deno-lint-ignore no-explicit-any
    const json: any = await resp.json()
    if (json.error) return { leads, erro: json.error as ErroGraph }
    for (const l of (json.data ?? [])) leads.push(l)
    url = json.paging?.next ?? null
  }
  return { leads, erro: null }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  // Esta função responde 200 mesmo quando o ciclo de uma clínica falha (é de propósito: uma clínica
  // com token ruim não pode derrubar as outras). O efeito colateral é que o coletor de pg_net, que
  // só olha o status HTTP, NÃO enxerga essa falha — o lead pago simplesmente não entra, em silêncio.
  // Por isso o registro tem que ser explícito e POR CLÍNICA.
  const registrar = (code: string, title: string, level: string, clinicId: string | null, ctx: unknown) =>
    supabase.rpc('log_system_error', {
      p_scope: 'meta-forms-sync', p_code: code, p_title: title,
      p_level: level, p_clinic_id: clinicId, p_context: ctx,
    }).then(() => {}, (e) => console.error('[meta-forms-sync] log falhou:', e))

  // Sem filtrar por meta_token: a clinica pode nao ter token proprio e depender do da organizacao
  // ou do da plataforma. Filtrar aqui (como era antes) fazia essas clinicas NUNCA serem varridas.
  const { data: clinics, error } = await supabase
    .from('clinics')
    .select('id, meta_forms_id, meta_token, organization_id, meta_token_source, meta_forms_last_synced_at')
    .not('meta_forms_id', 'is', null)
    .eq('is_active', true)

  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // As outras duas camadas de token, carregadas UMA vez (nao por clinica).
  const listaClinicas = (clinics ?? []) as ClinicRow[]
  const [platformToken, orgTokens] = await Promise.all([
    tokenDaPlataforma(supabase),
    tokensDasOrgs(supabase, listaClinicas.map((c) => c.organization_id ?? '')),
  ])

  let totalFetched = 0
  let totalIngested = 0
  const perClinic: Array<Record<string, unknown>> = []

  for (const c of listaClinicas) {
    let fetched = 0
    let ingested = 0
    let ok = true                 // ciclo 100% sem erro? (controla o avanço do cursor)
    let maxCreatedMs = 0          // created_time mais recente visto neste ciclo
    let camadaUsada: CamadaToken | null = null   // qual token deu certo nesta rodada

    // Limite inferior do time_created: cursor − overlap, ou lookback inicial se cursor nulo.
    const cursorMs = c.meta_forms_last_synced_at ? Date.parse(c.meta_forms_last_synced_at) : null
    const sinceMs = cursorMs !== null
      ? cursorMs - OVERLAP_MINUTES * 60_000
      : Date.now() - INITIAL_LOOKBACK_MINUTES * 60_000
    const sinceUnix = Math.floor(sinceMs / 1000)
    const filtering = encodeURIComponent(JSON.stringify(
      [{ field: 'time_created', operator: 'GREATER_THAN', value: sinceUnix }],
    ))

    try {
      // TRÊS camadas de token, na ordem: a que funcionou por último vem primeiro. Se a Meta
      // recusar POR CAUSA DO TOKEN, tenta a próxima; a que funcionar vira a principal da clínica.
      const candidatos = ordenarCandidatos(c.meta_token_source, {
        clinic: c.meta_token,
        org: c.organization_id ? orgTokens.get(c.organization_id) : null,
        platform: platformToken,
      })

      if (candidatos.length === 0) {
        ok = false
        await registrar(
          'sem_token_meta',
          'Formulário do Meta configurado, mas não há token em NENHUMA camada (cliente, organização ou plataforma)',
          'critical', c.id, { forms_id: c.meta_forms_id },
        )
      } else {
        // deno-lint-ignore no-explicit-any
        let leads: any[] = []
        let ultimoErro: ErroGraph | null = null
        const tentativas: string[] = []

        for (const cand of candidatos) {
          const r = await buscarLeads(c.meta_forms_id, cand.token, filtering)
          if (!r.erro) { leads = r.leads; camadaUsada = cand.camada; break }
          ultimoErro = r.erro
          tentativas.push(`${cand.camada}=${r.erro.code ?? '?'}`)
          // Erro que NÃO é de token (rate limit, instabilidade da Meta): trocar de camada não
          // ajuda e ainda queimaria as outras. Para aqui e tenta tudo de novo no próximo minuto.
          if (!ehErroDeToken(r.erro)) break
        }

        if (camadaUsada === null) {
          // Só AGORA é falha de verdade: nenhuma das camadas funcionou. Registrar antes disso
          // seria alarme sobre algo que o fallback cobriu, e alarme falso soterra o de verdade.
          ok = false
          console.error(`[meta-forms-sync] clinic ${c.id} graph error:`, ultimoErro?.message)
          await registrar(
            'graph_api_recusou',
            'A Meta recusou a busca dos leads do formulário em TODAS as camadas de token — leads pagos podem estar não entrando',
            'critical', c.id,
            { erro: ultimoErro?.message, codigo: ultimoErro?.code, forms_id: c.meta_forms_id, tentativas },
          )
        } else {
          // Memória: a camada boa passa a ser a primeira tentativa das próximas rodadas.
          if (camadaUsada !== c.meta_token_source) {
            const { error: srcErr } = await supabase
              .from('clinics').update({ meta_token_source: camadaUsada }).eq('id', c.id)
            if (srcErr) console.error(`[meta-forms-sync] meta_token_source clinic ${c.id}:`, srcErr.message)
          }

        for (const lead of leads) {
          fetched++
          const createdMs = lead.created_time ? Date.parse(lead.created_time) : 0
          if (createdMs > maxCreatedMs) maxCreatedMs = createdMs

          const fd: MetaField[] = lead.field_data ?? []
          const name =
            pickField(fd, ['full_name', 'name', 'nome']) ||
            [pickField(fd, ['first_name']), pickField(fd, ['last_name'])].filter(Boolean).join(' ').trim() ||
            null
          const phone = pickField(fd, ['phone_number', 'phone', 'telefone', 'whatsapp'])
          const email = pickField(fd, ['email', 'e-mail'])

          if (!phone && !email) continue // sem identidade mínima, ignora

          const { data: res, error: rpcErr } = await supabase.rpc('ingest_meta_form_lead', {
            p_clinic_id: c.id,
            p_external_id: String(lead.id),
            p_name: name,
            p_phone: phone,
            p_email: email,
            p_submitted_at: lead.created_time ?? null,
            p_campaign_name: lead.campaign_name ?? null,
            p_adset_name: lead.adset_name ?? null,
            p_ad_name: lead.ad_name ?? null,
            p_payload: fd,
          })

          if (rpcErr) {
            // Falha ao gravar este lead: não avança o cursor (re-tenta no próximo ciclo).
            ok = false
            console.error(`[meta-forms-sync] rpc clinic ${c.id}:`, rpcErr.message)
            await registrar(
              'gravacao_do_lead_falhou',
              'Lead do formulário do Meta chegou mas NÃO foi gravado',
              'error', c.id, { erro: rpcErr.message, lead_do_meta: String(lead.id) },
            )
            continue
          }
          if (res?.created) ingested++
        }
        } // fim do ramo "achou uma camada de token que funciona"
      }   // fim do ramo "existe pelo menos um candidato"
    } catch (e) {
      // 1 token ruim de uma clínica não derruba as demais; cursor não avança.
      ok = false
      console.error(`[meta-forms-sync] clinic ${c.id} exception:`, e instanceof Error ? e.message : e)
      await registrar(
        'ciclo_falhou',
        'A sincronização do formulário do Meta quebrou nesta clínica',
        'critical', c.id, { erro: e instanceof Error ? e.message : String(e) },
      )
    }

    // Avança o cursor SOMENTE se o ciclo foi 100% ok e vimos algo mais novo (avanço monotônico).
    if (ok && maxCreatedMs > 0) {
      const newCursorIso = new Date(maxCreatedMs).toISOString()
      const { error: updErr } = await supabase
        .from('clinics')
        .update({ meta_forms_last_synced_at: newCursorIso })
        .eq('id', c.id)
        .or(`meta_forms_last_synced_at.is.null,meta_forms_last_synced_at.lt.${newCursorIso}`)
      if (updErr) console.error(`[meta-forms-sync] cursor update clinic ${c.id}:`, updErr.message)
    }

    totalFetched += fetched
    totalIngested += ingested
    perClinic.push({
      clinic_id: c.id, fetched, ingested, ok,
      camada_token: camadaUsada,   // qual das 3 camadas respondeu (null = nenhuma funcionou)
      since: new Date(sinceMs).toISOString(),
      new_cursor: ok && maxCreatedMs > 0 ? new Date(maxCreatedMs).toISOString() : (c.meta_forms_last_synced_at ?? null),
    })
  }

  return new Response(
    JSON.stringify({ ok: true, clinics: listaClinicas.length, fetched: totalFetched, ingested: totalIngested, perClinic }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  )
})
