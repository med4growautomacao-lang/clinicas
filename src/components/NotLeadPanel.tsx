import React from "react";
import { createPortal } from "react-dom";
import { X, RotateCcw, UserX, Instagram } from "lucide-react";
import { format, parseISO } from "date-fns";
import { cn } from "@/src/lib/utils";
import { Lead } from "../hooks/useSupabase";
import GoogleLogo from "../assets/logos/Logo Googleads.png";
import MetaLogo from "../assets/logos/Logo Metaads.png";
import SemOrigemLogo from "../assets/logos/Logo Sem origem.png";

interface NotLeadPanelProps {
  open: boolean;
  onClose: () => void;
  leads: Lead[];
  onRestore: (id: string) => void;
}

// Caixa de anexo dos "Não Leads": lista os registros marcados como não-oportunidade
// e permite torná-los lead de novo. Renderiza em portal p/ não sofrer com os
// transforms do Kanban (que quebrariam um position:fixed).
export function NotLeadPanel({ open, onClose, leads, onRestore }: NotLeadPanelProps) {
  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[60] flex justify-end">
      <div
        className="absolute inset-0 bg-slate-900/30 backdrop-blur-[1px]"
        onClick={onClose}
      />
      <div className="relative w-full max-w-sm h-full bg-white shadow-2xl border-l border-slate-200 flex flex-col animate-in slide-in-from-right duration-200">
        <div className="px-4 py-3.5 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <UserX className="w-4 h-4 text-slate-500" />
            <h3 className="text-sm font-bold text-slate-900">Não Leads</h3>
            <span className="text-[11px] font-bold text-slate-400 bg-slate-200/60 px-1.5 py-0.5 rounded-full">
              {leads.length}
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-700 rounded transition-colors"
            title="Fechar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="px-4 pt-3 text-[11px] text-slate-400 leading-relaxed shrink-0">
          Registros marcados como "Não Lead" não entram em métricas nem em
          automações. São apenas informação. Clique em "Tornar Lead" para reverter.
        </p>

        <div className="flex-1 overflow-y-auto p-3 space-y-1.5 custom-scrollbar">
          {leads.length === 0 ? (
            <div className="p-8 text-center text-slate-400">
              <p className="text-sm font-medium">Nenhum registro aqui.</p>
            </div>
          ) : (
            leads.map((lead) => {
              const isMeta = !!lead.fb_campaign_name || lead.source === "meta_ads";
              const isGoogle = !!lead.g_campaign_name || lead.source === "google_ads";
              const isInstagram = !isMeta && !isGoogle && lead.source === "instagram";
              return (
                <div
                  key={lead.id}
                  className="flex items-center gap-3 p-2.5 rounded-lg border border-slate-100 bg-white hover:bg-slate-50 transition-colors"
                >
                  <div className="relative shrink-0">
                    {lead.avatar_url ? (
                      <img
                        src={lead.avatar_url}
                        alt={lead.name}
                        className="w-9 h-9 rounded-full object-cover border border-slate-200"
                      />
                    ) : (
                      <div className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-slate-600 bg-slate-100 border border-slate-200">
                        {lead.name?.[0] ?? "?"}
                      </div>
                    )}
                    {isMeta && (
                      <img src={MetaLogo} alt="Meta" className="absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full border-2 border-white bg-white" />
                    )}
                    {isGoogle && !isMeta && (
                      <img src={GoogleLogo} alt="Google" className="absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full border-2 border-white bg-white" />
                    )}
                    {isInstagram && (
                      <span className="absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full border-2 border-white bg-white flex items-center justify-center">
                        <Instagram className="w-2 h-2 text-pink-500" />
                      </span>
                    )}
                    {!isMeta && !isGoogle && !isInstagram && (
                      <img src={SemOrigemLogo} alt="Sem origem" className="absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full border-2 border-white bg-white opacity-90" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-slate-900 truncate">{lead.name}</p>
                    <p className="text-xs text-slate-500 truncate">{lead.phone || "Sem telefone"}</p>
                    {lead.not_lead_at && (
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        Marcado em {format(parseISO(lead.not_lead_at), "dd/MM/yyyy")}
                      </p>
                    )}
                  </div>

                  <button
                    onClick={() => onRestore(lead.id)}
                    className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold text-teal-700 bg-teal-50 hover:bg-teal-100 border border-teal-100 transition-colors"
                    title="Tornar lead de novo"
                  >
                    <RotateCcw className="w-3 h-3" />
                    Tornar Lead
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

// Botão "Não Leads (n)" que abre o painel. Reutilizado no Kanban e em Conversas.
interface NotLeadButtonProps {
  count: number;
  onClick: () => void;
  className?: string;
}

export function NotLeadButton({ count, onClick, className }: NotLeadButtonProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold border transition-colors",
        count > 0
          ? "text-slate-600 bg-white border-slate-200 hover:bg-slate-50"
          : "text-slate-400 bg-white border-slate-200 hover:bg-slate-50",
        className
      )}
      title="Registros marcados como Não Lead"
    >
      <UserX className="w-3.5 h-3.5" />
      Não Leads
      {count > 0 && (
        <span className="text-[10px] font-black text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-full">
          {count}
        </span>
      )}
    </button>
  );
}
