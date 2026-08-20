// wordpress-integrator — instala/valida o script de rastreamento no WordPress do cliente,
// detectando o caminho por site (DETECTA e ESCOLHE). Usa a credencial da clínica guardada em
// clinic_external_integrations (URL + usuário + Application Password), fornecida pelo próprio
// cliente na aba Integração Externa.
//
// DUAS ações:
//   - 'audit'  → só LEITURA. Diz o estado do site e QUAL caminho serve (nunca escreve nada).
//   - 'apply'  → EXECUTA o caminho recomendado e valida relendo o HTML público.
//
// Caminhos (ver pesquisa 20/08/2026):
//   - elementor_pro  → cria o Custom Code (CPT elementor_snippet) via REST. Funciona HOJE em
//                      Elementor Pro >= 3.32 (a LP da São Lucas é a prova viva). Zero instalação.
//   - plugin_proprio → instala nosso mini-plugin do diretório oficial e configura o clinic_id.
//                      Cobre Elementor Free/tema clássico/Gutenberg. Só liga quando o plugin
//                      estiver publicado (env MEDDESK_WP_PLUGIN_SLUG); até lá reporta 'plugin_pendente'.
//   - manual         → hospedagem sem instalação por API, multisite, ou usuário sem unfiltered_html.
//
// A parede do WordPress: <script> cru é removido (kses) de quem não tem 'unfiltered_html' (o caso
// do subsite de multisite), SEM erro. Por isso o apply do Elementor Pro RELÊ o snippet: se a tag
// sumiu, o caminho falhou e vira 'manual'.
//
// Erro que importa vai para a Central (§0.5). Nunca toca a uazapi nem envia mensagem.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

// Base do nosso site-script (a MESMA linha que já roda nos sites migrados).
const SITE_SCRIPT_BASE = `${SUPABASE_URL}/functions/v1`;
// Slug do nosso mini-plugin no diretório oficial. Vazio = ainda não publicado (caminho plugin desligado).
const PLUGIN_SLUG = Deno.env.get('MEDDESK_WP_PLUGIN_SLUG') ?? '';
// Nome da option que o mini-plugin lê para imprimir a tag (registrada com show_in_rest).
const PLUGIN_OPTION = 'meddesk_clinic_id';

const SNIPPET_TITLE = 'MedDesk Tracking';
const WP_TIMEOUT_MS = 15000;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function tagFor(clinicId: string): string {
  return `<script src="${SITE_SCRIPT_BASE}/site-script?c=${clinicId}" defer></script>`;
}

