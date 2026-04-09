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
  const connectToken = url.searchParams.get('c')
  const format = url.searchParams.get('format') // 'json' quando chamado pelo app React

  if (!connectToken) {
    const msg = 'Link inválido.'
    if (format === 'json') return new Response(JSON.stringify({ error: msg }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    return new Response(msg, { status: 400 })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  )

  // Busca instância pelo connect_token
  const { data: instance } = await supabase
    .from('whatsapp_instances')
    .select('clinic_id, phone_number, redirect_message')
    .eq('connect_token', connectToken)
    .maybeSingle()

  if (!instance?.phone_number) {
    const msg = 'Clínica não encontrada ou WhatsApp não configurado.'
    if (format === 'json') return new Response(JSON.stringify({ error: msg }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    return new Response(msg, { status: 404 })
  }

  // Captura UTMs
  const utmSource   = url.searchParams.get('utm_source')   || 'direto'
  const utmMedium   = url.searchParams.get('utm_medium')   || 'link'
  const utmCampaign = url.searchParams.get('utm_campaign') || null
  const utmContent  = url.searchParams.get('utm_content')  || null
  const utmTerm     = url.searchParams.get('utm_term')     || null

  // Gera código de protocolo (8 hex chars)
  const protocolo = crypto.randomUUID().replace(/-/g, '').slice(0, 8)

  // Salva sessão
  await supabase.from('link_sessions').insert({
    rast_id:      protocolo,
    clinic_id:    instance.clinic_id,
    utm_source:   utmSource,
    utm_medium:   utmMedium,
    utm_campaign: utmCampaign,
    utm_content:  utmContent,
    utm_term:     utmTerm,
  })

  const phone = instance.phone_number.replace(/\D/g, '')
  const customMsg = instance.redirect_message?.trim() || 'Olá! Gostaria de mais informações.'
  const fullText = `${customMsg} [Protocolo ${protocolo} não apague essa mensagem]`
  const waUrl = `https://wa.me/${phone}?text=${encodeURIComponent(fullText)}`

  // Modo JSON: retorna dados para o app React setar o cookie e redirecionar
  if (format === 'json') {
    return new Response(JSON.stringify({ rast_id: protocolo, wa_url: waUrl }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  // Modo HTML: acesso direto ao link (sem passar pelo app React)
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Redirecionando...</title>
</head>
<body>
<script>
  const expires = new Date(Date.now() + 63072000 * 1000).toUTCString();
  document.cookie = "rast_id=${protocolo}; expires=" + expires + "; path=/; SameSite=Lax";
  window.location.href = "${waUrl}";
<\/script>
<noscript>
  <meta http-equiv="refresh" content="0;url=${waUrl}">
</noscript>
</body>
</html>`

  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  })
})
