// external-crm-status — ENTRADA de Lead/Ganho/Perdido vindos do CRM do cliente (ex.: Clint).
// Substitui o papel dos fluxos n8n "Clint | Status Ganho/Perdido": aqueles jogavam numa planilha;
// este reflete o status no NOSSO banco, achando o lead (telefone->email), fazendo upsert se não
// existir (como o appendOrUpdate da planilha) e finalizando o ticket via finalize_ticket.
//
// Auth: TOKEN opaco da clínica (crm_token) na query (?k=). O tipo do evento vem de
// ?tipo=lead|ganho|perdido (setado pelo n8n) ou é inferido do payload (deal_status=WON -> ganho;
// deal_lost_status -> perdido; deal_status aberto/novo -> lead).
//
// ⚠️ tipo=lead NÃO é desfecho: só garante lead + ticket ABERTO na etapa WHATSAPP (nunca chama
// finalize_ticket). É a entrada de quem cria o negócio no CRM antes de qualquer resultado.
// A etapa NÃO é escolhida aqui nem pelo slug dentro da RPC: quem decide é a marca de transação
// `app.crm_intake`, que desliga o trg_auto_open_ticket_forms e deixa a RPC abrir o ticket.
// O caminho de FORMULÁRIO continua sendo o external-forms-ingest (outro token, outro dialeto).
//
// Falha -> Central de Erros (log_system_error).

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
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

async function registrarErro(code: string, title: string, level: string, clinicId: string | null, ctx: unknown): Promise<void> {
  try {
    const supa = createClient(SUPABASE_URL, SERVICE_KEY);
    await supa.rpc('log_system_error', {
      p_scope: 'external-crm-status', p_code: code, p_title: title,
      p_level: level, p_clinic_id: clinicId, p_context: ctx ?? {}, p_is_monitor: false,
    });
  } catch (e) {
    console.error('[external-crm-status] falhou ao registrar erro', e);
  }
}

function mapearOrigem(utmSource: string): string | null {
  const s = (utmSource ?? '').trim().toLowerCase();
  if (s === 'google' || s === 'google_ads' || s === 'googleads' || s === 'adwords') return 'google_ads';
  if (s === 'facebook' || s === 'fb' || s === 'meta' || s === 'facebook_ads' || s === 'meta_ads' || s === 'metaads') return 'meta_ads';
  if (s === 'instagram' || s === 'ig') return 'instagram';
  return null;
}

function derivarPlataforma(utmMedium: string, utmSource: string): string | null {
  const m = (utmMedium ?? '').toLowerCase();
  const s = (utmSource ?? '').trim().toLowerCase();
  if (m.includes('instagram') || s === 'instagram' || s === 'ig') return 'instagram';
  if (m.includes('facebook') || m.includes('messenger') || /(^|_)fb(_|$)/.test(m)) return 'facebook';
  return null;
}

