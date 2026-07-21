// conv-ai-learn — escreve e reescreve o MANUAL DE ANÁLISE de cada clínica.
//
// É o "aprendizado" do analista: o conhecimento do negócio não fica hardcoded no
// prompt do sistema (esse é COMPARTILHADO), e sim numa versão por clínica, guardada
// em conv_ai_prompt_versions e injetada pelo conv_ai_get_context.
//
// Dois modos, escolhidos automaticamente por conv_ai_learn_targets:
//   • bootstrap — clínica sem versão vigente. Como há pouca configuração escrita,
//     a v1 nasce das CONVERSAS HISTÓRICAS, que já vêm rotuladas por humanos: a
//     etapa em que o card foi deixado e o desfecho do ticket (ganho/perdido).
//   • learn — a cada N decisões humanas. Duas fontes de sinal: as vendas
//     confirmadas/recusadas na fila e as correções implícitas de etapa (humano
//     moveu o card em até 48h depois de um movimento 'ia_analise').
//
// Disparo: cron 1x/dia via system_http_post (sem JWT) -> deploy com --no-verify-jwt.
// Aceita ?clinic=<uuid> e ?dry=1 para rodar sob medida.
//
// Rollback é um clique na UI (conv_ai_rollback_prompt): toda versão fica guardada.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SCOPE = "conv-ai-learn";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const admin = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

async function registrarErro(
  code: string, title: string, level: string, clinicId: string | null, ctx: unknown,
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

// A geração Opus 4.7+ da Anthropic (Opus 4.8/4.7, Sonnet 5, Fable 5) REMOVEU
// temperature/top_p/top_k: mandar o campo devolve 400. Nesses modelos o
// "thinking" também liga sozinho, e aqui só queremos o texto do manual — sem
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
): Promise<string> {
  const key = await llmKey(provider);
  if (!key) throw new Error(`sem chave de API para ${provider}`);

  if (provider === "anthropic") {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: AbortSignal.timeout(90000),
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify(anthropicBody(model, temperature, maxTokens, system, user)),
    });
    if (!r.ok) throw new Error(`anthropic ${r.status}: ${(await r.text().catch(() => "")).slice(0, 300)}`);
    const j = await r.json();
    return (j?.content ?? []).map((c: any) => c?.text).filter(Boolean).join("\n").trim();
  }

  if (provider === "openai") {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: AbortSignal.timeout(90000),
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model, temperature, max_tokens: maxTokens,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
      }),
    });
    if (!r.ok) throw new Error(`openai ${r.status}: ${(await r.text().catch(() => "")).slice(0, 300)}`);
    const j = await r.json();
    return (j?.choices?.[0]?.message?.content ?? "").trim();
  }

  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    {
      method: "POST",
      signal: AbortSignal.timeout(90000),
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
  return (j?.candidates?.[0]?.content?.parts ?? []).map((p: any) => p?.text).filter(Boolean).join(" ").trim();
}

async function stagesDaClinica(clinicId: string): Promise<string> {
  const { data } = await admin
    .from("funnel_stages")
    .select("name, slug, position, is_conversion")
    .eq("clinic_id", clinicId)
    .order("position");
  return (data ?? []).map((s: any) =>
    `- ${s.slug ?? s.name}: "${s.name}"${s.is_conversion ? " (ETAPA DE CONVERSÃO / VENDA FECHADA)" : ""}`
  ).join("\n");
}

async function rodarBootstrap(clinicId: string, cfg: any, dry: boolean) {
  const learn = cfg.learn ?? {};
  const { data: amostra, error } = await admin.rpc("conv_ai_bootstrap_sample", {
    p_clinic_id: clinicId, p_limit: learn.bootstrap_sample ?? 60,
  });
  if (error) throw new Error(`amostra: ${error.message}`);
  const casos: any[] = amostra ?? [];
  if (casos.length < 5) return { clinic_id: clinicId, mode: "bootstrap", skipped: "historico_insuficiente", casos: casos.length };

  const user = `## Etapas do funil desta empresa
${await stagesDaClinica(clinicId)}

## Amostra de ${casos.length} atendimentos reais já rotulados por humanos
${casos.map((c, i) =>
  `### Caso ${i + 1}
Etapa em que o humano deixou: ${c.stage ?? "-"}
Desfecho: ${c.outcome}
Conversa:
${c.conversa}`).join("\n\n")}`;

  const texto = await callLlm(
    learn.provider ?? cfg.provider, learn.model ?? cfg.model,
    learn.temperature ?? 0.3, 2000, cfg.bootstrap_prompt ?? "", user,
  );
  if (!texto) throw new Error("bootstrap devolveu texto vazio");

  if (!dry) {
    const { data: res, error: saveErr } = await admin.rpc("conv_ai_save_prompt_version", {
      p_clinic_id: clinicId, p_content: texto, p_source: "bootstrap", p_based_on: casos.length,
    });
    if (saveErr) throw new Error(`salvar versão: ${saveErr.message}`);
    return { clinic_id: clinicId, mode: "bootstrap", version: res?.version, casos: casos.length };
  }
  return { clinic_id: clinicId, mode: "bootstrap", dry: true, preview: texto.slice(0, 600), casos: casos.length };
}

