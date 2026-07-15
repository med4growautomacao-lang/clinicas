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
import { mapearAtribuicao } from '../_shared/attribution.ts';

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

// Origem e convenção de UTM moram em _shared/attribution.ts — a MESMA régua da site-tracking.
// Antes cada rota tinha a sua e o mesmo UTM caía em colunas diferentes conforme o caminho.

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
const META_KEYS = new Set([
  'url', 'page url', 'page_url', 'pageurl', 'k', 'token', 'form_id', 'form_name', 'utm_id',
  'gclid', 'fbclid', 'wbraid', 'gbraid', 'rast_id', 'rastracking_visitor_id',
  'remote ip', 'user agent', 'powered by', 'date', 'time',
]);
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

    // ── UTMs: da querystring da URL da página e/ou de chaves utm_* no topo ─────────────────────
    // O nome da chave varia por ferramenta: Elementor manda "Page URL"; outras mandam "url".
    // 🐛 Pego no piloto (Rs cafe, 15/07): só se lia body.url → a querystring do Elementor era
    //    ignorada e o rast_id/gclid que a lib injeta na URL se perdiam.
    const pageUrl = String(body['url'] ?? body['Page URL'] ?? body['page_url'] ?? body['pageUrl'] ?? '');
    const urlParams = parseQuery(pageUrl);
    const pick = (k: string) => (urlParams[k] || String(body[k] ?? '')).trim();
    const utms = {
      utm_source: pick('utm_source'),
      utm_medium: pick('utm_medium'),
      utm_campaign: pick('utm_campaign'),
      utm_content: pick('utm_content'),
      utm_term: pick('utm_term'),
    };
    const gclid = pick('gclid');
    const fbclid = pick('fbclid');

    // rast_id = identidade do visitante (cookie de 2 anos). O script do site injeta o campo
    // oculto `rastracking_visitor_id` em todo formulário — é o que liga este form aos toques
    // anteriores da mesma pessoa (jornada multi-toque). Sem isso o lead nasce órfão de jornada.
    const rastId = pick('rast_id') || String(body['rastracking_visitor_id'] ?? '').trim();

    const at = mapearAtribuicao(utms, gclid, fbclid);

    // ── Ingestão ──────────────────────────────────────────────────────────────────────────────
    // O RPC recebe SEMÂNTICA (campanha/conjunto/anúncio/termo) e roteia para g_*/fb_* pela origem.
    const { data: res, error: rpcErr } = await supa.rpc('ingest_external_form_lead', {
      p_clinic_id: clinicId,
      p_name: nome || null,
      p_phone: telefone || null,
      p_email: email || null,
      p_source: at.origem,
      p_campaign: at.campaign,
      p_adset: at.adset,
      p_ad: at.ad,
      p_term: at.term,
      p_utm_source: utms.utm_source || null,
      p_ad_platform: at.adPlatform,
      p_raw: body,
      p_g_clid: gclid || null,       // sem isto o gclid ficava só no raw — inútil p/ conversão offline
      p_fb_clid: fbclid || null,
      p_rast_id: rastId || null,
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