// Anti-SSRF: a URL vem do banco (gestor da clínica preenche na tela), então validamos o destino
// antes de qualquer fetch. Bloqueia esquema não-http(s) e hosts de rede interna/metadados de nuvem
// (169.254.169.254 etc.). Não resolve DNS aqui (edge sem esse recurso), então rebind por DNS é um
// resíduo conhecido — o vetor direto (apontar para IP interno) fica fechado.
function hostBloqueado(hostRaw: string): boolean {
  const h = hostRaw.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || h === 'metadata.google.internal') return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = +m[1], b = +m[2];
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;            // link-local + metadados de nuvem
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a >= 224) return true;                           // multicast/reservado
  }
  if (h === '::1' || h === '::' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')) return true;
  return false;
}
function validarUrlPublica(raw: string): { ok: boolean; motivo?: string } {
  let u: URL;
  try { u = new URL(raw); } catch { return { ok: false, motivo: 'Endereço do site inválido.' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, motivo: 'O endereço do site precisa começar com http:// ou https://.' };
  if (hostBloqueado(u.hostname)) return { ok: false, motivo: 'Endereço de rede interna não é permitido.' };
  return { ok: true };
}

async function registrarErro(
  code: string,
  title: string,
  level: string,
  clinicId: string | null,
  ctx: unknown,
): Promise<void> {
  try {
    const supa = createClient(SUPABASE_URL, SERVICE_KEY);
    const { error } = await supa.rpc('log_system_error', {
      p_scope: 'wordpress-integrator',
      p_code: code,
      p_title: title,
      p_level: level,
      p_clinic_id: clinicId,
      p_context: ctx ?? {},
      p_is_monitor: false,
    });
    if (error) console.error('[wordpress-integrator] log_system_error falhou:', error.message);
  } catch (e) {
    console.error('[wordpress-integrator] falhou ao registrar erro', e);
  }
}

// Chamada autenticada à REST do WordPress do cliente. Nunca lança: devolve status + corpo.
async function wp(
  base: string,
  b64: string,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<{ ok: boolean; status: number; body: any; text: string; headers: Headers | null; erro?: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), WP_TIMEOUT_MS);
  try {
    const res = await fetch(base + path, {
      method: init?.method ?? 'GET',
      headers: {
        Authorization: 'Basic ' + b64,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: init?.body != null ? JSON.stringify(init.body) : undefined,
      signal: ctrl.signal,
    });
    const text = await res.text();
    let body: any = null;
    try { body = JSON.parse(text); } catch { /* nem toda resposta é JSON */ }
    return { ok: res.ok, status: res.status, body, text, headers: res.headers };
  } catch (e) {
    return { ok: false, status: 0, body: null, text: '', headers: null, erro: String(e) };
  } finally {
    clearTimeout(t);
  }
}

// Busca o HTML público de uma URL, furando cache com um parâmetro único. Só leitura.
async function fetchHtml(url: string): Promise<{ ok: boolean; status: number; html: string; headers: Headers | null }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), WP_TIMEOUT_MS);
  const sep = url.includes('?') ? '&' : '?';
  try {
    const res = await fetch(`${url}${sep}_wpi=${Date.now()}`, { signal: ctrl.signal, redirect: 'follow' });
    const html = await res.text();
    return { ok: res.ok, status: res.status, html, headers: res.headers };
  } catch {
    return { ok: false, status: 0, html: '', headers: null };
  } finally {
    clearTimeout(t);
  }
}

// A CSP do cliente pode bloquear nosso script no navegador MESMO com a tag presente. Heurística:
// se há CSP e a diretiva de script não cita nosso host nem libera geral, é risco a sinalizar.
function analisaCsp(headers: Headers | null): { presente: boolean; libera_nosso_host: boolean | null } {
  const csp = headers?.get('content-security-policy');
  if (!csp) return { presente: false, libera_nosso_host: null };
  const host = new URL(SUPABASE_URL).host;
  const diretiva = (csp.match(/script-src[^;]*/i) || csp.match(/default-src[^;]*/i) || [''])[0].toLowerCase();
  if (!diretiva) return { presente: true, libera_nosso_host: null };
  const liberado = diretiva.includes(host) || diretiva.includes('*') || diretiva.includes('https:');
  return { presente: true, libera_nosso_host: liberado };
}

function detectaCache(headers: Headers | null): string | null {
  if (!headers) return null;
  if (headers.get('cf-cache-status')) return 'cloudflare';
  if (headers.get('x-rocket-nginx-serving-static') || headers.get('wp-rocket')) return 'wp-rocket';
  if (headers.get('x-litespeed-cache')) return 'litespeed';
  const via = headers.get('x-cache') || headers.get('x-proxy-cache');
  if (via) return `cache:${via}`;
  return null;
}

interface Auditoria {
  wp_ok: boolean;
  wp_status: number;
  usuario: string | null;
  is_admin: boolean;
  tem_unfiltered_html: boolean;
  tema: { nome: string | null; bloco: boolean | null };
  elementor_pro_custom_code: boolean;
  snippet_existente_id: number | null;
  script_na_home: boolean;
  script_desta_clinica: boolean;
  csp: { presente: boolean; libera_nosso_host: boolean | null };
  cache: string | null;
  // Formulários Elementor do site e se o webhook aponta para a nossa captação. null = sem formulário.
  formularios: { total: number; conectados: number; outro_webhook: number } | null;
  // Botões de WhatsApp no site e botão flutuante. null = nenhum caminho de WhatsApp no site.
  // verificavel = há número da clínica para comparar E ao menos um botão carrega número.
  whatsapp: { botoes: number; com_numero: number; numero_certo: number; verificavel: boolean; flutuante: boolean } | null;
  caminho_recomendado: 'ja_instalado' | 'elementor_pro' | 'plugin_proprio' | 'plugin_pendente' | 'manual';
  bloqueios: string[];
}

