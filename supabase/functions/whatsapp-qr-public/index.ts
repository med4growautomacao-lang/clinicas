import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const url = new URL(req.url)
  const token = url.searchParams.get('token')
  const isJson = url.searchParams.get('json') === '1'

  if (!token) {
    return new Response('Token nao informado.', { status: 400 })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  )

  const { data, error } = await supabase
    .from('whatsapp_instances')
    .select('qr_code, status, phone_number, clinics(name)')
    .eq('connect_token', token)
    .maybeSingle()

  if (error || !data) {
    if (isJson) {
      return new Response(JSON.stringify({ error: 'Token invalido ou expirado.' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    return new Response(notFoundHtml(), {
      status: 404,
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    })
  }

  if (isJson) {
    return new Response(JSON.stringify({
      qr_code: data.qr_code ?? null,
      status: data.status,
      phone_number: data.phone_number ?? null,
      clinic_name: data.clinics?.name ?? null,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  return new Response(pageHtml(token, data.status, data.qr_code, data.phone_number), {
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  })
})

function pageHtml(token: string, status: string, qrCode: string | null, phoneNumber: string | null): string {
  const qrSrc = qrCode
    ? (qrCode.startsWith('data:') ? qrCode : 'data:image/png;base64,' + qrCode)
    : ''

  const body = status === 'connected'
    ? `
      <div class="success-icon">
        <svg fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/>
        </svg>
      </div>
      <h1>WhatsApp Conectado!</h1>
      <p class="subtitle">Sua conta foi conectada com sucesso.</p>
      ${phoneNumber ? '<p class="phone">' + phoneNumber + '</p>' : ''}
    `
    : status === 'qr_pending' && qrCode
    ? `
      <div class="logo">
        <svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 013.75 9.375v-4.5zM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5zM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0113.5 9.375v-4.5z"/>
        </svg>
      </div>
      <h1>Escaneie o QR Code</h1>
      <p class="subtitle">Use o WhatsApp no seu celular para escanear o c&oacute;digo abaixo.</p>
      <div class="qr-wrap"><img id="qr-img" src="${qrSrc}" alt="QR Code" /></div>
      <div class="steps">
        <div><span>1.</span> Abra o WhatsApp no celular</div>
        <div><span>2.</span> Toque em <span>Dispositivos conectados</span></div>
        <div><span>3.</span> Toque em <span>Conectar um dispositivo</span></div>
        <div><span>4.</span> Aponte a c&acirc;mera para o QR Code</div>
      </div>
      <div class="badge"><span class="dot"></span> Atualizando automaticamente...</div>
    `
    : `
      <div class="spinner"></div>
      <h1>Preparando conex&atilde;o...</h1>
      <p class="subtitle">Aguarde enquanto geramos o QR Code para voc&ecirc;.</p>
      <div class="badge"><span class="dot"></span> Verificando a cada 5 segundos...</div>
    `

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Conectar WhatsApp</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f0fdf4; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; }
    .card { background: white; border-radius: 24px; box-shadow: 0 20px 60px rgba(0,0,0,0.08); padding: 48px 40px; max-width: 420px; width: 100%; text-align: center; }
    .logo { width: 56px; height: 56px; background: #dcfce7; border-radius: 16px; display: flex; align-items: center; justify-content: center; margin: 0 auto 24px; }
    .logo svg { width: 28px; height: 28px; color: #16a34a; }
    h1 { font-size: 22px; font-weight: 700; color: #0f172a; margin-bottom: 8px; }
    .subtitle { font-size: 14px; color: #64748b; margin-bottom: 32px; line-height: 1.5; }
    .qr-wrap { background: white; border: 2px solid #d1fae5; border-radius: 20px; padding: 24px; display: inline-block; margin-bottom: 24px; }
    .qr-wrap img { width: 200px; height: 200px; display: block; }
    .steps { text-align: left; background: #f8fafc; border-radius: 12px; padding: 16px 20px; font-size: 13px; color: #475569; line-height: 2; }
    .steps span { font-weight: 600; color: #0f172a; }
    .spinner { width: 48px; height: 48px; border: 4px solid #d1fae5; border-top-color: #16a34a; border-radius: 50%; animation: spin 0.8s linear infinite; margin: 0 auto 24px; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .badge { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; color: #94a3b8; margin-top: 20px; }
    .dot { width: 6px; height: 6px; background: #22c55e; border-radius: 50%; animation: pulse 1.5s ease-in-out infinite; }
    @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
    .success-icon { width: 64px; height: 64px; background: #dcfce7; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 24px; }
    .success-icon svg { width: 32px; height: 32px; color: #16a34a; }
    .phone { font-size: 18px; font-weight: 700; color: #16a34a; margin: 12px 0 8px; }
  </style>
</head>
<body>
  <div class="card" id="app">${body}</div>
  <script>
    var TOKEN = '${token}';
    var POLL_URL = location.href.split('?')[0] + '?token=' + TOKEN + '&json=1';
    var connected = ${status === 'connected' ? 'true' : 'false'};

    if (!connected) {
      var interval = setInterval(function() {
        fetch(POLL_URL).then(function(r){ return r.json(); }).then(function(d) {
          var app = document.getElementById('app');
          if (d.status === 'connected') {
            clearInterval(interval);
            app.innerHTML = '<div class="success-icon"><svg fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg></div><h1>WhatsApp Conectado!</h1><p class="subtitle">Sua conta foi conectada com sucesso.</p>' + (d.phone_number ? '<p class="phone">'+d.phone_number+'</p>' : '');
          } else if (d.status === 'qr_pending' && d.qr_code) {
            var src = d.qr_code.startsWith('data:') ? d.qr_code : 'data:image/png;base64,' + d.qr_code;
            var img = document.getElementById('qr-img');
            if (img) {
              img.src = src;
            } else {
              location.reload();
            }
          }
        }).catch(function(){});
      }, 5000);
    }
  </script>
</body>
</html>`
}

function notFoundHtml(): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8"/>
  <title>Link invalido</title>
  <style>
    body { font-family: sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #fef2f2; }
    .card { background: white; border-radius: 16px; padding: 40px; text-align: center; max-width: 360px; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
    h1 { color: #ef4444; margin-bottom: 8px; font-size: 20px; }
    p { color: #64748b; font-size: 14px; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Link invalido</h1>
    <p>Este link de conexao e invalido ou ja expirou. Solicite um novo link ao responsavel.</p>
  </div>
</body>
</html>`
}
