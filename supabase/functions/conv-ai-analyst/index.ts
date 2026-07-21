// conv-ai-analyst — o analista de conversas.
//
// Lê a conversa de cada atendimento com mensagem nova e decide DUAS coisas:
//   (1) em que etapa do funil o ticket deveria estar;
//   (2) se houve VENDA.
//
// Regra de aplicação (decisão do dono, 21/07):
//   • etapa COMUM        -> aplica sozinha via set_ticket_stage (source='ia_analise');
//   • etapa de CONVERSÃO -> NUNCA aplica. Vira sugestão pendente para o vendedor
//     decidir na aba "Vendas sugeridas". Venda mexe em faturamento e dispara CAPI.
//
// Disparo: cron a cada 5 min via system_http_post (sem JWT) -> deploy com
// --no-verify-jwt. Também aceita ?ticket=<uuid> e ?dry=1 para teste manual.
//
// Gates, em ordem: system_settings.conv_ai_config.mode (off|shadow|active) e
// conv_ai_clinic_config.enabled por clínica. Em 'shadow' nada é aplicado: só
// registra o que TERIA feito (mesmo cutover dos gatilhos de etapa).
//
// Custo: só entra na fila quem teve mensagem nova (trigger trg_zz_conv_ai_enqueue),
// com debounce de conversa parada, lote limitado e teto diário por clínica — tudo
// no claim atômico conv_ai_claim_batch.
//
// Observabilidade: toda falha vai para a Central de Erros. Um catch que só faz
// console.error é invisível, e o pecado capital deste sistema é a perda silenciosa.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SCOPE = "conv-ai-analyst";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEFAULTS = {
  mode: "shadow",
  provider: "anthropic",
  model: "claude-haiku-4-5",
  temperature: 0.1,
  max_output_tokens: 1200,
  max_messages: 40,
  debounce_minutes: 3,
  batch_size: 25,
  daily_cap_per_clinic: 300,
  min_confidence_stage: 0.75,
  min_confidence_sale: 0.7,
  system_prompt: "",
};

const admin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

async function registrarErro(
  code: string,
  title: string,
  level: string,
  clinicId: string | null,
  ctx: unknown,
): Promise<void> {
  try {
    await admin.rpc("log_system_error", {
      p_scope: SCOPE, p_code: code, p_title: title,
      p_level: level, p_clinic_id: clinicId, p_context: ctx,
    });
  } catch (e) {
    console.error(`[${SCOPE}] log falhou:`, e);
  }
}

// Chave do provedor: Vault primeiro (painel super-admin), env como rede.
const _keys = new Map<string, string>();
async function llmKey(provider: string): Promise<string | null> {
  const name = provider === "gemini" ? "GEMINI_API_KEY"
    : provider === "anthropic" ? "ANTHROPIC_API_KEY"
    : provider === "openai" ? "OPENAI_API_KEY" : "";
  if (!name) return null;
  if (_keys.has(name)) return _keys.get(name)!;
  let key: string | null = null;
  try {
    const { data } = await admin.rpc("get_llm_secret", { p_name: name });
    if (data && String(data).trim()) key = String(data);
  } catch { /* sem Vault → env */ }
  if (!key) key = Deno.env.get(name) || null;
  if (key) _keys.set(name, key);
  return key;
}

type LlmOut = { text: string; tokens_in: number; tokens_out: number };

// A geração Opus 4.7+ da Anthropic (Opus 4.8/4.7, Sonnet 5, Fable 5) REMOVEU
// temperature/top_p/top_k: mandar o campo devolve 400. Nesses modelos o
// "thinking" também liga sozinho, e aqui só queremos o JSON da análise — sem
// gastar o teto de tokens pensando. Fable/Mythos não aceitam nem o disabled.
const ANTHROPIC_NO_SAMPLING = /^claude-(opus-4-[78]|sonnet-5|fable-5|mythos-5)/;
const ANTHROPIC_THINKING_ALWAYS_ON = /^claude-(fable-5|mythos-5)/;

function anthropicBody(model: string, temperature: number, maxTokens: number, system: string, user: string) {
  const body: Record<string, unknown> = {
    model, max_tokens: maxTokens, system,
    messages: [{ role: "user", content: user }],
  };
  if (ANTHROPIC_NO_SAMPLING.test(model)) {
    if (!ANTHROPIC_THINKING_ALWAYS_ON.test(model)) body.thinking = { type: "disabled" };
  } else {
    body.temperature = temperature;
  }
  return body;
}

