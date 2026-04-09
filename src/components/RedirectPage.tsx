import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

const EDGE_URL = 'https://yzpclhuifquhfqpiwysh.supabase.co/functions/v1/whatsapp-redirect';

export function RedirectPage() {
  const params = new URLSearchParams(window.location.search);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const c = params.get('c');
    if (!c) { setError('Link inválido.'); return; }

    // Chama edge function em modo JSON
    const url = new URL(EDGE_URL);
    url.searchParams.set('c', c);
    url.searchParams.set('format', 'json');
    params.forEach((v, k) => { if (k !== 'c' && k !== 'format') url.searchParams.set(k, v); });

    fetch(url.toString())
      .then(r => r.json())
      .then(({ rast_id, wa_url, error: err }) => {
        if (err || !wa_url) { setError(err || 'Clínica não encontrada.'); return; }
        // Seta cookie rast_id por 2 anos (mesmo TTL do rastracking_nod)
        const expires = new Date(Date.now() + 63072000 * 1000).toUTCString();
        document.cookie = `rast_id=${rast_id}; expires=${expires}; path=/; SameSite=Lax`;
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
