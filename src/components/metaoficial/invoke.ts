import { supabase } from "../../lib/supabase";

// O access token do Supabase vence (~1h). Com a aba aberta muito tempo, functions.invoke
// manda o token stale/anon e a edge (verify_jwt) devolve 401 (Unauthorized). Mesmo padrão do
// send-quote (LeadKanban): pega um token FRESCO e passa explícito no Authorization.
async function ensureFreshToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  const s = data.session;
  const expMs = (s?.expires_at ?? 0) * 1000;
  if (s?.access_token && expMs > Date.now() + 60_000) return s.access_token;
  const { data: r } = await supabase.auth.refreshSession();
  return r.session?.access_token ?? s?.access_token ?? null;
}

// Invoca a edge meta-cloud-api sempre com Authorization fresco.
export async function invokeMetaCloud(body: Record<string, unknown>) {
  const token = await ensureFreshToken();
  return supabase.functions.invoke("meta-cloud-api", {
    body,
    ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
  });
}
