// WhatsApp connection orchestrator.
//
// Substitui o n8n + whatsapp-bridge no caminho de criacao/conexao/cancelamento.
// State machine, idempotencia via cooldown, timeout em todas as chamadas externas,
// auditoria em whatsapp_events e zero exposicao de tokens nas respostas.
//
// Actions:
//   - 'start':       garante instancia na uazapi, dispara connect, retorna estado atual
//   - 'cancel':      aborta tentativa em curso (so age se status='connecting')
//   - 'disconnect':  desconecta sessao conectada (so age se status='connected')
//   - 'reset':       /instance/reset na uazapi (recovery de runtime preso)
//   - 'status':      somente leitura (proxy para frontend publico)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { ownerToPhone } from '../_shared/phone.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const UAZAPI_BASE = Deno.env.get('UAZAPI_BASE_URL') ?? 'https://med4growautomacao.uazapi.com';
const UAZAPI_ADMIN_TOKEN = Deno.env.get('UAZAPI_ADMIN_TOKEN') ?? '';
const N8N_INBOUND_URL = Deno.env.get('N8N_INBOUND_WEBHOOK_URL') ?? '';

// Tracking de anúncio: instância nova nasce apontando para a edge NATIVA, não mais para o n8n.
// Sem isto, o secret N8N_TRACKING_WEBHOOK_URL faria cada cliente novo renascer no fluxo antigo —
// o que perde o clique inteiro sempre que a Graph API recusa o token (ver ctwa-tracking).
const CTWA_TRACKING_URL = Deno.env.get('CTWA_TRACKING_WEBHOOK_URL')
  ?? `${Deno.env.get('SUPABASE_URL') ?? ''}/functions/v1/ctwa-tracking`;

const COOLDOWN_SECONDS = 15;
const HTTP_TIMEOUT_MS = 5000;

type Action = 'start' | 'cancel' | 'disconnect' | 'reset' | 'status';

interface InstanceRow {
  id: string;
  clinic_id: string;
  api_id: string | null;
  api_token: string;
  status: 'disconnected' | 'connecting' | 'connected';
  qr_code: string | null;
  phone_number: string | null;
  attempt_id: string | null;
  attempt_started_at: string | null;
  last_event_at: string | null;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), HTTP_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

interface UazapiCallResult {
  ok: boolean;
  status: number;
  data: any;
  error?: string;
}

async function uazapi(
  path: string,
  init: { method?: string; token?: string; admin?: boolean; body?: unknown },
): Promise<UazapiCallResult> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (init.admin) {
    if (!UAZAPI_ADMIN_TOKEN) {
      return { ok: false, status: 500, data: null, error: 'UAZAPI_ADMIN_TOKEN nao configurado' };
    }
    headers.admintoken = UAZAPI_ADMIN_TOKEN;
  } else if (init.token) {
    headers.token = init.token;
  }
  let attempt = 0;
  while (true) {
    attempt++;
    try {
      const res = await fetchWithTimeout(`${UAZAPI_BASE}${path}`, {
        method: init.method ?? 'POST',
        headers,
        body: init.body ? JSON.stringify(init.body) : undefined,
      });
      const text = await res.text();
      let data: any = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = text; }

      // 4xx nao retry; 5xx ou timeout retry com backoff
      if (res.ok) return { ok: true, status: res.status, data };
      if (res.status >= 400 && res.status < 500) {
        return { ok: false, status: res.status, data, error: typeof data === 'object' && data?.error ? data.error : `http_${res.status}` };
      }
      if (attempt >= 3) return { ok: false, status: res.status, data, error: typeof data === 'object' && data?.error ? data.error : `http_${res.status}` };
    } catch (err) {
      if (attempt >= 3) return { ok: false, status: 0, data: null, error: err instanceof Error ? err.message : 'fetch_failed' };
    }
    await new Promise((r) => setTimeout(r, 250 * Math.pow(3, attempt - 1)));
  }
}

async function logEvent(
  supa: SupabaseClient,
  row: { clinic_id: string; instance_id?: string | null; attempt_id?: string | null; event_type: string; source: string; payload?: unknown },
): Promise<void> {
  try {
    await supa.from('whatsapp_events').insert({
      clinic_id: row.clinic_id,
      instance_id: row.instance_id ?? null,
      attempt_id: row.attempt_id ?? null,
      event_type: row.event_type,
      source: row.source,
      payload: row.payload ?? null,
    });
  } catch (e) {
    console.error('[orchestrator] failed to log event', e);
  }
}