// Varre o JSON do Elementor de uma página: classifica o webhook dos formulários (conectado à
// nossa captação, de terceiro, ou sem webhook) e conta botões de WhatsApp (e quantos usam o
// número da clínica — comparação pelos 8 últimos dígitos, imune ao 9º dígito).
function statsPagina(
  elementorRaw: string, token: string | null, clinicLast8: string | null,
): { formTotal: number; formConect: number; formOutro: number; waTotal: number; waComNumero: number; waCertos: number } {
  const st = { formTotal: 0, formConect: 0, formOutro: 0, waTotal: 0, waComNumero: 0, waCertos: 0 };
  let data: any;
  try { data = JSON.parse(elementorRaw); } catch { return st; }
  const walk = (nodes: any[]) => {
    for (const n of nodes || []) {
      const s = n?.settings ?? {};
      if (n?.widgetType === 'form') {
        st.formTotal++;
        const actions: string[] = Array.isArray(s.submit_actions) ? s.submit_actions : [];
        const hooks = String(s.webhooks ?? '');
        // "conectado" exige a AÇÃO webhook ligada, não só a URL no campo — senão um form com a
        // ação removida (mas a URL sobrando) apareceria verde sem disparar nada.
        const nosso = actions.includes('webhook') && hooks.includes('external-forms-ingest') && (!token || hooks.includes(token));
        if (nosso) st.formConect++;
        else if (actions.includes('webhook') && hooks.length > 0) st.formOutro++;
      }
      const url = String(s?.link?.url ?? s?.button_link?.url ?? '');
      if (/wa\.me|api\.whatsapp|whatsapp/i.test(url)) {
        st.waTotal++;
        // Só compara quando o link CARREGA um número (wa.me/<num> ou phone=<num>). Links como
        // wa.me/message/XXX não têm número e não podem virar "número diferente".
        const m = url.match(/(?:wa\.me\/\+?|phone=\+?)(\d{8,})/);
        if (m) {
          st.waComNumero++;
          if (clinicLast8 && m[1].slice(-8) === clinicLast8) st.waCertos++;
        }
      }
      if (Array.isArray(n?.elements)) walk(n.elements);
    }
  };
  walk(data);
  return st;
}

