// whatsapp-sync-status
//
// Reconciliacao periodica entre o estado local em whatsapp_instances e o estado
// real reportado pela uazapi via GET /instance/all (admintoken). Tambem limpa
// webhooks duplicados em cada instancia (so na passada completa, ?dedupe=1).
//
// Agendamento (a partir de 04/08/2026):
//   - a cada 5 min: so a Parte 1 (reconciliacao). Barata: 1 chamada /instance/all
//     para todas as instancias, mais 1 leitura individual por instancia suspeita.
//   - 09:00 BRT: passada completa, com ?dedupe=1 (a Parte 2 leva ~15s).
//
// Antes eram 2 passadas por dia (09h e 18h) e a queda podia durar ate ~15h. Pior:
// a condenacao saia de UMA amostra, entao uma piscada de menos de um minuto da
// uazapi congelava a clinica ate a passada seguinte. Foi o que aconteceu com a
// clinica Tyago em 03/08/2026 (4h de envio automatico parado).

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

// Central de Erros. Esta edge nao registrava NADA: o cron marca 'succeeded' porque
// system_http_post so mede o enfileiramento, e a resposta do pg_net vinha
// timed_out=true, que o monitor de edge exclui de proposito. Resultado: ela podia
// derrubar todas as clinicas sem ninguem ver.
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
    console.error('[sync-status] log falhou:', e);
  }
}

// Motivo de desconexao que indica recuperacao INTERNA da uazapi, nao logout real.
// Foi o que derrubou a clinica Tyago em 03/08/2026: uma reconexao de menos de um
// minuto as 17h59:13 que o cron fotografou 51 segundos depois e congelou por 4h.
// Logout de verdade se apresenta como '401: logged out from another device',
// 'QR Code timeout' ou 'connection attempt canceled by API'.
function motivoTransitorio(reason: string | null | undefined): boolean {
  return String(reason ?? '').toLowerCase().startsWith('health_');
}

