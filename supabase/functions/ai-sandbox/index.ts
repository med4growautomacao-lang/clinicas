// ai-sandbox — ambiente de teste interno do Agente IA (Super Admin).
//
// Injeta uma mensagem "do paciente" no MESMO pipeline nativo (sandbox_send -> chat_messages inbound
// + enqueue_ai_turn) e cutuca o ai-agent-worker. O agente processa DE VERDADE (mesmo prompt, tools,
// memoria) e a resposta sai pela fila do Emissor roteada p/ transport='sandbox' (nunca toca a uazapi,
// porque o lead e is_simulation). A resposta aparece na conversa via saveAiResponse -> o front le por
// Realtime. `reset` limpa a sessao (cancela agendamentos, apaga a conversa e, opcional, o lead).
//
// Auth: verify_jwt=true + checagem is_super_admin (so o dono/super admin testa). As RPCs sao
// SECURITY DEFINER e estao revogadas de anon/authenticated: esta edge e o unico caminho.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";

  // (1) Super admin? Valida com o JWT do usuario.
  const authHeader = req.headers.get("Authorization") ?? "";
  const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: ures } = await userClient.auth.getUser();
  const uid = ures?.user?.id;
  if (!uid) return json({ ok: false, error: "unauthorized" }, 401);

  let body: any;
  try { body = await req.json(); } catch { body = {}; }
  const clinic_id = body?.clinic_id;
  const action = String(body?.action ?? "send");
  if (!clinic_id) return json({ ok: false, error: "missing_clinic_id" }, 400);

  const svc = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");

  // Acesso: super admin OU membro da clinica (clinic_user) OU da org dela. Mesmo padrao do chat-send,
  // pra o proprio gestor testar o agente da sua clinica na aba "Testar o Agente" (Configuracoes IA).
  const { data: isSuper } = await userClient.rpc("is_super_admin");
  let allowed = isSuper === true;
  if (!allowed) {
    const { data: cu } = await svc.from("clinic_users").select("id").eq("id", uid).eq("clinic_id", clinic_id).maybeSingle();
    allowed = !!cu;
    if (!allowed) {
      const { data: clinic } = await svc.from("clinics").select("organization_id").eq("id", clinic_id).maybeSingle();
      if (clinic?.organization_id) {
        const { data: ou } = await svc.from("org_users").select("user_id").eq("user_id", uid).eq("organization_id", clinic.organization_id).maybeSingle();
        allowed = !!ou;
      }
    }
  }
  if (!allowed) return json({ ok: false, error: "forbidden" }, 403);

  // (2) RESET: limpa a sessao de simulacao.
  if (action === "reset") {
    const { data, error } = await svc.rpc("sandbox_reset", {
      p_clinic_id: clinic_id, p_user_id: uid, p_delete_lead: body?.delete_lead === true,
    });
    if (error) return json({ ok: false, error: error.message }, 500);
    return json({ ok: true, ...(data as object) });
  }

  // (3) SEND: mensagem do "paciente" -> dispara o turno do agente.
  const text = String(body?.mensagem ?? "").trim();
  if (!text) return json({ ok: false, error: "missing_mensagem" }, 400);

  const { data, error } = await svc.rpc("sandbox_send", {
    p_clinic_id: clinic_id, p_user_id: uid,
    p_user_name: ures?.user?.email ?? null, p_text: text, p_midia_type: body?.midia_type ?? "",
  });
  if (error) return json({ ok: false, error: error.message }, 500);

  // (4) Kick do ai-agent-worker (wait curto: no sandbox nao esperamos o debounce longo). Best-effort;
  //     o cron do worker e o backstop.
  const session_id = (data as any)?.session_id;
  try {
    const url = `${SUPABASE_URL}/functions/v1/ai-agent-worker`;
    const kick = fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "kick", session_id, wait_seconds: 1 }),
    }).catch(() => {});
    (globalThis as any).EdgeRuntime?.waitUntil?.(kick);
  } catch { /* backstop cobre */ }

  return json({ ok: true, ...(data as object) });
});
