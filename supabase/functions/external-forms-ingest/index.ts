// external-forms-ingest — captação NATIVA de leads de formulário externo (site do cliente que
// dispara por webhook, sem o nosso script). Substitui o papel do n8n "Webhook Forms | Leads Captados":
// aquele fluxo jogava numa planilha Google; este grava direto no nosso banco (leads → ticket →
// touchpoint, tudo via triggers do INSERT).
//
// Contrato: POST público, autenticado por um TOKEN opaco da clínica na query (?k=<token>) — assim
// qualquer ferramenta de formulário consegue disparar (não exige header custom). O token mapeia p/
// a clínica em clinic_external_integrations. URL única por clínica, sem expor clinic_id.
//
// Aceita corpo JSON ou x-www-form-urlencoded. Os nomes de campo variam por ferramenta, então:
//   1) honra field_map configurado (name/phone/email); 2) cai no fuzzy match como a régua do n8n.
// UTMs saem da querystring de body.url (padrão do n8n) e/ou de chaves utm_* no topo do corpo.
//
// Falha vai para a Central de Erros (log_system_error) — o n8n só reclamava para dentro dele mesmo.

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
      p_scope: 'external-forms-ingest',
      p_code: code,
      p_title: title,
      p_level: level,
      p_clinic_id: clinicId,
      p_context: ctx ?? {},
      p_is_monitor: false,
    });
  } catch (e) {
    console.error('[external-forms-ingest] falhou ao registrar erro', e);
  }
}

// utm_medium (Posicionamento) carrega a PLATAFORMA: "Facebook_Mobile_Reels" -> facebook,
// "Instagram_Reels" -> instagram. Encaixa no enum já existente leads.ad_platform (instagram/facebook/
// whatsapp) que hoje só o CTWA preenche. O texto cru do posicionamento continua no ledger raw.
function derivarPlataforma(utmMedium: string, utmSource: string): string | null {
  const m = (utmMedium ?? '').toLowerCase();
  const s = (utmSource ?? '').trim().toLowerCase();
  if (m.includes('instagram') || s === 'instagram' || s === 'ig') return 'instagram';
  if (m.includes('facebook') || m.includes('messenger') || /(^|_)fb(_|$)/.test(m)) return 'facebook';
  return null;
}

// utm_source (+ click ids) -> a ORIGEM do nosso modelo. NULL = orgânico (não inventamos origem).
function mapearOrigem(utmSource: string, gclid: string, fbclid: string): string | null {
  const s = (utmSource ?? '').trim().toLowerCase();
  if (gclid) return 'google_ads';
  if (fbclid) return 'meta_ads';
  if (s === 'google' || s === 'google_ads' || s === 'googleads' || s === 'adwords') return 'google_ads';
  if (s === 'facebook' || s === 'fb' || s === 'meta' || s === 'facebook_ads' || s === 'meta_ads' || s === 'metaads') return 'meta_ads';
  if (s === 'instagram' || s === 'ig') return 'instagram';
  return null;
}

function parseQuery(url: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!url || typeof url !== 'string' || !url.includes('?')) return out;
  try {
    const qs = url.split('?')[1];
    for (const [k, v] of new URLSearchParams(qs)) out[k.toLowerCase()] = v;
  } catch { /* querystring malformada: ignora */ }
  return out;
}

// Chaves de metadado NUNCA são o nome/telefone/email do lead. Excluí-las antes do match evita o
// clássico "form_name contém 'name' → vira o nome do lead". (Payload real do cliente traz form_name,
// form_id, utm_* no mesmo corpo.)
const META_KEYS = new Set(['url', 'k', 'token', 'form_id', 'form_name', 'utm_id', 'gclid', 'fbclid']);
function isLeadField(key: string): boolean {
  const lk = key.toLowerCase();
  if (META_KEYS.has(lk)) return false;
  if (lk.startsWith('utm_')) return false;
  return true;
}