async function callLlm(
  provider: string, model: string, temperature: number, maxTokens: number,
  system: string, user: string,
): Promise<LlmOut> {
  const key = await llmKey(provider);
  if (!key) throw new Error(`sem chave de API para ${provider}`);

  if (provider === "anthropic") {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: AbortSignal.timeout(60000),
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify(anthropicBody(model, temperature, maxTokens, system, user)),
    });
    if (!r.ok) throw new Error(`anthropic ${r.status}: ${(await r.text().catch(() => "")).slice(0, 300)}`);
    const j = await r.json();
    const text = (j?.content ?? []).map((c: any) => c?.text).filter(Boolean).join("\n").trim();
    return { text, tokens_in: j?.usage?.input_tokens ?? 0, tokens_out: j?.usage?.output_tokens ?? 0 };
  }

  if (provider === "openai") {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: AbortSignal.timeout(60000),
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model, temperature, max_tokens: maxTokens,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
      }),
    });
    if (!r.ok) throw new Error(`openai ${r.status}: ${(await r.text().catch(() => "")).slice(0, 300)}`);
    const j = await r.json();
    return {
      text: (j?.choices?.[0]?.message?.content ?? "").trim(),
      tokens_in: j?.usage?.prompt_tokens ?? 0,
      tokens_out: j?.usage?.completion_tokens ?? 0,
    };
  }

  // gemini
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    {
      method: "POST",
      signal: AbortSignal.timeout(60000),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ parts: [{ text: user }] }],
        generationConfig: { temperature, maxOutputTokens: maxTokens },
      }),
    },
  );
  if (!r.ok) throw new Error(`gemini ${r.status}: ${(await r.text().catch(() => "")).slice(0, 300)}`);
  const j = await r.json();
  const text = (j?.candidates?.[0]?.content?.parts ?? []).map((p: any) => p?.text).filter(Boolean).join(" ").trim();
  return {
    text,
    tokens_in: j?.usageMetadata?.promptTokenCount ?? 0,
    tokens_out: j?.usageMetadata?.candidatesTokenCount ?? 0,
  };
}

