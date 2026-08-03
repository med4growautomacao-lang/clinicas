// conv-ai-mine — automação da CURADORIA de padrões do motor mecânico (4º modo do analista).
//
// Para uma clínica, minera candidatos (RPC conv_ai_mine_candidates: n-gramas com lift vs
// desfecho real), manda o LLM CURAR (junta fragmentos na frase mais completa, descarta a
// saudação que pegou carona, atribui a etapa do funil) e grava os padrões LIMPOS em
// conv_ai_patterns (source='mined'). A cada rodada SUBSTITUI os 'mined' da clínica; nunca
// toca nos 'manual'/'pair'.
//
// ⚠️ Só serve clínica COM gabarito (leads resolvidos, ganho/perdido). Funil abandonado sem
// outcome vem pela via de PAR auto-evidente (pendente), não por esta.
//
// Uso manual: ?clinic=<uuid>&dry=1 (mostra o que gravaria sem gravar). Sem clinic: varre as
// clínicas com o analista de IA ligado (enabled) OU com o motor mecânico ligado (shadow/active),
// porque quem usa só o Mecânico fica com enabled=false e ainda precisa dos padrões minerados.
// Consumo de IA registrado (FEATURE.analista). Toda falha vai
// para a Central de Erros: perda silenciosa é o pecado capital deste sistema.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { comMonitor, FEATURE } from "../_shared/llm-usage.ts";

const SCOPE = "conv-ai-mine";
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

// A geração Opus 4.7+ da Anthropic (Opus 4.7/4.8/5, Sonnet 5, Fable 5, Mythos 5) removeu
// temperature/top_p/top_k (400 se mandar) e liga "thinking" sozinha. Aqui só queremos o JSON
// dos padrões, sem gastar o teto pensando.
//
// ⚠️ `opus-5` é escrito à parte porque `opus-4-[78]` NÃO o cobre: esta régua nasceu antes do
// Opus 5 e deixava de fora justamente o modelo mais novo, que é o mais provável de alguém
// escolher no Super Admin. Corrigido em 03/08 junto com as irmãs (analyst, learn, llm.ts).
const ANTHROPIC_NO_SAMPLING = /^claude-(opus-4-[78]|opus-5|sonnet-5|fable-5|mythos-5)/;
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

type LlmOut = { text: string; tokens_in: number; tokens_out: number };

async function callLlm(
  provider: string, model: string, temperature: number, maxTokens: number,
  system: string, user: string, jsonMode = true,
): Promise<LlmOut> {
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
    return {
      text: (j?.content ?? []).map((c: any) => c?.text).filter(Boolean).join("\n").trim(),
      tokens_in: j?.usage?.input_tokens ?? 0,
      tokens_out: j?.usage?.output_tokens ?? 0,
    };
  }

  if (provider === "openai") {
    const gpt5 = /^(gpt-5|o[134])/.test(model);
    const body: Record<string, unknown> = {
      model,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    };
    if (gpt5) {
      body.max_completion_tokens = Math.max(maxTokens, 4000);
      body.reasoning_effort = "low";
    } else {
      body.max_tokens = maxTokens;
      body.temperature = temperature;
    }
    if (jsonMode) body.response_format = { type: "json_object" };
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: AbortSignal.timeout(90000),
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify(body),
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
      signal: AbortSignal.timeout(90000),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ parts: [{ text: user }] }],
        generationConfig: {
          temperature, maxOutputTokens: maxTokens,
          ...(jsonMode ? { responseMimeType: "application/json" } : {}),
        },
      }),
    },
  );
  if (!r.ok) throw new Error(`gemini ${r.status}: ${(await r.text().catch(() => "")).slice(0, 300)}`);
  const j = await r.json();
  return {
    text: (j?.candidates?.[0]?.content?.parts ?? []).map((p: any) => p?.text).filter(Boolean).join(" ").trim(),
    tokens_in: j?.usageMetadata?.promptTokenCount ?? 0,
    tokens_out: j?.usageMetadata?.candidatesTokenCount ?? 0,
  };
}

// Pega o primeiro objeto JSON balanceado, mesmo embrulhado em cerca de markdown ou prosa.
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
    else if (ch === "}") { depth--; if (depth === 0) { try { return JSON.parse(cleaned.slice(start, i + 1)); } catch { return null; } } }
  }
  return null;
}

const norm = (s: unknown) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const clamp01 = (n: unknown) => {
  const x = Number(n);
  return Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0.5;
};

