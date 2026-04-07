import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const body = await req.json()
    // Aceitamos 'token' ou 'connect_token' para compatibilidade
    const { action } = body
    const connect_token = body.connect_token || body.token
    let clinic_id = body.clinic_id

    console.log(`[WH-BRIDGE] Action: ${action}, Clinic: ${clinic_id}, Token: ${connect_token}`);

    // Resolve clinic_id se houver token
    if (connect_token && !clinic_id) {
      console.log(`[WH-BRIDGE] Resolving clinic_id from token: ${connect_token}`);
      const { data: instance, error: instanceError } = await supabaseClient
        .from('whatsapp_instances')
        .select('clinic_id')
        .eq('connect_token', connect_token)
        .maybeSingle();

      if (instanceError) throw instanceError;
      
      if (instance) {
        clinic_id = instance.clinic_id;
        console.log(`[WH-BRIDGE] Resolved Clinic ID: ${clinic_id}`);
      }
    }

    if (!clinic_id) {
      console.error("[WH-BRIDGE] Error: Clinic ID not provided or could not be resolved.");
      return new Response(
        JSON.stringify({ success: false, error: 'Clínica não identificada. Verifique o token.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const webhookUrl = Deno.env.get('WHATSAPP_CONNECTION_WEBHOOK')
    
    if (!webhookUrl) {
      console.error("[WH-BRIDGE] CRITICAL: WHATSAPP_CONNECTION_WEBHOOK is MISSING in Supabase Secrets!");
      return new Response(
        JSON.stringify({ success: false, error: 'Configuração do integrador (Webhook) ausente no servidor.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Busca o nome da clínica para enriquecer o payload do n8n
    const { data: clinicData } = await supabaseClient
      .from('clinics')
      .select('name')
      .eq('id', clinic_id)
      .single();

    const payload = {
      event: 'whatsapp_connection_requested', // Nome do evento padronizado
      action: action || 'connect',
      clinic_id,
      clinic_name: clinicData?.name || 'Clínica Desconhecida',
      timestamp: new Date().toISOString()
    }

    console.log("[WH-BRIDGE] Triggering n8n webhook:", webhookUrl);

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })

    const responseText = await response.text();
    console.log(`[WH-BRIDGE] n8n Response (${response.status}):`, responseText);

    if (!response.ok) {
      throw new Error(`O integrador retornou erro ${response.status}: ${responseText}`);
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Comando de conexão enviado com sucesso!',
        n8n_response: responseText 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('[WH-BRIDGE] Fatal Error:', error.message)
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