async function resolveInstance(
  supa: SupabaseClient,
  body: { clinic_id?: string; connect_token?: string },
): Promise<{ row: InstanceRow | null; clinic_id?: string }> {
  if (body.connect_token) {
    const { data } = await supa
      .from('whatsapp_instances')
      .select('id, clinic_id, api_id, api_token, status, qr_code, phone_number, attempt_id, attempt_started_at, last_event_at')
      .eq('connect_token', body.connect_token)
      .maybeSingle();
    return { row: (data as InstanceRow | null) ?? null, clinic_id: data?.clinic_id };
  }
  if (body.clinic_id) {
    const { data } = await supa
      .from('whatsapp_instances')
      .select('id, clinic_id, api_id, api_token, status, qr_code, phone_number, attempt_id, attempt_started_at, last_event_at')
      .eq('clinic_id', body.clinic_id)
      .maybeSingle();
    return { row: (data as InstanceRow | null) ?? null, clinic_id: body.clinic_id };
  }
  return { row: null };
}

// Garante registro local em whatsapp_instances. Cria com defaults se nao existir.
async function ensureLocalRow(supa: SupabaseClient, clinic_id: string): Promise<InstanceRow> {
  const { data: existing } = await supa
    .from('whatsapp_instances')
    .select('id, clinic_id, api_id, api_token, status, qr_code, phone_number, attempt_id, attempt_started_at, last_event_at')
    .eq('clinic_id', clinic_id)
    .maybeSingle();
  if (existing) return existing as InstanceRow;

  const { data: inserted, error } = await supa
    .from('whatsapp_instances')
    .insert({ clinic_id, api_token: '', status: 'disconnected' })
    .select('id, clinic_id, api_id, api_token, status, qr_code, phone_number, attempt_id, attempt_started_at, last_event_at')
    .single();
  if (error || !inserted) throw new Error(`failed_to_create_instance_row: ${error?.message ?? 'unknown'}`);
  return inserted as InstanceRow;
}

// Garante instancia correspondente na uazapi e devolve {api_id, api_token} validos.
// Estrategia: lista todas com admintoken, filtra por name === clinic_id. Se nao
// existir, cria via /instance/create.
async function ensureUazapiInstance(
  supa: SupabaseClient,
  row: InstanceRow,
): Promise<{ api_id: string; api_token: string; row: InstanceRow }> {
  // 1) Tenta achar na lista (idempotente)
  const list = await uazapi('/instance/all', { method: 'GET', admin: true });
  if (list.ok && Array.isArray(list.data)) {
    const found = list.data.find((it: any) => it?.name === row.clinic_id);
    if (found?.id && found?.token) {
      if (row.api_id !== found.id || row.api_token !== found.token) {
        const { data: updated } = await supa
          .from('whatsapp_instances')
          .update({ api_id: found.id, api_token: found.token })
          .eq('id', row.id)
          .select('id, clinic_id, api_id, api_token, status, qr_code, phone_number, attempt_id, attempt_started_at, last_event_at')
          .single();
        return { api_id: found.id, api_token: found.token, row: (updated as InstanceRow) ?? row };
      }
      return { api_id: found.id, api_token: found.token, row };
    }
  }

  // 2) Nao existe, cria
  const created = await uazapi('/instance/create', {
    method: 'POST',
    admin: true,
    body: { name: row.clinic_id, adminField01: 'paralello' },
  });
  if (!created.ok || !created.data?.token) {
    throw new Error(`uazapi_create_failed: ${created.error ?? 'no_token'}`);
  }
  const api_id = created.data.instance?.id ?? created.data.id ?? '';
  const api_token = created.data.token;
  const { data: updated } = await supa
    .from('whatsapp_instances')
    .update({ api_id, api_token })
    .eq('id', row.id)
    .select('id, clinic_id, api_id, api_token, status, qr_code, phone_number, attempt_id, attempt_started_at, last_event_at')
    .single();
  return { api_id, api_token, row: (updated as InstanceRow) ?? { ...row, api_id, api_token } };
}

