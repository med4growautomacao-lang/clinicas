import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Relay browser->servidor (contorna CORS) para os webhooks do n8n da organizacao.
//
// HARDENING 27/07: antes esta funcao fazia fetch(target_url) para QUALQUER URL, sem auth
// (verify_jwt=false) e sem allowlist = proxy SSRF aberto (qualquer um na internet mandava uma
// URL e o servidor buscava, inclusive hosts internos / metadata). Hoje os dois callers do front
// (encerramento de ticket e teste de gatilho) ja migraram para trigger/RPC nativos, entao a
// funcao esta efetivamente sem uso; mesmo assim seguia deployada e exploravel.
//
// Correcao: allowlist restrita ao dominio da propria organizacao. O unico host referenciado em
// todo o sistema (system_settings.webhook_lead_catch_url, docs, constantes) e
// *.med4growautomacao.com.br. Assim o SSRF morre (nao da para atingir host arbitrario) sem
// quebrar um eventual caller legitimo ao host conhecido.

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, x-client-info',
};

const ALLOWED_HOST_EXACT = 'med4growautomacao.com.br';
const ALLOWED_HOST_SUFFIX = '.med4growautomacao.com.br';

function isAllowedTarget(rawUrl: string): boolean {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  return host === ALLOWED_HOST_EXACT || host.endsWith(ALLOWED_HOST_SUFFIX);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await req.json();
    const targetUrl = body.target_url;
    const payload = body.payload;

    if (!targetUrl || !payload) {
      return new Response(JSON.stringify({ error: 'Missing target_url or payload' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // Anti-SSRF: so encaminha para o dominio da organizacao (https).
    if (!isAllowedTarget(targetUrl)) {
      return new Response(JSON.stringify({ error: 'target_url not allowed' }), {
        status: 403,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const webhookResponse = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      redirect: 'error',
    });

    const responseText = await webhookResponse.text();

    return new Response(JSON.stringify({
      success: true,
      status: webhookResponse.status,
      response: responseText,
    }), {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
});
