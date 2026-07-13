import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Dois identificadores DIFERENTES, que antes estavam confundidos no mesmo campo:
//
//  - `protocolo`: o código que vai na mensagem do WhatsApp. Identifica o CLIQUE, é descartável e
//    muda a cada acesso. Antes eram 4 dígitos (9.000 valores) num campo UNIQUE, inseridos sem
//    checar erro: com ~600 em uso, ~7% dos cliques colidiam, o insert falhava em silêncio e o
//    clique era perdido. Agora: 6 dígitos (900k) + retry no conflito.
//
//  - `rast_id`: a IDENTIDADE do visitante (UUID v4, mesmo formato do script instalado no site do
//    cliente). Vive num cookie de 2 anos e se REPETE entre cliques do mesmo navegador — é
//    justamente isso que permite montar a jornada ("clicou dia 3, voltou dia 8, conversou dia 12").
//    Antes o cookie guardava o protocolo, que muda toda vez — inútil para agrupar.
const PROTOCOL_DIGITS = 6
const MAX_INSERT_ATTEMPTS = 5

function genProtocol(): string {
  const min = 10 ** (PROTOCOL_DIGITS - 1)
  const max = 10 ** PROTOCOL_DIGITS - 1
  return String(Math.floor(min + Math.random() * (max - min + 1)))
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const url = new URL(req.url)
  const linkCode = url.searchParams.get('l')      // novo: link nomeado do gerenciador
  const connectToken = url.searchParams.get('c')  // legado: token da instância + UTMs na querystring
  const format = url.searchParams.get('format')

  // Identidade do visitante. O link publicado é servido pelo app (outro domínio), então o cookie
  // NÃO chega até aqui — quem o lê é o RedirectPage e o repassa por aqui. Se não vier (1ª visita,
  // ou acesso direto a esta função), geramos um UUID v4 e devolvemos para ser persistido.
  const rastFromClient = url.searchParams.get('rast_id')
  const rastId = rastFromClient && UUID_V4.test(rastFromClient)
    ? rastFromClient
    : crypto.randomUUID()

  const fail = (msg: string, status: number) => {
    if (format === 'json') {
      return new Response(JSON.stringify({ error: msg }), {
        status, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    return new Response(msg, { status })
  }

  if (!linkCode && !connectToken) return fail('Link inválido.', 400)

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  )

  let clinicId: string | null = null
  let redirectLinkId: string | null = null
  let utmSource: string, utmMedium: string
  let utmCampaign: string | null, utmContent: string | null, utmTerm: string | null

  if (linkCode) {
    // ---- Modo gerenciador: as UTMs vêm do link salvo, não da URL ----
    const { data: link } = await supabase
      .from('redirect_links')
      .select('id, clinic_id, utm_source, utm_medium, utm_campaign, utm_content, utm_term, active, archived_at')
      .eq('code', linkCode)
      .maybeSingle()

    if (!link) return fail('Link não encontrado.', 404)
    if (!link.active || link.archived_at) return fail('Este link foi desativado.', 410)

    clinicId       = link.clinic_id
    redirectLinkId = link.id
    utmSource      = link.utm_source  || 'direto'
    utmMedium      = link.utm_medium  || 'link'
    utmCampaign    = link.utm_campaign
    utmContent     = link.utm_content
    utmTerm        = link.utm_term
  } else {
    // ---- Modo legado: mantido vivo. O link da bio já divulgado usa este formato. ----
    const { data: instanceByToken } = await supabase
      .from('whatsapp_instances')
      .select('clinic_id')
      .eq('connect_token', connectToken)
      .maybeSingle()

    if (!instanceByToken?.clinic_id) return fail('Clínica não encontrada ou WhatsApp não configurado.', 404)

    clinicId    = instanceByToken.clinic_id
    utmSource   = url.searchParams.get('utm_source')   || 'direto'
    utmMedium   = url.searchParams.get('utm_medium')   || 'link'
    utmCampaign = url.searchParams.get('utm_campaign') || null
    utmContent  = url.searchParams.get('utm_content')  || null
    utmTerm     = url.searchParams.get('utm_term')     || null

    // O link antigo (já impresso na bio do cliente) não carrega o código do gerenciador. Casamos
    // pelas UTMs para que ele também alimente as métricas por link — assim ninguém precisa trocar
    // o link que já está publicado.
    const { data: matched } = await supabase
      .from('redirect_links')
      .select('id')
      .eq('clinic_id', clinicId)
      .eq('utm_source', utmSource)
      .eq('utm_medium', utmMedium)
      .is('archived_at', null)
      .limit(1)
      .maybeSingle()

    redirectLinkId = matched?.id ?? null
  }

  // Telefone + mensagem pré-preenchida da instância da clínica
  const { data: instance } = await supabase
    .from('whatsapp_instances')
    .select('phone_number, redirect_message')
    .eq('clinic_id', clinicId)
    .not('phone_number', 'is', null)
    .limit(1)
    .maybeSingle()

  if (!instance?.phone_number) return fail('WhatsApp não configurado para esta clínica.', 404)

  // Grava o clique. `protocolo` é UNIQUE: em colisão, re-sorteia (antes o erro era ignorado e o
  // clique se perdia). `rast_id` é a identidade e PODE repetir — é o que agrupa a jornada.
  let protocolo = ''
  let saved = false
  for (let attempt = 0; attempt < MAX_INSERT_ATTEMPTS; attempt++) {
    protocolo = genProtocol()
    const { error } = await supabase.from('link_sessions').insert({
      protocolo:        protocolo,
      rast_id:          rastId,
      clinic_id:        clinicId,
      redirect_link_id: redirectLinkId,
      utm_source:       utmSource,
      utm_medium:       utmMedium,
      utm_campaign:     utmCampaign,
      utm_content:      utmContent,
      utm_term:         utmTerm,
    })

    if (!error) { saved = true; break }
    if (error.code !== '23505') {  // 23505 = unique_violation -> re-sorteia o protocolo
      console.error('link_sessions insert falhou:', error)
      break
    }
  }

  // Sem sessão gravada o clique não vira atribuição. Melhor mandar a pessoa para o WhatsApp
  // sem protocolo (conversa acontece, lead fica orgânico) do que com um protocolo de outra sessão.
  if (!saved) {
    console.error('não foi possível registrar o clique após', MAX_INSERT_ATTEMPTS, 'tentativas')
    protocolo = ''
  }

  const phone = instance.phone_number.replace(/\D/g, '')
  const customMsg = instance.redirect_message?.trim() || 'Olá! Gostaria de mais informações.'
  const fullText = protocolo
    ? `${customMsg} [Protocolo ${protocolo} não apague essa mensagem]`
    : customMsg
  const waUrl = `https://wa.me/${phone}?text=${encodeURIComponent(fullText)}`

  // Devolve a IDENTIDADE (não o protocolo) para o app gravar no cookie. Era exatamente o inverso
  // antes: o cookie guardava o protocolo, que muda a cada clique e portanto não identificava nada.
  if (format === 'json') {
    return new Response(JSON.stringify({ rast_id: rastId, protocolo, wa_url: waUrl }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

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
  document.cookie = "rast_id=${rastId}; expires=" + expires + "; path=/; SameSite=Lax";
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
