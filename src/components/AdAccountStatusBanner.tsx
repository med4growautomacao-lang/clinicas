import { Megaphone } from 'lucide-react';
import { useAdAccountStatus } from '../hooks/useAdAccountStatus';

interface Props {
  onFix: (platform: 'meta' | 'google') => void;
  userRole?: string;
}

// Faixa de aviso global quando a conta de anúncios (Meta e/ou Google) da clínica ativa está
// INATIVA — token/permissão quebrada, o investimento não sincroniza. Mesmo molde do
// WhatsAppStatusBanner. Oculto para médicos (não operam anúncios).
export function AdAccountStatusBanner({ onFix, userRole }: Props) {
  const { meta, google, loading } = useAdAccountStatus();

  if (loading) return null;
  if (userRole === 'medico') return null;

  const metaBad = meta === 'inactive';
  const googleBad = google === 'inactive';
  if (!metaBad && !googleBad) return null;

  const quais = metaBad && googleBad ? 'do Meta e do Google' : metaBad ? 'do Meta' : 'do Google';
  const primeira: 'meta' | 'google' = metaBad ? 'meta' : 'google';

  return (
    <div className="bg-gradient-to-r from-rose-50 via-red-50 to-rose-50 border-b border-rose-200/80 shadow-sm">
      <div className="w-full px-8 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-full bg-rose-100 flex items-center justify-center shrink-0">
            <Megaphone className="w-4 h-4 text-rose-700" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-rose-900 truncate">Conta de anúncios {quais} inativa</p>
            <p className="text-xs text-rose-700 truncate">
              O token de acesso expirou ou perdeu permissão — o investimento não está sincronizando. Reconecte para voltar a acompanhar o gasto.
            </p>
          </div>
        </div>
        <button
          onClick={() => onFix(primeira)}
          className="bg-rose-600 hover:bg-rose-700 active:scale-[0.98] text-white text-xs font-bold px-4 py-2 rounded-lg shadow-sm shadow-rose-600/20 transition-all shrink-0"
        >
          Corrigir
        </button>
      </div>
    </div>
  );
}