async function auditar(
  base: string, b64: string, clinicId: string,
  captureToken: string | null, captureEnabled: boolean, clinicLast8: string | null,
): Promise<Auditoria> {
  const bloqueios: string[] = [];

  // 1) Quem sou eu no WordPress (autentica + caps).
  const me = await wp(base, b64, '/wp-json/wp/v2/users/me?context=edit');
  const wp_ok = me.ok;
  const caps = me.body?.capabilities ?? {};
  const roles: string[] = me.body?.roles ?? [];
  const is_admin = roles.includes('administrator') || caps.manage_options === true;
  const tem_unfiltered_html = caps.unfiltered_html === true;
  if (!wp_ok) {
    if (me.status === 0) bloqueios.push('Não foi possível acessar o site (fora do ar, endereço errado ou muito lento).');
    else if (me.status === 401 || me.status === 403) bloqueios.push('WordPress recusou a credencial — usuário ou senha de aplicativo inválidos/revogados.');
    else bloqueios.push(`WordPress respondeu HTTP ${me.status} — a REST pode estar bloqueada por firewall ou plugin de segurança.`);
  }
  else if (!is_admin) bloqueios.push('O usuário da senha de aplicativo não é administrador.');
  else if (!tem_unfiltered_html) bloqueios.push('O usuário não tem permissão para inserir <script> (unfiltered_html) — típico de site em rede/multisite.');

  // 2) Tipo do Custom Code do Elementor Pro (CPT elementor_snippet exposto?).
  let elementor_pro_custom_code = false;
  let snippet_existente_id: number | null = null;
  if (wp_ok) {
    const types = await wp(base, b64, '/wp-json/wp/v2/types?context=edit');
    elementor_pro_custom_code = !!(types.body && types.body.elementor_snippet);
    if (elementor_pro_custom_code) {
      // Já existe um snippet nosso? (procura pela tag do site-script no _elementor_code)
      // per_page alto: Custom Code costuma ter poucos snippets; assim não deixamos um snippet
      // nosso "escondido" além da 1ª página e criamos um duplicado no apply.
      const snips = await wp(base, b64, '/wp-json/wp/v2/elementor_snippet?context=edit&per_page=100&orderby=id&order=asc');
      if (Array.isArray(snips.body)) {
        const meu = snips.body.find((s: any) => String(s?.meta?._elementor_code ?? '').includes('site-script?c='));
        if (meu) snippet_existente_id = meu.id;
      }
    }
  }

  // 3) Tema (bloco/FSE ou clássico).
  let tema: { nome: string | null; bloco: boolean | null } = { nome: null, bloco: null };
  if (wp_ok) {
    const th = await wp(base, b64, '/wp-json/wp/v2/themes?status=active');
    const ativo = Array.isArray(th.body) ? th.body[0] : null;
    if (ativo) tema = { nome: ativo?.name?.rendered ?? ativo?.stylesheet ?? null, bloco: ativo?.is_block_theme ?? null };
  }

  // 4) HTML público da home: script já presente? CSP? cache?
  const home = await fetchHtml(base + '/');
  const script_na_home = home.html.includes('site-script?c=');
  const script_desta_clinica = home.html.includes(`site-script?c=${clinicId}`);
  const csp = analisaCsp(home.headers);
  const cache = detectaCache(home.headers);
  if (csp.presente && csp.libera_nosso_host === false) {
    bloqueios.push('O site envia Content-Security-Policy que não libera nosso domínio — o navegador pode bloquear o script mesmo instalado.');
  }

  // 5) Formulários e botões de WhatsApp do site (só páginas Elementor).
  let formularios: Auditoria['formularios'] = null;
  let whatsapp: Auditoria['whatsapp'] = null;
  if (wp_ok) {
    // Varre páginas, Landing Pages do Elementor Pro e posts (per_page alto). e-landing-page
    // devolve 404 quando o site não tem Landing Pages — o wp() trata e a gente ignora.
    const itens: any[] = [];
    for (const tipo of ['pages', 'e-landing-page', 'posts']) {
      const r = await wp(base, b64, `/wp-json/wp/v2/${tipo}?per_page=100&status=publish&context=edit`);
      if (Array.isArray(r.body)) itens.push(...r.body);
    }
    if (itens.length > 0) {
      const f = { total: 0, conectados: 0, outro_webhook: 0 };
      const w = { botoes: 0, com_numero: 0, numero_certo: 0 };
      for (const p of itens) {
        const ed = p?.meta?._elementor_data;
        if (!ed || typeof ed !== 'string') continue;
        const s = statsPagina(ed, captureToken, clinicLast8);
        f.total += s.formTotal; f.conectados += s.formConect; f.outro_webhook += s.formOutro;
        w.botoes += s.waTotal; w.com_numero += s.waComNumero; w.numero_certo += s.waCertos;
      }
      if (f.total > 0) {
        formularios = f;
        if (f.conectados === 0) {
          bloqueios.push('Há formulário no site sem o webhook de captação — o lead do formulário não entra no sistema.');
        } else if (!captureEnabled) {
          bloqueios.push('Formulário conectado, mas a captação está PAUSADA nas configurações — os leads não entram enquanto estiver pausada.');
        }
      }

      // Botão flutuante: plugin Click to Chat (ou similar de WhatsApp) ativo.
      let flutuante = false;
      const plug = await wp(base, b64, '/wp-json/wp/v2/plugins');
      if (Array.isArray(plug.body)) {
        flutuante = plug.body.some((p: any) =>
          p?.status === 'active' && /click-to-chat|whatsapp/i.test(String(p?.plugin ?? '') + ' ' + String(p?.textdomain ?? '')));
      }
      if (w.botoes > 0 || flutuante) {
        const verificavel = clinicLast8 != null && w.com_numero > 0;
        whatsapp = { botoes: w.botoes, com_numero: w.com_numero, numero_certo: w.numero_certo, verificavel, flutuante };
        if (verificavel && w.numero_certo < w.com_numero) {
          bloqueios.push(`Há botão de WhatsApp no site com número diferente do WhatsApp da clínica (${w.numero_certo}/${w.com_numero} corretos).`);
        }
      }
    }
  }

  // 6) Decisão de caminho.
  let caminho_recomendado: Auditoria['caminho_recomendado'];
  if (script_desta_clinica) {
    caminho_recomendado = 'ja_instalado';
  } else if (wp_ok && is_admin && tem_unfiltered_html && elementor_pro_custom_code) {
    caminho_recomendado = 'elementor_pro';
  } else if (wp_ok && is_admin) {
    caminho_recomendado = PLUGIN_SLUG ? 'plugin_proprio' : 'plugin_pendente';
  } else {
    caminho_recomendado = 'manual';
  }

  return {
    wp_ok, wp_status: me.status, usuario: me.body?.username ?? me.body?.slug ?? null,
    is_admin, tem_unfiltered_html, tema, elementor_pro_custom_code, snippet_existente_id,
    script_na_home, script_desta_clinica, csp, cache, formularios, whatsapp, caminho_recomendado, bloqueios,
  };
}

