import React, { useEffect, useRef, useState } from "react";
import { Sparkles, X, Send, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/src/lib/utils";
import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../lib/supabase";

interface ChatMsg { role: "user" | "assistant"; content: string }

interface AssistantConfig {
  enabled?: boolean;
  welcome_message?: string;
  example_questions?: string[];
  allowed_roles?: string[];
}

const DEFAULT_WELCOME = "Oi! Posso te ajudar com leads, agendamentos, faturamento e funil desta clínica.";

export function AIAssistant() {
  const { session, profile, activeClinicId } = useAuth();
  const [config, setConfig] = useState<AssistantConfig | null>(null);
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Carrega a config (global, editável no Super Admin).
  useEffect(() => {
    let ignore = false;
    supabase
      .from("system_settings").select("value").eq("id", "ai_assistant_config").maybeSingle()
      .then(({ data }) => {
        if (ignore) return;
        try { setConfig(data?.value ? JSON.parse(data.value) : { enabled: false }); }
        catch { setConfig({ enabled: false }); }
      });
    return () => { ignore = true; };
  }, []);

  // Reseta a conversa ao trocar de clínica.
  useEffect(() => {
    setMessages([]);
    setOpen(false);
  }, [activeClinicId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  const role = profile?.role || "";
  const allowed = config?.allowed_roles && config.allowed_roles.length
    ? (config.allowed_roles.includes(role) || role.startsWith("org_") || role === "super-admin")
    : true;

  // Só aparece logado, com clínica ativa, habilitado e com permissão.
  if (!session || !activeClinicId || !config || config.enabled === false || !allowed) return null;

  async function send(text: string) {
    const q = text.trim();
    if (!q || loading) return;
    const next = [...messages, { role: "user" as const, content: q }];
    setMessages(next);
    setInput("");
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("ai-assistant", {
        body: { messages: next, clinicId: activeClinicId },
      });
      const reply = error ? "Desculpe, tive um problema ao responder. Tente novamente."
        : (data?.reply || data?.error || "Não consegui responder.");
      setMessages([...next, { role: "assistant", content: reply }]);
    } catch {
      setMessages([...next, { role: "assistant", content: "Desculpe, tive um problema ao responder." }]);
    } finally {
      setLoading(false);
    }
  }

  const examples = config.example_questions?.slice(0, 4) || [];

  return (
    <>
      {/* Botão flutuante */}
      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-6 right-6 z-[60] w-14 h-14 rounded-full bg-teal-600 text-white shadow-lg shadow-teal-600/30 flex items-center justify-center hover:bg-teal-700 transition-colors"
        title="Assistente de IA"
      >
        {open ? <X className="w-6 h-6" /> : <Sparkles className="w-6 h-6" />}
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.16 }}
            className="fixed bottom-24 right-6 z-[60] w-[min(420px,calc(100vw-2rem))] h-[min(560px,calc(100vh-8rem))] bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden"
          >
            {/* Header */}
            <div className="px-4 py-3 bg-teal-600 text-white flex items-center gap-2 shrink-0">
              <Sparkles className="w-5 h-5" />
              <div className="flex flex-col">
                <span className="text-sm font-bold leading-tight">Assistente de IA</span>
                <span className="text-[10px] text-teal-100">Pergunte sobre os dados da clínica</span>
              </div>
            </div>

            {/* Mensagens */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar bg-slate-50">
              {messages.length === 0 && (
                <div className="space-y-3">
                  <div className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-700">
                    {config.welcome_message || DEFAULT_WELCOME}
                  </div>
                  {examples.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {examples.map((ex, i) => (
                        <button
                          key={i}
                          onClick={() => send(ex)}
                          className="text-xs px-2.5 py-1.5 rounded-full bg-teal-50 text-teal-700 border border-teal-100 hover:bg-teal-100 transition-colors text-left"
                        >
                          {ex}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {messages.map((m, i) => (
                <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                  <div className={cn(
                    "max-w-[85%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap break-words",
                    m.role === "user"
                      ? "bg-teal-600 text-white"
                      : "bg-white border border-slate-200 text-slate-800"
                  )}>
                    {m.content}
                  </div>
                </div>
              ))}

              {loading && (
                <div className="flex justify-start">
                  <div className="bg-white border border-slate-200 rounded-xl px-3 py-2 flex items-center gap-2 text-slate-400">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="text-xs">Consultando...</span>
                  </div>
                </div>
              )}
            </div>

            {/* Input */}
            <form
              onSubmit={(e) => { e.preventDefault(); send(input); }}
              className="p-3 border-t border-slate-100 bg-white flex items-center gap-2 shrink-0"
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Pergunte algo sobre a clínica..."
                className="flex-1 px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-200"
                disabled={loading}
              />
              <button
                type="submit"
                disabled={loading || !input.trim()}
                className="w-9 h-9 rounded-xl bg-teal-600 text-white flex items-center justify-center hover:bg-teal-700 disabled:opacity-40 transition-colors shrink-0"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
