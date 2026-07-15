// site-script — serve o script de rastreamento do site, POR CLÍNICA.
//
// O site do cliente cola UMA linha:
//   <script src="https://…/functions/v1/site-script?c=<clinic_id>" defer></script>
//
// Por que existe: até 15/07 o script (58 KB) era COLADO INLINE em cada WordPress, com clinic_id
// e telefone hardcoded por site. Toda mudança exigia visitar todos os sites — e foi por isso que
// os sites continuaram apontando para o n8n meses depois da migração. Servindo daqui, mudou o
// script no banco → TODOS os sites atualizam sozinhos (até o TTL do cache expirar).
//
// Fonte única: system_settings.global_tracking_script (editável no Super Admin). Esta edge só
// resolve os placeholders {{CLINIC_ID}} / {{PHONE}} / {{WA_PRE_MSG}} — os MESMOS que Settings.tsx
// substituía ao gerar o texto para copiar (clinics.phone / clinics.wa_pre_msg).
//
// Regra de ouro: esta função responde no <head> de páginas de clientes. NUNCA devolver erro que
// quebre a página — clínica inexistente/config ausente devolve um JS de comentário (HTTP 200) e
// registra na Central de Erros.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const JS_HEADERS = {
  'Content-Type': 'application/javascript; charset=utf-8',
  // 1h de cache no navegador/CDN: os sites não martelam a edge, e uma mudança no script
  // propaga em no máximo 1h. Ajustar aqui se um dia precisar de rollout mais rápido.
  'Cache-Control': 'public, max-age=3600',
  'Access-Control-Allow-Origin': '*',
};

function jsResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: JS_HEADERS });
}

function jsComment(msg: string): Response {
  // 200 de propósito: um 4xx/5xx em <script src> gera erro no console do site do cliente.
  return jsResponse(`/* site-script: ${msg} */\n`, 200);
}

async function registrarErro(
  code: string,
  title: string,
  clinicId: string | null,
  ctx: unknown,
): Promise<void> {
  try {
    const supa = createClient(SUPABASE_URL, SERVICE_KEY);
    const { error: rpcError } = await supa.rpc('log_system_error', {
      p_scope: 'site-script',
      p_code: code,
      p_title: title,
      p_level: 'error',
      p_clinic_id: clinicId,
      p_context: ctx ?? {},
      p_is_monitor: false,
    });
    // supabase-js NÃO lança em erro de RPC — sem esta linha a falha é invisível (foi assim que
    // 'warning' × CHECK 'warn' passou despercebido até 15/07).
    if (rpcError) console.error('[site-script] log_system_error falhou:', rpcError.message);
  } catch (e) {
    console.error('[site-script] falhou ao registrar erro', e);
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: JS_HEADERS });
  if (req.method !== 'GET') return jsComment('use GET');

  const url = new URL(req.url);
  const clinicId = (url.searchParams.get('c') ?? '').trim();
  const supa = createClient(SUPABASE_URL, SERVICE_KEY);

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clinicId)) {
    await registrarErro('clinic_id_invalido', 'site-script chamado sem clinic_id válido', null, {
      c_recebido: clinicId, referer: req.headers.get('referer'),
    });
    return jsComment('parametro c ausente ou invalido');
  }

  try {
    const [{ data: setting }, { data: clinic }] = await Promise.all([
      supa.from('system_settings').select('value').eq('id', 'global_tracking_script').maybeSingle(),
      supa.from('clinics').select('id, phone, wa_pre_msg').eq('id', clinicId).maybeSingle(),
    ]);

    if (!clinic) {
      await registrarErro('clinica_nao_encontrada', 'site-script chamado para clínica inexistente', null, {
        clinic_id: clinicId, referer: req.headers.get('referer'),
      });
      return jsComment('clinica nao encontrada');
    }
    if (!setting?.value) {
      await registrarErro('script_fonte_ausente', 'global_tracking_script vazio no system_settings', clinicId, {});
      return jsComment('script nao configurado');
    }

    // O blob vem com a tag <script> em volta (era colado no HTML); aqui servimos JS puro.
    let js = String(setting.value)
      .replace(/^\s*<script[^>]*>/i, '')
      .replace(/<\/script>\s*$/i, '');

    const phone = (clinic.phone ?? '').replace(/\D/g, '') || 'SEUNUMERO';
    const preMsg = (clinic.wa_pre_msg ?? '') || 'Olá! Vim do site.';

    js = js
      .replace(/{{CLINIC_ID}}/g, clinic.id)
      .replace(/{{PHONE}}/g, phone)
      .replace(/{{WA_PRE_MSG}}/g, preMsg.replace(/"/g, '\\"'));

    return jsResponse(js);
  } catch (e) {
    await registrarErro('ciclo_falhou', 'Erro inesperado servindo o site-script', clinicId, {
      erro: e instanceof Error ? e.message : String(e),
    });
    return jsComment('erro interno');
  }
});
