// whatsapp-bridge
//
// Apos a refatoracao, esta edge ficou como roteador fino:
//  - actions de conexao (create/connect/cancel) -> whatsapp-orchestrator
//  - actions de grupo (create_group/add_participants) -> WHATSAPP_GROUP_WEBHOOK (n8n)
//
// Mantemos esta edge por compat com clientes ja em cache. Pode ser removida
// quando confirmar zero trafego em /functions/v1/whatsapp-bridge nos logs.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const CONNECTION_ACTIONS = new Set(['create', 'connect', 'cancel', 'start', 'disconnect', 'reset', 'status']);
const GROUP_ACTIONS = new Set(['create_group', 'add_participants']);

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  let body: any;
  try { body = await req.json(); } catch { body = {}; }
  const action: string = body?.action ?? 'start';

  // 1) Acoes de grupo seguem para o webhook do n8n.
  //    O workflow do n8n usa o token da instancia (header `token` da uazapi) que
  //    espera receber no payload como `api_token`. Esse campo se perdeu quando a
  //    bridge virou roteador fino; aqui resolvemos de whatsapp_instances pelo
  //    clinic_id e reinjetamos antes de repassar.
  if (GROUP_ACTIONS.has(action)) {
    const groupUrl = Deno.env.get('WHATSAPP_GROUP_WEBHOOK');
    if (!groupUrl) {
      return new Response(JSON.stringify({ success: false, error: 'WHATSAPP_GROUP_WEBHOOK nao configurado' }), {
        status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // Resolve o token da instancia da clinica
    let apiToken = '';
    try {
      const supa = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      );
      const { data } = await supa
        .from('whatsapp_instances')
        .select('api_token')
        .eq('clinic_id', body?.clinic_id)
        .maybeSingle();
      apiToken = data?.api_token ?? '';
    } catch (_e) {
      // segue sem token; tratamos abaixo com erro explicito
    }
    if (!apiToken) {
      return new Response(JSON.stringify({ success: false, error: 'whatsapp_nao_conectado: instancia sem api_token para esta clinica' }), {
        status: 409, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    try {
      const res = await fetch(groupUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, api_token: apiToken }),
      });
      const text = await res.text();
      return new Response(text, {
        status: res.status,
        headers: { ...CORS_HEADERS, 'Content-Type': res.headers.get('content-type') ?? 'application/json' },
      });
    } catch (e: any) {
      return new Response(JSON.stringify({ success: false, error: e?.message ?? 'group_forward_failed' }), {
        status: 502, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }
  }

  // 2) Acoes de conexao seguem para o orchestrator. Traduz aliases legados:
  //    create/connect -> start
  if (CONNECTION_ACTIONS.has(action) || !action) {
    const forwarded = {
      action: (action === 'create' || action === 'connect') ? 'start' : action,
      clinic_id: body?.clinic_id,
      connect_token: body?.connect_token ?? body?.token,
    };
    try {
      const orchestratorUrl = `${Deno.env.get('SUPABASE_URL') ?? ''}/functions/v1/whatsapp-orchestrator`;
      const res = await fetch(orchestratorUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: req.headers.get('authorization') ?? `Bearer ${Deno.env.get('SUPABASE_ANON_KEY') ?? ''}`,
        },
        body: JSON.stringify(forwarded),
      });
      const text = await res.text();
      return new Response(text, {
        status: res.status,
        headers: { ...CORS_HEADERS, 'Content-Type': res.headers.get('content-type') ?? 'application/json' },
      });
    } catch (e: any) {
      return new Response(JSON.stringify({ success: false, error: e?.message ?? 'bridge_forward_failed' }), {
        status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }
  }

  // 3) Acao desconhecida
  return new Response(JSON.stringify({ success: false, error: `unknown_action: ${action}` }), {
    status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
});
