import React from "react";
import { ExternalLink } from "lucide-react";
import { cn } from "@/src/lib/utils";
import WhatsAppLogo from "../assets/logos/Logo Whatsapp.png";

/**
 * Atalho "abrir esta conversa no WhatsApp" pelo link oficial de click to chat (wa.me).
 *
 * ⚠️ É `wa.me` de PROPÓSITO, não `web.whatsapp.com/send`: quem escolhe onde abrir é o
 * WhatsApp, conforme a máquina de quem clicou (app de desktop instalado ou WhatsApp Web).
 * Fixar o destino no Web quebraria quem só usa o aplicativo. O preço é a tela intermediária
 * com o botão "Conversar", e isso é esperado.
 *
 * O envio dali NÃO passa pelo Emissor (sem fila, sem retry, sem gate de número inválido).
 * A conversa continua aparecendo no painel porque a `wa-inbound` grava também o que sai
 * (webhook `fromMe`), desde que a sessão aberta seja o número da clínica.
 */

/**
 * Endereço do contato para o link. A base guarda o número como a uazapi entrega
 * (o grosso é 12 dígitos: 55 + DDD + 8, celular BR sem o 9º), e é exatamente esse
 * endereço que o WhatsApp reconhece — não "corrigir" acrescentando o 9.
 *
 * A régua de DDI é por TAMANHO, igual à do banco: 10/11 dígitos = Brasil sem DDI.
 * Testar `startsWith('55')` quebraria o DDD 55 (Santa Maria/RS), que é número BR sem DDI.
 */
export function waDigits(phone?: string | null): string | null {
  const d = (phone || "").replace(/\D/g, "");
  if (d.length < 10) return null; // sem DDD não dá para abrir conversa nenhuma
  if (d.length === 10 || d.length === 11) return `55${d}`;
  return d;
}

interface AbrirNoWhatsAppProps {
  phone?: string | null;
  /** `leads.whatsapp_invalid`: o número já falhou a checagem de WhatsApp. */
  invalid?: boolean | null;
  /** Só o ícone, para header apertado. */
  compact?: boolean;
  className?: string;
}

export function AbrirNoWhatsApp({ phone, invalid, compact, className }: AbrirNoWhatsAppProps) {
  const digits = waDigits(phone);
  if (!digits) return null;

  return (
    <a
      href={`https://wa.me/${digits}`}
      target="_blank"
      rel="noopener noreferrer"
      // O botão vive dentro de card/linha clicável (Kanban, lista de Conversas): sem isto,
      // clicar aqui também dispararia a ação do pai.
      onClick={e => e.stopPropagation()}
      title={invalid
        ? "Abrir no WhatsApp. Atenção: este número já falhou a checagem de WhatsApp, a conversa pode não existir."
        : "Abrir esta conversa no WhatsApp (app de desktop ou WhatsApp Web, conforme sua máquina)"}
      className={cn(
        "flex items-center gap-1 px-2 py-0.5 rounded-lg border transition-all shrink-0",
        "text-[10px] font-bold border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100",
        invalid && "border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100",
        className
      )}
    >
      <img src={WhatsAppLogo} alt="" className={cn("w-3 h-3 shrink-0", invalid && "grayscale opacity-60")} />
      {!compact && <span>Abrir no WhatsApp</span>}
      <ExternalLink className="w-2.5 h-2.5 shrink-0 opacity-70" />
    </a>
  );
}
