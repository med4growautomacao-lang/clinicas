import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function decryptPin(pin_encrypted: string, userId: string, clinicId: string, secret: string): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), 'PBKDF2', false, ['deriveKey']
  );
  const key = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: new TextEncoder().encode(`prontuario:recovery:${userId}:${clinicId}`),
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );
  const combined = Uint8Array.from(atob(pin_encrypted.slice('enc:'.length)), c => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const data = combined.slice(12);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
  return new TextDecoder().decode(decrypted);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const RECOVERY_SECRET = Deno.env.get('PRONTUARIO_RECOVERY_SECRET');
    if (!RECOVERY_SECRET) throw new Error('PRONTUARIO_RECOVERY_SECRET não configurado');

    const jwt = req.headers.get('Authorization')?.replace('Bearer ', '');
    if (!jwt) throw new Error('Unauthorized');

    const { target_user_id, clinic_id, requester_password } = await req.json();
    if (!target_user_id || !clinic_id || !requester_password) throw new Error('Parâmetros incompletos');

    // Identifica o solicitante via JWT
    const supabaseUser = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { autoRefreshToken: false, persistSession: false } }
    );
    const { data: { user } } = await supabaseUser.auth.getUser();
    if (!user?.email) throw new Error('Usuário não autenticado');

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Verifica role: somente medico ou medico_gestor da clínica
    const { data: clinicUser } = await supabaseAdmin
      .from('clinic_users')
      .select('role')
      .eq('id', user.id)
      .eq('clinic_id', clinic_id)
      .maybeSingle();

    if (!clinicUser || !['medico', 'medico_gestor'].includes(clinicUser.role)) {
      return new Response(JSON.stringify({ error: 'Acesso negado para este perfil' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403,
      });
    }

    // Re-autentica com a senha informada
    const anonClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    );
    const { error: authError } = await anonClient.auth.signInWithPassword({
      email: user.email,
      password: requester_password,
    });
    if (authError) {
      return new Response(JSON.stringify({ error: 'Senha incorreta' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 401,
      });
    }

    // Busca pin_encrypted do médico alvo
    const { data: pinData } = await supabaseAdmin
      .from('prontuario_passwords')
      .select('pin_encrypted')
      .eq('user_id', target_user_id)
      .eq('clinic_id', clinic_id)
      .maybeSingle();

    if (!pinData?.pin_encrypted) {
      return new Response(JSON.stringify({ error: 'PIN não disponível para recuperação. O médico deve acessar o módulo de prontuários para gerar seu PIN.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404,
      });
    }

    const pin = await decryptPin(pinData.pin_encrypted, target_user_id, clinic_id, RECOVERY_SECRET);

    return new Response(JSON.stringify({ pin }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});