// Acha uma chave do corpo por fragmento (case-insensitive), como o "findField" do n8n,
// ignorando as chaves de metadado.
function findByFragments(body: Record<string, unknown>, fragments: string[]): string {
  const keys = Object.keys(body).filter(isLeadField);
  const k = keys.find((key) => fragments.some((f) => key.toLowerCase().includes(f)));
  const v = k ? body[k] : '';
  return v == null ? '' : String(v).trim();
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const reqUrl = new URL(req.url);
  const token = (reqUrl.searchParams.get('k') || reqUrl.searchParams.get('token') || '').trim();

  const supa = createClient(SUPABASE_URL, SERVICE_KEY);

  // ── Corpo: JSON ou x-www-form-urlencoded ────────────────────────────────────────────────────
  let body: Record<string, unknown> = {};
  try {
    const raw = await req.text();
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        const params = new URLSearchParams(raw);
        for (const [k, v] of params) body[k] = v;
      }
    }
  } catch {
    return json({ ok: false, error: 'invalid_body' }, 400);
  }
  // Token também aceito no corpo (algumas ferramentas só mandam body)
  const effToken = token || String(body['k'] ?? body['token'] ?? '').trim();
  if (!effToken) return json({ ok: false, error: 'missing_token' }, 401);

  // ── Resolve a clínica pelo token ────────────────────────────────────────────────────────────
  const { data: cfg, error: cfgErr } = await supa
    .from('clinic_external_integrations')
    .select('clinic_id, field_map, capture_enabled')
    .eq('capture_token', effToken)
    .maybeSingle();

  if (cfgErr) {
    await registrarErro('config_lookup_falhou', 'Falha ao resolver clínica pelo token do webhook', 'error', null, { erro: cfgErr.message });
    return json({ ok: false, error: 'server_error' }, 200);
  }
  if (!cfg) return json({ ok: false, error: 'invalid_token' }, 401);
  if (cfg.capture_enabled === false) return json({ ok: false, error: 'capture_disabled' }, 403);

  const clinicId = cfg.clinic_id as string;
  const fieldMap = (cfg.field_map ?? {}) as Record<string, string>;

  try {
    // ── Extração de nome/telefone/email: field_map primeiro, fuzzy depois ─────────────────────
    const mapped = (key: string): string => {
      const src = fieldMap?.[key];
      if (src && body[src] != null) return String(body[src]).trim();
      return '';
    };
    const nome =
      mapped('name') ||
      findByFragments(body, ['nome', 'name']) ||
      [findByFragments(body, ['first_name']), findByFragments(body, ['last_name'])].filter(Boolean).join(' ').trim();
    const telefone =
      mapped('phone') ||
      findByFragments(body, ['telefone', 'whatsapp', 'celular', 'phone', 'fone', 'tel', 'field_ab']);
    const email = mapped('email') || findByFragments(body, ['e-mail', 'email', 'mail']);

    // ── UTMs: da querystring de body.url e/ou de chaves utm_* no topo ──────────────────────────
    const urlParams = parseQuery(String(body['url'] ?? ''));
    const pick = (k: string) => (urlParams[k] || String(body[k] ?? '')).trim();
    const utmSource = pick('utm_source');
    const utmCampaign = pick('utm_campaign');
    const utmMedium = pick('utm_medium');
    const utmContent = pick('utm_content');
    const utmTerm = pick('utm_term');
    const gclid = pick('gclid');
    const fbclid = pick('fbclid');

    const origem = mapearOrigem(utmSource, gclid, fbclid);
    const adPlatform = derivarPlataforma(utmMedium, utmSource);

    // ── Ingestão ──────────────────────────────────────────────────────────────────────────────
    const { data: res, error: rpcErr } = await supa.rpc('ingest_external_form_lead', {
      p_clinic_id: clinicId,
      p_name: nome || null,
      p_phone: telefone || null,
      p_email: email || null,
      p_source: origem,
      p_campaign: utmCampaign || null,
      p_adset: utmTerm || null,      // no padrão do n8n: Conjunto = utm_term
      p_ad: utmContent || null,      // Anúncio = utm_content
      p_term: utmMedium || null,     // Posicionamento = utm_medium
      p_utm_source: utmSource || null,
      p_ad_platform: adPlatform,     // plataforma derivada do posicionamento -> leads.ad_platform
      p_raw: body,
    });

    if (rpcErr) {
      await registrarErro(
        'gravacao_do_lead_falhou',
        'Lead de formulário externo chegou mas NÃO foi gravado',
        'critical', clinicId,
        { erro: rpcErr.message, tem_telefone: !!telefone, tem_email: !!email },
      );
      return json({ ok: false, error: 'ingest_failed' }, 200);
    }

    if (res?.error) {
      // Submissão sem identidade mínima: registrada no ledger, mas não virou lead.
      await registrarErro(
        'submissao_sem_identidade',
        'Formulário externo sem telefone nem e-mail — não virou lead',
        'warning', clinicId,
        { motivo: res.error, campos_recebidos: Object.keys(body) },
      );
      return json({ ok: false, error: res.error }, 200);
    }

    // Métrica leve (best-effort): conta e carimba a última captação.
    await supa.rpc('bump_external_capture', { p_clinic_id: clinicId }).then(() => {}, () => {});

    return json({ ok: true, lead_id: res?.lead_id ?? null, created: res?.created ?? false });

  } catch (e) {
    await registrarErro(
      'ciclo_falhou',
      'Erro inesperado no webhook de captação externa',
      'critical', clinicId,
      { erro: e instanceof Error ? e.message : String(e) },
    );
    return json({ ok: false, error: 'unexpected' }, 200);
  }
});