// ── APLICAR: Elementor Pro (cria/atualiza o snippet e valida) ──────────────────────────────────
async function aplicarElementorPro(
  base: string, b64: string, clinicId: string, aud: Auditoria,
): Promise<{ sucesso: boolean; estado: string; detalhe: string }> {
  const corpo = {
    title: SNIPPET_TITLE,
    status: 'publish',
    meta: { _elementor_code: tagFor(clinicId), _elementor_location: 'elementor_head', _elementor_priority: 1 },
  };
  const res = aud.snippet_existente_id
    ? await wp(base, b64, `/wp-json/wp/v2/elementor_snippet/${aud.snippet_existente_id}`, { method: 'POST', body: corpo })
    : await wp(base, b64, '/wp-json/wp/v2/elementor_snippet', { method: 'POST', body: corpo });

  if (!res.ok) {
    return { sucesso: false, estado: 'falha_escrita', detalhe: `WordPress recusou a criação do Custom Code (HTTP ${res.status}).` };
  }
  // A parede do kses: se a tag foi removida na gravação, o usuário não tem unfiltered_html.
  const gravado = String(res.body?.meta?._elementor_code ?? '');
  if (!gravado.includes('<script')) {
    return { sucesso: false, estado: 'kses_removeu', detalhe: 'O WordPress removeu a tag <script> na gravação (falta unfiltered_html). Caminho vira manual.' };
  }
  // Valida no HTML público (pode estar em cache — não é falha).
  const home = await fetchHtml(base + '/');
  if (home.html.includes(`site-script?c=${clinicId}`)) {
    return { sucesso: true, estado: 'aplicado', detalhe: 'Script confirmado no HTML público do site.' };
  }
  return {
    sucesso: true,
    estado: 'aplicado_aguardando_cache',
    detalhe: aud.cache
      ? `Snippet criado. Ainda não aparece no HTML público — provável cache (${aud.cache}). Limpar o cache do site OU aguardar a expiração.`
      : 'Snippet criado. Ainda não aparece no HTML público — reconfira em alguns minutos.',
  };
}