async function stagesDaClinica(clinicId: string): Promise<Array<{ id: string; slug: string; name: string; is_conversion: boolean }>> {
  const { data } = await admin
    .from("funnel_stages")
    .select("id, slug, name, is_conversion")
    .eq("clinic_id", clinicId)
    .order("position");
  return (data ?? []) as any[];
}

const SYSTEM_CURADOR = `Você é um curador de padrões de um CRM médico. Recebe n-gramas candidatos, minerados das mensagens de uma clínica, cada um com o lift (quantas vezes acima da média de fechamento ele aparece) e o % de ganho. Sua tarefa é transformá-los em PADRÕES LIMPOS que um código simples vai usar para SUGERIR em que etapa do funil o atendimento deveria estar.

Regras invioláveis:
- JUNTE fragmentos que são a mesma frase: escolha a versão mais completa e distintiva (ex.: "para sua", "ate breve!", "sua consulta!" viram um só padrão "tudo certo para sua consulta ate breve").
- DESCARTE saudação e frase genérica que só pegou carona no contexto ("bom dia", "boa tarde", "tudo bem", "para sua", "com urologista", "meu plano", "voces fazem", "opcao selecionada" sem o resto).
- ATRIBUA a etapa que a frase indica, escolhendo SOMENTE entre os slugs de etapa fornecidos.
- NUNCA use uma etapa de conversão/venda como alvo: pagamento não aparece no chat. Confirmação de agendamento é a etapa de AGENDAMENTO, não a de venda.
- "side" é "outbound" (frase escrita pela clínica) ou "inbound" (frase do paciente).
- "confidence" de 0 a 1, refletindo o % de ganho/precisão do candidato de origem. Prefira confiança baixa a inventar.
- Use o % de ganho como PISTA da etapa: candidato da clínica com ganho muito baixo costuma ser mensagem de encerramento/desistência e vai para a etapa de PERDA; frase de cancelamento do paciente vai para a etapa de FALTA/CANCELAMENTO; confirmação/instrução pós-marcação vai para a etapa de AGENDAMENTO.
- Só devolva padrões que você tem certeza que significam a etapa. Poucos e certos é melhor que muitos e duvidosos.

Responda SOMENTE com um JSON válido, sem texto antes ou depois:
{"patterns":[{"phrase":"frase normalizada em minúsculas sem acento","side":"outbound","target_slug":"agendado","confidence":0.9}]}`;

function buildCurationPrompt(
  stages: Array<{ slug: string; name: string; is_conversion: boolean }>,
  outC: any[], inC: any[],
): string {
  const etapas = stages.map((s) =>
    `- ${s.slug}: "${s.name}"${s.is_conversion ? " (ETAPA DE VENDA — NÃO usar como alvo)" : ""}`
  ).join("\n");
  const linha = (c: any) => `  "${c.gram}"  (leads ${c.leads}, ganho ${c.pct_ganho}%, lift ${c.lift})`;
  return `## Etapas do funil desta clínica (use SÓ esses slugs no target_slug)
${etapas}

## Candidatos da SAÍDA (frases da clínica)
${outC.map(linha).join("\n") || "(nenhum)"}

## Candidatos da ENTRADA (frases do paciente)
${inC.map(linha).join("\n") || "(nenhum)"}

Cure conforme as regras e responda no formato JSON pedido.`;
}

