// Re-hospeda avatares efêmeros do WhatsApp (pps.whatsapp.net expira em horas) no nosso storage,
// para os cards não ficarem sem foto. Escopo GLOBAL de propósito: processa TODO lead recente com
// foto pps (não só onboarding) — o wa-inbound ao vivo também grava avatar pps, então isto persiste
// a foto em Kanban/Conversas de todas as clínicas. URL morta/inválida -> zera o avatar (cai no
// fallback de iniciais, melhor que imagem quebrada). Chamado por cron (system_http_post).
import { createClient } from "jsr:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const BUCKET = "lead-avatars";
const BATCH = 40;
const CONCURRENCY = 8; // baixa o wall-time (40 sequenciais x 8s podia estourar o limite da função)
const FRESH_HOURS = 6; // só imports recentes; os ~10k pps antigos já estão mortos

async function registrarErro(code: string, title: string, clinicId: string | null, context: unknown) {
  try {
    await supabase.rpc("log_system_error", {
      p_scope: "onboarding-rehost-avatars",
      p_code: code,
      p_title: title,
      p_level: "error",
      p_clinic_id: clinicId,
      p_context: context,
      p_is_monitor: false,
    });
  } catch (_) {
    // Central indisponível não pode derrubar o worker.
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// Anti-SSRF: só baixa de host *.whatsapp.net por https (o LIKE só filtra substring).
function isWhatsappUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && (u.hostname === "whatsapp.net" || u.hostname.endsWith(".whatsapp.net"));
  } catch {
    return false;
  }
}

async function setAvatar(leadId: string, url: string | null, clinicId: string | null) {
  const { error } = await supabase.from("leads").update({ avatar_url: url }).eq("id", leadId);
  if (error) {
    await registrarErro("update_failed", "Falha ao atualizar avatar_url do lead", clinicId, { lead: leadId, detail: error.message });
  }
}

type Lead = { id: string; clinic_id: string; avatar_url: string };
type Outcome = "rehosted" | "nulled" | "skipped";

async function processLead(lead: Lead): Promise<Outcome> {
  if (!isWhatsappUrl(lead.avatar_url)) {
    await setAvatar(lead.id, null, lead.clinic_id);
    return "nulled";
  }
  try {
    const res = await fetch(lead.avatar_url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
      await setAvatar(lead.id, null, lead.clinic_id);
      return "nulled";
    }
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.startsWith("image/")) {
      // 200 não-imagem (página de erro/redirect) -> não guarda lixo como avatar.
      await setAvatar(lead.id, null, lead.clinic_id);
      return "nulled";
    }
    const blob = new Blob([await res.arrayBuffer()], { type: contentType });
    if (blob.size === 0) {
      await setAvatar(lead.id, null, lead.clinic_id);
      return "nulled";
    }
    const path = `${lead.clinic_id}/${lead.id}.jpg`;
    const up = await supabase.storage.from(BUCKET).upload(path, blob, { contentType, upsert: true });
    if (up.error) {
      await registrarErro("upload_failed", "Falha ao subir avatar no storage", lead.clinic_id, { lead: lead.id, detail: up.error.message });
      return "skipped";
    }
    const pub = supabase.storage.from(BUCKET).getPublicUrl(path);
    await setAvatar(lead.id, pub.data.publicUrl, lead.clinic_id);
    return "rehosted";
  } catch (_) {
    // fetch falhou (URL morta / timeout) -> zera para cair no fallback de iniciais.
    await setAvatar(lead.id, null, lead.clinic_id);
    return "nulled";
  }
}

Deno.serve(async () => {
  try {
    const since = new Date(Date.now() - FRESH_HOURS * 3600 * 1000).toISOString();
    const { data: leads, error } = await supabase
      .from("leads")
      .select("id, clinic_id, avatar_url")
      .like("avatar_url", "%pps.whatsapp.net%")
      .gt("updated_at", since)
      .order("updated_at", { ascending: false })
      .limit(BATCH);

    if (error) {
      await registrarErro("query_failed", "Falha ao listar avatares para re-host", null, { detail: error.message });
      return json({ ok: false, error: error.message }, 500);
    }

    const items = (leads ?? []) as Lead[];
    let rehosted = 0, nulled = 0, skipped = 0;
    for (let i = 0; i < items.length; i += CONCURRENCY) {
      const results = await Promise.all(items.slice(i, i + CONCURRENCY).map(processLead));
      for (const r of results) {
        if (r === "rehosted") rehosted++;
        else if (r === "nulled") nulled++;
        else skipped++;
      }
    }
    return json({ ok: true, scanned: items.length, rehosted, nulled, skipped });
  } catch (e) {
    await registrarErro("unexpected", "Erro inesperado no re-host de avatares", null, { detail: String(e) });
    return json({ ok: false }, 500);
  }
});
