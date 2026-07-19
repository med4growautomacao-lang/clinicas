// whatsapp-group
//
// Criação/gestão nativa do GRUPO DE NOTIFICAÇÕES da clínica (substitui o fluxo n8n
// "Webhook_Manager"). Cria o grupo na uazapi, grava clinics.notification_group_id e
// manda a boas-vindas (best-effort). O erro do n8n era a boas-vindas falhando no
// grupo recém-criado e derrubando o fluxo TODO — aqui ela não bloqueia.
//
// Auth: verify_jwt=true (chamado pelo app autenticado) + checagem de membro da clínica.
// Registra falhas na Central (log_system_error).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const UAZAPI_BASE = "https://med4growautomacao.uazapi.com";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function normPhone(p: unknown): string {
  let n = String(p ?? "").replace(/\D/g, "");
  if (n && !n.startsWith("55")) n = "55" + n;
  return n;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

  const svc = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
  const registrarErro = async (code: string, title: string, ctx: unknown, clinicId: string | null = null) => {
    try {
      await svc.rpc("log_system_error", {
        p_scope: "whatsapp-group", p_code: code, p_title: title, p_level: "error",
        p_clinic_id: clinicId, p_context: ctx, p_is_monitor: false,
      });
    } catch (_e) { /* nunca derrubar a resposta por causa do log */ }
  };

  let body: any;
  try { body = await req.json(); } catch { return json({ success: false, error: "no_json" }, 400); }
  const action = String(body?.action ?? "create_group");
  const clinicId = body?.clinic_id;
  const groupName = String(body?.group_name ?? "").trim() || "Notificações";
  const groupId = body?.group_id;
  const participants = Array.isArray(body?.participants) ? body.participants : [];
  if (!clinicId) return json({ success: false, error: "clinic_id required" }, 400);

  // Authz: usuário logado + membro (clinic_users) ou org da clínica.
  const authHeader = req.headers.get("Authorization") ?? "";
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: ures } = await userClient.auth.getUser();
  const uid = ures?.user?.id;
  if (!uid) return json({ success: false, error: "unauthorized" }, 401);

  let allowed = false;
  const { data: cu } = await svc.from("clinic_users").select("id").eq("id", uid).eq("clinic_id", clinicId).maybeSingle();
  allowed = !!cu;
  if (!allowed) {
    const { data: ou } = await svc.from("org_users").select("organization_id").eq("user_id", uid);
    const orgIds = (ou ?? []).map((o: any) => o.organization_id).filter(Boolean);
    if (orgIds.length) {
      const { data: c } = await svc.from("clinics").select("id").eq("id", clinicId).in("organization_id", orgIds).maybeSingle();
      allowed = !!c;
    }
  }
  if (!allowed) return json({ success: false, error: "forbidden" }, 403);

  // Token da instância uazapi da clínica.
  const { data: inst } = await svc.from("whatsapp_instances").select("api_token").eq("clinic_id", clinicId).maybeSingle();
  const token = (inst as any)?.api_token;
  if (!token) return json({ success: false, error: "whatsapp_nao_conectado" }, 409);

  const phones: string[] = participants
    .map((p: any) => normPhone(typeof p === "string" ? p : p?.phone))
    .filter((s: string) => s.length >= 12);

  try {
    if (action === "create_group") {
      const cr = await fetch(`${UAZAPI_BASE}/group/create`, {
        method: "POST",
        headers: { "Accept": "application/json", "Content-Type": "application/json", token },
        body: JSON.stringify({ name: groupName, participants: phones }),
      });
      const crText = await cr.text();
      let crJson: any = {}; try { crJson = JSON.parse(crText); } catch { /* resposta não-JSON */ }
      const jid = crJson?.group?.JID ?? crJson?.JID ?? crJson?.group?.id ?? crJson?.id ?? null;
      if (!cr.ok || !jid) {
        await registrarErro("group_create_failed", "Falha ao criar grupo de notificações",
          { status: cr.status, resp: crText.slice(0, 300) }, clinicId);
        return json({ success: false, error: "group_create_failed", detail: crText.slice(0, 300) }, 502);
      }
      await svc.from("clinics").update({ notification_group_id: jid }).eq("id", clinicId);

      // Boas-vindas: BEST-EFFORT. Grupo já está criado e salvo — falha aqui não invalida.
      try {
        await fetch(`${UAZAPI_BASE}/send/text`, {
          method: "POST",
          headers: { "Accept": "application/json", "Content-Type": "application/json", token },
          body: JSON.stringify({
            number: jid,
            text: "👋 Grupo criado com sucesso!\n\nA partir de agora, o Agente IA enviará aqui as notificações importantes (transbordo, agendamentos, comprovantes).\nFique atento às mensagens 🚀",
          }),
        });
      } catch (_e) { /* boas-vindas é opcional */ }

      return json({ success: true, group_id: jid });
    }

    if (action === "add_participants") {
      if (!groupId) return json({ success: false, error: "group_id required" }, 400);
      if (phones.length === 0) return json({ success: false, error: "no_participants" }, 400);
      const ap = await fetch(`${UAZAPI_BASE}/group/updateParticipants`, {
        method: "POST",
        headers: { "Accept": "application/json", "Content-Type": "application/json", token },
        body: JSON.stringify({ groupjid: groupId, action: "add", participants: phones }),
      });
      const apText = await ap.text();
      if (!ap.ok) {
        await registrarErro("group_add_failed", "Falha ao adicionar participantes ao grupo",
          { status: ap.status, resp: apText.slice(0, 300) }, clinicId);
        return json({ success: false, error: "group_add_failed", detail: apText.slice(0, 300) }, 502);
      }
      return json({ success: true });
    }

    return json({ success: false, error: `unknown_action: ${action}` }, 400);
  } catch (e: any) {
    await registrarErro("group_error", "Erro ao processar ação de grupo", { detail: String(e), action }, clinicId);
    return json({ success: false, error: e?.message ?? "group_error" }, 500);
  }
});
