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
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    const { email, password, name, clinic_id, specialty, crm } = await req.json();

    if (!email || !name || !clinic_id) {
      throw new Error('E-mail, nome e clinic_id são obrigatórios');
    }

    let userId: string;

    // 1. Verificar se o usuário já existe em public.users
    const { data: existingUser, error: findError } = await supabaseClient
      .from('users')
      .select('id, role')
      .eq('email', email)
      .maybeSingle();

    if (existingUser) {
      userId = existingUser.id;
      console.log(`Usuário existente encontrado: ${userId} com cargo ${existingUser.role}`);
    } else {
      // 2. Criar novo usuário no Auth se não existir
      if (!password) throw new Error('Senha é obrigatória para novos usuários');

      const { data: authUser, error: authError } = await supabaseClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: name, clinic_id }
      });

      if (authError) throw authError;
      userId = authUser.user.id;

      // 3. Criar perfil em public.users
      const { error: userError } = await supabaseClient
        .from('users')
        .insert({
          id: userId,
          clinic_id,
          role: 'medico',
          full_name: name,
          email: email
        });

      if (userError) throw userError;
    }

    // 4. Verificar se já existe um perfil de médico para este usuário na mesma clínica
    const { data: existingDoctor } = await supabaseClient
      .from('doctors')
      .select('id')
      .eq('user_id', userId)
      .eq('clinic_id', clinic_id)
      .maybeSingle();

    if (existingDoctor) {
      throw new Error('Este usuário já está cadastrado como médico nesta clínica.');
    }

    // 5. Criar registro em public.doctors
    const { data: doctor, error: doctorError } = await supabaseClient
      .from('doctors')
      .insert({
        user_id: userId,
        clinic_id,
        name,
        specialty,
        crm,
        status: 'offline'
      })
      .select()
      .single();

    if (doctorError) throw doctorError;

    return new Response(JSON.stringify(doctor), {
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
