// chat-send
//
// Envia uma mensagem do operador para o lead pelo WhatsApp conectado da clinica e
// registra na conversa (chat_messages). Dois formatos:
//   - TEXTO  -> uazapi /send/text
//   - AUDIO  -> uazapi /send/media com type='ptt' (mensagem de voz gravada no navegador)
//     doc: https://docs.uazapi.com/endpoint/post/send~media — `file` aceita URL OU base64,
//     `ptt` e `myaudio` sao mensagem de voz; `audio` seria arquivo de audio comum.
//     O arquivo tambem sobe no bucket privado chat-media, que e de onde a BOLHA da conversa
//     toca o audio (mesmo caminho da midia recebida do paciente).
//
// Chamada pelo frontend (Conversas / drawer do Kanban) com o JWT do usuario.
// Espelha send-quote (auth + token + envio), com duas diferencas deliberadas:
//   1. gate da feature clinics.features->>'feature_chat_send' (opt-in, server-side);
//   2. falha registrada na Central de Erros (log_system_error) — send-quote nao registra,
//      e sem isso um envio que falha vira "sumiu a mensagem".
//
// A mensagem entra como sender='human' + direction='outbound': mantem a atribuicao
// comercial IA x Humano correta E dispara os gatilhos de etapa por keyword no banco.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const UAZAPI_BASE = "https://med4growautomacao.uazapi.com";
const MAX_TEXT = 4096;

// Audio: allowlist de formato + teto de tamanho. O teto e o do proprio WhatsApp (16 MB); 8 MB ja
// cobre ~40 minutos de opus e mantem o corpo do request e a linha da fila num tamanho sao.
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const AUDIO_EXT: Record<string, string> = {
  "audio/ogg": "ogg", "audio/opus": "ogg", "audio/webm": "webm", "audio/mpeg": "mp3",
  "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/aac": "aac", "audio/wav": "wav",
};

