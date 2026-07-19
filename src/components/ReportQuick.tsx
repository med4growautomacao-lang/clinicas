import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { format } from "date-fns";
import { Check, Copy, Download, FileText, Loader2, MessageSquare, XCircle } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import { logSystemError } from "../hooks/useSupabase";
import { downloadReportPdf } from "../lib/reportPdf";
import { Button } from "./ui/button";
import { cn } from "../lib/utils";

// Botão "Relatório" leve para VG e Marketing: gera o relatório comercial COMPLETO
// (RPC build_commercial_report — mesma fonte do Comercial e do envio agendado)
// usando o período da tela como janela de entrada/agenda/realização, e abre o
// modal com Copiar / .txt / PDF / Enviar no WhatsApp da organização.

export function ReportQuick({ start, end, className }: { start: Date; end: Date; className?: string }) {
  const { profile, activeClinicId } = useAuth();
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendMsg, setSendMsg] = useState<string | null>(null);

  const clinicId = activeClinicId || profile?.clinic_id;
  const from = format(start, "yyyy-MM-dd");
  const to = format(end, "yyyy-MM-dd");

  const generate = async () => {
    if (!clinicId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc("build_commercial_report", {
        p_clinic_id: clinicId,
        p_kind: "completo",
        p_entry_from: from, p_entry_to: to,
        p_conv_from: from, p_conv_to: to,
        p_appt_from: from, p_appt_to: to,
        p_compare: true,
      });
      if (error) throw error;
      if (typeof data !== "string" || !data) throw new Error("relatório vazio");
      setText(data);
      setSendMsg(null);
      setCopied(false);
      setOpen(true);
    } catch (err: any) {
      console.error("ReportQuick error:", err);
      logSystemError("REPORT_BUILD_FAIL", "build_commercial_report: falha ao gerar relatório (botão rápido)", clinicId, { error: err?.message ?? String(err) }, "error");
      alert("Não foi possível gerar o relatório. Tente novamente.");
    } finally {
      setLoading(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      alert("Não foi possível copiar. Selecione o texto manualmente.");
    }
  };

  const downloadTxt = () => {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `relatorio-${from}-a-${to}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const send = async () => {
    if (!clinicId) return;
    setSending(true);
    setSendMsg(null);
    try {
      const { data, error } = await supabase.rpc("send_clinic_report", {
        p_clinic_id: clinicId,
        p_kind: "completo",
        p_entry_from: from, p_entry_to: to,
        p_conv_from: from, p_conv_to: to,
        p_appt_from: from, p_appt_to: to,
        p_trigger: "manual",
      });
      if (error) throw error;
      if (data?.success) {
        setSendMsg(`Enviado a ${data.sent} destinatário${data.sent > 1 ? "s" : ""} ✓`);
      } else {
        const msgs: Record<string, string> = {
          org_whatsapp_desconectado: "WhatsApp da organização não está conectado (Gestão Organizacional → Configurações).",
          sem_destinatarios: "Nenhum destinatário configurado para esta clínica (Gestão Organizacional → Configurações).",
          nenhum_destinatario_valido: "Nenhum número de destinatário é válido.",
          clinica_sem_organizacao: "Esta clínica não pertence a uma organização.",
        };
        setSendMsg(msgs[data?.error] ?? `Falha ao enviar: ${data?.error ?? "erro desconhecido"}`);
      }
    } catch (err: any) {
      console.error("ReportQuick send error:", err);
      logSystemError("REPORT_SEND_FAIL", "send_clinic_report: falha ao enviar relatório (botão rápido)", clinicId, { error: err?.message ?? String(err) }, "error");
      setSendMsg("Erro ao enviar. Tente novamente.");
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <Button
        onClick={generate}
        disabled={loading || !clinicId}
        variant="outline"
        className={cn("gap-2 border-slate-200 bg-white hover:bg-slate-50 text-slate-600 shadow-sm", className)}
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin text-teal-600" /> : <FileText className="w-4 h-4" />}
        <span className="text-[10px] font-bold uppercase tracking-tight">Relatório</span>
      </Button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 12 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 bg-slate-50">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-teal-600" />
                  <span className="text-sm font-bold text-slate-700 uppercase tracking-wider">Relatório do período</span>
                </div>
                <button onClick={() => setOpen(false)} className="p-1 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors">
                  <XCircle className="w-5 h-5" />
                </button>
              </div>
              <div className="p-4 overflow-y-auto custom-scrollbar">
                <pre className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-slate-700 font-sans bg-slate-50 rounded-xl border border-slate-100 p-4">{text}</pre>
              </div>
              <div className="flex items-center justify-between gap-2 px-5 py-3.5 border-t border-slate-100 bg-slate-50">
                <span className={cn("text-[11px] font-semibold", sendMsg?.endsWith("✓") ? "text-emerald-600" : "text-amber-600")}>
                  {sendMsg ?? ""}
                </span>
                <div className="flex items-center gap-2">
                  <Button onClick={downloadTxt} variant="outline" className="gap-1.5 border-slate-200 bg-white hover:bg-slate-50 text-slate-600 px-3">
                    <Download className="w-4 h-4" />
                    <span className="text-[11px] font-bold uppercase tracking-tight">.txt</span>
                  </Button>
                  <Button onClick={() => downloadReportPdf(text, `relatorio-${from}-a-${to}.pdf`)} variant="outline" className="gap-1.5 border-slate-200 bg-white hover:bg-slate-50 text-slate-600 px-3">
                    <Download className="w-4 h-4" />
                    <span className="text-[11px] font-bold uppercase tracking-tight">PDF</span>
                  </Button>
                  <Button onClick={copy} variant="outline" className="gap-1.5 border-slate-200 bg-white hover:bg-slate-50 text-slate-600 px-3">
                    {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    <span className="text-[11px] font-bold uppercase tracking-tight">{copied ? "Copiado!" : "Copiar"}</span>
                  </Button>
                  <Button onClick={send} disabled={sending} className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white px-3">
                    {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageSquare className="w-4 h-4" />}
                    <span className="text-[11px] font-bold uppercase tracking-tight">{sending ? "Enviando..." : "Enviar"}</span>
                  </Button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
