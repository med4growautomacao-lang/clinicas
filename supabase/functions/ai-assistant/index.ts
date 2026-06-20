// AI Assistente — responde perguntas sobre os dados da clínica logada.
// Segurança: escopo travado no clinic_id derivado do JWT (não do front),
// leitura via papel assistant_ro (RLS por clínica), sem segredos, query validada.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";
import { Client as PgClient } from "https://deno.land/x/postgres@v0.19.3/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ALLOWED_MODELS = new Set(["claude-sonnet-4-6", "claude-opus-4-8"]);
const MAX_AGENT_STEPS = 6;

// ─── Tabelas que o assistente pode consultar (espelha os grants do assistant_ro) ───
const ALLOWED_TABLES = [
  "leads", "tickets", "appointments", "patients", "medical_records",
  "financial_transactions", "marketing_data", "conversions", "doctors",
  "consultation_types", "chat_messages", "funnel_stages", "lead_stage_history",
  "lead_tracking_inbox", "link_sessions", "booking_requests", "exam_requests",
  "prescriptions", "protocols", "sla_breaches", "automation_logs",
  "clinic_users", "whatsapp_instances", "clinics",
];

// ─── Validação da query gerada pelo modelo (defesa em profundidade) ───
const DENY_WORDS = /\b(insert|update|delete|drop|alter|create|grant|revoke|truncate|copy|vacuum|call|merge|into|set|reset|lock|listen|notify|prepare|execute|declare|fetch|move|comment|security|analyze|cluster|reindex|refresh|do)\b/i;
const DENY_SUBSTR = /(set_config|app\.clinic_id|pg_read|pg_ls|pg_sleep|lo_import|lo_export|dblink|pg_terminate|pg_cancel)/i;

function validateSql(raw: string): string {
  let sql = (raw || "").trim().replace(/;+\s*$/, "").trim();
  if (!sql) throw new Error("Consulta vazia.");
  if (sql.includes(";")) throw new Error("Apenas um comando SELECT é permitido.");
  if (!/^(select|with)\b/i.test(sql)) throw new Error("Apenas SELECT/WITH são permitidos.");
  if (DENY_WORDS.test(sql)) throw new Error("Comando não permitido (apenas leitura).");
  if (DENY_SUBSTR.test(sql)) throw new Error("Expressão não permitida.");
  return sql;
}

function ensureLimit(sql: string, maxRows: number): string {
  return /\blimit\b/i.test(sql) ? sql : `${sql}\nLIMIT ${maxRows}`;
}

