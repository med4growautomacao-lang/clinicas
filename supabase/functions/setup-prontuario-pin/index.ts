import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function encryptPin(pin: string, userId: string, clinicId: string, secret: string): Promise<string> {
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
    ['encrypt']
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(pin));
  const combined = new Uint8Array(12 + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), 12);
  return 'enc:' + btoa(String.fromCharCode(...combined));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const RECOVERY_SECRET = Deno.env.get('PRONTUARIO_RECOVERY_SECRET');
    if (!RECOVERY_SECRET) throw new Error('PRONTUARIO_RECOVERY_SECRET não configurado');

    const jwt = req.headers.get('Authorization')?.replace('Bearer ', '');
    if (!jwt) throw new Error('Unauthorized');

    const { pin, clinic_id } = await req.json();
    if (!pin || !clinic_id) throw new Error('pin e clinic_id são obrigatórios');

    const supabaseUser = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { autoRefreshToken: false, persistSession: false } }
    );
    const { data: { user } } = await supabaseUser.auth.getUser();
    if (!user) throw new Error('Usuário não autenticado');

    const pin_encrypted = await encryptPin(pin, user.id, clinic_id, RECOVERY_SECRET);

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { error } = await supabaseAdmin
      .from('prontuario_passwords')
      .update({ pin_encrypted })
      .eq('user_id', user.id)
      .eq('clinic_id', clinic_id);

    if (error) throw error;

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});
