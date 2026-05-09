import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { target_user_id, target_email, clinic_id } = await req.json();

    if (!target_user_id || !target_email || !clinic_id) {
      throw new Error('target_user_id, target_email e clinic_id são obrigatórios');
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const password = Array.from({ length: 8 }, () =>
      CHARS[Math.floor(Math.random() * CHARS.length)]
    ).join("");

    const hash = await sha256(password);

    const { error: upsertError } = await supabase
      .from('prontuario_passwords')
      .upsert(
        { clinic_id, user_id: target_user_id, email: target_email, password_hash: hash },
        { onConflict: 'user_id,clinic_id' }
      );

    if (upsertError) throw upsertError;

    const resendKey = Deno.env.get('RESEND_API_KEY');
    if (!resendKey) throw new Error('RESEND_API_KEY não configurado');

    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: Deno.env.get('EMAIL_FROM') ?? 'noreply@navs.com.br',
        to: [target_email],
        subject: 'Sua senha de acesso ao Prontuário',
        html: `
          <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:32px">
            <h2 style="color:#0f766e;margin-bottom:8px">Acesso ao Prontuário</h2>
            <p style="color:#475569">Sua senha de acesso ao módulo de Prontuários é:</p>
            <div style="background:#f1f5f9;border-radius:12px;padding:20px;text-align:center;margin:20px 0">
              <span style="font-size:28px;font-weight:bold;letter-spacing:6px;color:#0f172a">${password}</span>
            </div>
            <p style="color:#64748b;font-size:13px">Guarde esta senha em local seguro. Ela é necessária para acessar dados sensíveis de pacientes.</p>
          </div>
        `,
      }),
    });

    if (!emailRes.ok) {
      const emailErr = await emailRes.text();
      throw new Error(`Erro ao enviar email: ${emailErr}`);
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});