// O modelo às vezes embrulha o JSON em cerca de markdown ou em prosa. Pega o
// primeiro objeto balanceado em vez de confiar no formato.
function extractJson(raw: string): any | null {
  if (!raw) return null;
  const cleaned = raw.replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/, "").trim();
  const start = cleaned.indexOf("{");
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (esc) { esc = false; continue; }
    if (ch === "\\") { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(cleaned.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

// Casamento tolerante de slug/nome de etapa (o modelo pode devolver com acento).
const norm = (s: unknown) =>
  String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[^\d,.-]/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function buildUserPrompt(ctx: any): string {
  const stages = (ctx.stages ?? []).map((s: any) =>
    `- ${s.slug ?? s.name}: "${s.name}"${s.is_conversion ? " (ETAPA DE CONVERSÃO / VENDA FECHADA)" : ""}`
  ).join("\n");
  const conversa = (ctx.messages ?? []).map((m: any) => `[${m.at}] ${m.who}: ${m.text}`).join("\n");
  const manual = ctx.clinic_prompt
    ? `\n## Manual desta empresa (o que a experiência dela já ensinou)\n${ctx.clinic_prompt}\n`
    : "";

  // Regras de gatilho que a própria empresa cadastrou. É a declaração explícita
  // de "esta frase significa esta etapa aqui", e existe um motor literal que já
  // as aplica: contradizê-las sem motivo é desfazer o que o cliente configurou.
  const regras = (ctx.clinic_rules ?? []).length
    ? `\n## Regras que esta empresa cadastrou (respeite-as)
${(ctx.clinic_rules ?? []).map((r: any) => `- quando a mensagem contém "${r.quando_a_mensagem_contem}" → etapa "${r.etapa}"`).join("\n")}
Um motor automático já aplica essas regras ao pé da letra. Você cobre o que elas não pegam: as mesmas intenções ditas com outras palavras, e o que não tem frase-padrão.\n`
    : "";

  return `## Empresa
${ctx.clinic?.name ?? "-"}${ctx.clinic?.category === "outro" ? " (não é clínica: 'paciente' aqui é cliente e 'consulta' é atendimento ou serviço)" : ""}
${manual}${regras}
## Etapas do funil desta empresa
${stages || "(nenhuma etapa cadastrada)"}

## Estado atual deste atendimento
Etapa atual: "${ctx.ticket?.stage_name ?? "sem etapa"}" (slug: ${ctx.ticket?.stage_slug ?? "-"})
Contato: ${ctx.lead?.name ?? "-"}

## Conversa (mais antiga primeiro)
${conversa || "(sem mensagens)"}

Analise e responda no formato JSON pedido.`;
}

// Devolve o rótulo do que fez. Em dry-run com ?debug=1 devolve também o JSON cru
// do modelo: é assim que se confere a calibragem antes de ligar uma clínica.
async function analisarTicket(item: any, cfg: any, dry: boolean, debug = false): Promise<any> {
  const { data: ctx, error: ctxErr } = await admin.rpc("conv_ai_get_context", {
    p_ticket_id: item.ticket_id,
    p_max_messages: cfg.max_messages,
  });
  if (ctxErr) throw new Error(`contexto: ${ctxErr.message}`);
  if (!ctx?.found) {
    await admin.rpc("conv_ai_finish_ticket", { p_ticket_id: item.ticket_id, p_analyzed_seq: item.last_message_seq, p_error: null });
    return "ticket_not_found";
  }

  // Ticket já resolvido não se analisa: a venda está fechada, mexer nela é proibido.
  if (ctx.ticket?.outcome) {
    await admin.rpc("conv_ai_finish_ticket", { p_ticket_id: item.ticket_id, p_analyzed_seq: ctx.last_seq, p_error: null });
    return "resolved";
  }
  if ((ctx.messages ?? []).length < 2) {
    await admin.rpc("conv_ai_finish_ticket", { p_ticket_id: item.ticket_id, p_analyzed_seq: ctx.last_seq, p_error: null });
    return "too_short";
  }

  const out = await callLlm(
    cfg.provider, cfg.model, cfg.temperature, cfg.max_output_tokens,
    cfg.system_prompt, buildUserPrompt(ctx),
  );
  const parsed = extractJson(out.text);
  if (!parsed) {
    await registrarErro("resposta_nao_json", "O analista devolveu resposta fora do formato JSON", "warning",
      item.clinic_id, { ticket_id: item.ticket_id, resposta: out.text.slice(0, 500) });
    await admin.rpc("conv_ai_finish_ticket", { p_ticket_id: item.ticket_id, p_analyzed_seq: ctx.last_seq, p_error: "resposta_nao_json" });
    return "bad_json";
  }

  const stages: any[] = ctx.stages ?? [];
  const conversionStage = stages.find((s) => s.is_conversion);
  const sugSlug = norm(parsed?.stage?.slug);
  const sugStage = sugSlug
    ? stages.find((s) => norm(s.slug) === sugSlug) ?? stages.find((s) => norm(s.name) === sugSlug)
    : null;
  const stageConf = num(parsed?.stage?.confidence) ?? 0;
  const saleConf = num(parsed?.sale?.confidence) ?? 0;
  const saleDetected = parsed?.sale?.detected === true && saleConf >= cfg.min_confidence_sale;
  const minStage = item.min_confidence_stage ?? cfg.min_confidence_stage;

  const base = {
    clinic_id: item.clinic_id,
    ticket_id: item.ticket_id,
    lead_id: item.lead_id ?? ctx.lead?.id ?? null,
    previous_stage_id: ctx.ticket?.stage_id ?? null,
    provider: cfg.provider,
    model: cfg.model,
    tokens_in: out.tokens_in,
    tokens_out: out.tokens_out,
    analyzed_seq: ctx.last_seq,
  };

  let resultado = "no_change";

  // Modo por clínica em cada eixo: off | suggest | auto. O kill-switch GLOBAL
  // manda em cima de tudo: fora de 'active' nada é aplicado, só registrado.
  const stageMode: string = item.stage_mode ?? "auto";
  const saleMode: string = item.sale_mode ?? "suggest";
  const aplicando = cfg.mode === "active" && !dry;

  // 1 registro em aberto por ticket (índice único). Reanálise ATUALIZA o que
  // existe em vez de empilhar (vale também para 'shadow', senão o modo de teste
  // enche a tabela de linhas repetidas do mesmo ticket).
  const gravarAberto = async (row: Record<string, unknown>) => {
    if (dry) return null;
    const { data: existing } = await admin
      .from("conv_ai_insights")
      .select("id")
      .eq("ticket_id", item.ticket_id)
      .in("status", ["pending", "shadow"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing?.id) {
      await admin.from("conv_ai_insights").update(row).eq("id", existing.id);
      return existing.id as string;
    }
    const { data: inserted } = await admin
      .from("conv_ai_insights").insert(row).select("id").maybeSingle();
    return (inserted?.id as string) ?? null;
  };

  // ── Caminho VENDA ─────────────────────────────────────────────────────────
  if (saleMode === "off" && (saleDetected || (sugStage?.is_conversion && stageConf >= minStage))) {
    // Eixo desligado nesta clínica: não registra nem aplica. Cai direto no
    // finish do item da fila lá embaixo (dar return aqui deixaria a fila presa
    // em 'running' para sempre).
    resultado = "sale_off";
  } else if (saleDetected || (sugStage?.is_conversion && stageConf >= minStage)) {
    const row: Record<string, unknown> = {
      ...base,
      kind: "sale",
      suggested_stage_id: conversionStage?.id ?? sugStage?.id ?? null,
      sale_value: num(parsed?.sale?.value),
      confidence: Math.max(saleConf, sugStage?.is_conversion ? stageConf : 0),
      rationale: String(parsed?.sale?.rationale ?? parsed?.stage?.rationale ?? "").slice(0, 1000),
      evidence: Array.isArray(parsed?.sale?.evidence) ? parsed.sale.evidence : [],
      status: aplicando ? "pending" : "shadow",
    };
    const insightId = await gravarAberto(row);
    resultado = aplicando ? "sale_pending" : "sale_shadow";

    // 'auto': fecha a venda pelo mesmo caminho do GanhoModal (conversão → etapa
    // de conversão → finalize_ticket), via RPC. Sem valor conhecido a RPC recusa
    // e a sugestão FICA pendente para um humano decidir.
    if (aplicando && saleMode === "auto" && insightId) {
      const { data: res, error } = await admin.rpc("conv_ai_auto_close_sale", { p_insight_id: insightId });
      if (error) throw new Error(`auto_close_sale: ${error.message}`);
      if (res?.success) {
        resultado = "sale_auto_closed";
      } else {
        resultado = `sale_pending_${res?.error_code ?? "recusada"}`;
        if (res?.error_code === "no_value") {
          await registrarErro("venda_auto_sem_valor",
            "IA detectou venda mas não achou valor: ficou pendente em vez de lançar faturamento zerado",
            "warning", item.clinic_id, { ticket_id: item.ticket_id, insight_id: insightId });
        }
      }
    }
  }
  // ── Caminho ETAPA comum ───────────────────────────────────────────────────
  else if (stageMode === "off" && sugStage && sugStage.id !== ctx.ticket?.stage_id) {
    resultado = "stage_off";
  } else if (sugStage && sugStage.id !== ctx.ticket?.stage_id) {
    const stageRow: Record<string, unknown> = {
      ...base, kind: "stage", suggested_stage_id: sugStage.id,
      confidence: stageConf,
      rationale: String(parsed?.stage?.rationale ?? "").slice(0, 1000),
      evidence: Array.isArray(parsed?.stage?.evidence) ? parsed.stage.evidence : [],
    };

    // Precedência do motor de palavra-chave: se ele moveu este card há pouco e a
    // IA discorda, a IA NÃO desfaz. Vira sugestão, e um humano decide. Dois
    // motores se sobrescrevendo em silêncio é pior que uma linha na fila.
    const gatilhoRecente =
      ctx.last_trigger_stage_id != null &&
      ctx.last_trigger_minutes != null &&
      Number(ctx.last_trigger_minutes) <= 60 &&
      ctx.last_trigger_stage_id === ctx.ticket?.stage_id &&
      sugStage.id !== ctx.last_trigger_stage_id;

    if (stageConf < minStage) {
      if (!dry) await admin.from("conv_ai_insights").insert({ ...stageRow, status: "skipped_low_confidence" });
      resultado = "low_confidence";
    } else if (gatilhoRecente) {
      await gravarAberto({
        ...stageRow,
        status: aplicando ? "pending" : "shadow",
        rationale: `[Discorda de uma regra de gatilho aplicada há ${Math.round(Number(ctx.last_trigger_minutes))} min] ${stageRow.rationale}`,
      });
      resultado = aplicando ? "stage_pending_conflito_gatilho" : "stage_shadow";
    } else if (stageMode === "suggest") {
      await gravarAberto({ ...stageRow, status: aplicando ? "pending" : "shadow" });
      resultado = aplicando ? "stage_pending" : "stage_shadow";
    } else {
      let applied = false;
      if (aplicando) {
        const { data: res, error: mvErr } = await admin.rpc("set_ticket_stage", {
          p_ticket_id: item.ticket_id,
          p_new_stage_id: sugStage.id,
          p_source: "ia_analise",
          p_actor: "conv-ai-analyst",
          p_on_resolved: "block",
        });
        if (mvErr) throw new Error(`set_ticket_stage: ${mvErr.message}`);
        applied = res?.success === true && res?.blocked !== true;
      }
      if (!dry) {
        await admin.from("conv_ai_insights").insert({ ...stageRow, status: applied ? "auto_applied" : "shadow" });
      }
      resultado = applied ? "stage_applied" : "stage_shadow";
    }
  }

  if (!dry) {
    await admin.rpc("conv_ai_finish_ticket", {
      p_ticket_id: item.ticket_id, p_analyzed_seq: ctx.last_seq, p_error: null,
    });
    await admin.from("conv_ai_clinic_config")
      .update({ last_analysis_at: new Date().toISOString() })
      .eq("clinic_id", item.clinic_id);
  }
  return debug
    ? { resultado, parsed, etapa_atual: ctx.ticket?.stage_name, tem_manual: !!ctx.clinic_prompt, mensagens: (ctx.messages ?? []).length }
    : resultado;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const url = new URL(req.url);
  const dry = url.searchParams.get("dry") === "1";
  const oneTicket = url.searchParams.get("ticket");
  const debug = url.searchParams.get("debug") === "1";

  try {
    const { data: row } = await admin
      .from("system_settings").select("value").eq("id", "conv_ai_config").maybeSingle();
    let cfg: any = { ...DEFAULTS };
    try { cfg = { ...DEFAULTS, ...JSON.parse(row?.value ?? "{}") }; } catch { /* default */ }

    if (cfg.mode === "off" && !oneTicket) {
      return new Response(JSON.stringify({ skipped: "mode_off" }), {
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // Lote: claim atômico (duas execuções do cron nunca pegam o mesmo ticket).
    let batch: any[] = [];
    if (oneTicket) {
      const { data: t } = await admin
        .from("tickets").select("id, clinic_id, lead_id").eq("id", oneTicket).maybeSingle();
      if (!t) {
        return new Response(JSON.stringify({ error: "ticket não encontrado" }), {
          status: 404, headers: { ...CORS, "Content-Type": "application/json" },
        });
      }
      batch = [{ ticket_id: t.id, clinic_id: t.clinic_id, lead_id: t.lead_id, last_message_seq: 0, analyzed_seq: 0 }];
    } else {
      const limit = parseInt(url.searchParams.get("limit") ?? "") || cfg.batch_size;
      const { data, error } = await admin.rpc("conv_ai_claim_batch", {
        p_limit: limit,
        p_debounce_minutes: cfg.debounce_minutes,
        p_daily_cap: cfg.daily_cap_per_clinic,
      });
      if (error) throw new Error(`claim: ${error.message}`);
      batch = data ?? [];
    }

    if (batch.length === 0) {
      return new Response(JSON.stringify({ processed: 0 }), {
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // Config por clínica: limiar (override do global) e o modo de cada eixo.
    const clinicIds = [...new Set(batch.map((b) => b.clinic_id))];
    const { data: confs } = await admin
      .from("conv_ai_clinic_config")
      .select("clinic_id, min_confidence_stage, stage_mode, sale_mode")
      .in("clinic_id", clinicIds);
    const cfgByClinic = new Map((confs ?? []).map((c: any) => [c.clinic_id, c]));

    const results: Record<string, number> = {};
    const detalhes: any[] = [];
    for (const item of batch) {
      const cc = cfgByClinic.get(item.clinic_id) ?? {};
      const enriched = {
        ...item,
        min_confidence_stage: cc.min_confidence_stage ?? null,
        stage_mode: cc.stage_mode ?? "auto",
        sale_mode: cc.sale_mode ?? "suggest",
      };
      try {
        const r = await analisarTicket(enriched, cfg, dry, debug);
        if (debug) detalhes.push(r);
        const label = typeof r === "string" ? r : r.resultado;
        results[label] = (results[label] ?? 0) + 1;
      } catch (e) {
        results["error"] = (results["error"] ?? 0) + 1;
        const msg = e instanceof Error ? e.message : String(e);
        await registrarErro(
          "analise_falhou",
          "Análise de conversa falhou — o card não vai andar e a venda não vai ser sugerida",
          "error", item.clinic_id, { ticket_id: item.ticket_id, erro: msg },
        );
        if (!dry) {
          await admin.rpc("conv_ai_finish_ticket", {
            p_ticket_id: item.ticket_id, p_analyzed_seq: item.analyzed_seq ?? 0, p_error: msg.slice(0, 500),
          });
        }
      }
    }

    return new Response(JSON.stringify({ mode: cfg.mode, dry, processed: batch.length, results, ...(debug ? { detalhes } : {}) }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await registrarErro("rodada_falhou", "A rodada do analista de conversas quebrou inteira", "critical", null, { erro: msg });
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