// Configura webhooks na uazapi de forma idempotente:
//  - lista os existentes
//  - se houver duplicatas para um URL esperado, apaga todas exceto a primeira
//  - se faltar algum URL esperado, cria
// URLs nao reconhecidos (configs custom do cliente) ficam intactos.
async function ensureUazapiWebhooks(
  api_token: string,
): Promise<{ created: string[]; removed_duplicates: { url: string; ids: string[] }[] }> {
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
  const eventsUrl = `${SUPABASE_URL}/functions/v1/uazapi-events`;

  let existing: any[] = [];
  try {
    const list = await uazapi('/webhook', { method: 'GET', token: api_token });
    if (list.ok && Array.isArray(list.data)) existing = list.data;
  } catch {
    existing = [];
  }

  const desired = [
    { url: eventsUrl, events: ['connection'], excludeMessages: [] as string[] },
    ...(N8N_INBOUND_URL     ? [{ url: N8N_INBOUND_URL,     events: ['messages'], excludeMessages: ['wasSentByApi'] }] : []),
    ...(CTWA_TRACKING_URL   ? [{ url: CTWA_TRACKING_URL,   events: ['messages'], excludeMessages: ['wasSentByApi'] }] : []),
  ];

  const created: string[] = [];
  const removed_duplicates: { url: string; ids: string[] }[] = [];

  for (const want of desired) {
    const matches = existing.filter((w: any) => w?.url === want.url && w?.id);

    if (matches.length === 0) {
      // Cria
      await uazapi('/webhook', {
        method: 'POST',
        token: api_token,
        body: { action: 'add', enabled: true, url: want.url, events: want.events, excludeMessages: want.excludeMessages },
      });
      created.push(want.url);
      continue;
    }

    if (matches.length > 1) {
      // Mantem o primeiro, apaga os outros
      const removedIds: string[] = [];
      for (let i = 1; i < matches.length; i++) {
        const res = await uazapi('/webhook', {
          method: 'POST',
          token: api_token,
          body: { action: 'delete', id: matches[i].id },
        });
        if (res.ok) removedIds.push(matches[i].id);
      }
      if (removedIds.length > 0) removed_duplicates.push({ url: want.url, ids: removedIds });
    }
    // matches.length === 1 -> idempotente, nao faz nada
  }

  return { created, removed_duplicates };
}

function isWithinCooldown(row: InstanceRow): boolean {
  if (!row.last_event_at) return false;
  const last = new Date(row.last_event_at).getTime();
  return Date.now() - last < COOLDOWN_SECONDS * 1000;
}

async function handleStart(supa: SupabaseClient, row: InstanceRow, source: string): Promise<Response> {
  if (row.status === 'connected') {
    return json({ success: true, status: 'connected', message: 'ja conectado' });
  }

  // Cooldown: se a tentativa atual recebeu evento ha menos de 15s, retorna estado.
  if (row.status === 'connecting' && isWithinCooldown(row)) {
    return json({
      success: true,
      status: 'connecting',
      cooldown: true,
      qr_code: row.qr_code,
      attempt_id: row.attempt_id,
    });
  }

  // Garante instancia na uazapi (cria se necessario)
  let ensured;
  try {
    ensured = await ensureUazapiInstance(supa, row);
  } catch (e: any) {
    await logEvent(supa, {
      clinic_id: row.clinic_id, instance_id: row.id, event_type: 'error', source,
      payload: { stage: 'ensure_uazapi_instance', error: e.message },
    });
    return json({ success: false, error: e.message }, 502);
  }
  row = ensured.row;

  // Configura webhooks (idempotente: cria os que faltam, dedup os duplicados)
  try {
    const whResult = await ensureUazapiWebhooks(ensured.api_token);
    if (whResult.created.length > 0 || whResult.removed_duplicates.length > 0) {
      await logEvent(supa, {
        clinic_id: row.clinic_id, instance_id: row.id, event_type: 'webhook_ensured', source,
        payload: whResult,
      });
    }
  } catch (e) {
    // Falha de webhook nao bloqueia conexao; loga e segue
    await logEvent(supa, {
      clinic_id: row.clinic_id, instance_id: row.id, event_type: 'warning', source,
      payload: { stage: 'ensure_webhooks', error: String(e) },
    });
  }

  // Transiciona local row para 'connecting' (state machine atribui attempt_id automatico)
  if (row.status !== 'connecting') {
    const { data: updated, error } = await supa
      .from('whatsapp_instances')
      .update({ status: 'connecting' })
      .eq('id', row.id)
      .select('id, clinic_id, api_id, api_token, status, qr_code, phone_number, attempt_id, attempt_started_at, last_event_at')
      .single();
    if (error) {
      return json({ success: false, error: `state_transition_failed: ${error.message}` }, 409);
    }
    row = updated as InstanceRow;
  }

  await logEvent(supa, {
    clinic_id: row.clinic_id, instance_id: row.id, attempt_id: row.attempt_id, source,
    event_type: 'connect_requested', payload: { api_id: ensured.api_id },
  });

  // Chama /instance/connect na uazapi
  const connectRes = await uazapi('/instance/connect', {
    method: 'POST',
    token: ensured.api_token,
    body: {},
  });

  if (!connectRes.ok) {
    // 429 -> limite. 4xx -> auth ruim. Marca disconnected pra permitir nova tentativa
    await supa.from('whatsapp_instances').update({
      status: 'disconnected',
      last_error: `connect_failed: ${connectRes.error}`,
    }).eq('id', row.id);
    await logEvent(supa, {
      clinic_id: row.clinic_id, instance_id: row.id, attempt_id: row.attempt_id, source,
      event_type: 'error', payload: { stage: 'instance_connect', status: connectRes.status, error: connectRes.error },
    });
    return json({ success: false, status: 'disconnected', error: connectRes.error, http_status: connectRes.status }, 502);
  }

  // /instance/connect retorna { instance: {qrcode, status,...} }. Salvamos qrcode/qr_expires_at.
  const qrcode = connectRes.data?.instance?.qrcode ?? null;
  if (qrcode) {
    const expiresAt = new Date(Date.now() + 2 * 60 * 1000).toISOString();
    await supa.from('whatsapp_instances').update({
      qr_code: qrcode,
      qr_expires_at: expiresAt,
      last_event_at: new Date().toISOString(),
    }).eq('id', row.id);
    await logEvent(supa, {
      clinic_id: row.clinic_id, instance_id: row.id, attempt_id: row.attempt_id, source,
      event_type: 'qr_received', payload: { has_qr: true },
    });
  }

  return json({ success: true, status: 'connecting', qr_received: !!qrcode, attempt_id: row.attempt_id });
}

