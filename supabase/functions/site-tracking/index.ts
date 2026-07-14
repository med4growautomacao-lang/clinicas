// site-tracking — substitui o workflow n8n "Tracking Google" (webhook clinica/webhook_redirecionamento).
//
// O site (script rastracking_nod + nosso bloco) chama esta função quando a pessoa clica no botão de
// WhatsApp, e FICA ESPERANDO o protocolo para montar o link. Se a gente falhar, o script cai no
// fallback e abre o WhatsApp SEM protocolo — o lead entra sem origem. Ou seja: responder rápido e
// sempre é mais importante do que responder completo.
//
// Contrato de resposta é IDÊNTICO ao do n8n — { "id_protocolo": "..." } — de propósito: assim a
// migração de cada site é a troca de UMA linha (a URL do fetch), sem mexer no resto do script.
//
// O que muda em relação ao n8n:
//
//   1. `source` vem do utm_source REAL. O n8n gravava 'google_ads' FIXO em todo clique — então
//      anúncio do Meta que passava pelo site (campanha "[RMK IG para Site]", medium
//      Facebook_Stories/Instagram_Reels) era contabilizado como Google Ads, e tráfego
//      orgânico/direto também. Isso inflava o ROAS do Google e esvaziava o do Meta.
//   2. Usa o `clinic_id` que o site JÁ MANDA. O n8n ignorava e buscava a clínica pelo TELEFONE —
//      a mesma fragilidade que já quebrou os gatilhos de etapa.
//   3. Não cria lead placeholder ("Lead Pendente"). Grava na attribution_inbox e o protocolo é a
//      chave — sem lead-fantasma, sem duplicata, e com last-touch (ver migration 20260714000013).
//   4. Guarda `pagina` e `src_historico`, que o n8n descartava.
//   5. Erro vai para a Central de Erros (o n8n só reclamava para dentro dele mesmo).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

async function registrarErro(
  code: string,
  title: string,
  level: string,
  clinicId: string | null,
  ctx: unknown,
): Promise<void> {
  try {
    const supa = createClient(SUPABASE_URL, SERVICE_KEY);
    await supa.rpc('log_system_error', {
      p_scope: 'site-tracking',
      p_code: code,
      p_title: title,
      p_level: level,
      p_clinic_id: clinicId,
      p_context: ctx ?? {},
      p_is_monitor: false,
    });
  } catch (e) {
    console.error('[site-tracking] falhou ao registrar erro', e);
  }
}

// O telefone só é usado como PLANO B (site antigo que não manda clinic_id).
function normalizarTelefone(raw: string): string | null {
  let p = String(raw ?? '').replace(/\D/g, '').replace(/^0+/, '');
  if (!p) return null;
  if (!p.startsWith('55')) p = '55' + p;
  if (p.length === 13) {
    const country = p.slice(0, 2);
    const ddd = p.slice(2, 4);
    let rest = p.slice(4);
    if (rest.startsWith('9')) rest = rest.slice(1);
    p = country + ddd + rest;
  }
  return p.length >= 12 && p.length <= 13 ? p : null;
}

// utm_source -> a ORIGEM do nosso modelo. O n8n não fazia isso: carimbava google_ads em tudo.
// NULL = orgânico. Não inventamos origem: "direto"/"referral"/vazio permanecem sem atribuição,
// que é o que eles são.
function mapearOrigem(utmSource: string, gclid: string, fbclid: string): string | null {
  const s = (utmSource ?? '').trim().toLowerCase();

  // O click-id é prova mais forte que a UTM (a UTM o cliente digita; o clid o anunciante emite).
  if (gclid) return 'google_ads';
  if (fbclid) return 'meta_ads';

  if (s === 'google' || s === 'google_ads' || s === 'googleads' || s === 'adwords') return 'google_ads';
  if (s === 'facebook' || s === 'fb' || s === 'meta' || s === 'facebook_ads' || s === 'meta_ads') return 'meta_ads';
  if (s === 'instagram' || s === 'ig') return 'instagram';

  return null; // direto / referral / orgânico / desconhecido
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const supa = createClient(SUPABASE_URL, SERVICE_KEY);

  const txt = (k: string) => String(body[k] ?? '').trim();
  const telefoneDestino = txt('telefone_destino');
  let clinicId = txt('clinic_id') || null;

  try {
    // ── Resolver a clínica ────────────────────────────────────────────────────────────────────
    // O site JÁ MANDA o clinic_id. Confiar nele (validando) em vez de adivinhar pelo telefone.
    if (clinicId) {
      const { data } = await supa.from('clinics').select('id').eq('id', clinicId).maybeSingle();
      if (!data) clinicId = null; // id inválido/velho -> cai no plano B
    }

    if (!clinicId && telefoneDestino) {
      const norm = normalizarTelefone(telefoneDestino);
      if (norm) {
        const { data } = await supa.from('clinics').select('id').eq('phone', norm).maybeSingle();
        clinicId = data?.id ?? null;
      }
    }

    if (!clinicId) {
      await registrarErro(
        'clinica_nao_encontrada',
        'Clique no site sem clínica identificável',
        'error',
        null,
        { clinic_id_recebido: txt('clinic_id'), telefone_destino: telefoneDestino, pagina: txt('pagina') },
      );
      // Devolve 200 com protocolo vazio: o script trata `|| "0000"` e ao menos abre o WhatsApp.
      return json({ id_protocolo: '' }, 200);
    }

    // ── Atribuição ────────────────────────────────────────────────────────────────────────────
    const gclid = txt('gclid');
    const fbclid = txt('fbclid'); // hoje o script não manda; quando mandar, já é aproveitado
    const utmSource = txt('utm_source');
    const origem = mapearOrigem(utmSource, gclid, fbclid);

    const { data: proto, error } = await supa.rpc('site_ingest_click', {
      p_clinic_id: clinicId,
      p_source: origem,
      p_g_clid: gclid || null,
      p_fb_clid: fbclid || null,
      p_campaign: txt('utm_campaign') || null,
      p_adset: txt('utm_medium') || null,
      p_ad: txt('utm_content') || null,
      p_term: txt('utm_term') || null,
      p_utm_source: utmSource || null,
      p_rast_id: txt('rast_id') || null,
      p_raw: {
        pagina: txt('pagina') || null,
        src_historico: txt('src_historico') || null,
        wbraid: txt('wbraid') || null,
        gbraid: txt('gbraid') || null,
        telefone_destino: telefoneDestino || null,
        user_agent: req.headers.get('user-agent'),
        referer: req.headers.get('referer'),
      },
    });

    if (error) {
      await registrarErro(
        'gravacao_do_clique_falhou',
        'Não consegui gravar o clique do site',
        'critical',
        clinicId,
        { erro: error.message, gclid, utm_source: utmSource, pagina: txt('pagina') },
      );
      return json({ id_protocolo: '' }, 200);
    }

    return json({ id_protocolo: proto });

  } catch (e) {
    await registrarErro(
      'ciclo_falhou',
      'Erro inesperado no tracking do site',
      'critical',
      clinicId,
      { erro: e instanceof Error ? e.message : String(e) },
    );
    return json({ id_protocolo: '' }, 200);
  }
});
