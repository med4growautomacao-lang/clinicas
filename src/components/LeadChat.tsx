import React, { useState, useEffect, useRef } from "react";
import { X, Send, Bot, User, Loader2, MessageSquare, Phone } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "./ui/button";
import { useChatMessages, ChatMessage, Lead, useLeads, useFunnelStages } from "../hooks/useSupabase";
import { format, isToday, isYesterday } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/src/lib/utils";

interface LeadChatProps {
  lead: Lead;
  onClose: () => void;
  isDragging?: boolean;
}

function stripToolCallPrefix(text: string): string {
  if (!text.startsWith('[Used tools:')) return text;
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '[') depth++;
    else if (text[i] === ']') {
      depth--;
      if (depth === 0) return text.slice(i + 1).trimStart();
    }
  }
  return text;
}

export function extractMessageText(message: any): string {
  if (!message) return '';

  // 1) Se for string, tenta extrair o content de dentro de um JSON
  if (typeof message === 'string') {
    const trimmed = message.trim();
    if (trimmed.startsWith('{')) {
      // Tenta JSON.parse direto
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed.content) return extractMessageText(parsed.content);
        if (parsed.text) return stripToolCallPrefix(parsed.text);
        if (parsed.output) return stripToolCallPrefix(parsed.output);
      } catch {
        // JSON.parse falhou (ex: quebra de linha literal dentro do valor)
        // Fallback: regex para extrair o campo "content"
        const match = trimmed.match(/"content"\s*:\s*"([\s\S]*?)"\s*[,}]/);
        if (match) {
          return stripToolCallPrefix(match[1].replace(/\\n/g, '\n').replace(/\\"/g, '"'));
        }
      }
    }
    return stripToolCallPrefix(trimmed);
  }

  // 2) Se for objeto com "content"
  if (message.content != null) {
    if (typeof message.content === 'string') {
      // Se o content em si parece ser JSON, recursa para extrair o real
      const c = message.content.trim();
      if (c.startsWith('{')) return extractMessageText(c);
      return stripToolCallPrefix(message.content);
    }
    if (Array.isArray(message.content)) {
      return message.content
        .map((block: any) => block?.text || block?.content || '')
        .filter(Boolean)
        .join('\n');
    }
  }

  // 3) Campos alternativos
  if (typeof message.text === 'string') return stripToolCallPrefix(message.text);
  if (typeof message.output === 'string') return stripToolCallPrefix(message.output);

  // 4) Último recurso: concatena valores string do objeto
  const values = Object.values(message).filter(v => typeof v === 'string') as string[];
  if (values.length > 0) return stripToolCallPrefix(values.join(' '));
  return JSON.stringify(message);
}

