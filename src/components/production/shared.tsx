import React from "react";
import { X } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/src/lib/utils";
import { Button } from "../ui/button";

// Primitivos compartilhados do modulo Producao (Estoque/PCP/Manutencao).

export const inputCls =
  "w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-700 focus:outline-none focus:border-teal-400 focus:ring-4 focus:ring-teal-100/30 focus:bg-white transition-all";

export function fmtQty(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 }).format(v);
}

export function fmtBRL(n: number | null | undefined): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(n ?? 0));
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso.length <= 10 ? iso + "T00:00:00" : iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("pt-BR");
}

export function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label className="text-xs font-bold text-slate-500 uppercase tracking-wide">{label}</label>
      {children}
    </div>
  );
}

export function Modal({
  title,
  subtitle,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 8 }}
        className={cn("bg-white rounded-2xl shadow-xl w-full flex flex-col max-h-[90vh]", wide ? "max-w-3xl" : "max-w-lg")}
      >
        <div className="flex items-start justify-between gap-3 px-6 py-4 border-b border-slate-100">
          <div className="min-w-0">
            <h3 className="text-lg font-black text-slate-900 truncate">{title}</h3>
            {subtitle && <p className="text-xs font-medium text-slate-500 mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="p-1.5 -mr-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-all">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-6 py-5 overflow-y-auto custom-scrollbar">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-slate-100">{footer}</div>}
      </motion.div>
    </motion.div>
  );
}

// Cartao de estatistica compacto (topo das abas).
export function StatCard({ label, value, tone = "slate", icon }: { label: string; value: string; tone?: "slate" | "amber" | "emerald" | "rose" | "teal"; icon?: React.ReactNode }) {
  const tones: Record<string, string> = {
    slate: "text-slate-900",
    amber: "text-amber-600",
    emerald: "text-emerald-600",
    rose: "text-rose-600",
    teal: "text-teal-600",
  };
  return (
    <div className="flex-1 min-w-[140px] bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">{label}</span>
        {icon}
      </div>
      <p className={cn("text-2xl font-black mt-1", tones[tone])}>{value}</p>
    </div>
  );
}

// Rótulo colorido de status.
export function StatusBadge({ label, tone }: { label: string; tone: "slate" | "amber" | "emerald" | "rose" | "sky" | "violet" }) {
  const tones: Record<string, string> = {
    slate: "bg-slate-100 text-slate-600",
    amber: "bg-amber-100 text-amber-700",
    emerald: "bg-emerald-100 text-emerald-700",
    rose: "bg-rose-100 text-rose-700",
    sky: "bg-sky-100 text-sky-700",
    violet: "bg-violet-100 text-violet-700",
  };
  return <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold whitespace-nowrap", tones[tone])}>{label}</span>;
}

export function EmptyState({ icon, title, hint, action }: { icon: React.ReactNode; title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-300 mb-4">{icon}</div>
      <p className="text-slate-700 font-bold">{title}</p>
      {hint && <p className="text-slate-400 text-sm mt-1 max-w-xs">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// Reexport util p/ conveniencia dos consumidores.
export { Button };
