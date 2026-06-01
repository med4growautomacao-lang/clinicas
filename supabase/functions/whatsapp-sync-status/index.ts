// whatsapp-sync-status
//
// Reconciliacao periodica entre o estado local em whatsapp_instances e o estado
// real reportado pela uazapi via GET /instance/all (admintoken). Tambem limpa
// webhooks duplicados em cada instancia.
//
// Agendamento: pg_cron 09:00 e 18:00 BRT (12:00 e 21:00 UTC).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const UAZAPI_BASE = Deno.env.get('UAZAPI_BASE_URL') ?? 'https://med4growautomacao.uazapi.com';
const UAZAPI_ADMIN_TOKEN = Deno.env.get('UAZAPI_ADMIN_TOKEN') ?? '';
const N8N_INBOUND_URL = Deno.env.get('N8N_INBOUND_WEBHOOK_URL') ?? '';
const N8N_TRACKING_URL = Deno.env.get('N8N_TRACKING_WEBHOOK_URL') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const HTTP_TIMEOUT_MS = 10000;

// Normaliza numero brasileiro: tira non-digits, remove 9 do meio quando 13 digitos.
function normalizeBrazilianPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let phone = String(raw).split('@')[0].replace(/\D/g, '');
  if (!phone) return null;
  phone = phone.replace(/^0+/, '');
  const stripExtra9 = (d: string): string => {
    if (d.length === 13 && d.startsWith('55')) {
      const c = d.slice(0, 2), ddd = d.slice(2, 4);
      let rest = d.slice(4);
      if (rest.startsWith('9')) rest = rest.slice(1);
      return c + ddd + rest;
    }
    return d;
  };
  if (phone.startsWith('55')) return stripExtra9(phone);
  if (phone.length === 10 || phone.length === 11) { phone = '55' + phone; return stripExtra9(phone); }
  return phone;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), HTTP_TIMEOUT_MS);
  try { return await fetch(url, { ...init, signal: ctrl.signal }); }
  finally { clearTimeout(timer); }
}

async function fetchUazapiAll(): Promise<any[]> {
  const res = await fetchWithTimeout(`${UAZAPI_BASE}/instance/all`, {
    method: 'GET',
    headers: { Accept: 'application/json', admintoken: UAZAPI_ADMIN_TOKEN },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`uazapi_${res.status}: ${text.slice(0, 200)}`);
  const data = JSON.parse(text);
  return Array.isArray(data) ? data : [];
}

interface Webhook {
  id: string;
  url: string;
  events: string[];
  enabled: boolean;
}

async function listInstanceWebhooks(api_token: string): Promise<Webhook[]> {
  const res = await fetchWithTimeout(`${UAZAPI_BASE}/webhook`, {
    method: 'GET',
    headers: { Accept: 'application/json', token: api_token },
  });
  if (!res.ok) throw new Error(`get_webhooks_${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

async function deleteWebhook(api_token: string, id: string): Promise<boolean> {
  const res = await fetchWithTimeout(`${UAZAPI_BASE}/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', token: api_token },
    body: JSON.stringify({ action: 'delete', id }),
  });
  return res.ok;
}

// Identifica os 3 URLs esperados por instancia. Webhook com URL diferente desses
// e mantido (pode ser config customizada do cliente).
function expectedUrls(): string[] {
  return [
    `${SUPABASE_URL}/functions/v1/uazapi-events`,
    N8N_INBOUND_URL,
    N8N_TRACKING_URL,
  ].filter((u) => !!u);
}

