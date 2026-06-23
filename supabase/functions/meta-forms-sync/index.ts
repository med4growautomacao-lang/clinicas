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
  meta_token: string
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

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  const { data: clinics, error } = await supabase
    .from('clinics')
    .select('id, meta_forms_id, meta_token, meta_forms_last_synced_at')
    .not('meta_forms_id', 'is', null)
    .not('meta_token', 'is', null)
    .eq('is_active', true)

  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  let totalFetched = 0
  let totalIngested = 0
  const perClinic: Array<Record<string, unknown>> = []

  for (const c of (clinics ?? []) as ClinicRow[]) {
    let fetched = 0
    let ingested = 0
    let ok = true                 // ciclo 100% sem erro? (controla o avanço do cursor)
    let maxCreatedMs = 0          // created_time mais recente visto neste ciclo

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
      let url: string | null =
        `https://graph.facebook.com/${GRAPH_VERSION}/${c.meta_forms_id}/leads` +
        `?fields=id,created_time,field_data,campaign_name,adset_name,ad_name` +
        `&limit=100&filtering=${filtering}` +
        `&access_token=${encodeURIComponent(c.meta_token)}`

      while (url) {
        const resp = await fetch(url)
        const json = await resp.json()

        if (json.error) {
          // Token expirado / form inválido / rate limit: marca o ciclo como falho p/ NÃO avançar o cursor.
          ok = false
          console.error(`[meta-forms-sync] clinic ${c.id} graph error:`, json.error?.message)
          break
        }

        for (const lead of (json.data ?? [])) {
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
            continue
          }
          if (res?.created) ingested++
        }

        url = json.paging?.next ?? null
      }
    } catch (e) {
      // 1 token ruim de uma clínica não derruba as demais; cursor não avança.
      ok = false
      console.error(`[meta-forms-sync] clinic ${c.id} exception:`, e instanceof Error ? e.message : e)
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
      since: new Date(sinceMs).toISOString(),
      new_cursor: ok && maxCreatedMs > 0 ? new Date(maxCreatedMs).toISOString() : (c.meta_forms_last_synced_at ?? null),
    })
  }

  return new Response(
    JSON.stringify({ ok: true, clinics: (clinics ?? []).length, fetched: totalFetched, ingested: totalIngested, perClinic }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  )
})
