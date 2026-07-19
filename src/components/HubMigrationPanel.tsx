import { useEffect, useState, useCallback } from 'react';
import { Loader2, RefreshCw, ArrowRight, Undo2, Wifi, WifiOff, Bot } from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { supabase } from '../lib/supabase';
import { useToast } from './ui/toast';

// Super Admin › Configurações › Migração Hub.
// Migra a ROTA de ingestão ('messages') de cada clínica entre o n8n (Receptor) e o
// hub nativo (wa-inbound), com troca de webhook AO VIVO. Backend: action 'migrate' do
// whatsapp-orchestrator (super-admin only) + RPC get_hub_migration_status.

type Row = {
  clinic_id: string;
  name: string;
  category: string | null;
  route: 'hub' | 'n8n';
  status: string;
  ia: boolean;
  has_token: boolean;
  msgs_7d: number;
};

export function HubMigrationPanel() {
  const showToast = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc('get_hub_migration_status');
    if (error) { showToast('Falha ao carregar: ' + error.message, 'error'); setLoading(false); return; }
    setRows((data as Row[]) || []);
    setLoading(false);
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  const migrate = async (r: Row, route: 'hub' | 'n8n') => {
    const verb = route === 'hub' ? 'migrar para o HUB (wa-inbound)' : 'voltar para o n8n (Receptor)';
    if (!window.confirm(`Confirmar: ${verb}\n\nClínica: ${r.name}\n\nIsso troca a rota de recebimento das mensagens em PRODUÇÃO (reversível).`)) return;
    setBusy(r.clinic_id);
    try {
      const { data, error } = await supabase.functions.invoke('whatsapp-orchestrator', {
        body: { action: 'migrate', clinic_id: r.clinic_id, route },
      });
      const ok = !error && (data as any)?.success === true;
      if (!ok) {
        showToast('Erro: ' + (error?.message || (data as any)?.error || 'falhou'), 'error');
      } else {
        const live = (data as any)?.applied_live;
        showToast(`${r.name}: rota → ${route.toUpperCase()}${live ? ' · webhook aplicado' : ' · aplica na próxima conexão'}`, 'success');
        await load();
      }
    } catch (e: any) {
      showToast('Erro: ' + (e?.message || 'falhou'), 'error');
    } finally {
      setBusy(null);
    }
  };

  // n8n primeiro (os que faltam migrar), depois por volume desc.
  const sorted = [...rows].sort((a, b) => {
    if (a.route !== b.route) return a.route === 'n8n' ? -1 : 1;
    return b.msgs_7d - a.msgs_7d;
  });
  const hubCount = rows.filter(r => r.route === 'hub').length;
  const n8nCount = rows.length - hubCount;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-lg font-bold text-slate-800">Migração para o Hub</h3>
          <p className="text-xs text-slate-500 mt-0.5">Rota de recebimento das mensagens: n8n (Receptor) ↔ hub nativo (wa-inbound). Reversível.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-xs font-bold">
            <span className="px-2.5 py-1 rounded-full bg-teal-50 text-teal-700 border border-teal-200">{hubCount} no hub</span>
            <span className="px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200">{n8nCount} no n8n</span>
          </div>
          <button onClick={load} disabled={loading}
            className="p-2 rounded-lg text-slate-400 hover:text-teal-600 hover:bg-teal-50 transition-all disabled:opacity-50" title="Atualizar">
            <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-slate-400"><Loader2 className="w-5 h-5 animate-spin" /></div>
      ) : (
        <div className="border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50/70 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                <th className="text-left px-4 py-2.5">Clínica</th>
                <th className="text-center px-2 py-2.5">Conexão</th>
                <th className="text-right px-2 py-2.5">Msgs 7d</th>
                <th className="text-center px-2 py-2.5">Rota</th>
                <th className="text-right px-4 py-2.5">Ação</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(r => {
                const connected = r.status === 'connected';
                const isBusy = busy === r.clinic_id;
                return (
                  <tr key={r.clinic_id} className="border-t border-slate-100 hover:bg-slate-50/50">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-semibold text-slate-700 truncate">{r.name}</span>
                        {r.ia && <span className="shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-violet-50 text-violet-600 border border-violet-200 text-[9px] font-bold"><Bot className="w-2.5 h-2.5" /> IA</span>}
                        {r.category === 'outro' && <span className="shrink-0 px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 text-[9px] font-bold">não-clínica</span>}
                      </div>
                    </td>
                    <td className="px-2 py-2.5">
                      <div className="flex items-center justify-center">
                        {connected
                          ? <span title="Conectado" className="inline-flex items-center gap-1 text-emerald-600 text-[10px] font-bold"><Wifi className="w-3.5 h-3.5" /></span>
                          : <span title="Desconectado" className="inline-flex items-center gap-1 text-slate-300 text-[10px] font-bold"><WifiOff className="w-3.5 h-3.5" /></span>}
                      </div>
                    </td>
                    <td className="px-2 py-2.5 text-right tabular-nums text-slate-500">{r.msgs_7d.toLocaleString('pt-BR')}</td>
                    <td className="px-2 py-2.5 text-center">
                      <span className={cn('inline-block px-2 py-0.5 rounded-full text-[10px] font-bold border',
                        r.route === 'hub' ? 'bg-teal-50 text-teal-700 border-teal-200' : 'bg-amber-50 text-amber-700 border-amber-200')}>
                        {r.route === 'hub' ? 'HUB' : 'n8n'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {r.route === 'n8n' ? (
                        <button onClick={() => migrate(r, 'hub')} disabled={isBusy}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold transition-all active:scale-[0.98] disabled:opacity-50">
                          {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowRight className="w-3.5 h-3.5" />} Migrar
                        </button>
                      ) : (
                        <button onClick={() => migrate(r, 'n8n')} disabled={isBusy}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white hover:bg-slate-50 text-slate-500 border border-slate-200 text-xs font-bold transition-all active:scale-[0.98] disabled:opacity-50">
                          {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Undo2 className="w-3.5 h-3.5" />} Reverter
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[11px] text-slate-400">
        Conectada: o webhook é trocado na hora. Desconectada: só a rota muda; o webhook aplica na próxima conexão (o orchestrator apaga o webhook antigo, sem dupla entrega).
      </p>
    </div>
  );
}
