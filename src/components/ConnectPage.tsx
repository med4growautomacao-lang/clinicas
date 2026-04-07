import React, { useEffect, useState } from 'react';
import { Loader2, CheckCircle2 } from 'lucide-react';

const EDGE_URL = 'https://yzpclhuifquhfqpiwysh.supabase.co/functions/v1/whatsapp-qr-public';

interface QRState {
  status: string;
  qr_code: string | null;
  phone_number: string | null;
}

export function ConnectPage() {
  const token = new URLSearchParams(window.location.search).get('token');
  const [state, setState] = useState<QRState>({ status: 'connecting', qr_code: null, phone_number: null });
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    if (!token) { setInvalid(true); return; }

    const poll = async () => {
      try {
        const res = await fetch(`${EDGE_URL}?token=${token}&json=1`);
        if (res.status === 404) { setInvalid(true); return; }
        const data = await res.json();
        setState(data);
      } catch {}
    };

    poll();
    const interval = setInterval(poll, 5000);
    return () => clearInterval(interval);
  }, [token]);

  if (invalid) {
    return (
      <div className="min-h-screen bg-red-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl shadow-lg p-10 max-w-sm w-full text-center">
          <p className="text-2xl font-bold text-red-500 mb-2">Link inválido</p>
          <p className="text-slate-500 text-sm">Este link de conexão é inválido ou já expirou. Solicite um novo link ao responsável.</p>
        </div>
      </div>
    );
  }

  if (state.status === 'connected') {
    return (
      <div className="min-h-screen bg-green-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl shadow-lg p-10 max-w-sm w-full text-center space-y-4">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-8 h-8 text-green-600" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">WhatsApp Conectado!</h1>
          <p className="text-slate-500 text-sm">Sua conta foi conectada com sucesso.</p>
          {state.phone_number && <p className="text-lg font-bold text-green-600">{state.phone_number}</p>}
        </div>
      </div>
    );
  }

  const qrSrc = state.qr_code
    ? (state.qr_code.startsWith('data:') ? state.qr_code : `data:image/png;base64,${state.qr_code}`)
    : null;

  return (
    <div className="min-h-screen bg-green-50 flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl shadow-lg p-10 max-w-sm w-full text-center space-y-6">
        {qrSrc ? (
          <>
            <h1 className="text-xl font-bold text-slate-900">Escaneie o QR Code</h1>
            <p className="text-slate-500 text-sm">Use o WhatsApp no seu celular para escanear o código abaixo.</p>
            <div className="border-2 border-green-100 rounded-2xl p-6 inline-block">
              <img src={qrSrc} alt="QR Code" className="w-52 h-52 mx-auto" />
            </div>
            <div className="bg-slate-50 rounded-xl p-4 text-left text-sm text-slate-600 space-y-1">
              <p><span className="font-bold">1.</span> Abra o WhatsApp no celular</p>
              <p><span className="font-bold">2.</span> Toque em <span className="font-bold">Dispositivos conectados</span></p>
              <p><span className="font-bold">3.</span> Toque em <span className="font-bold">Conectar um dispositivo</span></p>
              <p><span className="font-bold">4.</span> Aponte a câmera para o QR Code</p>
            </div>
          </>
        ) : (
          <>
            <Loader2 className="w-12 h-12 text-green-600 animate-spin mx-auto" />
            <h1 className="text-xl font-bold text-slate-900">Preparando conexão...</h1>
            <p className="text-slate-500 text-sm">Aguarde enquanto geramos o QR Code para você.</p>
          </>
        )}
        <p className="text-xs text-slate-300 flex items-center justify-center gap-1">
          <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse inline-block" />
          Atualizando automaticamente...
        </p>
      </div>
    </div>
  );
}
