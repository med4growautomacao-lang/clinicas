import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { useLatched } from "@/src/hooks/useAnchoredPosition";

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

/**
 * Pilha de modais abertos. Esc só pode fechar o do topo: um listener por modal,
 * sem essa coordenação, fecharia todos os empilhados de uma vez.
 */
const openStack: symbol[] = [];

interface ModalProps<T> {
  open: boolean;
  onClose: () => void;
  /**
   * Passe uma FUNÇÃO para o conteúdo só ser construído quando o modal estiver
   * aberto. Como JSX é avaliado na criação do elemento pai, `children` direto
   * roda em todo render do chamador, mesmo fechado.
   */
  children: React.ReactNode | ((data: T) => React.ReactNode);
  /**
   * Dado que o conteúdo precisa. É retido durante a animação de saída, então o
   * chamador pode zerar o estado (`setAlvo(null)`) sem o modal sumir na hora.
   */
  data?: T | null;
  size?: ModalSize;
  /** Classe de z-index. Suba para empilhar sobre outro modal (ex.: "z-[60]"). */
  zIndexClass?: string;
  /** Clique no fundo fecha. Desligue em fluxos que não podem ser abandonados no meio. */
  closeOnBackdrop?: boolean;
  /** Tecla Esc fecha. */
  closeOnEsc?: boolean;
  /** Rótulo acessível quando o cabeçalho não é um ModalHeader. */
  ariaLabel?: string;
  className?: string;
}

export function Modal<T = undefined>({
  open,
  onClose,
  children,
  data,
  size = "md",
  zIndexClass = "z-50",
  closeOnBackdrop = true,
  closeOnEsc = true,
  ariaLabel,
  className,
}: ModalProps<T>) {
  const panelRef = React.useRef<HTMLDivElement>(null);
  // Onde o foco estava antes de abrir, para devolver ao fechar.
  const restoreFocusRef = React.useRef<HTMLElement | null>(null);
  // onClose costuma ser uma arrow inline, recriada a cada render do chamador.
  // Numa dependência de effect ela re-registraria os listeners a cada tecla.
  const onCloseRef = React.useRef(onClose);
  React.useEffect(() => { onCloseRef.current = onClose; });

  const idRef = React.useRef<symbol>(Symbol("modal"));
  const titleId = React.useId();

  React.useEffect(() => {
    if (!open) return;
    const id = idRef.current;
    openStack.push(id);
    return () => {
      const i = openStack.lastIndexOf(id);
      if (i >= 0) openStack.splice(i, 1);
    };
  }, [open]);

  React.useEffect(() => {
    if (!open || !closeOnEsc) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Só o modal do topo responde.
      if (openStack[openStack.length - 1] !== idRef.current) return;
      e.stopPropagation();
      onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, closeOnEsc]);

  // Foco entra no painel ao abrir e volta ao gatilho ao fechar, senão o Tab
  // continua percorrendo a página atrás do overlay.
  //
  // Mira o primeiro CAMPO, nunca um botão: o primeiro focável costuma ser o "X"
  // do cabeçalho, e aí um Enter (reflexo natural em formulário) fecharia o modal
  // e descartaria o preenchimento. Sem campo, foca o próprio painel, que também
  // evita deixar Enter armado sobre uma ação destrutiva num modal de confirmação.
  React.useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const field = panel?.querySelector<HTMLElement>(
      "input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled])",
    );
    (field ?? panel)?.focus();
    return () => restoreFocusRef.current?.focus?.();
  }, [open]);

  // Prende o Tab dentro do painel enquanto ele for o modal do topo.
  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      if (openStack[openStack.length - 1] !== idRef.current) return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const latched = useLatched(data);

  // Fechar pelo fundo precisa exigir que o gesto TENHA COMEÇADO no fundo. Com
  // um onClick simples, arrastar para selecionar texto dentro do painel e
  // soltar sobre o overlay fecha o modal e descarta o formulário.
  const backdropDownRef = React.useRef(false);

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
          onMouseDown={(e) => { backdropDownRef.current = e.target === e.currentTarget; }}
          onMouseUp={(e) => {
            const started = backdropDownRef.current;
            backdropDownRef.current = false;
            if (closeOnBackdrop && started && e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={ariaLabel}
            aria-labelledby={ariaLabel ? undefined : titleId}
            tabIndex={-1}
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className={cn(
              // max-h + flex-col + overflow-hidden: a trava de altura
              "bg-white rounded-2xl shadow-2xl w-full max-h-[90dvh] flex flex-col overflow-hidden outline-none",
              SIZES[size],
              className,
            )}
          >
            <ModalTitleIdContext.Provider value={titleId}>
              {typeof children === "function"
                ? (children as (data: T) => React.ReactNode)(latched as T)
                : children}
            </ModalTitleIdContext.Provider>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Liga o aria-labelledby do diálogo ao título renderizado pelo ModalHeader. */
const ModalTitleIdContext = React.createContext<string | undefined>(undefined);

interface ModalHeaderProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  onClose?: () => void;
  icon?: React.ReactNode;
  className?: string;
}

/** Cabeçalho fixo: fica sempre visível enquanto o corpo rola. */
export function ModalHeader({ title, subtitle, onClose, icon, className }: ModalHeaderProps) {
  const titleId = React.useContext(ModalTitleIdContext);
  return (
    <div
      className={cn(
        "flex items-center gap-3 p-6 border-b border-slate-100 shrink-0",
        className,
      )}
    >
      {icon}
      <div className="min-w-0 flex-1">
        <h3 id={titleId} className="text-lg font-bold text-slate-900 leading-tight">{title}</h3>
        {subtitle && (
          <p className="text-xs text-slate-500 font-medium mt-0.5">{subtitle}</p>
        )}
      </div>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar"
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
