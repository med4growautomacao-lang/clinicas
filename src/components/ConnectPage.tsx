import React, { useEffect, useState } from 'react';
import { Loader2, CheckCircle2, QrCode, Smartphone, Info, RefreshCw, XCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const EDGE_URL = 'https://yzpclhuifquhfqpiwysh.supabase.co/functions/v1/whatsapp-qr-public';

interface QRState {
  status: string;
  qr_code: string | null;
  phone_number: string | null;
  clinic_name: string | null;
}

export function ConnectPage() {
  const token = new URLSearchParams(window.location.search).get('token');
  const [state, setState] = useState<QRState>({ status: 'connecting', qr_code: null, phone_number: null, clinic_name: null });
  const [invalid, setInvalid] = useState(false);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [requesting, setRequesting] = useState(false);
  const intervalRef = React.useRef<any>(null);
  const connectedRef = React.useRef(false);

  const clearQr = React.useCallback(() => {
    if (!token || connectedRef.current) return;
    const BRIDGE_URL = EDGE_URL.replace('whatsapp-qr-public', 'whatsapp-bridge');
    // sendBeacon garante envio mesmo quando a aba fecha
    navigator.sendBeacon(BRIDGE_URL, JSON.stringify({ action: 'cancel', token }));
  }, [token]);

  // Limpa QR ao fechar/recarregar a aba
  useEffect(() => {
    const onUnload = () => clearQr();
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [clearQr]);

  const handleStartConnection = async () => {
    if (!token || requesting) return;
    setRequesting(true);
    try {
      const response = await fetch(`${EDGE_URL.replace('whatsapp-qr-public', 'whatsapp-bridge')}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', token })
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        console.error('Bridge Error Details:', errorData);
      }
    } catch (err) {
      console.error('Error starting connection:', err);
    } finally {
      setTimeout(() => setRequesting(false), 2000);
    }
  };

  useEffect(() => {
    if (!token) { 
        setInvalid(true); 
        setLoadingInitial(false);
        return; 
    }

    const stopPolling = () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };

    const poll = async () => {
      try {
        const res = await fetch(`${EDGE_URL}?token=${token}&json=1`);
        if (res.status === 404) {
          setInvalid(true);
          setLoadingInitial(false);
          stopPolling();
          return;
        }
        const data = await res.json();
        setState(data);
        setLoadingInitial(false);
        if (data.status === 'connected') { connectedRef.current = true; stopPolling(); }
      } catch (err) {
        console.error('Polling error:', err);
      }
    };

    poll();
    intervalRef.current = setInterval(poll, 5000);
    return () => stopPolling();
  }, [token]);

  useEffect(() => {
    let pulseInterval: any;
    if (token && (state.status === 'connecting' || state.status === 'qr_pending')) {
      const sendSignal = async () => {
        try {
          await fetch(`${EDGE_URL.replace('whatsapp-qr-public', 'whatsapp-bridge')}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'connect', token })
          });
        } catch (err) {
          console.error('Pulse error:', err);
        }
      };
      
      pulseInterval = setInterval(sendSignal, 15000);
    }
    return () => {
      if (pulseInterval) clearInterval(pulseInterval);
    };
  }, [state.status, token]);

  if (loadingInitial) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center space-y-4">
             <Loader2 className="w-12 h-12 text-teal-600 animate-spin mx-auto" />
             <p className="text-slate-400 font-bold uppercase tracking-widest text-[10px]">Verificando Convite...</p>
        </div>
      </div>
    );
  }

  if (invalid) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-6 font-sans">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-3xl shadow-2xl shadow-slate-200 p-12 max-w-md w-full text-center space-y-6 border border-slate-100"
        >
          <div className="w-20 h-20 bg-rose-50 rounded-full flex items-center justify-center mx-auto">
            <XCircle className="w-10 h-10 text-rose-500" />
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-bold text-slate-900">Link Inválido</h1>
            <p className="text-slate-500 text-sm leading-relaxed">
              Este link de conexão não é mais válido ou expirou por segurança. 
              Por favor, solicite ao administrador da clínica que gere um novo link.
            </p>
          </div>
          <button 
            onClick={() => window.location.reload()}
            className="w-full py-4 bg-slate-900 hover:bg-slate-800 text-white rounded-2xl font-bold transition-all"
          >
            Tentar Novamente
          </button>
        </motion.div>
      </div>
    );
  }

  if (state.status === 'connected') {
    return (
      <div className="min-h-screen bg-[#F0FDFA] flex items-center justify-center p-6 font-sans">
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-white rounded-[2.5rem] shadow-2xl shadow-teal-900/10 p-12 max-w-md w-full text-center space-y-8 border border-white relative overflow-hidden"
        >
          <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-teal-400 to-emerald-500" />
          
          <div className="space-y-6">
            <div className="relative inline-block">
                <div className="absolute -inset-4 bg-teal-100 rounded-full blur-xl opacity-50 animate-pulse" />
                <div className="relative w-24 h-24 bg-teal-600 rounded-full flex items-center justify-center mx-auto shadow-xl">
                    <CheckCircle2 className="w-12 h-12 text-white" />
                </div>
            </div>
            
            <div className="space-y-2">
                <h1 className="text-3xl font-black text-slate-900 tracking-tight">Sucesso!</h1>
                <p className="text-slate-500 font-medium italic">Seu WhatsApp foi integrado ao sistema.</p>
            </div>

            {state.phone_number && (
                <div className="bg-slate-50 rounded-2xl p-6 border border-slate-100">
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Número Conectado</p>
                    <p className="text-2xl font-black text-teal-600 tracking-tight">{state.phone_number}</p>
                </div>
            )}
          </div>

          <div className="pt-4">
             <p className="text-sm text-slate-400">Você já pode fechar esta aba.</p>
          </div>
        </motion.div>
      </div>
    );
  }

  const qrSrc = state.qr_code
    ? (state.qr_code.startsWith('data:') ? state.qr_code : `data:image/png;base64,${state.qr_code}`)
    : null;

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-6 font-sans selection:bg-teal-100">
      {/* Background Decorative Elements */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-teal-500/5 rounded-full blur-[120px]" />
          <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-emerald-500/5 rounded-full blur-[120px]" />
      </div>

      <motion.div 
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white rounded-[2.5rem] shadow-2xl shadow-slate-200 p-8 md:p-12 max-w-lg w-full relative border border-white"
      >
        <div className="flex items-center justify-between mb-10">
            <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-teal-600 rounded-xl flex items-center justify-center shadow-lg shadow-teal-200">
                    <QrCode className="w-5 h-5 text-white" />
                </div>
                <div className="text-left overflow-hidden">
                    <h2 className="text-lg font-black text-slate-900 leading-tight truncate max-w-[180px]">
                        {state.clinic_name || 'Integração'}
                    </h2>
                    <p className="text-[10px] font-bold text-teal-600 uppercase tracking-widest mt-0.5">WhatsApp Remote</p>
                </div>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 rounded-full border border-slate-100">
                <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Link Ativo</span>
            </div>
        </div>

        <div className="text-center space-y-8">
          <AnimatePresence mode="wait">
            {(state.status === 'qr_pending' || state.status === 'connecting' || state.qr_code) ? (
              <motion.div 
                key="qr-section"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-8"
              >
                <div className="space-y-3">
                  <h1 className="text-3xl font-black text-slate-900 tracking-tight leading-tight">
                      Escaneie o <span className="text-teal-600">QR Code</span>
                  </h1>
                  <p className="text-slate-500 font-medium text-sm max-w-[280px] mx-auto leading-relaxed">
                      Abra seu WhatsApp e escaneie o código abaixo para vincular sua conta.
                  </p>
                </div>

                <div className="relative group mx-auto w-fit">
                  <div className="absolute -inset-6 bg-gradient-to-tr from-teal-500/10 to-emerald-500/10 rounded-[3rem] blur-2xl transition-all opacity-0 group-hover:opacity-100" />
                  
                  {qrSrc ? (
                    <motion.div 
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="relative p-8 bg-white rounded-[2rem] border border-slate-100 shadow-xl shadow-slate-200/50"
                    >
                        <img 
                            src={qrSrc} 
                            alt="WhatsApp QR Code" 
                            className="w-56 h-56 md:w-64 md:h-64 object-contain relative z-10"
                        />
                    </motion.div>
                  ) : (
                    <div className="w-56 h-56 md:w-64 md:h-64 flex flex-col items-center justify-center p-8 bg-slate-50 rounded-[2rem] border border-dashed border-slate-200">
                        <Loader2 className="w-10 h-10 text-teal-600 animate-spin mb-4" />
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Gerando Código...</p>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-3 text-left">
                  {[
                      { step: "01", text: "Abra o WhatsApp no seu celular" },
                      { step: "02", text: "Vá em Menu ou Configurações" },
                      { step: "03", text: "Selecione Dispositivos Conectados" },
                      { step: "04", text: "Aponte sua câmera para esta tela" },
                  ].map((i) => (
                      <div key={i.step} className="flex items-center gap-4 p-4 rounded-2xl bg-slate-50/50 border border-slate-100 group hover:bg-white hover:shadow-md transition-all">
                          <span className="text-xs font-black text-teal-600/40 group-hover:text-teal-600">{i.step}</span>
                          <p className="text-sm font-bold text-slate-700">{i.text}</p>
                      </div>
                  ))}
                </div>

                <button
                  onClick={() => { clearQr(); setState(s => ({ ...s, status: 'disconnected', qr_code: null })); }}
                  className="text-xs text-slate-400 hover:text-red-500 font-bold transition-colors underline underline-offset-2"
                >
                  Cancelar conexão
                </button>
              </motion.div>
            ) : (
              <motion.div
                key="start-section"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-8 py-4"
              >
                <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-2">
                    <Smartphone className="w-10 h-10 text-slate-300" />
                </div>
                
                <div className="space-y-3">
                    <h1 className="text-3xl font-black text-slate-900 tracking-tight">Pronto para Conectar?</h1>
                    <p className="text-slate-500 font-medium text-sm max-w-[280px] mx-auto leading-relaxed">
                        Clique no botão abaixo para gerar um código de conexão seguro para sua conta.
                    </p>
                </div>

                <button
                    onClick={handleStartConnection}
                    disabled={requesting}
                    className={`
                        w-full py-5 px-8 rounded-2xl font-black text-lg transition-all duration-300
                        flex items-center justify-center gap-3 shadow-2xl
                        ${requesting 
                            ? 'bg-slate-100 text-slate-400 cursor-not-allowed' 
                            : 'bg-teal-600 hover:bg-teal-700 text-white active:scale-[0.98] shadow-teal-200'}
                    `}
                >
                    {requesting ? (
                        <>
                            <Loader2 className="w-6 h-6 animate-spin" />
                            Preparando...
                        </>
                    ) : (
                        <>
                            <QrCode className="w-6 h-6" />
                            Gerar Link de Conexão
                        </>
                    )}
                </button>

                <div className="bg-amber-50 rounded-2xl p-4 flex gap-3 text-left">
                    <Info className="w-5 h-5 text-amber-600 shrink-0" />
                    <p className="text-xs font-bold text-amber-700 leading-relaxed">
                        Certique-se de que o celular está por perto e com internet ativa.
                    </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="mt-10 pt-8 border-t border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
                <RefreshCw className="w-3.5 h-3.5 text-slate-300 animate-spin" />
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Atualiza a cada 5s</span>
            </div>
            <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest flex items-center gap-1">
                Security by <span className="text-teal-500/50">Supabase</span>
            </p>
        </div>
      </motion.div>
    </div>
  );
}
