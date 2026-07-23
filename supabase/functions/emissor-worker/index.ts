// emissor-worker — drena a fila de saida (`outbound_messages`). E o UNICO lugar que fala com a
// uazapi depois que os 13 produtores forem migrados.
//
// O que ele faz que o envio inline de hoje nao faz:
//   1. TOKEN PELO GATE CANONICO (`fn_clinic_send_token`): exige instancia 'connected', token nao
//      vazio e `send_blocked_until` vencido, com `order by connected_at desc`. Hoje
//      fn_handle_confirmation_reply e notify_ops pegam `api_token ... limit 1` cru e enviam por
//      instancia DESCONECTADA (13 clinicas nesse estado) ignorando a trava anti-ban.
//   2. LE A RESPOSTA. Hoje `system_http_post` e assincrono e ninguem le o resultado; e desde a
//      migration 20260723155500 o monitor ignora timeout de proposito. Se ninguem ler aqui,
//      ninguem le em lugar nenhum.
//   3. SO REGISTRA A CONVERSA DEPOIS DO 200 (`outbound_register_chat`). Hoje todos gravam em
//      chat_messages incondicionalmente: se a uazapi recusa, o painel mente.
//   4. RETRY com backoff + DLQ, e o alerta na Central sai COM clinica, lead e produtor.
//   5. ORDEM POR CONVERSA garantida pelo claim (uma bolha por conversa em voo). Por isso o loop
//      faz varias rodadas na MESMA invocacao: as 3 bolhas de um turno saem em sequencia e em
//      segundos, nao uma por minuto de cron.
//
// Auth: `verify_jwt = false` e sem gate de secret, igual ao ai-agent-worker e pelo mesmo motivo —
// o worker so DRENA uma fila que apenas service_role popula (emit_message e SECURITY DEFINER e
// esta revogada de anon/authenticated). Chamar isto de fora, no maximo, acelera envio legitimo.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const UAZAPI_BASE = Deno.env.get("UAZAPI_BASE") ?? "https://med4growautomacao.uazapi.com";
const MAX_RODADAS = 20;
const LOTE = 25;
const FETCH_TIMEOUT_MS = 25000;

// deno-lint-ignore no-explicit-any
type Supa = any;

interface Mensagem {
  id: string;
  clinic_id: string;
  lead_id: string | null;
  to_addr: string;
  to_kind: string;
  kind: string;
  body: string | null;
  media_url: string | null;
  media_base64: string | null;
  media_mime: string | null;
  media_kind: string | null;
  media_filename: string | null;
  delay_ms: number;
  transport: string;
  producer: string;
  send_as: string;
  attempts: number;
}

function svc(): Supa {
  return createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
}

async function registrarErro(
  supa: Supa, code: string, title: string, level: string,
  clinicId: string | null, ctx: unknown,
) {
  try {
    await supa.rpc("log_system_error", {
      p_scope: "emissor", p_code: code, p_title: title, p_level: level,
      p_clinic_id: clinicId, p_context: ctx,
    });
  } catch (e) {
    console.error("[emissor] log falhou:", e);
  }
}

// Cache de token por invocacao: um lote costuma ter varias mensagens da mesma clinica e nao ha
// motivo para ir ao banco a cada uma. Curto de proposito — se a instancia cair no meio da rodada,
// a proxima invocacao ja pega o estado novo.
async function resolverToken(supa: Supa, cache: Map<string, string | null>, clinicId: string, sendAs: string) {
  // 'org' resolve o token da instancia da ORG; 'clinic' o gate canonico da clinica. Cacheia por par.
  const key = `${clinicId}:${sendAs}`;
  if (cache.has(key)) return cache.get(key) ?? null;
  const { data, error } = await supa.rpc("fn_outbound_token", { p_clinic_id: clinicId, p_send_as: sendAs });
  const token = error ? null : (data as string | null);
  cache.set(key, token);
  return token;
}

