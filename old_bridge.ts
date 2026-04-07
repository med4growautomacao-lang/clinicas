import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const body = await req.json()
    const { action } = body
    const connect_token = body.connect_token || body.token
    let clinic_id = body.clinic_id

    // Dados da inst├óncia (api_id, api_token)
    let api_id = null;
    let api_token = null;

    if (connect_token && !clinic_id) {
      const { data: instance, error: instanceError } = await supabaseClient
        .from('whatsapp_instances')
        .select('clinic_id, api_id, api_token')
        .eq('connect_token', connect_token)
        .maybeSingle();

      if (instanceError) throw instanceError;
      
      if (instance) {
        clinic_id = instance.clinic_id;
        api_id = instance.api_id;
        api_token = instance.api_token;
      }
    } else if (clinic_id) {
      // Se j├í temos a cl├¡nica, buscamos os dados da inst├óncia dela
      const { data: instance } = await supabaseClient
        .from('whatsapp_instances')
        .select('api_id, api_token')
        .eq('clinic_id', clinic_id)
        .maybeSingle();
      
      if (instance) {
        api_id = instance.api_id;
        api_token = instance.api_token;
      }
    }

    if (!clinic_id) {
      return new Response(JSON.stringify({ success: false, error: 'Clinica nao identificada' }), { 
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      })
    }

    const { data: clinicData } = await supabaseClient.from('clinics').select('name').eq('id', clinic_id).single();

    const webhookUrl = Deno.env.get('WHATSAPP_CONNECTION_WEBHOOK')

    const payload = {
      event: 'whatsapp_connection_requested',
      action: action || 'connect',
      clinic_id,
      clinic_name: clinicData?.name || 'Cl├¡nica Desconhecida',
      api_id,
      api_token,
      timestamp: new Date().toISOString()
    }

    console.log(`[WH-BRIDGE] Triggering n8n with clinic: ${clinic_id} (${clinicData?.name})`);

    const response = await fetch(webhookUrl!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })

    const responseText = await response.text();

    return new Response(JSON.stringify({ 
      success: response.ok, 
      n8n_response: responseText,
      sent_payload: payload 
    }), { 
      status: response.ok ? 200 : 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    })

  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error.message }), { 
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    })
  }
})