function base64ParaBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Espelha _shared/phone.ts (inline), igual send-quote/reengagement/welcome.
function normalizeBrazilianPhone(rawInput: string | null | undefined): string | null {
  if (!rawInput) return null;
  let phone = String(rawInput).replace(/\D/g, "");
  if (!phone) return null;
  phone = phone.replace(/^0+/, "");
  const stripExtra9 = (digits: string): string => {
    if (digits.length === 13 && digits.startsWith("55")) {
      const country = digits.slice(0, 2);
      const ddd = digits.slice(2, 4);
      let rest = digits.slice(4);
      if (rest.startsWith("9")) rest = rest.slice(1);
      return country + ddd + rest;
    }
    return digits;
  };
  if (phone.startsWith("55")) return stripExtra9(phone);
  if (phone.length === 10 || phone.length === 11) return stripExtra9("55" + phone);
  return phone;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  let body: any;
  try { body = await req.json(); } catch { body = {}; }
  const { clinic_id, lead_id, phone, text, audio } = body ?? {};
  const cleanText = typeof text === "string" ? text.trim() : "";
  // `audio` = { base64, mimetype, duration_ms? } gravado pelo navegador (ChatComposer).
  const temAudio = !!audio && typeof audio === "object" && typeof (audio as any).base64 === "string";
  if (!clinic_id || !phone || (!cleanText && !temAudio)) return json({ ok: false, error: "missing_params" }, 400);
  if (cleanText.length > MAX_TEXT) return json({ ok: false, error: "texto_muito_longo" }, 400);

  // Mensagem de voz nao tem legenda no WhatsApp: aceitar os dois juntos jogaria o texto digitado
  // fora em silencio. A caixa de envio nunca manda os dois, entao isto e guarda para chamador novo.
  if (temAudio && cleanText) return json({ ok: false, error: "audio_com_texto" }, 400);
  // Formato: so o `type` base interessa (o navegador manda "audio/webm;codecs=opus").
  const audioMime = temAudio ? String((audio as any).mimetype ?? "").split(";")[0].trim().toLowerCase() : "";
  const audioExt = AUDIO_EXT[audioMime];

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const registrarErro = async (code: string, title: string, ctx: Record<string, unknown>) => {
    try {
      await supabase.rpc("log_system_error", {
        p_scope: "chat-send",
        p_code: code,
        p_title: title,
        p_level: "error",
        p_clinic_id: clinic_id,
        p_context: ctx,
        p_is_monitor: false,
      });
    } catch (_e) { /* nunca deixar o log derrubar a resposta */ }
  };

  // (1) Autenticacao + autorizacao: usuario precisa pertencer a clinica (ou a org dela).
  const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  const { data: userData } = await supabase.auth.getUser(jwt);
  const uid = userData?.user?.id;
  if (!uid) return json({ ok: false, error: "unauthorized" }, 401);

  const { data: cu } = await supabase
    .from("clinic_users").select("id").eq("id", uid).eq("clinic_id", clinic_id).maybeSingle();
  let allowed = !!cu;
  // chat_messages.user_id referencia clinic_users(id); usuario de organizacao NAO esta
  // em clinic_users -> gravar o uid dele viola o FK. Preenche so quando for clinic_user.
  const messageUserId = cu?.id ?? null;

  // (2) Gate da feature (opt-in) — lido junto do organization_id p/ evitar 2 selects.
  const { data: clinic } = await supabase
    .from("clinics").select("organization_id, features").eq("id", clinic_id).maybeSingle();

  if (!allowed && clinic?.organization_id) {
    const { data: ou } = await supabase
      .from("org_users").select("user_id").eq("user_id", uid).eq("organization_id", clinic.organization_id).maybeSingle();
    allowed = !!ou;
  }
  if (!allowed) return json({ ok: false, error: "forbidden" }, 403);

  if ((clinic?.features as any)?.feature_chat_send !== true) {
    return json({ ok: false, error: "envio_desativado" }, 403);
  }

  // (3) AUDIO: valida, sobe no bucket PRIVADO chat-media e guarda o base64 para o envio.
  //     A subida vem ANTES do envio de proposito: o Emissor solta o base64 assim que entrega
  //     (mark_outbound_sent zera media_base64), entao o bucket e a UNICA copia que sobra para a
  //     bolha tocar. Se o envio falhar depois, sobra um arquivo orfao de poucos KB — barato perto
  //     de gravar na conversa um audio que ninguem consegue mais ouvir.
  //     O path comeca pelo clinic_id porque e assim que a `chat-media-sign` autoriza a leitura.
  let audioPath: string | null = null;
  let audioB64 = "";
  if (temAudio) {
    audioB64 = String((audio as any).base64).replace(/^data:[^;]+;base64,/, "");
    if (!audioExt || !audioB64) return json({ ok: false, error: "audio_invalido" }, 400);
    let bytes: Uint8Array;
    try { bytes = base64ParaBytes(audioB64); } catch { return json({ ok: false, error: "audio_invalido" }, 400); }
    if (bytes.length === 0) return json({ ok: false, error: "audio_invalido" }, 400);
    if (bytes.length > MAX_AUDIO_BYTES) return json({ ok: false, error: "audio_muito_grande" }, 413);

    const path = `${clinic_id}/out-${crypto.randomUUID()}.${audioExt}`;
    const { error: upErr } = await supabase.storage.from("chat-media")
      .upload(path, bytes, { contentType: audioMime, upsert: false });
    if (upErr) {
      await registrarErro("audio_upload_falhou", "Nao deu para guardar o audio gravado no chat",
        { detail: upErr.message, lead_id, mime: audioMime, bytes: bytes.length });
      return json({ ok: false, error: "upload_falhou", detail: upErr.message }, 502);
    }
    audioPath = path;
  }

  // Conteudo que vai para a conversa. No audio o `content` nao aparece na tela (a bolha vira
  // player pelo fileURL); ele existe para a memoria da IA, o analista e os gatilhos por palavra.
  const chatMessage = audioPath
    ? {
        type: "human", content: "[Áudio enviado pela equipe]",
        fileURL: audioPath, mimetype: audioMime, kind: "audio",
        additional_kwargs: {}, response_metadata: {},
      }
    : { type: "human", content: cleanText, additional_kwargs: {}, response_metadata: {} };

  // (4) EMISSOR (opt-in por clinica, `fn_emissor_ativo`). Com a chave LIGADA a mensagem vai para
  //     a fila de saida e quem envia e o emissor-worker: ele resolve o token pelo gate canonico
  //     (`fn_clinic_send_token` — instancia conectada, token valido, envio nao bloqueado), LE a
  //     resposta da uazapi e so entao grava a conversa.
  //     A UI nao muda: ela ja nao faz insercao otimista e mostra a mensagem pelo realtime do
  //     INSERT em chat_messages (ver comentario em useSupabase.ts). A diferenca e que a linha
  //     passa a aparecer quando a mensagem SAIU DE VERDADE, com ~1s de kick, em vez de aparecer
  //     mesmo quando a uazapi recusou.
  //     Com a chave DESLIGADA (default) cai no caminho antigo, byte por byte.
  const { data: viaEmissor } = await supabase.rpc("fn_emissor_ativo", { p_clinic_id: clinic_id });

  if (viaEmissor === true) {
    const numeroFila = normalizeBrazilianPhone(String(phone));
    if (!numeroFila) return json({ ok: false, error: "telefone_invalido" }, 400);

    // Duplo clique do operador nao vira mensagem dobrada. A janela de minuto deixa o reenvio
    // deliberado (mandar o mesmo texto de novo mais tarde) continuar funcionando.
    // AUDIO fica de fora: cada gravacao e um arquivo diferente, entao a chave so poderia usar o
    // tamanho do binario — e duas gravacoes de tamanho igual no mesmo minuto sumiriam em silencio.
    let h = 5381;
    for (let i = 0; i < cleanText.length; i++) h = ((h << 5) + h + cleanText.charCodeAt(i)) | 0;
    const janela = new Date().toISOString().slice(0, 16);
    const dedupKey = audioPath
      ? null
      : `chat:${clinic_id}:${lead_id ?? numeroFila}:${(h >>> 0).toString(36)}:${janela}`;

    const { data: outboundId, error: filaErr } = await supabase.rpc("emit_message", {
      p_clinic_id: clinic_id,
      p_to_addr: numeroFila,
      p_producer: "chat_manual",
      // PTT nao tem legenda: audio vai sem corpo, senao o texto sumiria sem aviso.
      p_body: audioPath ? null : cleanText,
      p_kind: audioPath ? "audio" : "text",
      p_media_base64: audioPath ? audioB64 : null,
      p_media_mime: audioPath ? audioMime : null,
      // `media_kind` vai CRU no campo `type` do /send/media (emissor-worker): 'ptt' e o que faz o
      // WhatsApp mostrar mensagem de voz, e nao um arquivo de audio anexado.
      p_media_kind: audioPath ? "ptt" : null,
      p_lead_id: lead_id ?? null,
      p_dedup_key: dedupKey,
      p_chat_payload: {
        sender: "human",
        user_id: messageUserId,
        phone: numeroFila,
        // Mantem o formato exato que a conversa ja usa: sender='human' + direction='outbound'
        // preserva a atribuicao comercial IA x Humano e dispara os gatilhos de etapa por keyword.
        message: chatMessage,
      },
    });

    if (filaErr) {
      await registrarErro("fila_falhou", "Nao deu para enfileirar a mensagem do chat no Emissor",
        { detail: filaErr.message, lead_id, number: numeroFila });
      return json({ ok: false, error: "fila_falhou", detail: filaErr.message }, 502);
    }

    // Kick DIRETO do worker (background, best-effort). No chat manual ha um humano esperando a
    // bolha aparecer; sem isto o envio so sairia no proximo ciclo do pg_net/cron (~7s medidos).
    // Um fetch direto derruba isso para ~1s. O worker e idempotente (claim atomico) e o trigger
    // pg_net + cron de 1 min continuam como backstop se este kick falhar.
    try {
      const workerUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/emissor-worker`;
      const kick = fetch(workerUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "kick", clinic_id }),
      }).catch(() => { /* backstop: pg_net/cron drenam */ });
      (globalThis as any).EdgeRuntime?.waitUntil?.(kick);
    } catch { /* sem EdgeRuntime: o backstop cobre */ }

    return json({ ok: true, queued: true, outbound_id: outboundId });
  }

  // ---- Caminho antigo (chave desligada): envio inline, como sempre foi. ----
  // (5) Token da instancia uazapi da clinica.
  const { data: instance } = await supabase
    .from("whatsapp_instances").select("api_token").eq("clinic_id", clinic_id).maybeSingle();
  const token = instance?.api_token;
  if (!token) return json({ ok: false, error: "whatsapp_nao_conectado" }, 409);

  // (6) Telefone do lead normalizado (os dois lados normalizados no resto do sistema).
  const number = normalizeBrazilianPhone(String(phone));
  if (!number) return json({ ok: false, error: "telefone_invalido" }, 400);

  // (7) Envio. Texto -> /send/text; audio -> /send/media com type='ptt' e o arquivo em base64
  //     (`mimetype` explicito porque em base64 a uazapi nao tem nome de arquivo para deduzir).
  try {
    const resp = await fetch(`${UAZAPI_BASE}${audioPath ? "/send/media" : "/send/text"}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json", "token": token },
      body: JSON.stringify(audioPath
        ? { number, type: "ptt", file: audioB64, mimetype: audioMime, delay: 0 }
        : { number, text: cleanText, delay: 0 }),
    });
    if (!resp.ok) {
      const detail = await resp.text().catch(() => "");
      await registrarErro("uazapi_error", "Falha ao enviar mensagem pelo chat", { status: resp.status, detail, lead_id, number });
      return json({ ok: false, error: "uazapi_error", detail }, 502);
    }
  } catch (e) {
    await registrarErro("send_failed", "Erro de rede ao enviar mensagem pelo chat", { detail: String(e), lead_id, number });
    return json({ ok: false, error: "send_failed", detail: String(e) }, 502);
  }

  // (8) Registra na conversa. session_id/clinic_name/seq vem por trigger.
  //     Aqui o log importa: a mensagem JA foi entregue ao lead, entao perder a linha
  //     significa conversa incompleta na tela e gatilho de etapa que nao dispara.
  const { data: inserted, error: insertErr } = await supabase.from("chat_messages").insert({
    clinic_id,
    lead_id: lead_id ?? null,
    phone: number,
    user_id: messageUserId,
    sender: "human",
    direction: "outbound",
    message: chatMessage,
  }).select("id").single();

  if (insertErr) {
    await registrarErro("log_failed", "Mensagem enviada mas nao registrada na conversa", { detail: insertErr.message, lead_id, number });
    return json({ ok: true, logged: false });
  }

  return json({ ok: true, logged: true, message_id: inserted?.id });
});
