// _shared/agent/prompt.ts — montagem do system prompt do Agente IA.
//
// Reproduz o systemMessage do no "AI Agent" do n8n, na mesma ordem:
//   1) bloco temporal (hoje + 15 dias, America/Sao_Paulo)
//   2) Dados do Lead  (leads.ai_summary)
//   3) prompt combinado (v_clinic_ai_prompt.combined_prompt = template do sistema + prompt da clinica)
//   4) bloco de transbordo (montado das handoff_rules)

const DIAS = ["domingo", "segunda-feira", "terca-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sabado"];
const DIAS_ACENTO = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];

function cap(x: string): string { return x.charAt(0).toUpperCase() + x.slice(1); }

// Data "hoje" (YYYY-MM-DD) no fuso de Sao Paulo, sem depender de libs.
function todaySP(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}
function hourSP(): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
}

// Ancora a data em meio-dia UTC para somar dias sem risco de virar o dia por fuso.
function dayInfo(baseYmd: string, add: number): { weekday: string; dm: string } {
  const [y, m, d] = baseYmd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  dt.setUTCDate(dt.getUTCDate() + add);
  const weekday = DIAS_ACENTO[dt.getUTCDay()];
  const dm = `${String(dt.getUTCDate()).padStart(2, "0")}/${String(dt.getUTCMonth() + 1).padStart(2, "0")}/${dt.getUTCFullYear()}`;
  return { weekday, dm };
}

export function buildTemporalBlock(): string {
  const base = todaySP();
  const linhas: string[] = [];
  const hoje = dayInfo(base, 0);
  linhas.push(`Hoje é ${hoje.weekday}, ${hoje.dm} - ${hourSP()}`);
  const amanha = dayInfo(base, 1);
  linhas.push(`Amanhã será ${amanha.weekday}, ${amanha.dm}`);
  const depois = dayInfo(base, 2);
  linhas.push(`Depois de amanhã será ${depois.weekday}, ${depois.dm}`);
  for (let i = 3; i <= 15; i++) {
    const di = dayInfo(base, i);
    linhas.push(cap(`${di.weekday} será ${di.dm}`));
  }
  return `contexto_temporal:\n  data_de_hoje: |\n${linhas.join("\n")}`;
}

export interface HandoffRule { keywords?: string; action?: string; [k: string]: unknown }

export function buildHandoffBlock(rules: HandoffRule[] | null | undefined, enabled: boolean): string {
  const rs = (rules || []).filter((r) => r && r.keywords);
  if (rs.length === 0 || !enabled) return "";
  const kws = rs.map((r) => `- ${r.keywords}`).join("\n");
  return `## Transbordo para humano\n\n` +
    `Se o cliente mencionar QUALQUER uma das palavras-chave abaixo (ou variações claras delas), ` +
    `CHAME IMEDIATAMENTE a tool ACIONAR_HANDOFF passando trigger_keyword com a palavra detectada.\n\n` +
    `Palavras-chave configuradas:\n${kws}\n\n` +
    `A tool cuida de tudo: pausa a IA, avisa a equipe e envia despedida ao cliente se configurado. ` +
    `Você NÃO deve escrever "Gatilho:", "vou transferir" ou qualquer marcador no texto.\n\n` +
    `Ao chamar a tool, leia o campo next_step retornado e siga ele literalmente.`;
}

export interface AgentContext {
  combinedPrompt: string;
  aiSummary: string;
  handoffRules: HandoffRule[] | null;
  handoffEnabled: boolean;
}

export function assembleSystemPrompt(ctx: AgentContext): string {
  const parts = [
    buildTemporalBlock(),
    ctx.aiSummary || "",
    ctx.combinedPrompt || "",
    buildHandoffBlock(ctx.handoffRules, ctx.handoffEnabled),
  ].filter((p) => p && p.trim());
  return parts.join("\n\n");
}

/** Le combined_prompt (v_clinic_ai_prompt) e ai_summary (leads) para a sessao. */
export async function fetchAgentContext(
  supabase: any, clinicId: string, sessionId: string,
  handoffRules: HandoffRule[] | null, handoffEnabled: boolean,
): Promise<AgentContext> {
  const [{ data: promptRow }, { data: leadRow }] = await Promise.all([
    supabase.from("v_clinic_ai_prompt").select("combined_prompt").eq("clinic_id", clinicId).maybeSingle(),
    supabase.from("leads").select("ai_summary").eq("clinic_id", clinicId).eq("session_id", sessionId).maybeSingle(),
  ]);
  return {
    combinedPrompt: promptRow?.combined_prompt || "",
    aiSummary: leadRow?.ai_summary || "",
    handoffRules,
    handoffEnabled,
  };
}

export { DIAS };
