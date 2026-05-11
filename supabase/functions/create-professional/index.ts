import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { email, name, clinic_id, specialty, crm } = await req.json();

    if (!email || !name || !clinic_id) {
      throw new Error('E-mail, nome e clinic_id são obrigatórios');
    }

    let userId: string;
    let isNewUser = false;

    // 1. Verificar se o usuário já existe em auth.users
    const { data: { users: existingUsers } } = await supabaseClient.auth.admin.listUsers();
    const existingAuthUser = existingUsers?.find(u => u.email === email);

    if (existingAuthUser) {
      userId = existingAuthUser.id;
    } else {
      // 2. Criar via convite — Supabase envia email para o médico definir a própria senha
      const { data: inviteData, error: inviteError } = await supabaseClient.auth.admin.inviteUserByEmail(email, {
        data: { full_name: name, clinic_id },
      });
      if (inviteError) throw inviteError;
      userId = inviteData.user.id;
      isNewUser = true;
    }

    // 3. Verificar se já existe médico nesta clínica
    const { data: existingDoctor } = await supabaseClient
      .from('doctors')
      .select('id')
      .eq('user_id', userId)
      .eq('clinic_id', clinic_id)
      .maybeSingle();

    if (existingDoctor) {
      throw new Error('Este usuário já está cadastrado como médico nesta clínica.');
    }

    // 4. Criar/atualizar perfil em clinic_users
    const { error: cuError } = await supabaseClient
      .from('clinic_users')
      .upsert(
        { id: userId, clinic_id, role: 'medico', full_name: name, email },
        { onConflict: 'id' }
      );
    if (cuError) throw cuError;

    // 5. Criar registro em doctors
    const { data: doctor, error: doctorError } = await supabaseClient
      .from('doctors')
      .insert({ user_id: userId, clinic_id, name, specialty, crm, status: 'offline' })
      .select()
      .single();

    if (doctorError) throw doctorError;

    return new Response(JSON.stringify({ ...doctor, invited: isNewUser }), {
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
