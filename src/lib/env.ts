// Endereço do Supabase em UM lugar só.
//
// Antes, a URL do projeto estava escrita à mão em 4 arquivos (lib/supabase.ts, ConnectPage,
// RedirectPage e Settings): apontar o app para outro ambiente exigia editar todos, e esquecer
// um deixava a página pública /connect — que nem pede login — falando com a PRODUÇÃO.
//
// Os valores de produção continuam sendo o padrão, então sem .env nada muda de comportamento.
// Para rodar contra outro ambiente, crie um `.env.local` (o .gitignore cobre `.env*`, exceto
// o `.env.example`) com:
//   VITE_SUPABASE_URL=https://<ref>.supabase.co
//   VITE_SUPABASE_ANON_KEY=<anon key daquele projeto>

const PROD_URL = 'https://yzpclhuifquhfqpiwysh.supabase.co';
const PROD_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl6cGNsaHVpZnF1aGZxcGl3eXNoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMyNTUxNDcsImV4cCI6MjA4ODgzMTE0N30.DXuX6KDpEPMoCAVpH2gs6reGTC97RZiNA_IUPT0Inos';

// A barra final é removida: `.../supabase.co/` + `/functions/v1` viraria `//functions/v1`, que
// alguns proxies tratam como caminho diferente.
const rawUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();

export const SUPABASE_URL = rawUrl ? rawUrl.replace(/\/+$/, '') : PROD_URL;
export const SUPABASE_ANON_KEY =
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() || PROD_ANON_KEY;

/** Base das edge functions. Use sempre isto, nunca monte a URL na mão. */
export const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;

/** true quando o app está falando com o banco dos clientes reais. */
export const IS_PRODUCTION_BACKEND = SUPABASE_URL === PROD_URL;

// Em desenvolvimento, avisa que está batendo na produção. Rodar o front local contra o banco
// real é justamente o acidente que separar os ambientes existe para evitar.
if (import.meta.env.DEV && IS_PRODUCTION_BACKEND) {
  console.warn(
    '[env] Este front está conectado à PRODUÇÃO (yzpclhuifquhfqpiwysh). ' +
    'Para usar o ambiente de teste, defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no .env.local.'
  );
}