async function rodarAprendizado(clinicId: string, decisions: number, cfg: any, dry: boolean) {
  const learn = cfg.learn ?? {};
  const { data: fb, error } = await admin.rpc("conv_ai_feedback_sample", {
    p_clinic_id: clinicId, p_limit: 40,
  });
  if (error) throw new Error(`feedback: ${error.message}`);

  const vendas: any[] = fb?.vendas ?? [];
  const correcoes: any[] = fb?.correcoes_de_etapa ?? [];
  if (vendas.length === 0 && correcoes.length === 0) {
    return { clinic_id: clinicId, mode: "learn", skipped: "sem_sinal" };
  }

  const { data: atual } = await admin
    .from("conv_ai_prompt_versions").select("content, version")
    .eq("clinic_id", clinicId).eq("is_current", true).maybeSingle();

  const user = `## Etapas do funil desta empresa
${await stagesDaClinica(clinicId)}

## Manual vigente (versão ${atual?.version ?? "-"})
${atual?.content ?? "(vazio)"}

## Decisões humanas sobre as sugestões de VENDA (${vendas.length})
${vendas.length ? JSON.stringify(vendas, null, 1) : "(nenhuma)"}

## Etapas que o humano CORRIGIU depois da IA mover (${correcoes.length})
${correcoes.length ? JSON.stringify(correcoes, null, 1) : "(nenhuma)"}`;

  const texto = await callLlm(
    learn.provider ?? cfg.provider, learn.model ?? cfg.model,
    learn.temperature ?? 0.3, 2000, cfg.learn_prompt ?? "", user,
  );
  if (!texto) throw new Error("aprendizado devolveu texto vazio");

  if (!dry) {
    const { data: res, error: saveErr } = await admin.rpc("conv_ai_save_prompt_version", {
      p_clinic_id: clinicId, p_content: texto, p_source: "learn", p_based_on: decisions,
    });
    if (saveErr) throw new Error(`salvar versão: ${saveErr.message}`);
    return { clinic_id: clinicId, mode: "learn", version: res?.version, vendas: vendas.length, correcoes: correcoes.length };
  }
  return { clinic_id: clinicId, mode: "learn", dry: true, preview: texto.slice(0, 600), vendas: vendas.length, correcoes: correcoes.length };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const url = new URL(req.url);
  const dry = url.searchParams.get("dry") === "1";
  const oneClinic = url.searchParams.get("clinic");
  const forced = url.searchParams.get("mode"); // bootstrap | learn (só com ?clinic=)

  try {
    const { data: row } = await admin
      .from("system_settings").select("value").eq("id", "conv_ai_config").maybeSingle();
    let cfg: any = {};
    try { cfg = JSON.parse(row?.value ?? "{}"); } catch { cfg = {}; }
    if (cfg.mode === "off" && !oneClinic) {
      return new Response(JSON.stringify({ skipped: "mode_off" }), {
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    let alvos: any[] = [];
    if (oneClinic) {
      const { data: cur } = await admin
        .from("conv_ai_prompt_versions").select("id")
        .eq("clinic_id", oneClinic).eq("is_current", true).maybeSingle();
      const { data: conf } = await admin
        .from("conv_ai_clinic_config").select("decisions_since_learn")
        .eq("clinic_id", oneClinic).maybeSingle();
      alvos = [{
        clinic_id: oneClinic,
        mode: forced ?? (cur ? "learn" : "bootstrap"),
        decisions: conf?.decisions_since_learn ?? 0,
      }];
    } else {
      const { data, error } = await admin.rpc("conv_ai_learn_targets", {
        p_every_n: cfg?.learn?.every_n_decisions ?? 15,
      });
      if (error) throw new Error(`alvos: ${error.message}`);
      alvos = data ?? [];
    }

    const out: any[] = [];
    for (const alvo of alvos) {
      try {
        out.push(alvo.mode === "bootstrap"
          ? await rodarBootstrap(alvo.clinic_id, cfg, dry)
          : await rodarAprendizado(alvo.clinic_id, alvo.decisions ?? 0, cfg, dry));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        out.push({ clinic_id: alvo.clinic_id, mode: alvo.mode, erro: msg });
        await registrarErro(
          "aprendizado_falhou",
          "Falha ao gerar o manual de análise da clínica — a IA segue com a versão antiga",
          "warning", alvo.clinic_id, { modo: alvo.mode, erro: msg },
        );
      }
    }

    return new Response(JSON.stringify({ dry, alvos: alvos.length, resultados: out }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await registrarErro("rodada_falhou", "A rodada de aprendizado do analista quebrou inteira", "error", null, { erro: msg });
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