// Executa a query como assistant_ro, com o clinic_id fixado pela RLS.
async function runSql(sql: string, clinicId: string, maxRows: number): Promise<unknown[]> {
  const safe = ensureLimit(validateSql(sql), maxRows);
  const dbUrl = Deno.env.get("ASSISTANT_DB_URL");
  if (!dbUrl) throw new Error("ASSISTANT_DB_URL não configurada.");
  const client = new PgClient(dbUrl);
  await client.connect();
  try {
    // Fixa o escopo da clínica para a RLS (setado pelo servidor, nunca pelo modelo).
    await client.queryObject("SELECT set_config('app.clinic_id', $1, false)", [clinicId]);
    const result = await client.queryObject(safe);
    return result.rows as unknown[];
  } finally {
    await client.end();
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return jsonResponse({ error: "Não autenticado." }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    // 1) Identifica o usuário pelo JWT.
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return jsonResponse({ error: "Sessão inválida." }, 401);

    const admin = createClient(supabaseUrl, serviceKey);

    // 2) Resolve o clinic_id do usuário (nunca confia no clinicId cru do front).
    const body = await req.json().catch(() => ({}));
    const requestedClinicId: string | null = body?.clinicId ?? null;
    const messages = Array.isArray(body?.messages) ? body.messages : [];

    let clinicId: string | null = null;
    let userRole = "secretaria";

    const { data: clinicUser } = await admin
      .from("clinic_users").select("clinic_id, role").eq("id", user.id).maybeSingle();

    if (clinicUser) {
      clinicId = clinicUser.clinic_id;
      userRole = clinicUser.role;
    } else {
      // Org-admin: só pode escolher uma clínica da própria organização.
      const { data: orgUser } = await admin
        .from("org_users").select("organization_id, role").eq("user_id", user.id).maybeSingle();
      if (orgUser && requestedClinicId) {
        const { data: c } = await admin
          .from("clinics").select("id").eq("id", requestedClinicId)
          .eq("organization_id", orgUser.organization_id).maybeSingle();
        if (c) { clinicId = c.id; userRole = orgUser.role || "org_admin"; }
      }
    }
    if (!clinicId) return jsonResponse({ error: "Sem clínica associada para consultar." }, 403);

    // 3) Lê a config do Super Admin.
    const { data: cfgRow } = await admin
      .from("system_settings").select("value").eq("id", "ai_assistant_config").maybeSingle();
    let cfg: any = {};
    try { cfg = cfgRow?.value ? JSON.parse(cfgRow.value) : {}; } catch { cfg = {}; }

    if (cfg.enabled === false) return jsonResponse({ error: "Assistente desativado." }, 403);
    const allowedRoles: string[] = Array.isArray(cfg.allowed_roles) ? cfg.allowed_roles : [];
    if (allowedRoles.length && !allowedRoles.includes(userRole) &&
        !["org_owner", "org_admin", "super-admin"].includes(userRole)) {
      return jsonResponse({ error: "Sem permissão para usar o assistente." }, 403);
    }

    const model = ALLOWED_MODELS.has(cfg.model) ? cfg.model : "claude-sonnet-4-6";
    const maxRows = Number.isFinite(cfg.max_rows) ? Math.min(cfg.max_rows, 1000) : 200;

    // Nome da clínica para contexto.
    const { data: clinicRow } = await admin
      .from("clinics").select("name").eq("id", clinicId).maybeSingle();

    const today = new Date().toISOString().slice(0, 10);
    const systemPrompt = [
      cfg.system_prompt || "Você é o assistente de dados de uma clínica. Responda em português, de forma objetiva.",
      "",
      `Contexto: clínica "${clinicRow?.name ?? ""}". Data de hoje: ${today}.`,
      "Para responder com dados reais, use a ferramenta run_sql com UMA consulta SELECT de leitura.",
      "Os dados já estão filtrados automaticamente para esta clínica — NÃO adicione filtro por clinic_id.",
      `Tabelas disponíveis: ${ALLOWED_TABLES.join(", ")}.`,
      "Para descobrir colunas, consulte information_schema.columns (ex.: SELECT column_name FROM information_schema.columns WHERE table_name='leads').",
      "Dicas: tickets.outcome indica resultado (ex.: ganho/perdido); financial_transactions tem amount/type/status/date; marketing_data tem date/platform/investment; leads e chat_messages se ligam por lead_id.",
      "Apresente valores em R$ e datas como dia/mês. Se não houver dados, diga que não encontrou. Responda apenas com a resposta final ao usuário.",
    ].join("\n");

    const tools = [{
      name: "run_sql",
      description: "Executa uma consulta SQL SELECT (somente leitura) no banco da clínica e retorna as linhas em JSON.",
      input_schema: {
        type: "object",
        properties: { query: { type: "string", description: "Uma única consulta SELECT (sem ponto e vírgula)." } },
        required: ["query"],
      },
    }];

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return jsonResponse({ error: "ANTHROPIC_API_KEY não configurada." }, 500);

    // Histórico do chat (apenas texto user/assistant).
    const convo: any[] = messages
      .filter((m: any) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .map((m: any) => ({ role: m.role, content: m.content }));
    if (convo.length === 0) return jsonResponse({ error: "Nenhuma mensagem enviada." }, 400);

    // 4) Loop do agente (tool use).
    for (let step = 0; step < MAX_AGENT_STEPS; step++) {
      const resp = await fetch(ANTHROPIC_URL, {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({ model, max_tokens: 4096, system: systemPrompt, tools, messages: convo }),
      });

      if (!resp.ok) {
        const errText = await resp.text();
        console.error("Anthropic error", resp.status, errText);
        return jsonResponse({ error: "Falha ao consultar o modelo." }, 502);
      }

      const data = await resp.json();
      convo.push({ role: "assistant", content: data.content });

      if (data.stop_reason === "tool_use") {
        const toolResults: any[] = [];
        for (const block of data.content) {
          if (block.type !== "tool_use" || block.name !== "run_sql") continue;
          try {
            const rows = await runSql(String(block.input?.query ?? ""), clinicId, maxRows);
            toolResults.push({
              type: "tool_result",
              tool_use_id: block.id,
              content: JSON.stringify({ row_count: rows.length, rows }).slice(0, 100000),
            });
          } catch (e) {
            toolResults.push({
              type: "tool_result", tool_use_id: block.id, is_error: true,
              content: `Erro na consulta: ${(e as Error).message}`,
            });
          }
        }
        convo.push({ role: "user", content: toolResults });
        continue; // próxima iteração: o modelo lê os resultados
      }

      // stop_reason end_turn (ou outro): extrai o texto final.
      const text = (data.content || [])
        .filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n").trim();
      return jsonResponse({ reply: text || "Não consegui gerar uma resposta." });
    }

    return jsonResponse({ reply: "A consulta ficou complexa demais. Tente reformular a pergunta." });
  } catch (e) {
    console.error("ai-assistant fatal", e);
    return jsonResponse({ error: "Erro interno do assistente." }, 500);
  }
});
