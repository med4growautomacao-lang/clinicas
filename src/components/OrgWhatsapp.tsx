import React, { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { Loader2, MessageCircle, QrCode, RefreshCw, Unplug } from "lucide-react";
import WhatsappLogo from "../assets/logos/Logo Whatsapp.png";

// Conexão do WhatsApp da ORGANIZAÇÃO (número da agência) — remetente dos
// relatórios automáticos enviados aos clientes. Mesmo orchestrator das clínicas
// (state machine start/cancel/disconnect/status), mas keyed por org_id: a
// instância é SEND-ONLY (sem IA, sem chat — só webhook de status de conexão).
//
// Mecânica: polling do action 'status' (3s durante conexão, 30s em repouso).
// O QR chega via uazapi-events → whatsapp_instances → poll.

type WaStatus = "disconnected" | "connecting" | "connected" | "unknown";

interface OrgWaState {
  status: WaStatus;
  qr_code: string | null;
  phone_number: string | null;
}

const ATTEMPT_TIMEOUT_MS = 120_000; // igual ao Settings da clínica: reseta o spinner após 2min

export function OrgWhatsapp({ organizationId }: { organizationId: string }) {
  const [wa, setWa] = useState<OrgWaState>({ status: "unknown", qr_code: null, phone_number: null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attemptStartRef = useRef<number | null>(null);

  const invoke = useCallback(async (action: string) => {
    const { data, error: err } = await supabase.functions.invoke("whatsapp-orchestrator", {
      body: { action, org_id: organizationId },
    });
    if (err) throw err;
    return data;
  }, [organizationId]);

  const refresh = useCallback(async () => {
    try {
      const data = await invoke("status");
      if (data?.success) {
        setWa({ status: data.status ?? "disconnected", qr_code: data.qr_code ?? null, phone_number: data.phone_number ?? null });
        setError(null);
      } else if (data?.error === "instance_not_found") {
        // Org ainda não conectou nenhuma vez — estado inicial legítimo.
        setWa({ status: "disconnected", qr_code: null, phone_number: null });
        setError(null);
      }
    } catch {
      // 404 do orchestrator (sem instância) também cai aqui dependendo do client.
      setWa((prev) => (prev.status === "unknown" ? { status: "disconnected", qr_code: null, phone_number: null } : prev));
    }
  }, [invoke]);

  // Poll: 3s conectando (QR/confirm), 30s em repouso (pega desconexões externas).
  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, wa.status === "connecting" ? 3000 : 30000);
    return () => clearInterval(interval);
  }, [refresh, wa.status]);

  // Timeout da tentativa: cancela sozinho depois de 2min aguardando pareamento.
  useEffect(() => {
    let timeoutId: any;
    if (wa.status === "connecting") {
      if (!attemptStartRef.current) attemptStartRef.current = Date.now();
      const remaining = Math.max(0, ATTEMPT_TIMEOUT_MS - (Date.now() - attemptStartRef.current));
      timeoutId = setTimeout(async () => {
        attemptStartRef.current = null;
        try { await invoke("cancel"); } catch { /* melhor esforço */ }
        refresh();
      }, remaining);
    } else {
      attemptStartRef.current = null;
    }
    return () => { if (timeoutId) clearTimeout(timeoutId); };
  }, [wa.status, invoke, refresh]);

  const handleConnect = async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await invoke("start");
      if (data && data.success === false) throw new Error(data.error || "Falha ao iniciar conexão");
      await refresh();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = async () => {
    setBusy(true);
    try { await invoke("cancel"); await refresh(); } finally { setBusy(false); }
  };

  const handleDisconnect = async () => {
    if (!window.confirm("Desconectar o WhatsApp da organização? Os relatórios automáticos deixarão de ser enviados até reconectar.")) return;
    setBusy(true);
    try { await invoke("disconnect"); await refresh(); } finally { setBusy(false); }
  };

  const statusDot =
    wa.status === "connected" ? "bg-emerald-500" :
    wa.status === "connecting" ? "bg-amber-500 animate-pulse" :
    "bg-slate-300";
  const statusLabel =
    wa.status === "connected" ? "Conectado" :
    wa.status === "connecting" ? (wa.qr_code ? "Aguardando leitura do QR" : "Conectando...") :
    wa.status === "unknown" ? "Verificando..." : "Desconectado";

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-emerald-50 rounded-lg flex items-center justify-center p-1.5">
            <img src={WhatsappLogo} alt="WhatsApp" className="w-full h-full object-contain" />
          </div>
          <div>
            <p className="text-sm font-bold text-slate-800">WhatsApp da Organização</p>
            <p className="text-xs text-slate-400">Número remetente dos relatórios automáticos aos clientes</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${statusDot}`} />
          <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">{statusLabel}</span>
        </div>
      </div>

      <div className="p-6 space-y-4">
        {wa.status === "connected" && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <MessageCircle className="w-5 h-5 text-emerald-500" />
              <div>
                <p className="text-sm font-bold text-slate-700">{wa.phone_number || "Número conectado"}</p>
                <p className="text-xs text-slate-400">Pronto para enviar relatórios</p>
              </div>
            </div>
            <button
              onClick={handleDisconnect}
              disabled={busy}
              className="flex items-center gap-2 px-4 py-2 border border-rose-200 text-rose-600 hover:bg-rose-50 disabled:opacity-50 text-xs font-bold rounded-xl transition-all"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Unplug className="w-3.5 h-3.5" />}
              Desconectar
            </button>
          </div>
        )}

        {wa.status === "connecting" && (
          <div className="flex flex-col items-center gap-4 py-2">
            {wa.qr_code ? (
              <>
                <div className="p-3 bg-white border-2 border-emerald-200 rounded-2xl shadow-sm">
                  <img
                    src={wa.qr_code.startsWith("data:") ? wa.qr_code : `data:image/png;base64,${wa.qr_code}`}
                    alt="QR Code"
                    className="w-52 h-52 object-contain"
                  />
                </div>
                <p className="text-xs text-slate-500 text-center max-w-xs">
                  No celular da organização: WhatsApp → Aparelhos conectados → Conectar aparelho → escaneie o código.
                </p>
              </>
            ) : (
              <div className="flex items-center gap-3 py-6">
                <Loader2 className="w-5 h-5 text-emerald-500 animate-spin" />
                <span className="text-sm font-medium text-slate-500">Gerando QR Code...</span>
              </div>
            )}
            <button
              onClick={handleCancel}
              disabled={busy}
              className="px-4 py-2 border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-50 text-xs font-bold rounded-xl transition-all"
            >
              Cancelar
            </button>
          </div>
        )}

        {(wa.status === "disconnected" || wa.status === "unknown") && (
          <div className="flex flex-col items-start gap-3">
            <p className="text-xs text-slate-500 max-w-md">
              Conecte um número exclusivo da organização (não use o WhatsApp de um cliente). É ele quem envia os
              relatórios de desempenho para os donos das clínicas.
            </p>
            <button
              onClick={handleConnect}
              disabled={busy || wa.status === "unknown"}
              className="flex items-center gap-2 px-5 py-2.5 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white text-sm font-bold rounded-xl transition-all shadow-sm"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <QrCode className="w-4 h-4" />}
              Conectar WhatsApp
            </button>
            {error && (
              <p className="text-xs font-medium text-rose-600 flex items-center gap-1.5">
                <RefreshCw className="w-3 h-3" /> {error}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
