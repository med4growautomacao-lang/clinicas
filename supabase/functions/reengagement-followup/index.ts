// reengagement-followup — envio NATIVO do follow-up de reengajamento (migra o envio do n8n).
//
// Chamada por pg_net (sem JWT), 1 vez por lead, a partir do selector SQL
// process_reengagement_followup() (cron a cada 30 min) que já fez os gates duráveis.
// Aqui: claim atômico no banco (fn_claim_reengagement_step: contador E régua, com re-check das
// exclusões duráveis e do opt-out) → envio multi-balão via Emissor/uazapi → automation_logs
// (type=followup) → chat_messages (REENGAJAMENTO).
//
// RÉGUA: cada etapa do funil pode ter a sua (followup_steps.stage_id); stage_id null é a régua
// Padrão, que vale para toda etapa sem régua própria. Quem escolhe é o selector, e a régua vem no
// payload como ruleset_stage_id. A lógica por etapa está atrás do gate system_settings
// 'reengajamento_por_etapa'; com ele desligado tudo cai no Padrão, como antes.
//
// Normalização de telefone espelha _shared/phone.ts (inline); envio espelha o ai-scheduler/welcome.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

const UAZAPI_BASE = "https://med4growautomacao.uazapi.com";
const TYPING_DELAY_MS = 5000;

function nowSP(): string {
  return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().replace("Z", "");
}

