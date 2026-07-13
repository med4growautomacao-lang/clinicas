import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

const EDGE_URL = 'https://yzpclhuifquhfqpiwysh.supabase.co/functions/v1/whatsapp-redirect';
const RAST_COOKIE_TTL = 63072000; // 2 anos, igual ao script do site

// O cookie vive neste domínio; a edge roda em outro (supabase.co) e não o enxerga. Então é esta
// página que lê a identidade do visitante e a repassa — e persiste a que a edge devolver.
function readCookie(name: string): string | null {
  const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : null;
}

export function RedirectPage() {
  const params = new URLSearchParams(window.location.search);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const c = params.get('c'); // legado: token da instância + UTMs na própria URL
    const l = params.get('l'); // gerenciador: código do link (UTMs vêm salvas no banco)
    if (!c && !l) { setError('Link inválido.'); return; }

    // Chama edge function em modo JSON
    const url = new URL(EDGE_URL);
    if (l) url.searchParams.set('l', l);
    if (c) url.searchParams.set('c', c);
    url.searchParams.set('format', 'json');
    params.forEach((v, k) => {
      if (k === 'c' || k === 'l' || k === 'format') return;
      if (v) url.searchParams.set(k, v); // ignora utm vazia: string vazia vira 'direto' na edge
    });

    // Se este visitante já tem identidade (clique anterior, ou o script do site), reaproveita —
    // é o que faz os vários cliques do mesmo navegador caírem na mesma jornada.
    const existing = readCookie('rast_id');
    if (existing) url.searchParams.set('rast_id', existing);

    fetch(url.toString())
      .then(r => r.json())
      .then(({ rast_id, wa_url, error: err }) => {
        if (err || !wa_url) { setError(err || 'Clínica não encontrada.'); return; }
        // Persiste a IDENTIDADE (UUID). Antes gravávamos aqui o protocolo, que muda a cada clique
        // e por isso não identificava ninguém.
        if (rast_id) {
          const expires = new Date(Date.now() + RAST_COOKIE_TTL * 1000).toUTCString();
          document.cookie = `rast_id=${rast_id}; expires=${expires}; path=/; SameSite=Lax`;
        }
        window.location.href = wa_url;
      })
      .catch(() => setError('Erro ao processar o link.'));
  }, []);

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center space-y-2">
          <p className="text-slate-600 font-semibold">{error}</p>
          <p className="text-slate-400 text-sm">Solicite um novo link à clínica.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="text-center space-y-4">
        <Loader2 className="w-10 h-10 text-teal-600 animate-spin mx-auto" />
        <p className="text-slate-500 font-bold uppercase tracking-widest text-[10px]">Redirecionando...</p>
      </div>
    </div>
  );
}