export function LeadChat({ lead, onClose, isDragging = false }: LeadChatProps) {
  const { data: messages, loading, send } = useChatMessages(lead.id, lead.phone);
  const { update: updateLead } = useLeads();
  const { data: stages } = useFunnelStages();
  const [content, setContent] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const [sending, setSending] = useState(false);

  // Solução Definitiva: MutationObserver para observar o DOM real
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    // Rola para o final de forma síncrona
    const scrollDown = () => {
      el.scrollTop = el.scrollHeight;
    };

    // Força o scroll na montagem (caso já tenha mensagens cacheadas)
    scrollDown();

    // Observa qualquer mudança no HTML interno do container (novas mensagens)
    const observer = new MutationObserver((mutations) => {
      // Se houver adição de nós, força o scroll
      scrollDown();
    });

    observer.observe(el, {
      childList: true, // Observa elementos adicionados ou removidos
      subtree: true,   // Observa os filhos dos filhos
      characterData: true // Observa mudanças de texto
    });

    // Como o framer-motion faz um slide-in de 300ms, damos um "empurrãozinho"
    // contínuo durante o primeiro meio segundo de vida do componente
    let pings = 0;
    const interval = setInterval(() => {
      scrollDown();
      pings++;
      if (pings > 10) clearInterval(interval); // 500ms total
    }, 50);

    return () => {
      observer.disconnect();
      clearInterval(interval);
    };
  }, [loading]); // Só recria se o loading mudar

  const handleSend = async () => {
    if (!content.trim() || sending) return;
    setSending(true);
    await send({ 
      message: { role: 'user', content: content.trim() }, 
      lead_id: lead.id, 
      phone: lead.phone 
    });
    setContent("");
    setSending(false);
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 300 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 300 }}
      className={cn("fixed inset-y-0 right-0 w-full max-w-md bg-white shadow-2xl z-[70] flex flex-col border-l border-slate-200", isDragging && "pointer-events-none")}
    >
      {/* Header */}
      <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-white sticky top-0 z-10">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-teal-100 rounded-full flex items-center justify-center text-teal-700 font-bold text-lg shadow-sm">
            {lead.name[0]}
          </div>
          <div>
            <h3 className="font-bold text-slate-900 leading-tight">{lead.name}</h3>
            <div className="flex items-center gap-3 mt-0.5">
              <button 
                onClick={() => updateLead(lead.id, { ai_enabled: !lead.ai_enabled })}
                className="flex items-center gap-1.5 group outline-none"
              >
                <div className={cn(
                  "w-2.5 h-2.5 rounded-full transition-all shadow-sm",
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
                  <span className="text-slate-300">•</span>
                  <span className="text-[10px] font-bold text-slate-400 flex items-center gap-1">
                    <Phone className="w-2.5 h-2.5" />
                    {lead.phone}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
        <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-full transition-all">
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Stage selector */}
      {stages.length > 0 && (
        <div className="px-6 py-2 border-b border-slate-100 bg-slate-50/60 flex items-center gap-2">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider shrink-0">Etapa</span>
          <select
            value={lead.stage_id || ''}
            onChange={e => updateLead(lead.id, { stage_id: e.target.value })}
            className="flex-1 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-teal-200 focus:border-teal-400 transition-all"
          >
            {stages.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-6 bg-slate-50/50 custom-scrollbar relative block">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-slate-400">
            <Loader2 className="w-8 h-8 animate-spin" />
            <p className="text-sm font-medium">Carregando conversa...</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-4 opacity-50">
            <div className="w-16 h-16 bg-white rounded-2xl shadow-sm flex items-center justify-center">
              <MessageSquare className="w-8 h-8 text-teal-600" />
            </div>
            <p className="text-sm font-medium text-center max-w-[200px]">Nenhuma mensagem encontrada nesta jornada.</p>
          </div>
        ) : (() => {
            const getDateLabel = (date: Date) => {
              if (isToday(date)) return 'Hoje';
              if (isYesterday(date)) return 'Ontem';
              return format(date, "d 'de' MMMM", { locale: ptBR });
            };
            const sorted = [...messages].sort((a, b) =>
              new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
            );
            const seenDates = new Set<string>();
            return (
              <div className="space-y-6 pb-4">
                {sorted.map((msg) => {
                  const isOutbound = msg.direction === 'outbound';
                  const isAI = msg.sender === 'ai';
                  const currentDate = new Date(msg.created_at);
                  const dateKey = format(currentDate, 'yyyy-MM-dd');
                  const showDateSeparator = !seenDates.has(dateKey);
                  if (showDateSeparator) seenDates.add(dateKey);

                  return (
                    <React.Fragment key={msg.id}>
                      {showDateSeparator && (
                        <div className="flex justify-center my-6">
                          <span className="bg-white/90 backdrop-blur-sm border border-slate-100 text-[10px] font-bold text-slate-500 uppercase tracking-widest px-4 py-1.5 rounded-full shadow-sm">
                            {getDateLabel(currentDate)}
                          </span>
                        </div>
                      )}
                      <div
                        className={cn(
                          "flex gap-4 max-w-[85%] min-w-0",
                          isOutbound ? "ml-auto flex-row-reverse" : ""
                        )}
                      >
                        <div className={cn(
                          "w-8 h-8 rounded-lg shadow-sm flex-shrink-0 flex items-center justify-center",
                          isAI ? "bg-teal-600 shadow-md" :
                          (isOutbound ? "bg-slate-800 shadow-md" : "bg-white border border-slate-200")
                        )}>
                          {isAI ? (
                            <Bot className="w-5 h-5 text-white" />
                          ) : (
                            <User className={cn("w-4 h-4", isOutbound ? "text-white" : "text-slate-400")} />
                          )}
                        </div>

                        <div className={cn(
                          "px-4 py-3 rounded-2xl text-sm shadow-sm max-w-full overflow-hidden break-words",
                          isAI
                            ? "bg-teal-600 text-white rounded-tr-none"
                            : (isOutbound
                                ? "bg-slate-800 text-white rounded-tr-none"
                                : "bg-white border border-slate-200 text-slate-700 rounded-tl-none")
                        )}>
                          <p className="text-sm font-medium leading-relaxed whitespace-pre-wrap">
                            {extractMessageText(msg.message)}
                          </p>
                          <div className="flex items-center justify-between gap-4 mt-1">
                            <span className={cn(
                              "text-[9px] block opacity-60 font-bold uppercase ml-auto",
                              isOutbound || isAI ? "text-white text-right" : "text-slate-400"
                            )}>
                              {format(new Date(msg.created_at), 'HH:mm')}
                            </span>
                          </div>
                        </div>
                      </div>
                    </React.Fragment>
                  );
                })}
                {/* Elemento âncora invisível no final exato do container */}
                <div ref={endRef} className="h-1 opacity-0 pointer-events-none" />
              </div>
            );
          })()
      }
    </div>

    {/* Input Area */}
    <div className="p-6 border-t border-slate-100 bg-white">
      <div className="relative group">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="Digite uma mensagem..."
          className="w-full pl-4 pr-14 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-200 font-medium text-sm min-h-[50px] max-h-[150px] resize-none transition-all group-hover:bg-white"
        />
          <button
            onClick={handleSend}
            disabled={!content.trim() || sending}
            className={cn(
              "absolute right-2 bottom-2 p-2 rounded-lg transition-all",
              content.trim() && !sending 
                ? "bg-teal-600 text-white shadow-md hover:scale-105 active:scale-95" 
                : "bg-slate-100 text-slate-400"
            )}
          >
            {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
          </button>
        </div>
        <p className="text-[10px] text-slate-400 mt-3 text-center font-medium">
          As respostas enviadas aqui serão encaminhadas via WhatsApp.
        </p>
      </div>
    </motion.div>
  );
}
