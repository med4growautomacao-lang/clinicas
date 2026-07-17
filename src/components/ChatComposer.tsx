import React, { useState, useRef } from "react";
import { Send, Loader2, PhoneOff } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { useSettings } from "../hooks/useSupabase";

// Erros que a edge chat-send devolve, em português para o operador.
const ERROS: Record<string, string> = {
  envio_desativado: "Envio pelo chat está desativado para esta clínica.",
  whatsapp_nao_conectado: "WhatsApp da clínica não está conectado.",
  telefone_invalido: "Telefone do lead é inválido.",
  texto_muito_longo: "Mensagem muito longa.",
  sem_telefone: "Este lead não tem telefone.",
  forbidden: "Você não tem acesso a esta clínica.",
  uazapi_error: "O WhatsApp recusou o envio. Tente de novo.",
  send_failed: "Falha de conexão ao enviar. Tente de novo.",
};

interface ChatComposerProps {
  // Vem do useChatMessages do mesmo lead exibido na conversa.
  onSend: (text: string) => Promise<{ ok: boolean; error?: string }>;
  disabled?: boolean;
  disabledReason?: string;
}

/**
 * Caixa de envio de mensagem do chat. Só aparece com a feature `feature_chat_send`
 * ligada na clínica (Gestão Organizacional). A mensagem enviada entra na conversa
 * pelo realtime — não há eco local, para a tela nunca mostrar algo que não foi entregue.
 */
export function ChatComposer({ onSend, disabled, disabledReason }: ChatComposerProps) {
  const { clinic } = useSettings();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Opt-in: ausente ou false = escondido.
  if (clinic?.features?.feature_chat_send !== true) return null;

  const enviar = async () => {
    const clean = text.trim();
    if (!clean || sending || disabled) return;
    setSending(true);
    setErro(null);
    const res = await onSend(clean);
    setSending(false);
    if (res.ok) {
      setText("");
      inputRef.current?.focus();
    } else {
      setErro(ERROS[res.error ?? ""] ?? "Não foi possível enviar a mensagem.");
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      enviar();
    }
  };

  return (
    <div className="border-t border-slate-100 bg-white px-4 py-3 shrink-0">
      {disabled && disabledReason && (
        <div className="flex items-center gap-1.5 mb-2 text-[11px] font-semibold text-rose-700">
          <PhoneOff className="w-3 h-3 shrink-0" />
          {disabledReason}
        </div>
      )}
      {erro && (
        <p className="mb-2 text-[11px] font-semibold text-rose-600">{erro}</p>
      )}
      <div className="flex items-end gap-2">
        <textarea
          ref={inputRef}
          rows={1}
          value={text}
          disabled={disabled || sending}
          onChange={e => {
            setText(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
          }}
          onKeyDown={onKeyDown}
          placeholder={disabled ? "Envio indisponível" : "Escreva uma mensagem…"}
          className="flex-1 resize-none text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-2xl px-3.5 py-2.5 max-h-[120px] placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-200 focus:border-teal-400 disabled:opacity-60 transition-all"
        />
        <button
          onClick={enviar}
          disabled={!text.trim() || sending || disabled}
          title="Enviar (Enter)"
          className={cn(
            "w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-all",
            text.trim() && !sending && !disabled
              ? "bg-teal-600 text-white hover:bg-teal-700 shadow"
              : "bg-slate-100 text-slate-300",
          )}
        >
          {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}
