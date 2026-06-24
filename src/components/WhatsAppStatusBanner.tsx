import { WifiOff } from 'lucide-react';
import { useWhatsappStatus } from '../hooks/useWhatsappStatus';

interface Props {
  onReconnect: () => void;
  userRole?: string;
}

// Faixa de aviso global quando a instancia WhatsApp da clinica ativa esta
// desconectada. Aparece em todas as telas autenticadas, exceto para roles
// que nao operam WhatsApp (medicos).
export function WhatsAppStatusBanner({ onReconnect, userRole }: Props) {
  const { status, loading } = useWhatsappStatus();

  if (loading) return null;
  if (status !== 'disconnected') return null;
  if (userRole === 'medico') return null;

  return (
    <div className="bg-gradient-to-r from-amber-50 via-orange-50 to-amber-50 border-b border-amber-200/80 shadow-sm">
      <div className="w-full px-8 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
            <WifiOff className="w-4 h-4 text-amber-700" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-amber-900 truncate">WhatsApp desconectado</p>
            <p className="text-xs text-amber-700 truncate">
              Sua clínica não está enviando nem recebendo mensagens. Reconecte para retomar o atendimento.
            </p>
          </div>
        </div>
        <button
          onClick={onReconnect}
          className="bg-amber-600 hover:bg-amber-700 active:scale-[0.98] text-white text-xs font-bold px-4 py-2 rounded-lg shadow-sm shadow-amber-600/20 transition-all shrink-0"
        >
          Reconectar
        </button>
      </div>
    </div>
  );
}