async function rodarMineracao(clinicId: string, cfg: any, dry: boolean): Promise<any> {
  const [out, inb] = await Promise.all([
    admin.rpc("conv_ai_mine_candidates", { p_clinic_id: clinicId, p_min_support: 8, p_side: "outbound" }),
    admin.rpc("conv_ai_mine_candidates", { p_clinic_id: clinicId, p_min_support: 6, p_side: "inbound" }),
  ]);
  if (out.error) throw new Error(`candidatos saída: ${out.error.message}`);
  if (inb.error) throw new Error(`candidatos entrada: ${inb.error.message}`);
  // Inclui os DOIS tipos de sinal: ganho (lift alto) E perdido (ganho=0). Sem isso, mandar só
  // os de maior lift pro LLM descarta os padrões de encerramento/cancelamento (lift 0).
  const pick = (rows: any[] | null, nGanho: number, nPerdido: number) => {
    const arr = rows ?? [];
    return [
      ...arr.filter((c) => (c.ganho ?? 0) > 0).slice(0, nGanho),
      ...arr.filter((c) => (c.ganho ?? 0) === 0).slice(0, nPerdido),
    ];
  };
  const outC = pick(out.data, 40, 20);
  const inC = pick(inb.data, 20, 12);
  if (outC.length + inC.length < 3) {
    return { clinic_id: clinicId, skipped: "poucos_candidatos_ou_sem_gabarito", candidatos: outC.length + inC.length };
  }

  const stages = await stagesDaClinica(clinicId);
  const stageBySlug = new Map(stages.map((s) => [norm(s.slug), s]));
  const user = buildCurationPrompt(stages, outC, inC);

  const res = await comMonitor(
    admin,
    { feature: FEATURE.analista, scope: SCOPE, provider: cfg.provider, model: cfg.model, clinicId },
    () => callLlm(cfg.provider, cfg.model, 0.1, 1500, SYSTEM_CURADOR, user, true),
    (r) => ({ input: r.tokens_in, output: r.tokens_out }),
  );

  const parsed = extractJson(res.text);
  if (!parsed) {
    await registrarErro("curadoria_nao_json", "A curadoria de padrões devolveu resposta fora do JSON", "warning",
      clinicId, { resposta: res.text.slice(0, 500) });
    return { clinic_id: clinicId, erro: "resposta_nao_json" };
  }

  const brutos: any[] = Array.isArray(parsed?.patterns) ? parsed.patterns : [];
  // Filtra: alvo válido, NUNCA etapa de venda, frase presente.
  const rows = brutos
    .filter((p) => p?.phrase && stageBySlug.has(norm(p?.target_slug)) && !stageBySlug.get(norm(p.target_slug))!.is_conversion)
    .map((p) => {
      const isIn = norm(p.side) === "inbound";
      return {
        clinic_id: clinicId,
        side: isIn ? "inbound" : "outbound",
        phrase_in: isIn ? norm(p.phrase) : null,
        phrase_out: isIn ? null : norm(p.phrase),
        target_kind: "stage",
        target_stage_id: stageBySlug.get(norm(p.target_slug))!.id,
        confidence: clamp01(p.confidence),
        source: "mined",
      };
    });

  if (dry) {
    return {
      clinic_id: clinicId, dry: true,
      candidatos: { saida: outC.length, entrada: inC.length },
      padroes: rows,
      tokens: { entrada: res.tokens_in, saida: res.tokens_out },
    };
  }

  // Substitui os minerados anteriores desta clínica (mantém 'manual'/'pair' intactos).
  await admin.from("conv_ai_patterns").delete().eq("clinic_id", clinicId).eq("source", "mined");
  if (rows.length) {
    const { error } = await admin.from("conv_ai_patterns").insert(rows);
    if (error) throw new Error(`gravar padrões: ${error.message}`);
  }
  return { clinic_id: clinicId, gravados: rows.length, candidatos: { saida: outC.length, entrada: inC.length } };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url);
  const dry = url.searchParams.get("dry") === "1";
  const oneClinic = url.searchParams.get("clinic");

  try {
    const { data: row } = await admin
      .from("system_settings").select("value").eq("id", "conv_ai_config").maybeSingle();
    let cfg: any = { provider: "anthropic", model: "claude-haiku-4-5" };
    try { cfg = { ...cfg, ...JSON.parse(row?.value ?? "{}") }; } catch { /* default */ }

    let alvos: string[] = [];
    if (oneClinic) {
      alvos = [oneClinic];
    } else {
      // Analista de IA ligado (enabled) OU motor mecânico em shadow/active. Sem o segundo braço,
      // clínica que escolhe só Mecânico (enabled=false) nunca teria padrões e a fila ficaria vazia.
      const { data } = await admin
        .from("conv_ai_clinic_config")
        .select("clinic_id")
        .or("enabled.eq.true,mechanical_mode.in.(shadow,active)");
      alvos = (data ?? []).map((c: any) => c.clinic_id);
    }

    const resultados: any[] = [];
    for (const clinicId of alvos) {
      try {
        resultados.push(await rodarMineracao(clinicId, cfg, dry));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        resultados.push({ clinic_id: clinicId, erro: msg });
        await registrarErro("mineracao_falhou", "Falha ao minerar/curar os padrões da clínica", "warning", clinicId, { erro: msg });
      }
    }

    return new Response(JSON.stringify({ dry, alvos: alvos.length, resultados }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await registrarErro("rodada_falhou", "A rodada de mineração de padrões quebrou inteira", "error", null, { erro: msg });
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
