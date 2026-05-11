import React, { createContext, useContext, useState, useCallback, ReactNode } from "react";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/src/lib/utils";

type ToastKind = "success" | "error" | "info";

interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastContextValue {
  showToast: (message: string, kind?: ToastKind) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const showToast = useCallback((message: string, kind: ToastKind = "info") => {
    const id = Date.now() + Math.random();
    setItems(prev => [...prev, { id, kind, message }]);
    setTimeout(() => {
      setItems(prev => prev.filter(t => t.id !== id));
    }, 4500);
  }, []);

  const dismiss = (id: number) => setItems(prev => prev.filter(t => t.id !== id));

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="fixed bottom-6 right-6 z-[200] flex flex-col gap-2 pointer-events-none">
        <AnimatePresence>
          {items.map(t => {
            const Icon = t.kind === "success" ? CheckCircle2 : t.kind === "error" ? AlertCircle : Info;
            const styles =
              t.kind === "success"
                ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                : t.kind === "error"
                ? "bg-rose-50 border-rose-200 text-rose-800"
                : "bg-sky-50 border-sky-200 text-sky-800";
            const iconCls =
              t.kind === "success" ? "text-emerald-600" : t.kind === "error" ? "text-rose-600" : "text-sky-600";
            return (
              <motion.div
                key={t.id}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className={cn(
                  "pointer-events-auto flex items-start gap-3 min-w-[280px] max-w-md px-4 py-3 rounded-xl border shadow-lg",
                  styles
                )}
              >
                <Icon className={cn("w-5 h-5 flex-shrink-0 mt-0.5", iconCls)} />
                <p className="flex-1 text-sm font-semibold leading-snug">{t.message}</p>
                <button
                  onClick={() => dismiss(t.id)}
                  className="p-0.5 -mr-1 hover:opacity-70 transition-opacity"
                  aria-label="Fechar"
                >
                  <X className="w-4 h-4" />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast deve ser usado dentro do ToastProvider");
  return ctx.showToast;
}