// ── APLICAR: mini-plugin do diretório (instala + configura). Só quando publicado. ──────────────
async function aplicarPluginProprio(
  base: string, b64: string, clinicId: string,
): Promise<{ sucesso: boolean; estado: string; detalhe: string }> {
  if (!PLUGIN_SLUG) {
    return { sucesso: false, estado: 'plugin_pendente', detalhe: 'O mini-plugin ainda não foi publicado no diretório oficial. Caminho indisponível.' };
  }
  // 1) Instalar + ativar pelo slug do diretório (core WP >= 5.5).
  const inst = await wp(base, b64, '/wp-json/wp/v2/plugins', { method: 'POST', body: { slug: PLUGIN_SLUG, status: 'active' } });
  if (!inst.ok) {
    const jaExiste = String(inst.body?.code ?? '') === 'folder_exists';
    if (jaExiste) {
      // Já instalado: garantir ativo. O "plugin file" costuma ser {slug}/{slug}.php; se a convenção
      // do nosso plugin mudar, derivar do retorno do install em vez de presumir.
      const react = await wp(base, b64, `/wp-json/wp/v2/plugins/${PLUGIN_SLUG}/${PLUGIN_SLUG}`, { method: 'POST', body: { status: 'active' } });
      if (!react.ok) {
        return { sucesso: false, estado: 'falha_ativacao', detalhe: `Plugin já instalado, mas não deu para ativá-lo (HTTP ${react.status}).` };
      }
    } else {
      return { sucesso: false, estado: 'falha_instalacao', detalhe: `Não deu para instalar o plugin (HTTP ${inst.status}). Hospedagem pode bloquear escrita de arquivos.` };
    }
  }
  // 2) Configurar o clinic_id (option registrada com show_in_rest).
  const cfg = await wp(base, b64, '/wp-json/wp/v2/settings', { method: 'POST', body: { [PLUGIN_OPTION]: clinicId } });
  if (!cfg.ok || cfg.body?.[PLUGIN_OPTION] !== clinicId) {
    return { sucesso: false, estado: 'falha_config', detalhe: 'Plugin instalado, mas não deu para gravar o identificador da clínica.' };
  }
  // 3) Validar no HTML público.
  const home = await fetchHtml(base + '/');
  if (home.html.includes(`site-script?c=${clinicId}`)) {
    return { sucesso: true, estado: 'aplicado', detalhe: 'Plugin instalado e script confirmado no site.' };
  }
  return { sucesso: true, estado: 'aplicado_aguardando_cache', detalhe: 'Plugin instalado e configurado. Ainda não aparece no HTML público — provável cache.' };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  try {
    const jwt = req.headers.get('Authorization')?.replace('Bearer ', '');
    if (!jwt) return json({ error: 'unauthorized' }, 401);

    const { clinic_id, action } = await req.json().catch(() => ({}));
    if (!clinic_id || !['audit', 'apply'].includes(action)) return json({ error: 'parametros_invalidos' }, 400);

    // Autorização: régua canônica do app can_manage_clinic — libera super-admin, gestor DESTA
    // clínica, e org_owner/org_admin da organização dona da clínica. É a mesma função que gateia
    // o gerenciamento da clínica no resto do sistema (evita divergência: o admin de organização
    // gerencia a clínica mas tomava 403 no meu check antigo, que só olhava clinic_users).
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: 'unauthorized' }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: podeGerenciar } = await userClient.rpc('can_manage_clinic', { p_clinic_id: clinic_id });
    if (podeGerenciar !== true) return json({ error: 'forbidden' }, 403);

    // Credencial do WordPress da clínica. A senha está cifrada em repouso; a RPC decifra e só
    // service_role pode chamá-la (o front nunca lê a senha de volta).
    const { data: credRows } = await admin.rpc('get_wordpress_credentials', { p_clinic_id: clinic_id });
    const cei = Array.isArray(credRows) ? credRows[0] : credRows;

    const url = (cei?.wordpress_url ?? '').trim().replace(/\/+$/, '');
    const usuario = (cei?.wordpress_username ?? '').trim();
    const senha = (cei?.app_password ?? '').trim();
    if (!url || !usuario || !senha) {
      return json({ error: 'sem_credencial', detalhe: 'Preencha endereço, usuário e senha de aplicativo do WordPress antes de integrar.' }, 400);
    }
    const urlCheck = validarUrlPublica(url);
    if (!urlCheck.ok) {
      await registrarErro('url_bloqueada', 'Endereço de WordPress recusado (anti-SSRF)', 'warning', clinic_id, { url, motivo: urlCheck.motivo });
      return json({ error: 'url_invalida', detalhe: urlCheck.motivo }, 400);
    }
    const b64 = btoa(`${usuario}:${senha}`);

    // Token/estado da captação de formulário, para checar se o webhook do site aponta para nós.
    const { data: capRow } = await admin
      .from('clinic_external_integrations')
      .select('capture_token, capture_enabled')
      .eq('clinic_id', clinic_id)
      .maybeSingle();

    // Número do WhatsApp da clínica (para conferir os botões do site). Últimos 8 dígitos = imune ao 9º.
    const { data: waInst } = await admin
      .from('whatsapp_instances')
      .select('phone_number')
      .eq('clinic_id', clinic_id)
      .not('phone_number', 'is', null)
      .limit(1)
      .maybeSingle();
    const clinicDigits = String(waInst?.phone_number ?? '').replace(/\D/g, '');
    const clinicLast8 = clinicDigits.length >= 8 ? clinicDigits.slice(-8) : null;

    const aud = await auditar(url, b64, clinic_id, capRow?.capture_token ?? null, capRow?.capture_enabled === true, clinicLast8);

    if (action === 'audit') {
      return json({ ok: true, action: 'audit', auditoria: aud });
    }

    // action === 'apply'
    if (aud.caminho_recomendado === 'ja_instalado') {
      return json({ ok: true, action: 'apply', estado: 'ja_instalado', detalhe: 'O script desta clínica já está no site.', auditoria: aud });
    }

    let r: { sucesso: boolean; estado: string; detalhe: string };
    if (aud.caminho_recomendado === 'elementor_pro') {
      r = await aplicarElementorPro(url, b64, clinic_id, aud);
    } else if (aud.caminho_recomendado === 'plugin_proprio') {
      r = await aplicarPluginProprio(url, b64, clinic_id);
    } else {
      // plugin_pendente ou manual — não há execução automática.
      r = {
        sucesso: false,
        estado: aud.caminho_recomendado,
        detalhe: aud.caminho_recomendado === 'plugin_pendente'
          ? 'Este site precisa do nosso mini-plugin, que ainda será publicado no diretório. Por ora, instalação manual.'
          : `Sem caminho automático para este site: ${aud.bloqueios.join(' ') || 'requer instalação manual.'}`,
      };
    }

    if (!r.sucesso) {
      await registrarErro(
        `apply_${r.estado}`,
        `Integração WordPress não concluída (${r.estado})`,
        r.estado === 'manual' || r.estado === 'plugin_pendente' ? 'warning' : 'error',
        clinic_id,
        { url, caminho: aud.caminho_recomendado, detalhe: r.detalhe, bloqueios: aud.bloqueios },
      );
    } else if (r.estado === 'aplicado' || r.estado === 'aplicado_aguardando_cache') {
      // A auditoria foi tirada ANTES de instalar; após o sucesso, refletir a realidade nova para o
      // painel não mostrar "ainda não instalado" logo abaixo do "Site integrado".
      aud.script_desta_clinica = true;
      aud.script_na_home = true;
      aud.caminho_recomendado = 'ja_instalado';
    }

    return json({ ok: r.sucesso, action: 'apply', estado: r.estado, detalhe: r.detalhe, auditoria: aud });
  } catch (err) {
    await registrarErro('excecao', 'Exceção no integrador WordPress', 'error', null, { erro: String(err) });
    return json({ error: 'erro_interno', detalhe: String(err) }, 500);
  }
});