async function postUazapi(caminho: string, token: string, corpo: unknown) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(`${UAZAPI_BASE}${caminho}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json", token },
      body: JSON.stringify(corpo),
      signal: ctrl.signal,
    });
    const texto = await r.text().catch(() => "");
    let json: Record<string, unknown> | null = null;
    try { json = texto ? JSON.parse(texto) : null; } catch { /* corpo nao-JSON */ }
    return { ok: r.ok, status: r.status, texto: texto.slice(0, 500), json };
  } finally {
    clearTimeout(t);
  }
}

// 4xx que nao adianta repetir (numero inexistente, fora do WhatsApp, payload invalido) vira
// 'dropped' na hora, sem gastar 3 tentativas. 401/403 NAO entram aqui de proposito: token pode ser
// reconectado, e esgotar as tentativas gera o alerta critico com a clinica identificada — melhor
// do que descartar em silencio. 408/429 sao transitorios por definicao.
function ehPermanente(status: number) {
  return status >= 400 && status < 500 && ![401, 403, 408, 429].includes(status);
}

// A CONTA da clinica esta fora do ar / punida pelo WhatsApp? Entao o problema nao e a mensagem.
//   503 "session is not reconnectable" -> WhatsApp desconectado
//   463 / reachout_timelock            -> WhatsApp restringiu a conta de iniciar conversas
//   status 0                           -> a propria uazapi nao respondeu
// (mesma deteccao que a forms-welcome fazia inline, agora centralizada no Emissor).
function ehFalhaInfra(status: number, corpo: string): boolean {
  if (status === 0 || status === 503) return true;
  const b = (corpo || "").toLowerCase();
  return b.includes("463") || b.includes("reachout_timelock") || b.includes("temporary restr")
    || b.includes("disconnected") || b.includes("not reconnectable");
}

// A uazapi informa ate quando a restricao vale; usamos para nao martelar a API antes disso.
function bloqueadoAte(corpo: string): string | null {
  try {
    const m = (corpo || "").match(/"until"\s*:\s*"([^"]+)"/);
    if (m && !Number.isNaN(Date.parse(m[1]))) return new Date(m[1]).toISOString();
  } catch { /* corpo nao-JSON */ }
  return null;
}

async function processar(supa: Supa, m: Mensagem, cache: Map<string, string | null>) {
  // --- Transporte SANDBOX: nunca toca a uazapi. E o que faz o ambiente de teste interno existir
  // sem um `if (simulacao)` espalhado por 13 produtores.
  if (m.transport === "sandbox") {
    await supa.rpc("outbound_register_chat", { p_id: m.id, p_provider_message_id: null });
    await supa.rpc("mark_outbound_sent", {
      p_id: m.id, p_provider_status: null, p_provider_message_id: null,
      p_provider_response: { simulado: true }, p_chat_message_id: null, p_simulated: true,
    });
    return;
  }

  const token = await resolverToken(supa, cache, m.clinic_id, m.send_as ?? "clinic");
  if (!token) {
    // Sem token = WhatsApp desconectado, bloqueado ou sem instancia. Transitorio: a clinica pode
    // reconectar. Ao esgotar as tentativas vira critico na Central COM a clinica.
    await supa.rpc("mark_outbound_failed", {
      p_id: m.id,
      p_error: "WhatsApp indisponivel (desconectado, sem token ou envio bloqueado)",
      p_provider_status: null, p_provider_response: null, p_permanente: false,
    });
    return;
  }

  const ehTexto = m.kind === "text";
  const caminho = ehTexto ? "/send/text" : "/send/media";
  const corpo = ehTexto
    ? { number: m.to_addr, text: m.body ?? "", delay: m.delay_ms ?? 0 }
    : {
        number: m.to_addr,
        type: m.media_kind ?? (m.kind === "audio" ? "audio" : "document"),
        file: m.media_base64 ?? m.media_url,
        text: m.body ?? undefined,
        // docName: nome do arquivo que o destinatario ve (ex.: orcamento em PDF do send-quote).
        docName: m.media_filename ?? undefined,
        delay: m.delay_ms ?? 0,
      };

  let r: Awaited<ReturnType<typeof postUazapi>>;
  try {
    r = await postUazapi(caminho, token, corpo);
  } catch (e) {
    const abortado = (e as Error)?.name === "AbortError";
    await supa.rpc("mark_outbound_failed", {
      p_id: m.id,
      p_error: abortado ? `timeout de ${FETCH_TIMEOUT_MS}ms na uazapi` : `erro de rede: ${String(e)}`,
      p_provider_status: null, p_provider_response: null, p_permanente: false,
    });
    return;
  }

  if (!r.ok) {
    // Falha de INFRA (conta fora do ar / restrita): bloqueia a instancia e devolve a mensagem a
    // fila SEM contar a tentativa. O gate faz os outros produtores pararem de martelar a conta.
    if (ehFalhaInfra(r.status, r.texto)) {
      await supa.rpc("mark_outbound_infra_blocked", {
        p_id: m.id, p_clinic_id: m.clinic_id,
        p_until: bloqueadoAte(r.texto),
        p_error: `uazapi ${r.status}: ${r.texto}`,
      });
      return;
    }
    await supa.rpc("mark_outbound_failed", {
      p_id: m.id,
      p_error: `uazapi ${r.status}: ${r.texto}`,
      p_provider_status: r.status,
      p_provider_response: r.json ?? { corpo: r.texto },
      p_permanente: ehPermanente(r.status),
    });
    return;
  }

  // Entregue. AGORA (e so agora) a conversa recebe a linha.
  const providerId =
    (r.json?.id as string) ?? (r.json?.messageid as string) ?? (r.json?.messageId as string) ?? null;

  const { data: chatId } = await supa.rpc("outbound_register_chat", {
    p_id: m.id, p_provider_message_id: providerId,
  });
  await supa.rpc("mark_outbound_sent", {
    p_id: m.id, p_provider_status: r.status, p_provider_message_id: providerId,
    p_provider_response: r.json ?? null, p_chat_message_id: chatId ?? null, p_simulated: false,
  });
}

async function drenar(supa: Supa) {
  const cache = new Map<string, string | null>();
  let processadas = 0;

  // Devolve a fila o que ficou 'sending' por worker que morreu no meio.
  try {
    await supa.rpc("requeue_stale_outbound", { p_older_minutes: 5 });
  } catch { /* nao impede a drenagem */ }

  for (let rodada = 0; rodada < MAX_RODADAS; rodada++) {
    const { data, error } = await supa.rpc("claim_outbound_messages", {
      p_limit: LOTE, p_worker: `emissor-worker/${rodada}`,
    });
    if (error) {
      await registrarErro(supa, "claim_falhou", "Nao deu para reivindicar mensagens da fila de saida",
        "error", null, { erro: error.message });
      break;
    }
    const lote = (data ?? []) as Mensagem[];
    if (lote.length === 0) break;

    // Seguro em paralelo: o claim garante no maximo UMA mensagem por conversa neste lote.
    await Promise.all(lote.map((m) =>
      processar(supa, m, cache).catch((e) =>
        registrarErro(supa, "processamento_quebrou",
          "O envio de uma mensagem quebrou dentro do worker", "critical", m.clinic_id,
          { outbound_id: m.id, producer: m.producer, erro: String(e) })
      )
    ));
    processadas += lote.length;
  }
  return processadas;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const supa = svc();
  try {
    const processadas = await drenar(supa);
    return json({ ok: true, processadas });
  } catch (e) {
    await registrarErro(supa, "worker_quebrou", "O worker do Emissor quebrou; mensagens podem estar paradas na fila",
      "critical", null, { erro: (e as Error).message, stack: (e as Error).stack?.slice(0, 500) });
    return json({ ok: false, error: String(e) }, 500);
  }
});