// Segunda leitura, individual, da instancia suspeita. O /instance/all e UMA foto;
// condenar na primeira amostra e o defeito que este cron tinha.
async function lerStatusIndividual(api_token: string): Promise<{ status: string; owner: string | null; reason: string | null } | null> {
  try {
    const res = await fetchWithTimeout(`${UAZAPI_BASE}/instance/status`, {
      method: 'GET',
      headers: { Accept: 'application/json', token: api_token },
    });
    if (!res.ok) return null;
    const body = await res.json();
    return {
      status: String(body?.instance?.status ?? '').toLowerCase(),
      owner: body?.instance?.owner ?? null,
      reason: body?.instance?.lastDisconnectReason ?? null,
    };
  } catch {
    return null;
  }
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
  catch (e: any) {
    // Sem isto a checagem de conexao de TODAS as clinicas podia estar morta ha dias
    // sem nenhum sinal: o cron reporta sucesso e o monitor de edge ignora timeout.
    await registrarErro(
      supa, 'whatsapp_sync_sem_uazapi',
      'Checagem de conexao do WhatsApp nao conseguiu falar com a uazapi',
      'critical', null, { erro: e?.message ?? 'uazapi_fetch_failed' },
    );
    return json({ success: false, error: e?.message ?? 'uazapi_fetch_failed' }, 502);
  }

  const uazById = new Map<string, any>();
  const uazByName = new Map<string, any>();
  for (const it of uazapiList) {
    if (it?.id) uazById.set(it.id, it);
    if (it?.name) uazByName.set(it.name, it);
  }

  const { data: locals, error: localErr } = await supa
    .from('whatsapp_instances')
    .select('id, clinic_id, org_id, api_id, api_token, status, attempt_id, phone_number')
    .not('api_id', 'is', null);
  if (localErr) return json({ success: false, error: localErr.message }, 500);

  // Nome da instância na uazapi: clinic_id (clínica) ou 'org-<org_id>' (instância da organização).
  // Sem isto, o fallback por-nome usaria clinic_id=NULL na linha da org e ela seria falsamente
  // marcada 'disconnected', parando os relatórios automáticos.
  const uazName = (l: any): string => l.clinic_id ?? `org-${l.org_id}`;

  type Reconcile = { instance_id: string; clinic_id: string | null; from: string; to: string; reason: string };
  const reconciled: Reconcile[] = [];
  const notFoundOnUazapi: string[] = [];
  // Instancias que a 1a leitura acusou e a confirmacao poupou. Sem isto a melhoria
  // seria invisivel: um cron que nao derruba ninguem parece um cron que nao roda.
  type NaoCondenado = { instance_id: string; clinic_id: string | null; motivo: string };
  const naoCondenados: NaoCondenado[] = [];

  for (const local of locals ?? []) {
    let remote = uazById.get(local.api_id);

    // Fallback: nao achou por api_id, tenta por name (=clinic_id). Pode ter
    // sido recriada na uazapi com novo id mas mesmo nome.
    if (!remote) {
      const byName = uazByName.get(uazName(local));
      if (byName?.id && byName?.token) {
        // Remapeia api_id e api_token localmente
        await supa.from('whatsapp_instances').update({ api_id: byName.id, api_token: byName.token }).eq('id', local.id);
        await supa.from('whatsapp_events').insert({
          clinic_id: local.clinic_id, org_id: local.org_id ?? null, instance_id: local.id, event_type: 'api_id_remapped', source: 'sync_cron',
          payload: { old_api_id: local.api_id, new_api_id: byName.id, reason: 'matched_by_name' },
        });
        // Atualiza variavel local em memoria para o resto do loop usar
        local.api_id = byName.id;
        remote = byName;
      }
    }

    if (!remote) {
      notFoundOnUazapi.push(local.id);
      if (local.status !== 'disconnected') {
        // Mesma regra do outro caminho: uma resposta parcial ou truncada de
        // /instance/all nao pode derrubar clinica. Reconfere individualmente.
        const confirmacao = local.api_token ? await lerStatusIndividual(local.api_token) : null;
        if (confirmacao && confirmacao.status === 'connected') {
          naoCondenados.push({ instance_id: local.id, clinic_id: local.clinic_id, motivo: 'ausente_no_all_mas_conectada' });
          await supa.from('whatsapp_events').insert({ clinic_id: local.clinic_id, org_id: local.org_id ?? null, instance_id: local.id, event_type: 'sync_falso_alarme', source: 'sync_cron', payload: { reason: 'ausente_no_all_mas_conectada' } });
          continue;
        }
        const { error } = await supa.from('whatsapp_instances').update({ status: 'disconnected', last_error: 'sync_cron: instancia nao encontrada na uazapi' }).eq('id', local.id);
        if (!error) {
          reconciled.push({ instance_id: local.id, clinic_id: local.clinic_id, from: local.status, to: 'disconnected', reason: 'missing_on_uazapi' });
          await supa.from('whatsapp_events').insert({ clinic_id: local.clinic_id, org_id: local.org_id ?? null, instance_id: local.id, attempt_id: local.attempt_id, event_type: 'sync_correction', source: 'sync_cron', payload: { from: local.status, to: 'disconnected', reason: 'missing_on_uazapi' } });
          // Instancia da ORG nao tem clinica nem grupo: nao ha quem avisar.
          if (local.clinic_id) {
            await supa.rpc('avisar_queda_whatsapp', { p_clinic_id: local.clinic_id, p_origem: 'sync_cron', p_motivo: 'missing_on_uazapi' });
          }
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
        await supa.from('whatsapp_events').insert({ clinic_id: local.clinic_id, org_id: local.org_id ?? null, instance_id: local.id, event_type: 'sync_correction', source: 'sync_cron', payload: { from: local.status, to: 'connected', reason: 'uazapi_says_connected', phone_updated: !!updates.phone_number } });
      }
      continue;
    }

    // Status iguais mas phone_number faltando localmente: preenche
    if (remoteStatus === 'connected' && local.status === 'connected' && remotePhone && !local.phone_number) {
      const { error } = await supa.from('whatsapp_instances').update({ phone_number: remotePhone }).eq('id', local.id);
      if (!error) {
        reconciled.push({ instance_id: local.id, clinic_id: local.clinic_id, from: 'connected', to: 'connected', reason: 'phone_filled' });
        await supa.from('whatsapp_events').insert({ clinic_id: local.clinic_id, org_id: local.org_id ?? null, instance_id: local.id, event_type: 'sync_correction', source: 'sync_cron', payload: { reason: 'phone_filled', phone_number: remotePhone } });
      }
    }
    if ((remoteStatus === 'disconnected' || remoteStatus === 'loggedout') && local.status !== 'disconnected') {
      // === CONFIRMAR ANTES DE CONDENAR ===
      // Marcar 'disconnected' nao e barato: a trigger APAGA phone_number, sem numero
      // o fn_chat_session_id devolve NULL e o agente recusa todo turno, e o
      // fn_clinic_send_token exige 'connected', entao TODO envio automatico para.
      // Uma amostra unica nao justifica esse estrago.
      const confirmacao = local.api_token ? await lerStatusIndividual(local.api_token) : null;

      // 2a leitura discorda: era piscada. Nao condena.
      if (confirmacao && confirmacao.status === 'connected') {
        naoCondenados.push({ instance_id: local.id, clinic_id: local.clinic_id, motivo: 'segunda_leitura_diz_conectado' });
        await supa.from('whatsapp_events').insert({ clinic_id: local.clinic_id, org_id: local.org_id ?? null, instance_id: local.id, event_type: 'sync_falso_alarme', source: 'sync_cron', payload: { reason: 'segunda_leitura_diz_conectado', remote_reason: remote.lastDisconnectReason ?? null } });
        continue;
      }

      // Nao consegui reconferir: na duvida, NAO derruba a clinica.
      if (!confirmacao) {
        naoCondenados.push({ instance_id: local.id, clinic_id: local.clinic_id, motivo: 'segunda_leitura_falhou' });
        await supa.from('whatsapp_events').insert({ clinic_id: local.clinic_id, org_id: local.org_id ?? null, instance_id: local.id, event_type: 'sync_suspeita', source: 'sync_cron', payload: { reason: 'segunda_leitura_falhou', remote_reason: remote.lastDisconnectReason ?? null } });
        continue;
      }

      // 2a leitura confirma a queda. Se o motivo for recuperacao interna da uazapi,
      // exige DUAS passadas seguidas antes de condenar: e o padrao que se conserta
      // sozinho em menos de um minuto. Com o cron de 5 min isso custa ~5 min de
      // atraso numa queda real, contra as ate 15h que custava antes.
      const motivo = confirmacao.reason ?? remote.lastDisconnectReason ?? null;
      if (motivoTransitorio(motivo)) {
        const desde = new Date(Date.now() - 30 * 60 * 1000).toISOString();
        const { data: suspeitaAnterior } = await supa
          .from('whatsapp_events')
          .select('id')
          .eq('instance_id', local.id)
          .eq('event_type', 'sync_suspeita')
          .gte('created_at', desde)
          .limit(1);

        if (!suspeitaAnterior?.length) {
          naoCondenados.push({ instance_id: local.id, clinic_id: local.clinic_id, motivo: 'primeira_suspeita_motivo_transitorio' });
          await supa.from('whatsapp_events').insert({ clinic_id: local.clinic_id, org_id: local.org_id ?? null, instance_id: local.id, event_type: 'sync_suspeita', source: 'sync_cron', payload: { reason: 'motivo_transitorio', remote_reason: motivo } });
          continue;
        }
      }

      const { error } = await supa.from('whatsapp_instances').update({ status: 'disconnected', last_error: 'sync_cron: uazapi reportou desconectado' }).eq('id', local.id);
      if (!error) {
        reconciled.push({ instance_id: local.id, clinic_id: local.clinic_id, from: local.status, to: 'disconnected', reason: 'uazapi_says_disconnected' });
        await supa.from('whatsapp_events').insert({ clinic_id: local.clinic_id, org_id: local.org_id ?? null, instance_id: local.id, attempt_id: local.attempt_id, event_type: 'sync_correction', source: 'sync_cron', payload: { from: local.status, to: 'disconnected', reason: 'uazapi_says_disconnected', remote_reason: motivo, confirmado_por: 'segunda_leitura' } });
        // So aqui, DEPOIS da confirmacao: avisar o grupo a cada piscada seria pior
        // que nao avisar. Instancia da ORG nao tem clinica nem grupo.
        if (local.clinic_id) {
          await supa.rpc('avisar_queda_whatsapp', { p_clinic_id: local.clinic_id, p_origem: 'sync_cron', p_motivo: motivo });
        }
      }
      continue;
    }
  }

  // === Parte 2: Dedup de webhooks por instancia ===
  // Roda em sequencia (30 instancias × ~500ms = ~15s) e e a razao de esta edge
  // estourar o timeout de 5s do chamador. Como a Parte 1 agora roda de 5 em 5 min,
  // a limpeza fica so na passada completa (1x/dia), via ?dedupe=1.
  type WhSummary = { instance_id: string; clinic_id: string; removed: number; total_before: number };
  const webhookCleanups: WhSummary[] = [];
  let webhookErrors = 0;
  const comDedupe = new URL(req.url).searchParams.get('dedupe') === '1';

  for (const local of comDedupe ? (locals ?? []) : []) {
    if (!local.api_token) continue;
    // Pula instancias que nao existem na uazapi (ja apagadas)
    if (!uazById.has(local.api_id)) continue;
    try {
      const res = await dedupeWebhooks(local.api_token);
      if (res.removed > 0) {
        webhookCleanups.push({ instance_id: local.id, clinic_id: local.clinic_id, removed: res.removed, total_before: res.total_before });
        await supa.from('whatsapp_events').insert({
          clinic_id: local.clinic_id, org_id: local.org_id ?? null, instance_id: local.id, event_type: 'webhook_dedupe', source: 'sync_cron',
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
    nao_condenados_count: naoCondenados.length,
    reconciled,
    nao_condenados: naoCondenados,
    dedupe: comDedupe,
    webhook_cleanups: webhookCleanups,
    webhook_errors: webhookErrors,
  };
  console.log('[sync-status]', summary);
  return json(summary);
});
