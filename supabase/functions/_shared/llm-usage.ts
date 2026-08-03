// _shared/llm-usage.ts — monitor de consumo de IA, um lugar so.
//
// Toda chamada a provedor (Gemini, Anthropic, OpenAI, ElevenLabs) vira uma linha em `llm_usage`.
// Antes disso o consumo vinha na resposta de todo provedor e era DESCARTADO em tudo menos no
// conv-ai-analyst — justamente o AGENTE, maior consumidor, ficava sem registro, e "quem esta
// gastando mais?" so tinha resposta por estimativa de volume.
//
// `feature` = a chave de system_settings que o Super Admin edita, para o painel agrupar pelas
// MESMAS funcoes que ele configura. Use as constantes abaixo em vez de string solta: errar o
// nome nao da erro, so faz a linha sumir do grupo certo no painel.

export const FEATURE = {
  agente: "agent_ai_config",
  analista: "conv_ai_config",
  assistente: "ai_assistant_config",
  midia: "media_ai_config",
  voz: "elevenlabs_config",
  // Memoria longa do agente. Chave PROPRIA de proposito: registrada sob `agente` ela sumia dentro
  // do grupo do Agente no painel, e "quanto custa a memoria?" ficava sem resposta. Ela tambem tem
  // modelo proprio (mais barato), entao misturar as duas escondia a economia.
  memoriaLonga: "long_memory_config",
} as const;

export interface UsoIA {
  feature: string;
  /** edge/passo de origem: e o que permite achar o culpado quando um numero pula */
  scope: string;
  provider: string;
  model?: string | null;
  clinicId?: string | null;
  leadId?: string | null;
  tokensIn?: number;
  tokensOut?: number;
  /** para o que NAO e cobrado por token: TTS conta caracteres, audio pode contar segundos */
  units?: number;
  unitKind?: string | null;
  ok?: boolean;
  error?: string | null;
  durationMs?: number;
}

/**
 * ⚠️ SEGREDO NA MENSAGEM DE ERRO. O Gemini leva a chave na QUERY STRING
 * (`...:generateContent?key=AIza...`), e o `TypeError` de rede do Deno embute a URL inteira.
 * Sem esta limpeza, uma queda de rede grava a chave viva do provedor numa tabela que fica 90 dias.
 * Limpa por PADRAO (nao por provider) porque a mesma mensagem chega por caminhos diferentes.
 */
export function limparSegredo(msg: string | null | undefined): string | null {
  if (!msg) return null;
  return String(msg)
    .replace(/([?&](?:key|api[_-]?key|token|access_token)=)[^&\s"')]+/gi, "$1[REMOVIDO]")
    .replace(/\b(AIza[0-9A-Za-z_\-]{10,})/g, "[REMOVIDO]")
    .replace(/\b(sk-[A-Za-z0-9_\-]{10,})/g, "[REMOVIDO]")
    .replace(/\b(sk-ant-[A-Za-z0-9_\-]{10,})/g, "[REMOVIDO]")
    .replace(/\b(xi-api-key\s*[:=]\s*)[^\s,"']+/gi, "$1[REMOVIDO]")
    .slice(0, 500);
}

/**
 * Registra e NUNCA lanca. Um monitor que derruba a funcao monitorada e pior que nao ter monitor:
 * aqui a falha maxima aceitavel e perder a linha do painel, nunca o atendimento.
 * Nao retorna promessa que valha esperar — chame com `void`.
 */
export function registrarUsoIA(supabase: any, u: UsoIA): void {
  // `waitUntil` (padrao ja usado em ai-agent/ai-agent-worker/ai-sandbox/ai-scheduler) mantem a
  // gravacao viva DEPOIS que a edge devolve a resposta, sem cobrar latencia de quem esta esperando.
  // Sem ele restavam duas opcoes ruins: `await` (soma uma ida ao banco por passo — no assistente sao
  // ate 15 por pergunta) ou soltar (o isolate morre no `return` e some justamente a chamada final,
  // que carrega a conversa inteira e e a mais cara).
  const p = registrarUsoIAAsync(supabase, u);
  try { (globalThis as any).EdgeRuntime?.waitUntil?.(p); } catch { /* fora da edge: segue solto */ }
}

/**
 * Mesma coisa, mas devolve a promessa. Use quando a linha for registrada IMEDIATAMENTE ANTES de
 * devolver a resposta HTTP: o isolate da edge e derrubado depois do `return`, e um fire-and-forget
 * ali morre com ele — some justamente a chamada final, que costuma ser a maior.
 * Prefira `EdgeRuntime.waitUntil(...)` quando existir; senao, `await`.
 */
export function registrarUsoIAAsync(supabase: any, u: UsoIA): Promise<void> {
  try {
    return supabase.rpc("log_llm_usage", {
      p_feature: u.feature,
      p_scope: u.scope,
      p_provider: u.provider,
      p_model: u.model ?? null,
      p_clinic_id: u.clinicId ?? null,
      p_tokens_in: Math.max(0, Math.round(u.tokensIn ?? 0)),
      p_tokens_out: Math.max(0, Math.round(u.tokensOut ?? 0)),
      p_ok: u.ok ?? true,
      p_error: limparSegredo(u.error),
      p_duration_ms: u.durationMs ?? null,
      p_units: Math.max(0, Math.round(u.units ?? 0)),
      p_unit_kind: u.unitKind ?? null,
      p_lead_id: u.leadId ?? null,
    }).then(() => undefined, () => undefined);
  } catch {
    // rede caida ate o Postgres: segue o jogo
  }
  return Promise.resolve();
}

/**
 * Envelopa uma chamada de LLM medindo tempo e registrando sucesso E falha.
 * Falha tambem entra: consome cota, e um pico de erro no painel e o sintoma mais barato de
 * "acabou o credito" ou "modelo fora do ar".
 */
export async function comMonitor<T>(
  supabase: any,
  base: Omit<UsoIA, "tokensIn" | "tokensOut" | "ok" | "error" | "durationMs">,
  fn: () => Promise<T>,
  tokensDe: (r: T) => { input?: number; output?: number },
): Promise<T> {
  const t0 = Date.now();
  try {
    const r = await fn();
    const t = tokensDe(r) ?? {};
    registrarUsoIA(supabase, { ...base, tokensIn: t.input ?? 0, tokensOut: t.output ?? 0, ok: true, durationMs: Date.now() - t0 });
    return r;
  } catch (e) {
    registrarUsoIA(supabase, { ...base, ok: false, error: String((e as Error)?.message ?? e), durationMs: Date.now() - t0 });
    throw e;
  }
}