// Para cada URL esperado, deixa apenas 1 webhook ativo. Apaga duplicatas.
// URLs nao esperados sao deixados intactos.
async function dedupeWebhooks(api_token: string): Promise<{ removed: number; total_before: number; duplicates: { url: string; kept: string; removed: string[] }[] }> {
  const webhooks = await listInstanceWebhooks(api_token);
  const expected = new Set(expectedUrls());

  const byUrl = new Map<string, Webhook[]>();
  for (const wh of webhooks) {
    if (!wh?.url || !wh?.id) continue;
    if (!expected.has(wh.url)) continue;
    const list = byUrl.get(wh.url) ?? [];
    list.push(wh);
    byUrl.set(wh.url, list);
  }

  let removed = 0;
  const duplicates: { url: string; kept: string; removed: string[] }[] = [];
  for (const [url, dupes] of byUrl) {
    if (dupes.length <= 1) continue;
    const kept = dupes[0];
    const removedIds: string[] = [];
    for (let i = 1; i < dupes.length; i++) {
      const ok = await deleteWebhook(api_token, dupes[i].id);
      if (ok) { removed++; removedIds.push(dupes[i].id); }
    }
    duplicates.push({ url, kept: kept.id, removed: removedIds });
  }
  return { removed, total_before: webhooks.length, duplicates };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (!UAZAPI_ADMIN_TOKEN) return json({ success: false, error: 'UAZAPI_ADMIN_TOKEN nao configurado' }, 500);

  const supa = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');

  // === Parte 1: Reconciliacao de status ===
  let uazapiList: any[];
  try { uazapiList = await fetchUazapiAll(); }
  catch (e: any) { return json({ success: false, error: e?.message ?? 'uazapi_fetch_failed' }, 502); }

  const uazById = new Map<string, any>();
  for (const it of uazapiList) { if (it?.id) uazById.set(it.id, it); }

  const { data: locals, error: localErr } = await supa
    .from('whatsapp_instances')
    .select('id, clinic_id, api_id, api_token, status, attempt_id, phone_number')
    .not('api_id', 'is', null);
  if (localErr) return json({ success: false, error: localErr.message }, 500);

  type Reconcile = { instance_id: string; clinic_id: string; from: string; to: string; reason: string };
  const reconciled: Reconcile[] = [];
  const notFoundOnUazapi: string[] = [];

  for (const local of locals ?? []) {
    const remote = uazById.get(local.api_id);
    if (!remote) {
      notFoundOnUazapi.push(local.id);
      if (local.status !== 'disconnected') {
        const { error } = await supa.from('whatsapp_instances').update({ status: 'disconnected', last_error: 'sync_cron: instancia nao encontrada na uazapi' }).eq('id', local.id);
        if (!error) {
          reconciled.push({ instance_id: local.id, clinic_id: local.clinic_id, from: local.status, to: 'disconnected', reason: 'missing_on_uazapi' });
          await supa.from('whatsapp_events').insert({ clinic_id: local.clinic_id, instance_id: local.id, attempt_id: local.attempt_id, event_type: 'sync_correction', source: 'sync_cron', payload: { from: local.status, to: 'disconnected', reason: 'missing_on_uazapi' } });
        }
      }
      continue;
    }
    const remoteStatus = String(remote.status ?? '').toLowerCase();
    const remotePhone = normalizeBrazilianPhone(remote.owner);

    if (remoteStatus === 'connected' && local.status !== 'connected') {
      if (local.status === 'disconnected') await supa.from('whatsapp_instances').update({ status: 'connecting' }).eq('id', local.id);
      const updates: Record<string, unknown> = { status: 'connected' };
      if (remotePhone && remotePhone !== local.phone_number) updates.phone_number = remotePhone;
      const { error } = await supa.from('whatsapp_instances').update(updates).eq('id', local.id);
      if (!error) {
        reconciled.push({ instance_id: local.id, clinic_id: local.clinic_id, from: local.status, to: 'connected', reason: 'uazapi_says_connected' });
        await supa.from('whatsapp_events').insert({ clinic_id: local.clinic_id, instance_id: local.id, event_type: 'sync_correction', source: 'sync_cron', payload: { from: local.status, to: 'connected', reason: 'uazapi_says_connected', phone_updated: !!updates.phone_number } });
      }
      continue;
    }

    // Status iguais mas phone_number faltando localmente: preenche
    if (remoteStatus === 'connected' && local.status === 'connected' && remotePhone && !local.phone_number) {
      const { error } = await supa.from('whatsapp_instances').update({ phone_number: remotePhone }).eq('id', local.id);
      if (!error) {
        reconciled.push({ instance_id: local.id, clinic_id: local.clinic_id, from: 'connected', to: 'connected', reason: 'phone_filled' });
        await supa.from('whatsapp_events').insert({ clinic_id: local.clinic_id, instance_id: local.id, event_type: 'sync_correction', source: 'sync_cron', payload: { reason: 'phone_filled', phone_number: remotePhone } });
      }
    }
    if ((remoteStatus === 'disconnected' || remoteStatus === 'loggedout') && local.status !== 'disconnected') {
      const { error } = await supa.from('whatsapp_instances').update({ status: 'disconnected', last_error: 'sync_cron: uazapi reportou desconectado' }).eq('id', local.id);
      if (!error) {
        reconciled.push({ instance_id: local.id, clinic_id: local.clinic_id, from: local.status, to: 'disconnected', reason: 'uazapi_says_disconnected' });
        await supa.from('whatsapp_events').insert({ clinic_id: local.clinic_id, instance_id: local.id, attempt_id: local.attempt_id, event_type: 'sync_correction', source: 'sync_cron', payload: { from: local.status, to: 'disconnected', reason: 'uazapi_says_disconnected', remote_reason: remote.lastDisconnectReason ?? null } });
      }
      continue;
    }
  }

  // === Parte 2: Dedup de webhooks por instancia ===
  // Roda em sequencia (30 instancias × ~500ms = ~15s, dentro do budget da edge)
  type WhSummary = { instance_id: string; clinic_id: string; removed: number; total_before: number };
  const webhookCleanups: WhSummary[] = [];
  let webhookErrors = 0;

  for (const local of locals ?? []) {
    if (!local.api_token) continue;
    // Pula instancias que nao existem na uazapi (ja apagadas)
    if (!uazById.has(local.api_id)) continue;
    try {
      const res = await dedupeWebhooks(local.api_token);
      if (res.removed > 0) {
        webhookCleanups.push({ instance_id: local.id, clinic_id: local.clinic_id, removed: res.removed, total_before: res.total_before });
        await supa.from('whatsapp_events').insert({
          clinic_id: local.clinic_id, instance_id: local.id, event_type: 'webhook_dedupe', source: 'sync_cron',
          payload: { removed: res.removed, total_before: res.total_before, duplicates: res.duplicates },
        });
      }
    } catch (e) {
      webhookErrors++;
      console.warn('[sync-status] webhook dedupe failed', local.id, String(e));
    }
  }

  const summary = {
    success: true,
    locals_checked: locals?.length ?? 0,
    uazapi_total: uazapiList.length,
    reconciled_count: reconciled.length,
    not_found_on_uazapi: notFoundOnUazapi.length,
    reconciled,
    webhook_cleanups: webhookCleanups,
    webhook_errors: webhookErrors,
  };
  console.log('[sync-status]', summary);
  return json(summary);
});