async function handleCancel(supa: SupabaseClient, row: InstanceRow, source: string): Promise<Response> {
  if (row.status !== 'connecting') {
    return json({ success: true, status: row.status, message: 'nada a cancelar' });
  }

  if (row.api_token) {
    await uazapi('/instance/disconnect', { method: 'POST', token: row.api_token, body: {} });
  }

  const { error } = await supa.from('whatsapp_instances')
    .update({ status: 'disconnected' })
    .eq('id', row.id);
  if (error) return json({ success: false, error: error.message }, 409);

  await logEvent(supa, {
    clinic_id: row.clinic_id, instance_id: row.id, attempt_id: row.attempt_id, source,
    event_type: 'cancel', payload: null,
  });
  return json({ success: true, status: 'disconnected' });
}

async function handleDisconnect(supa: SupabaseClient, row: InstanceRow, source: string): Promise<Response> {
  if (row.status !== 'connected') {
    return json({ success: true, status: row.status, message: 'nada a desconectar' });
  }

  if (row.api_token) {
    await uazapi('/instance/disconnect', { method: 'POST', token: row.api_token, body: {} });
  }

  const { error } = await supa.from('whatsapp_instances')
    .update({ status: 'disconnected' })
    .eq('id', row.id);
  if (error) return json({ success: false, error: error.message }, 409);

  await logEvent(supa, {
    clinic_id: row.clinic_id, instance_id: row.id, source,
    event_type: 'disconnect_requested', payload: null,
  });
  return json({ success: true, status: 'disconnected' });
}

async function handleReset(supa: SupabaseClient, row: InstanceRow, source: string): Promise<Response> {
  if (!row.api_token) return json({ success: false, error: 'sem_api_token' }, 400);
  const res = await uazapi('/instance/reset', { method: 'POST', token: row.api_token, body: {} });
  await logEvent(supa, {
    clinic_id: row.clinic_id, instance_id: row.id, source, event_type: 'reset_requested',
    payload: { http_status: res.status, data: res.data },
  });
  return json({ success: res.ok, status: row.status, http_status: res.status });
}

async function handleStatus(_supa: SupabaseClient, row: InstanceRow): Promise<Response> {
  return json({
    success: true,
    status: row.status,
    qr_code: row.qr_code,
    phone_number: row.phone_number,
    attempt_id: row.attempt_id,
    last_event_at: row.last_event_at,
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ success: false, error: 'method_not_allowed' }, 405);

  const supa = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  let body: any;
  try { body = await req.json(); } catch { return json({ success: false, error: 'invalid_json' }, 400); }

  const action = (body.action as Action) ?? 'start';
  const source = body.connect_token ? 'public' : 'admin';

  // Resolve / cria instancia local
  let row: InstanceRow | null = null;
  let clinic_id = body.clinic_id as string | undefined;
  try {
    const resolved = await resolveInstance(supa, body);
    row = resolved.row;
    if (resolved.clinic_id) clinic_id = resolved.clinic_id;
    if (!row && action === 'start' && clinic_id) {
      row = await ensureLocalRow(supa, clinic_id);
    }
  } catch (e: any) {
    return json({ success: false, error: e.message }, 500);
  }
  if (!row) return json({ success: false, error: 'instance_not_found' }, 404);

  try {
    switch (action) {
      case 'start':       return await handleStart(supa, row, source);
      case 'cancel':      return await handleCancel(supa, row, source);
      case 'disconnect':  return await handleDisconnect(supa, row, source);
      case 'reset':       return await handleReset(supa, row, source);
      case 'status':      return await handleStatus(supa, row);
      default:            return json({ success: false, error: `unknown_action_${action}` }, 400);
    }
  } catch (e: any) {
    console.error('[orchestrator] unhandled error', e);
    await logEvent(supa, {
      clinic_id: row.clinic_id, instance_id: row.id, source,
      event_type: 'error', payload: { stage: 'unhandled', error: e.message },
    });
    return json({ success: false, error: e.message ?? 'unhandled' }, 500);
  }
});