// Fuzzy fallback: acha uma chave por fragmento, ignorando metadados/deal_*/utm_*.
function findByFragments(body: Record<string, unknown>, fragments: string[]): string {
  const keys = Object.keys(body).filter((k) => {
    const lk = k.toLowerCase();
    return !lk.startsWith('utm_') && !lk.startsWith('deal_') && !lk.startsWith('contact_utm');
  });
  const k = keys.find((key) => fragments.some((f) => key.toLowerCase().includes(f)));
  const v = k ? body[k] : '';
  return v == null ? '' : String(v).trim();
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const reqUrl = new URL(req.url);
  const token = (reqUrl.searchParams.get('k') || reqUrl.searchParams.get('token') || '').trim();
  const tipoParam = (reqUrl.searchParams.get('tipo') || '').trim().toLowerCase();

  const supa = createClient(SUPABASE_URL, SERVICE_KEY);

  let body: Record<string, unknown> = {};
  try {
    const raw = await req.text();
    if (raw) {
      try { body = JSON.parse(raw); }
      catch { const p = new URLSearchParams(raw); for (const [k, v] of p) body[k] = v; }
    }
  } catch {
    return json({ ok: false, error: 'invalid_body' }, 400);
  }

  const effToken = token || String(body['k'] ?? body['token'] ?? '').trim();
  if (!effToken) return json({ ok: false, error: 'missing_token' }, 401);

  const { data: cfg, error: cfgErr } = await supa
    .from('clinic_external_integrations')
    .select('clinic_id, won_enabled, lost_enabled, lead_enabled')
    .eq('crm_token', effToken)
    .maybeSingle();

  if (cfgErr) {
    await registrarErro('config_lookup_falhou', 'Falha ao resolver clínica pelo crm_token', 'error', null, { erro: cfgErr.message });
    return json({ ok: false, error: 'server_error' }, 200);
  }
  if (!cfg) return json({ ok: false, error: 'invalid_token' }, 401);

  const clinicId = cfg.clinic_id as string;
  const txt = (k: string) => String(body[k] ?? '').trim();

  try {
    // ── Decide o tipo: ?tipo= da QUERYSTRING, senão infere do payload ──────────────────────────
    // ⚠️ O tipo NÃO é aceito pelo corpo, de propósito. `tipo` é nome comum em payload de CRM
    // brasileiro (tipo de contato, tipo de serviço), e um valor "Perdido" querendo dizer outra
    // coisa fecharia o ticket como perda de verdade, com data e tudo. Allowlist não protege aqui:
    // o valor perigoso é exatamente um dos literais válidos. A URL que a tela entrega sempre traz
    // `&tipo=`, então o fallback pelo corpo resolveria um problema que ninguém tem.
    const tipoEff = tipoParam;
    const dealStatus = txt('deal_status').toUpperCase();
    const dealLostStatus = txt('deal_lost_status');
    // Allowlist FECHADA de "negócio em aberto" -> lead. Inferir lead de qualquer status desconhecido
    // faria todo evento não reconhecido virar lead novo (e abrir ticket) em vez de falhar visível.
    const STATUS_ABERTO = ['OPEN', 'NEW', 'CREATED', 'LEAD', 'ABERTO', 'NOVO'];
    const outcome: 'ganho' | 'perdido' | 'lead' | null =
      tipoEff === 'ganho' ? 'ganho' :
      tipoEff === 'perdido' ? 'perdido' :
      tipoEff === 'lead' ? 'lead' :
      dealStatus === 'WON' ? 'ganho' :
      (dealLostStatus || ['LOST', 'LOSE', 'LOSS'].includes(dealStatus)) ? 'perdido' :
      STATUS_ABERTO.includes(dealStatus) ? 'lead' : null;

    if (!outcome) return json({ ok: false, error: 'tipo_indeterminado' }, 200);
    // Gate FAIL-CLOSED: `!cfg.x`, não `cfg.x === false`. Com a comparação estrita, um valor
    // null/undefined (coluna nova ainda não migrada, linha legada, bundle antigo cujo .select()
    // não pedia a coluna) passa direto e liga a integração para quem nunca a habilitou.
    if (outcome === 'ganho' && !cfg.won_enabled) return json({ ok: false, error: 'won_disabled' }, 403);
    if (outcome === 'perdido' && !cfg.lost_enabled) return json({ ok: false, error: 'lost_disabled' }, 403);
    if (outcome === 'lead' && !cfg.lead_enabled) return json({ ok: false, error: 'lead_disabled' }, 403);

    // ── Campos do contato (padrão Clint contact_*), com fuzzy de fallback ──────────────────────
    const phone = txt('contact_phone') || findByFragments(body, ['telefone', 'whatsapp', 'celular', 'phone']);
    const email = txt('contact_email') || findByFragments(body, ['e-mail', 'email', 'mail']);
    const name  = txt('contact_name')  || findByFragments(body, ['nome', 'name']);
    const lossReason = outcome === 'perdido' ? (dealLostStatus || txt('deal_lost_reason') || null) : null;

    // Atribuição (só usada se precisar CRIAR o lead)
    const utmSource = txt('contact_utm_source') || txt('utm_source');
    const utmMedium = txt('contact_utm_medium') || txt('utm_medium');
    const origem = mapearOrigem(utmSource);
    const adPlatform = derivarPlataforma(utmMedium, utmSource);

    // O corpo vai INTEIRO para external_crm_events.raw (ledger). Como o token também é aceito
    // pelo corpo, ele acabaria gravado em texto puro em milhares de linhas, e não há rotação de
    // crm_token na UI (só o capture_token tem "Gerar novo endereço"). Tira antes de persistir.
    const { k: _k, token: _token, ...rawSemSegredo } = body;

    const { data: res, error: rpcErr } = await supa.rpc('apply_external_crm_outcome', {
      p_clinic_id: clinicId,
      p_outcome: outcome,
      p_phone: phone || null,
      p_email: email || null,
      p_name: name || null,
      p_loss_reason: lossReason,
      p_source: origem,
      p_campaign: txt('contact_utm_campaign') || txt('utm_campaign') || null,
      p_adset: txt('contact_utm_term') || txt('utm_term') || null,
      p_ad: txt('contact_utm_content') || txt('utm_content') || null,
      p_ad_platform: adPlatform,
      p_raw: rawSemSegredo,
    });

    if (rpcErr) {
      await registrarErro('gravacao_outcome_falhou', 'Evento do CRM chegou mas NÃO foi aplicado', 'critical', clinicId,
        { erro: rpcErr.message, outcome, tem_telefone: !!phone, tem_email: !!email });
      return json({ ok: false, error: 'apply_failed' }, 200);
    }

    if (res?.error) {
      const level = res.error === 'sem_identidade' ? 'warning' : 'error';
      await registrarErro('evento_nao_aplicado', 'Evento do CRM não pôde ser aplicado', level, clinicId,
        { motivo: res.error, outcome, campos: Object.keys(body) });
      return json({ ok: false, error: res.error }, 200);
    }

    return json({
      ok: true, outcome,
      lead_id: res?.lead_id ?? null,
      ticket_id: res?.ticket_id ?? null,
      created_lead: res?.created_lead ?? false,
      created_ticket: res?.created_ticket ?? false,
      skipped: res?.skipped ?? false,
    });

  } catch (e) {
    await registrarErro('ciclo_falhou', 'Erro inesperado no webhook do CRM', 'critical', clinicId,
      { erro: e instanceof Error ? e.message : String(e) });
    return json({ ok: false, error: 'unexpected' }, 200);
  }
});
