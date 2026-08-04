// Receiver de webhooks da uazapi (event=connection).
//
// A uazapi entrega push de eventos quando uma instancia muda de estado:
//  - status=connecting + qrcode -> QR pronto pra escanear
//  - status=connected           -> instancia logou
//  - status=disconnected        -> sessao caiu
//
// Esta edge atualiza whatsapp_instances respeitando a state machine, registra
// auditoria em whatsapp_events e responde 200 rapido para a uazapi nao reenviar.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { ownerToPhone, normalizeBrazilianPhone } from '../_shared/phone.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const UAZAPI_BASE = Deno.env.get('UAZAPI_BASE_URL') ?? 'https://med4growautomacao.uazapi.com';
const STATUS_FETCH_TIMEOUT_MS = 4000;

interface UazapiInstance {
  id?: string;
  token?: string;
  name?: string;
  status?: string;
  qrcode?: string;
  owner?: string;
  profileName?: string;
  profilePicUrl?: string;
  lastDisconnect?: string;
  lastDisconnectReason?: string;
}

interface UazapiConnectionEvent {
  event?: string;
  // A uazapi entrega a chave como 'EventType' (E maiusculo). Ver
  // https://docs.uazapi.com/ -> openapi-bundled.json, GET /webhook/errors.
  EventType?: string;
  instance?: string | UazapiInstance;
  data?: UazapiInstance | Record<string, any>;
  // alguns provedores entregam direto no root
  status?: string;
  qrcode?: string;
  owner?: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

// Central de Erros: sem isto a falha desta edge nao existe para ninguem.
// O `instance_not_found` era `console.warn` + 200, ou seja, invisivel.
async function registrarErro(
  supa: SupabaseClient, code: string, title: string, level: string,
  clinicId: string | null, ctx: unknown,
) {
  try {
    await supa.rpc('log_system_error', {
      p_scope: 'whatsapp', p_code: code, p_title: title, p_level: level,
      p_clinic_id: clinicId, p_context: ctx,
    });
  } catch (e) {
    console.error('[uazapi-events] log falhou:', e);
  }
}

function extractInstanceData(payload: UazapiConnectionEvent): UazapiInstance & { id?: string; status?: string; qrcode?: string; owner?: string } {
  // Tenta varios formatos possiveis (uazapi pode entregar em estruturas diferentes)
  if (payload.data && typeof payload.data === 'object') {
    return payload.data as UazapiInstance;
  }
  if (payload.instance && typeof payload.instance === 'object') {
    return payload.instance as UazapiInstance;
  }
  if (payload.status || payload.qrcode || payload.owner) {
    return {
      id: typeof payload.instance === 'string' ? payload.instance : undefined,
      status: payload.status,
      qrcode: payload.qrcode,
      owner: payload.owner,
    };
  }
  return {};
}

// clinic_id é null para a instância de ORGANIZAÇÃO (remetente de relatórios; send-only).
type InstanceRow = { id: string; clinic_id: string | null; org_id: string | null; attempt_id: string | null; status: string; api_token: string | null; phone_number: string | null };

const ROW_COLS = 'id, clinic_id, org_id, attempt_id, status, api_token, phone_number';

async function findInstanceRow(supa: SupabaseClient, data: UazapiInstance): Promise<InstanceRow | null> {
  if (data.id) {
    const { data: byId } = await supa
      .from('whatsapp_instances')
      .select(ROW_COLS)
      .eq('api_id', data.id)
      .maybeSingle();
    if (byId) return byId as any;
  }
  if (data.token) {
    const { data: byToken } = await supa
      .from('whatsapp_instances')
      .select(ROW_COLS)
      .eq('api_token', data.token)
      .maybeSingle();
    if (byToken) return byToken as any;
  }
  if (data.name) {
    // name na uazapi = clinic_id (clínicas) ou 'org-<org_id>' (instância da organização)
    if (data.name.startsWith('org-')) {
      const { data: byOrg } = await supa
        .from('whatsapp_instances')
        .select(ROW_COLS)
        .eq('org_id', data.name.slice(4))
        .maybeSingle();
      if (byOrg) return byOrg as any;
    } else {
      const { data: byClinic } = await supa
        .from('whatsapp_instances')
        .select(ROW_COLS)
        .eq('clinic_id', data.name)
        .maybeSingle();
      if (byClinic) return byClinic as any;
    }
  }
  return null;
}

// Busca o numero (owner/jid) da instancia na uazapi via GET /instance/status.
// Usado quando o webhook de 'connected' chega sem o campo 'owner' (comum no
// primeiro evento pos-pareamento) -- assim o numero aparece na hora, sem
// esperar o cron whatsapp-sync-status (09h/18h BRT).
async function fetchOwnerPhone(apiToken: string): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), STATUS_FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${UAZAPI_BASE}/instance/status`, {
        method: 'GET',
        headers: { Accept: 'application/json', token: apiToken },
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return null;
    const body = await res.json();
    const fromOwner = ownerToPhone(body?.instance?.owner);
    if (fromOwner) return fromOwner;
    return normalizeBrazilianPhone(body?.status?.jid?.user);
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ success: false, error: 'method_not_allowed' }, 405);

  const supa = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  let payload: UazapiConnectionEvent;
  try { payload = await req.json(); } catch { return json({ success: false, error: 'invalid_json' }, 400); }

  // Soft validacao: aceita 'connection' ou ausencia (alguns clientes nao enviam).
  // A uazapi manda 'EventType'; ler so 'event' fazia este guard ser letra morta e
  // qualquer evento entrava como se fosse conexao.
  const event = String(payload.EventType ?? payload.event ?? 'connection').toLowerCase();
  if (event !== 'connection') {
    // Eventos que nao sejam de conexao sao ignorados aqui (mensagem vai para wa-inbound)
    return json({ success: true, ignored: true, event });
  }

  const data = extractInstanceData(payload);
  const row = await findInstanceRow(supa, data);
  if (!row) {
    // Caminho MUDO ate 04/08/2026: webhook de conexao chegando e sendo descartado
    // sem linha em whatsapp_events e sem Central. Se a instancia deixa de casar,
    // a clinica perde a deteccao em tempo real e ninguem fica sabendo.
    console.warn('[uazapi-events] instance nao encontrada', { id: data.id, name: data.name });
    await registrarErro(
      supa, 'uazapi_evento_sem_instancia',
      'Webhook de conexao da uazapi nao casou com nenhuma instancia',
      'error', null,
      { api_id: data.id ?? null, name: data.name ?? null, uazapi_status: data.status ?? null },
    );
    return json({ success: false, error: 'instance_not_found' }, 200); // 200 evita retry da uazapi
  }

  const uazStatus = (data.status ?? '').toLowerCase();
  const updates: Record<string, unknown> = { last_event_at: new Date().toISOString() };
  let nextStatus: string | null = null;

  if (uazStatus === 'connected') {
    nextStatus = 'connected';
    let phone = ownerToPhone(data.owner);
    // O webhook de 'connected' costuma vir sem 'owner'. Se o numero ainda nao
    // esta salvo, busca na uazapi agora para preencher imediatamente.
    //
    // Isto ficou CRITICO: a queda anula phone_number, entao toda volta chega com
    // row.phone_number nulo. Sem reencontrar o numero aqui, a instancia volta em
    // estado meio-vivo (envio liberado, agente recusando todo turno) -- que agora
    // acende o monitor whatsapp_sem_numero na Central.
    if (!phone && row.api_token && !row.phone_number) {
      phone = await fetchOwnerPhone(row.api_token);
    }
    if (phone) updates.phone_number = phone;
    if (!phone && !row.phone_number) {
      await registrarErro(
        supa, 'whatsapp_volta_sem_numero',
        'Instancia reconectou mas a uazapi nao informou o numero',
        'error', row.clinic_id,
        { instance_id: row.id, de: row.status },
      );
    }
  } else if (uazStatus === 'connecting' || uazStatus === 'qrcode' || uazStatus === 'connectingphone') {
    nextStatus = row.status === 'connected' ? null : 'connecting'; // nao volta de connected p/ connecting
    if (data.qrcode) {
      updates.qr_code = data.qrcode;
      updates.qr_expires_at = new Date(Date.now() + 2 * 60 * 1000).toISOString();
    }
  } else if (uazStatus === 'disconnected' || uazStatus === 'loggedout') {
    nextStatus = 'disconnected';
  }

  if (nextStatus && nextStatus !== row.status) {
    updates.status = nextStatus;
  }

  const { error } = await supa.from('whatsapp_instances').update(updates).eq('id', row.id);
  if (error) {
    // Ate 04/08/2026 este ramo comia a recuperacao: a maquina de estados recusava
    // 'disconnected -> connected' e o sinal de volta morria aqui, com registro so
    // em whatsapp_events (tabela sem painel e sem alerta). Aconteceu na clinica
    // Tyago em 28/06: a volta chegou 2 minutos depois da queda e a clinica ficou
    // muda ate as 09h do dia seguinte. A aresta foi liberada no banco; este ramo
    // agora acende a Central para qualquer outra recusa.
    console.error('[uazapi-events] update error', error);
    await registrarErro(
      supa, 'whatsapp_update_recusado',
      'Banco recusou a atualizacao de estado vinda do webhook da uazapi',
      'critical', row.clinic_id,
      { erro: error.message, tentativa: updates, de: row.status, uazapi: data.status ?? null },
    );
    await supa.from('whatsapp_events').insert({
      clinic_id: row.clinic_id,
      org_id: row.org_id,
      instance_id: row.id,
      attempt_id: row.attempt_id,
      event_type: 'error',
      source: 'uazapi_webhook',
      payload: { error: error.message, attempted_updates: updates, uazapi_data: data },
    });
    return json({ success: false, error: error.message }, 200);
  }

  await supa.from('whatsapp_events').insert({
    clinic_id: row.clinic_id,
    org_id: row.org_id,
    instance_id: row.id,
    attempt_id: row.attempt_id,
    event_type: nextStatus
      ? (nextStatus === 'connected' ? 'connected' : nextStatus === 'disconnected' ? 'disconnected' : 'qr_received')
      : 'webhook_noop',
    source: 'uazapi_webhook',
    payload: { uazapi_status: uazStatus, has_qr: !!data.qrcode, has_owner: !!data.owner, phone_set: !!updates.phone_number },
  });

  // Caiu de verdade e a uazapi avisou: este e o caminho MAIS RAPIDO de todos, chega
  // em segundos, sem esperar o cron. Avisa o grupo com o link de reconexao.
  // A propria funcao trava repeticao (3h) para instancia instavel nao virar spam.
  // Instancia da ORG nao tem clinica nem grupo, por isso o guard.
  if (nextStatus === 'disconnected' && row.status !== 'disconnected' && row.clinic_id) {
    await supa.rpc('avisar_queda_whatsapp', {
      p_clinic_id: row.clinic_id, p_origem: 'uazapi_webhook', p_motivo: uazStatus,
    });
  }

  return json({ success: true, next_status: nextStatus ?? row.status });
});