function firstNameCapitalized(name: string | null | undefined): string {
  const first = String(name || "").trim().split(/\s+/)[0] || "";
  if (!first) return "";
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

function renderMessage(text: string, firstName: string): string {
  return String(text || "")
    .replace(/\{name\}/gi, firstName)
    .replace(/\{nome\}/gi, firstName)
    .replace(/\{paciente\}/gi, firstName)
    .trim();
}

async function sendText(token: string, number: string, text: string, delay = 0): Promise<boolean> {
  try {
    const resp = await fetch(`${UAZAPI_BASE}/send/text`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json", "token": token },
      body: JSON.stringify({ number, text, delay }),
    });
    return resp.ok;
  } catch (e) {
    console.error("[reengagement-followup] uazapi send error:", e);
    return false;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  let body: any;
  try { body = await req.json(); } catch { body = {}; }
  // ruleset_stage_id = a RÉGUA deste passo (null = régua Padrão, que vale para toda etapa sem
  // régua própria). Vem do selector; a edge não decide régua, só repassa o que foi selecionado.
  const { lead_id, clinic_id, name, phone, clinic_phone, message_text, step_no, expected_count, is_closing, ruleset_stage_id } = body ?? {};

  const json = (obj: unknown, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  if (!lead_id || !clinic_id) return json({ ok: false, error: "lead_id e clinic_id obrigatórios" }, 400);

  // DRY-RUN: prévia da mensagem renderizada, SEM claim/envio/log.
  if (body?.dry_run === true) {
    const { data: lead } = await supabase.from("leads").select("name").eq("id", lead_id).maybeSingle();
    const fn = firstNameCapitalized(lead?.name ?? name);
    const rendered = renderMessage(message_text, fn);
    const bubbles = rendered.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
    return json({ ok: true, dry_run: true, first_name: fn, step_no: step_no ?? null, bubbles });
  }

  const v_expected = Number(expected_count ?? 0);

  const v_stage: string | null = ruleset_stage_id ?? null;

  // (1) CLAIM ATÔMICO, agora no banco (fn_claim_reengagement_step). A trava não é mais só o
  // contador: é contador E régua na MESMA condição, porque quando a régua muda o passo válido
  // passa a ser o primeiro (expected = 0) mesmo com o contador em outro valor — o PostgREST não
  // expressa esse "ou" sem abrir corrida. A RPC também re-checa as exclusões duráveis e o
  // opt-out do tipo (janela entre listar e enviar que antes ficava aberta).
  const { data: claim, error: claimErr } = await supabase.rpc("fn_claim_reengagement_step", {
    p_lead_id: lead_id, p_stage_id: v_stage, p_expected: v_expected,
  });
  if (claimErr) return json({ ok: false, error: claimErr.message }, 500);
  if (!claim?.claimed) return json({ ok: true, skipped: claim?.reason ?? "not_claimed" });

  // Estado anterior, para devolver o passo à régua se o envio não acontecer. Devolver só o
  // contador (como antes) deixaria a régua e o relógio do contato errados.
  const prev = { count: claim.prev_count ?? 0, stage: claim.prev_stage_id ?? null, sent_at: claim.prev_sent_at ?? null };
  const releaseStep = async () => {
    await supabase.rpc("fn_release_reengagement_step", {
      p_lead_id: lead_id, p_prev_count: prev.count, p_prev_stage_id: prev.stage, p_prev_sent_at: prev.sent_at,
    });
  };
  // Identificador do CICLO desta régua: é o followup_sent_at que o claim acabou de gravar.
  // Entra na chave anti-duplicidade do Emissor — ver o comentário no emit_message abaixo.
  const cicloId = String(claim.sent_at ?? nowSP()).replace(/\D/g, "");

  // (1.1) Re-check da direção da última mensagem. O selector já exige last_dir='outbound', mas há
  // uma janela entre selecionar e chegar aqui: se o lead RESPONDEU nesse meio-tempo, NÃO reengaja
  // por cima da resposta fresca (parece que o bot ignorou o cliente). Devolve o passo à régua
  // (followup_count volta ao valor anterior) — quando ele voltar a ficar em silêncio, reentra.
  const { data: lastMsg } = await supabase
    .from("chat_messages")
    .select("direction")
    .eq("lead_id", lead_id)
    .order("seq", { ascending: false })
    .limit(1);
  if (lastMsg && lastMsg.length > 0 && lastMsg[0].direction === "inbound") {
    await releaseStep();
    return json({ ok: true, skipped: "lead_replied" });
  }

  const logFail = async (reason: string) => {
    await supabase.from("automation_logs").insert({
      clinic_id, lead_id, type: "followup", status: "failed",
      message_sent: reason, triggered_at: nowSP(),
      metadata: { step_no: step_no ?? null, ruleset_stage_id: v_stage },
    });
  };

  // (2) telefones (necessário nos dois caminhos). O telefone da CLÍNICA não é mais lido aqui: ele
  // só servia para montar a session_id em TS, e a chave de memória agora tem um dono só, que é o
  // banco (30/07/2026).
  const leadNumber = normalizeBrazilianPhone(phone);
  if (!leadNumber) { await logFail("telefone do lead inválido"); return json({ ok: false, error: "invalid_phone" }); }

  // (3) mensagem do passo (multi-balão por parágrafo)
  const rendered = renderMessage(message_text, firstNameCapitalized(name));
  const bubbles = rendered.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  if (bubbles.length === 0) { await logFail("mensagem do passo vazia"); return json({ ok: false, error: "empty_message" }); }
  const joined = bubbles.join(" | ");

  // (4) EMISSOR (opt-in por clínica). Enfileira cada balão como uma mensagem; o worker resolve o
  //     token pelo gate canônico, entrega EM ORDEM e só então grava a conversa (chat_payload no
  //     último balão, com o conteúdo unido — mesmo formato de hoje). automation_logs marca 'sent'
  //     no enfileiramento: a entrega com retry é garantida pelo Emissor, que grita na Central se
  //     esgotar. Com a chave DESLIGADA (default) cai no envio inline de sempre.
  const { data: viaEmissor } = await supabase.rpc("fn_emissor_ativo", { p_clinic_id: clinic_id });

  let sent = false;
  if (viaEmissor === true) {
    let emitErr: string | null = null;
    for (let i = 0; i < bubbles.length; i++) {
      const isLast = i === bubbles.length - 1;
      // Erro de emit NAO pode virar 'sent' fantasma: rastreia e reflete no automation_logs.
      const { error } = await supabase.rpc("emit_message", {
        p_clinic_id: clinic_id,
        p_to_addr: leadNumber,
        p_producer: "reengagement",
        p_body: bubbles[i],
        p_lead_id: lead_id,
        p_delay_ms: TYPING_DELAY_MS,
        // Chave anti-duplicidade COM régua e ciclo. A antiga era `reeng:<lead>:<passo>:<balão>`,
        // e uq_outbound_dedup é único GLOBAL: o passo 1 de duas réguas (ou o mesmo passo depois
        // de um reinício) colidia, o emit_message devolvia o id da linha ANTIGA e o produtor
        // marcava 'sent' sem nada ter sido enfileirado. Provado: 2 chamadas com a mesma chave
        // => 1 linha e ids iguais. O ciclo é o followup_sent_at gravado por este claim.
        p_dedup_key: `reeng:${lead_id}:${v_stage ?? "padrao"}:${step_no ?? 0}:${cicloId}:${i}`,
        // conversa gravada uma vez, no último balão, com o conteúdo unido (igual ao inline de hoje)
        p_chat_payload: isLast
          ? { sender: "system", message: { type: "system", content: joined, additional_kwargs: {}, response_metadata: {} } }
          : null,
      });
      if (error) emitErr = error.message;
    }
    sent = !emitErr; // enfileirado com sucesso => entrega garantida (com retry) pelo Emissor
    if (emitErr) {
      // Devolve o passo à régua (contador, régua e relógio) p/ o cron reentrar — senao o passo do
      // drip seria consumido sem ter sido enviado e nunca reenviado. Espelha o forms-welcome.
      await releaseStep();
    }
    await supabase.from("automation_logs").insert({
      clinic_id, lead_id, type: "followup", status: sent ? "sent" : "failed",
      message_sent: sent ? joined : `falha ao enfileirar: ${emitErr}`,
      triggered_at: nowSP(),
      // a régua vai no log porque "passo 2" só quer dizer alguma coisa junto com a régua dele,
      // e auditar insistência se faz por automation_logs, não pelo contador do contato
      metadata: { step_no: step_no ?? null, via: "emissor", ruleset_stage_id: v_stage },
    });
    // kick imediato do worker (best-effort; o cron de 1 min é o backstop)
    try {
      const workerUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/emissor-worker`;
      const kick = fetch(workerUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "kick", clinic_id }) }).catch(() => {});
      (globalThis as any).EdgeRuntime?.waitUntil?.(kick);
    } catch { /* backstop cobre */ }
  } else {
    // ---- Caminho antigo (chave desligada): token + envio inline sequencial. ----
    const { data: instance } = await supabase
      .from("whatsapp_instances").select("api_token").eq("clinic_id", clinic_id).maybeSingle();
    const token = instance?.api_token;
    if (!token) { await logFail("sem api_token (WhatsApp não conectado)"); return json({ ok: false, error: "no_token" }); }

    let anySent = false;
    for (const bubble of bubbles) {
      const ok = await sendText(token, leadNumber, bubble, TYPING_DELAY_MS);
      anySent = anySent || ok;
    }
    sent = anySent;
    // Nenhum balão saiu: devolve o passo à régua, senão ele é consumido sem ter sido enviado e
    // o contato pula uma mensagem em silêncio (o caminho do Emissor já fazia isso).
    if (!anySent) await releaseStep();
    await supabase.from("automation_logs").insert({
      clinic_id, lead_id, type: "followup",
      status: anySent ? "sent" : "failed",
      message_sent: joined, triggered_at: nowSP(),
      metadata: { step_no: step_no ?? null, ruleset_stage_id: v_stage },
    });
    if (anySent) {
      // ⚠️ NÃO montar a session_id aqui. Passamos o TELEFONE (que é fato) e o banco compõe a chave
      // (trigger fn_fill_chat_session_id -> fn_chat_session_id, que normaliza). Montar em TS era
      // reproduzir o defeito de 17/07 a 30/07/2026 por outro caminho: o normalizador local divergia
      // do normalize_br_phone (ex.: DDD 55 sem DDI) e a memória nascia partida.
      // O `phone` também é o que faz o trigger master achar o lead: sem phone e sem session_id ele
      // zeraria o lead_id da linha.
      await supabase.from("chat_messages").insert({
        clinic_id, lead_id, phone: leadNumber,
        // sender/type 'system': automação não é fala do Agente IA (atribuição + memória + ícone próprio)
        sender: "system", direction: "outbound",
        message: { type: "system", content: joined, additional_kwargs: {}, response_metadata: {} },
      });
    }
  }

  // (8) ENCERRAMENTO: passo is_closing FECHA o ticket como Perdido via finalize_ticket (RPC canônica
  // — seta outcome=perdido + etapa + loss_reason + resolve + invariantes). resolve=true: a resposta
  // tardia abre um ticket NOVO limpo (reinicia a régua) e o Pós-Atendimento perdido pode disparar.
  //
  // ⚠️ SÓ encerra se a despedida saiu (`sent`). Antes o encerramento rodava mesmo com o envio
  // falho: 12 atendimentos reais (Vaz e Tyago, 25/06 a 12/07/2026, período dos números inválidos)
  // foram fechados como Perdido sem que a pessoa recebesse o "vou encerrar seu atendimento".
  // Com a falha, o passo já foi devolvido à régua acima, então o card segue aberto e a despedida
  // é tentada de novo na próxima rodada.
  let closed = false;
  if (is_closing === true && sent) {
    const { data: openTickets } = await supabase
      .from("tickets").select("id").eq("lead_id", lead_id).eq("status", "open")
      .order("opened_at", { ascending: false }).limit(1);
    const ticketId = openTickets && openTickets.length > 0 ? openTickets[0].id : null;
    if (ticketId) {
      const { error: finErr } = await supabase.rpc("finalize_ticket", {
        p_ticket_id: ticketId,
        p_outcome: "perdido",
        p_loss_reason: "Encerrado por falta de resposta",
        p_notes: null,
        p_resolve: true,
      });
      if (finErr) console.error("[reengagement-followup] finalize_ticket:", finErr.message);
      else closed = true;
    }
  }

  return json({ ok: true, sent, step_no: step_no ?? null, ruleset_stage_id: v_stage, bubbles: bubbles.length, closed, lead_id });
});
