// whatsapp-sync-status
//
// Reconciliacao periodica entre o estado local em whatsapp_instances e o estado
// real reportado pela uazapi via GET /instance/all (admintoken).
//
// Sintoma que motivou: ja vi caso de instancia marcada como 'connected' no DB
// mas desconectada na uazapi (provavelmente perdeu evento connection no webhook).
// Esta funcao corrige a divergencia de forma idempotente.
//
// Estrategia:
//  1) Lista todas as instancias na uazapi (1 chamada, eficiente)
//  2) Para cada whatsapp_instances local com api_id, compara status
//  3) Se diferente, aplica UPDATE respeitando state machine:
//      - uazapi=connected   -> local connected   (so age se local != connected)
//      - uazapi=disconnected-> local disconnected
//      - uazapi=connecting  -> nao mexe (pode estar mid-flow legitimo)
//  4) Loga cada divergencia em whatsapp_events com source='sync_cron'
//
// Agendamento: pg_cron 09:00 e 18:00 BRT (12:00 e 21:00 UTC).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const UAZAPI_BASE = Deno.env.get('UAZAPI_BASE_URL') ?? 'https://med4growautomacao.uazapi.com';
const UAZAPI_ADMIN_TOKEN = Deno.env.get('UAZAPI_ADMIN_TOKEN') ?? '';
const HTTP_TIMEOUT_MS = 10000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
}

async function fetchUazapiAll(): Promise<any[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(`${UAZAPI_BASE}/instance/all`, {
      method: 'GET',
      headers: { Accept: 'application/json', admintoken: UAZAPI_ADMIN_TOKEN },
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`uazapi_${res.status}: ${text.slice(0, 200)}`);
    const data = JSON.parse(text);
    return Array.isArray(data) ? data : [];
  } finally {
    clearTimeout(timer);
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  if (!UAZAPI_ADMIN_TOKEN) return json({ success: false, error: 'UAZAPI_ADMIN_TOKEN nao configurado' }, 500);

  const supa = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  let uazapiList: any[];
  try {
    uazapiList = await fetchUazapiAll();
  } catch (e: any) {
    return json({ success: false, error: e?.message ?? 'uazapi_fetch_failed' }, 502);
  }

  // index uazapi por id
  const uazById = new Map<string, any>();
  for (const it of uazapiList) {
    if (it?.id) uazById.set(it.id, it);
  }

  // Lista todas as locais (somente as que ja tem api_id mapeado)
  const { data: locals, error: localErr } = await supa
    .from('whatsapp_instances')
    .select('id, clinic_id, api_id, status, attempt_id, phone_number')
    .not('api_id', 'is', null);
  if (localErr) return json({ success: false, error: localErr.message }, 500);

  type Reconcile = {
    instance_id: string;
    clinic_id: string;
    from: string;
    to: string;
    reason: string;
  };
  const reconciled: Reconcile[] = [];
  const notFoundOnUazapi: string[] = [];

  for (const local of locals ?? []) {
    const remote = uazById.get(local.api_id);

    // 1) Existe local mas nao existe na uazapi -> marca disconnected
    if (!remote) {
      notFoundOnUazapi.push(local.id);
      if (local.status !== 'disconnected') {
        const { error } = await supa
          .from('whatsapp_instances')
          .update({ status: 'disconnected', last_error: 'sync_cron: instancia nao encontrada na uazapi' })
          .eq('id', local.id);
        if (!error) {
          reconciled.push({ instance_id: local.id, clinic_id: local.clinic_id, from: local.status, to: 'disconnected', reason: 'missing_on_uazapi' });
          await supa.from('whatsapp_events').insert({
            clinic_id: local.clinic_id, instance_id: local.id, attempt_id: local.attempt_id,
            event_type: 'sync_correction', source: 'sync_cron',
            payload: { from: local.status, to: 'disconnected', reason: 'missing_on_uazapi' },
          });
        }
      }
      continue;
    }

    const remoteStatus = String(remote.status ?? '').toLowerCase();

    // 2) uazapi=connected, local != connected -> corrige para connected
    if (remoteStatus === 'connected' && local.status !== 'connected') {
      // State machine so aceita connecting->connected. Se estamos em disconnected,
      // precisamos passar por connecting primeiro.
      if (local.status === 'disconnected') {
        await supa.from('whatsapp_instances').update({ status: 'connecting' }).eq('id', local.id);
      }
      const { error } = await supa
        .from('whatsapp_instances')
        .update({ status: 'connected' })
        .eq('id', local.id);
      if (!error) {
        reconciled.push({ instance_id: local.id, clinic_id: local.clinic_id, from: local.status, to: 'connected', reason: 'uazapi_says_connected' });
        await supa.from('whatsapp_events').insert({
          clinic_id: local.clinic_id, instance_id: local.id,
          event_type: 'sync_correction', source: 'sync_cron',
          payload: { from: local.status, to: 'connected', reason: 'uazapi_says_connected' },
        });
      }
      continue;
    }

    // 3) uazapi=disconnected, local != disconnected -> corrige para disconnected
    if ((remoteStatus === 'disconnected' || remoteStatus === 'loggedout') && local.status !== 'disconnected') {
      const { error } = await supa
        .from('whatsapp_instances')
        .update({ status: 'disconnected', last_error: 'sync_cron: uazapi reportou desconectado' })
        .eq('id', local.id);
      if (!error) {
        reconciled.push({ instance_id: local.id, clinic_id: local.clinic_id, from: local.status, to: 'disconnected', reason: 'uazapi_says_disconnected' });
        await supa.from('whatsapp_events').insert({
          clinic_id: local.clinic_id, instance_id: local.id, attempt_id: local.attempt_id,
          event_type: 'sync_correction', source: 'sync_cron',
          payload: { from: local.status, to: 'disconnected', reason: 'uazapi_says_disconnected', remote_reason: remote.lastDisconnectReason ?? null },
        });
      }
      continue;
    }

    // 4) uazapi=connecting -> nao mexe (pode ser tentativa em andamento legitima)
    // 5) status iguais -> nao mexe
  }

  // Sumario
  const summary = {
    success: true,
    locals_checked: locals?.length ?? 0,
    uazapi_total: uazapiList.length,
    reconciled_count: reconciled.length,
    not_found_on_uazapi: notFoundOnUazapi.length,
    reconciled,
  };
  console.log('[sync-status]', summary);
  return json(summary);
});
