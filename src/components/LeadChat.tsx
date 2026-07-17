import React, { useState } from "react";
import { X, Phone, ThumbsUp, ThumbsDown, TrendingUp, Pencil, PhoneOff } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useChatMessages, Lead, useLeads, useFunnelStages, useConversions } from "../hooks/useSupabase";
import { cn } from "@/src/lib/utils";
import { ChatThread } from "./ChatThread";
import { ChatComposer } from "./ChatComposer";

// Reexports — outros módulos importam daqui (ex.: AISecretary)
export { extractMessageText, detectMedia, MediaBubble } from "./ChatThread";
export type { MediaKind } from "./ChatThread";

interface LeadChatProps {
  lead: Lead;
  onClose: () => void;
  isDragging?: boolean;
  ticketId?: string;
  currentStageId?: string | null;
  onGanho?: () => void;
  onPerdido?: () => void;
  onStageChange?: (stageId: string) => void;
  onEdit?: () => void;
}

export function LeadChat({ lead, onClose, isDragging = false, ticketId, currentStageId, onGanho, onPerdido, onStageChange, onEdit }: LeadChatProps) {
  const { data: messages, loading, send } = useChatMessages(lead.id, lead.phone);
  const { update: updateLead } = useLeads();
  const { byLead: conversionsByLead } = useConversions();
  const [showConversions, setShowConversions] = useState(false);
  const { data: stages } = useFunnelStages();

  return (
    <>
    <motion.div
      initial={{ opacity: 0, x: 300 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 300 }}
      className={cn("fixed inset-y-0 right-0 w-full max-w-md bg-white shadow-2xl z-[70] flex flex-col border-l border-slate-200", isDragging && "pointer-events-none")}
    >
      {/* Header */}
      <div className="border-b border-slate-100 bg-white sticky top-0 z-10">
        <div className="px-5 pt-4 pb-3 flex items-start gap-3">
          {/* Avatar */}
          {lead.avatar_url ? (
            <div className="relative w-10 h-10 shrink-0 mt-0.5">
              <img
                src={lead.avatar_url}
                alt={lead.name}
                className="w-10 h-10 rounded-full object-cover border-2 border-white shadow"
                onError={e => { e.currentTarget.style.display = 'none'; (e.currentTarget.nextElementSibling as HTMLElement).style.display = 'flex'; }}
              />
              <div style={{ display: 'none' }} className="absolute inset-0 w-10 h-10 bg-teal-100 rounded-full items-center justify-center text-teal-700 font-bold text-base shadow">
                {lead.name[0]}
              </div>
            </div>
          ) : (
            <div className="w-10 h-10 bg-teal-100 rounded-full flex items-center justify-center text-teal-700 font-bold text-base shadow shrink-0 mt-0.5">
              {lead.name[0]}
            </div>
          )}

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-bold text-slate-900 truncate">{lead.name}</h3>
              <div className="flex items-center gap-1 shrink-0 -mr-1">
                {onEdit && (
                  <button onClick={onEdit} title="Editar lead" className="p-1.5 text-slate-400 hover:text-teal-600 hover:bg-teal-50 rounded-full transition-all">
                    <Pencil className="w-4 h-4" />
                  </button>
                )}
                <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-all">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <button
                onClick={() => updateLead(lead.id, { ai_enabled: !lead.ai_enabled })}
                className="flex items-center gap-1 group outline-none"
              >
                <div className={cn(
                  "w-2 h-2 rounded-full transition-all",
                  lead.ai_enabled ? "bg-emerald-500 animate-pulse" : "bg-slate-300"
                )} />
                <span className={cn(
                  "text-[10px] font-bold uppercase tracking-wider transition-colors",
                  lead.ai_enabled ? "text-emerald-600" : "text-slate-400 group-hover:text-slate-600"
                )}>
                  IA {lead.ai_enabled ? "Ativa" : "Pausada"}
                </span>
              </button>
              {lead.phone && (
                <>
                  <span className="text-slate-200">•</span>
                  <span className="text-[10px] font-medium text-slate-400 flex items-center gap-1">
                    <Phone className="w-2.5 h-2.5" />
                    {lead.phone}
                  </span>
                </>
              )}
              {ticketId && (onGanho || onPerdido) && (
                <>
                  <span className="text-slate-200">•</span>
                  <div className="flex items-center gap-1.5">
                    {onGanho && (
                      <button onClick={onGanho} className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition-all">
                        <ThumbsUp className="w-3 h-3" />
                        Ganho
                      </button>
                    )}
                    {onPerdido && (
                      <button onClick={onPerdido} className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition-all">
                        <ThumbsDown className="w-3 h-3" />
                        Perdido
                      </button>
                    )}
                  </div>
                </>
              )}
              <span className="text-slate-200">•</span>
              <button
                onClick={() => setShowConversions(true)}
                className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold text-teal-700 bg-teal-50 hover:bg-teal-100 border border-teal-200 rounded-lg transition-all"
              >
                <TrendingUp className="w-3 h-3" />
                Conversões {(conversionsByLead[lead.id]?.length ?? 0) > 0 && `(${conversionsByLead[lead.id].length})`}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Aviso: número não está no WhatsApp */}
      {lead.whatsapp_invalid && (
        <div className="px-5 py-2 bg-rose-50 border-b border-rose-100 flex items-center gap-2">
          <PhoneOff className="w-3.5 h-3.5 text-rose-500 shrink-0" />
          <span className="text-[11px] font-semibold text-rose-700 leading-snug">
            Este número não está no WhatsApp — não é possível enviar mensagens automáticas. Contate o lead por outro canal.
          </span>
        </div>
      )}

      {/* Stage selector — só quando o pai sabe tratar a mudança de etapa (ex.: Kanban) */}
      {stages.length > 0 && onStageChange && (
        <div className="px-5 py-2 border-b border-slate-100 bg-slate-50/60 flex items-center gap-2">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider shrink-0">Etapa</span>
          <select
            value={currentStageId || ''}
            onChange={e => onStageChange?.(e.target.value)}
            className="flex-1 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-teal-200 focus:border-teal-400 transition-all"
          >
            {stages.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
      )}

      <ChatThread
        messages={messages}
        loading={loading}
        leadAvatarUrl={lead.avatar_url}
        leadName={lead.name}
      />

      <ChatComposer
        onSend={send}
        disabled={!lead.phone || !!lead.whatsapp_invalid}
        disabledReason={lead.whatsapp_invalid ? "Este número não está no WhatsApp." : !lead.phone ? "Este lead não tem telefone." : undefined}
      />
    </motion.div>

    {/* Modal de Conversões */}
    <AnimatePresence>
      {showConversions && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4"
          onClick={() => setShowConversions(false)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 16 }}
            className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <div>
                <p className="font-bold text-slate-900 text-base">{lead.name}</p>
                {lead.phone && (
                  <p className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
                    <Phone className="w-3 h-3" /> {lead.phone}
                  </p>
                )}
              </div>
              <button onClick={() => setShowConversions(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Lista */}
            <div className="p-5">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Histórico de Conversões</p>
              {(conversionsByLead[lead.id]?.length ?? 0) === 0 ? (
                <p className="text-sm text-slate-400 text-center py-6">Nenhuma conversão registrada.</p>
              ) : (
                <>
                  <div className="space-y-2 max-h-64 overflow-y-auto custom-scrollbar">
                    {[...conversionsByLead[lead.id]]
                      .sort((a, b) => new Date(b.converted_at).getTime() - new Date(a.converted_at).getTime())
                      .map(conv => (
                        <div key={conv.id} className="flex items-center justify-between px-3 py-2 bg-teal-50 border border-teal-100 rounded-lg">
                          <span className="text-xs text-slate-500">
                            {new Date(conv.converted_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                          </span>
                          <span className="text-sm font-semibold text-teal-700">
                            R$ {Number(conv.value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                          </span>
                        </div>
                      ))}
                  </div>
                  <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100 text-xs">
                    <span className="text-slate-400">{conversionsByLead[lead.id].length} ganho{conversionsByLead[lead.id].length !== 1 ? 's' : ''}</span>
                    <span className="font-bold text-teal-600">
                      Total: R$ {conversionsByLead[lead.id].reduce((s, c) => s + Number(c.value || 0), 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
    </>
  );
}
