import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  console.log(`Recebido request: ${req.method}`)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const body = await req.json()
    let { clinic_id, action, token } = body
    console.log(`action: ${action} | clinic_id: ${clinic_id} | token: ${token}`)

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Se tiver token mas não clinic_id, busca a clínica pelo token
    if (token && !clinic_id) {
      const { data: inst } = await supabaseClient
        .from('whatsapp_instances')
        .select('clinic_id')
        .eq('connect_token', token)
        .maybeSingle()
      
      if (inst) clinic_id = inst.clinic_id
    }

    if (!clinic_id) {
      return new Response(
        JSON.stringify({ success: false, error: 'Clinica nao identificada.' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    // ── Criar grupo de notificações ──────────────────────────────────────────
    if (action === 'create_group') {
      const { group_name, participants } = body

      const webhookUrl = Deno.env.get('WHATSAPP_GROUP_WEBHOOK') ?? Deno.env.get('WHATSAPP_CONNECTION_WEBHOOK')
      if (!webhookUrl) {
        return new Response(
          JSON.stringify({ success: false, error: 'Secret WHATSAPP_GROUP_WEBHOOK não configurada.' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        )
      }

      const { data: instance } = await supabaseClient
        .from('whatsapp_instances')
        .select('api_id, api_token')
        .eq('clinic_id', clinic_id)
        .maybeSingle()

      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'create_group',
          clinic_id,
          group_name,
          participants,
          api_id: instance?.api_id,
          api_token: instance?.api_token,
          timestamp: new Date().toISOString(),
        }),
      })

      if (!response.ok) {
        throw new Error(`n8n retornou erro: ${response.status}`)
      }

      return new Response(
        JSON.stringify({ success: true, message: 'Grupo criado com sucesso.' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      )
    }

    // ── Conexão WhatsApp (comportamento original) ────────────────────────────
    const n8nWebhookUrl = Deno.env.get('WHATSAPP_CONNECTION_WEBHOOK')
    if (!n8nWebhookUrl) {
      return new Response(
        JSON.stringify({ success: false, error: 'Secret WHATSAPP_CONNECTION_WEBHOOK não configurada.' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

    const { data: instance, error: instanceError } = await supabaseClient
      .from('whatsapp_instances')
      .select('api_id, api_token')
      .eq('clinic_id', clinic_id)
      .maybeSingle()

    if (instanceError) throw new Error(`Erro ao buscar instância: ${instanceError.message}`)

    const response = await fetch(n8nWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'whatsapp_connection_requested',
        clinic_id,
        api_id: instance?.api_id,
        api_token: instance?.api_token,
        timestamp: new Date().toISOString(),
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`ERRO no n8n: ${response.status} - ${errorText}`)
      throw new Error(`O n8n retornou um erro: ${response.status}`)
    }

    const result = await response.text()
    console.log('Webhook n8n disparado com sucesso!')

    return new Response(
      JSON.stringify({ success: true, message: 'Conexão iniciada com sucesso via n8n', result }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )
  } catch (error) {
    console.error(`Erro na função: ${error.message}`)
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }
})
