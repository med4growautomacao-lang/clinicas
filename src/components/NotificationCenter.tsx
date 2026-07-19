import { useEffect, useRef, useState } from 'react';
import { Bell, CheckCheck, CalendarDays, Receipt, AlertTriangle, MessageSquareWarning, Dot } from 'lucide-react';
import { useNotifications, OpsNotification } from '../hooks/useSupabase';

// Sino de notificações no rodapé da Sidebar. Espelho in-app do grupo do WhatsApp
// (mesma fonte: notify_ops). Clique num item leva à tela relevante (deep-link v1 por evento).

function timeAgo(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'agora';
  const m = Math.floor(s / 60);
  if (m < 60) return `há ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'ontem' : `há ${d} dias`;
}

function eventIcon(event: string) {
  if (event === 'agendamento') return CalendarDays;
  if (event === 'comprovante') return Receipt;
  if (event === 'nao_atendido') return AlertTriangle;
  if (event === 'handoff') return MessageSquareWarning;
  return Bell;
}

const LEVEL_DOT: Record<string, string> = {
  warning: 'text-amber-500',
  success: 'text-emerald-500',
  info: 'text-teal-600',
};

// Mapa evento -> aba de destino (deep-link v1). Conversas vivem em "Comercial".
function tabForEvent(event: string): string {
  if (event === 'agendamento') return 'appointments';
  return 'ai-secretary';
}

export function NotificationCenter() {
  const { data, unreadCount, markAllRead, markRead } = useNotifications();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const handleClick = (n: OpsNotification) => {
    if (!n.read_at) markRead(n.id);
    setOpen(false);
    const tab = tabForEvent(n.event);
    // Deep-link: abre a conversa do lead específico (ChatsView consome open_lead_id).
    if (n.lead_id && tab === 'ai-secretary') sessionStorage.setItem('open_lead_id', n.lead_id);
    window.dispatchEvent(new CustomEvent('app-navigate', { detail: { tab } }));
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="relative p-1.5 text-slate-400 hover:text-teal-600 hover:bg-teal-50 rounded-lg transition-all"
        title="Notificações"
        aria-label="Notificações"
      >
        <Bell className="w-4 h-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[15px] h-[15px] px-1 rounded-full bg-rose-500 text-white text-[9px] font-bold flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed bottom-20 left-4 w-80 max-w-[calc(100vw-2rem)] max-h-[26rem] bg-white border border-slate-200 rounded-xl shadow-2xl z-[60] flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100 bg-slate-50/60">
            <span className="text-xs font-bold text-slate-800">Notificações</span>
            {unreadCount > 0 && (
              <button
                onClick={() => markAllRead()}
                className="flex items-center gap-1 text-[10px] font-semibold text-teal-600 hover:text-teal-700"
              >
                <CheckCheck className="w-3 h-3" /> Marcar todas como lidas
              </button>
            )}
          </div>

          <div className="overflow-y-auto">
            {data.length === 0 ? (
              <div className="px-4 py-8 text-center text-[11px] text-slate-400">
                Nenhuma notificação por aqui.
              </div>
            ) : (
              data.map(n => {
                const Icon = eventIcon(n.event);
                const unread = !n.read_at;
                return (
                  <button
                    key={n.id}
                    onClick={() => handleClick(n)}
                    className={`w-full text-left flex gap-2.5 px-4 py-2.5 border-b border-slate-50 hover:bg-slate-50 transition-colors ${unread ? 'bg-teal-50/40' : ''}`}
                  >
                    <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${LEVEL_DOT[n.level] || 'text-slate-400'}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1">
                        <span className="text-[11px] font-bold text-slate-800 truncate flex-1">{n.title}</span>
                        {unread && <Dot className="w-4 h-4 text-rose-500 shrink-0 -mr-1" />}
                      </div>
                      {n.body && <p className="text-[10px] text-slate-500 mt-0.5 line-clamp-2">{n.body}</p>}
                      <span className="text-[9px] text-slate-400">{timeAgo(n.created_at)}</span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
