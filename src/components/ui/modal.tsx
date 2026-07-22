import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "@/src/lib/utils";

/**
 * Modal com altura travada.
 *
 * O painel nunca passa de 90dvh: cabeçalho e rodapé ficam fixos e só o corpo
 * rola. Sem isso o conteúdo vaza para fora do viewport e não há como rolar
 * (overlay `fixed` não gera scroll na página), obrigando o usuário a tirar o
 * zoom para enxergar os campos.
 */

const SIZES = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-xl",
  "2xl": "max-w-2xl",
  "3xl": "max-w-3xl",
  "4xl": "max-w-4xl",
} as const;

export type ModalSize = keyof typeof SIZES;

interface ModalProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  size?: ModalSize;
  /** Classe de z-index. Suba para empilhar sobre outro modal (ex.: "z-[60]"). */
  zIndexClass?: string;
  /** Clique no fundo fecha. Desligue em fluxos que não podem ser abandonados no meio. */
  closeOnBackdrop?: boolean;
  /** Tecla Esc fecha. */
  closeOnEsc?: boolean;
  className?: string;
}

export function Modal({
  open,
  onClose,
  children,
  size = "md",
  zIndexClass = "z-50",
  closeOnBackdrop = true,
  closeOnEsc = true,
  className,
}: ModalProps) {
  React.useEffect(() => {
    if (!open || !closeOnEsc) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, closeOnEsc, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className={cn(
            "fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4",
            zIndexClass,
          )}
          onClick={closeOnBackdrop ? onClose : undefined}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className={cn(
              // max-h + flex-col + overflow-hidden: a trava de altura
              "bg-white rounded-2xl shadow-2xl w-full max-h-[90dvh] flex flex-col overflow-hidden",
              SIZES[size],
              className,
            )}
            onClick={(e) => e.stopPropagation()}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

interface ModalHeaderProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  onClose?: () => void;
  icon?: React.ReactNode;
  className?: string;
}

/** Cabeçalho fixo: fica sempre visível enquanto o corpo rola. */
export function ModalHeader({ title, subtitle, onClose, icon, className }: ModalHeaderProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 p-6 border-b border-slate-100 shrink-0",
        className,
      )}
    >
      {icon}
      <div className="min-w-0 flex-1">
        <h3 className="text-lg font-bold text-slate-900 leading-tight">{title}</h3>
        {subtitle && (
          <p className="text-xs text-slate-500 font-medium mt-0.5">{subtitle}</p>
        )}
      </div>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          className="text-slate-400 hover:text-slate-600 hover:bg-slate-100 p-1.5 rounded-lg transition-colors shrink-0"
        >
          <X className="w-5 h-5" />
        </button>
      )}
    </div>
  );
}

/** Corpo rolável. `min-h-0` é obrigatório: sem ele o flex item não encolhe e o scroll não acontece. */
export function ModalBody({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex-1 min-h-0 overflow-y-auto custom-scrollbar p-6 space-y-4",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Rodapé fixo: os botões de ação nunca somem para fora da tela. */
export function ModalFooter({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex gap-3 p-6 border-t border-slate-100 bg-slate-50 shrink-0",
        className,
      )}
    >
      {children}
    </div>
  );
}
