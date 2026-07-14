import React, { useMemo, useState } from 'react';
import {
  AlertOctagon, AlertTriangle, Info, RefreshCw, CheckCircle2, ChevronDown,
  Activity, Loader2, ShieldCheck,
} from 'lucide-react';
import { useSystemErrors, SystemError } from '../hooks/useSupabase';
import { useClinics } from '../hooks/useSupabase';
import { cn } from '@/src/lib/utils';

// Central de Erros — a tela do super admin.
//
// Duas naturezas convivem aqui, e a distinção é o que mantém o painel confiável:
//   • CONDIÇÃO (is_monitor): vale AGORA. O cron reavalia a cada 5 min e resolve sozinha quando o
//     problema some. Não pode ser resolvida na mão — "resolver" um WhatsApp que continua caído
//     só esconderia o problema até a próxima rodada.
//   • EVENTO: aconteceu e passou (cron que falhou, edge que respondeu 500). Só um humano encerra.
//
// Tudo é agrupado por fingerprint: 500 erros iguais viram UMA linha com contador. Sem isso o painel
// vira enxurrada e ninguém olha — que é o mesmo que não ter monitoramento.

const LEVEL: Record<string, { label: string; icon: any; chip: string; dot: string; rank: number }> = {
  critical: { label: 'Crítico', icon: AlertOctagon,  chip: 'bg-rose-50 text-rose-700 border-rose-200',    dot: 'bg-rose-500',   rank: 0 },
  error:    { label: 'Erro',    icon: AlertTriangle, chip: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-500',  rank: 1 },
  warn:     { label: 'Aviso',   icon: Info,          chip: 'bg-slate-50 text-slate-600 border-slate-200', dot: 'bg-slate-400',  rank: 2 },
};

const SCOPE_LABEL: Record<string, string> = {
  monitor: 'Monitor',
  cron: 'Agendamento',
  edge: 'Função',
};

function quando(iso: string) {
  const d = new Date(iso);
  const min = Math.floor((Date.now() - d.getTime()) / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  return d.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

function Linha({ e, clinica, onResolver }: {
  e: SystemError;
  clinica?: string;
  onResolver: (id: string) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const meta = LEVEL[e.level] ?? LEVEL.warn;
  const Icon = meta.icon;

  return (
    <div className="border border-slate-100 rounded-xl bg-white overflow-hidden">
      <button
        onClick={() => setAberto(v => !v)}
        className="w-full flex items-start gap-3 p-3.5 text-left hover:bg-slate-50/70 transition-colors"
      >
        <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border', meta.chip)}>
          <Icon className="w-4 h-4" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold text-slate-900">{e.title}</span>
            {e.occurrences > 1 && (
              <span className="px-1.5 py-0.5 rounded-full bg-slate-900 text-white text-[10px] font-bold">
                {e.occurrences}×
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-400 flex-wrap">
            <span className="font-semibold text-slate-500">{SCOPE_LABEL[e.scope] ?? e.scope}</span>
            <span>·</span>
            <span className="font-mono">{e.code}</span>
            {clinica && (<><span>·</span><span>{clinica}</span></>)}
            <span>·</span>
            <span>{quando(e.last_seen_at)}</span>
            {e.is_monitor && (
              <span className="px-1.5 py-0.5 rounded-full border border-slate-200 text-slate-400 font-semibold">
                condição atual
              </span>
            )}
          </div>
        </div>

        <ChevronDown className={cn('w-4 h-4 text-slate-300 shrink-0 transition-transform', aberto && 'rotate-180')} />
      </button>

      {aberto && (
        <div className="px-3.5 pb-3.5 pt-0 space-y-3">
          {e.last_context && (
            <pre className="text-[11px] bg-slate-900 text-slate-100 rounded-lg p-3 overflow-x-auto">
              {JSON.stringify(e.last_context, null, 2)}
            </pre>
          )}

          <div className="flex items-center justify-between gap-3 text-[11px] text-slate-400">
            {/* Condição não tem "quantas vezes" — tem HÁ QUANTO TEMPO dura. O contador só faz
                sentido para evento ("51 welcome falharam"). */}
            <span>{e.is_monitor ? 'Dura desde' : 'Primeira vez'}: {quando(e.first_seen_at)}</span>

            {e.is_monitor ? (
              // Sem botão de propósito: quem resolve é o próprio monitor, quando a condição sumir.
              <span className="italic">Resolve sozinho quando o problema for corrigido.</span>
            ) : (
              <button
                onClick={() => onResolver(e.id)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-teal-50 text-teal-700 font-bold hover:bg-teal-100 transition-colors"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                Marcar como resolvido
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function ErrorCenter() {
  const { data, loading, setStatus, refetch } = useSystemErrors();
  const { data: clinics } = useClinics();
  const [verResolvidos, setVerResolvidos] = useState(false);

  const nomeClinica = useMemo(() => {
    const m = new Map<string, string>();
    clinics.forEach(c => m.set(c.id, c.name));
    return m;
  }, [clinics]);

  const abertos = data.filter(e => e.status !== 'resolved');
  const resolvidos = data.filter(e => e.status === 'resolved');
  const lista = verResolvidos ? resolvidos : abertos;

  const ordenada = useMemo(() => [...lista].sort((a, b) => {
    const r = (LEVEL[a.level]?.rank ?? 9) - (LEVEL[b.level]?.rank ?? 9);
    return r !== 0 ? r : new Date(b.last_seen_at).getTime() - new Date(a.last_seen_at).getTime();
  }), [lista]);

  const conta = (nivel: string) => abertos.filter(e => e.level === nivel).length;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <Loader2 className="w-7 h-7 text-teal-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Resumo */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Críticos',  value: conta('critical'), icon: AlertOctagon,  color: 'bg-rose-50 text-rose-600' },
          { label: 'Erros',     value: conta('error'),    icon: AlertTriangle, color: 'bg-amber-50 text-amber-600' },
          { label: 'Avisos',    value: conta('warn'),     icon: Info,          color: 'bg-slate-100 text-slate-500' },
          { label: 'Resolvidos', value: resolvidos.length, icon: CheckCircle2, color: 'bg-teal-50 text-teal-600' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 flex items-center gap-3">
            <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center shrink-0', s.color)}>
              <s.icon className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xl font-black text-slate-900 leading-none">{s.value}</p>
              <p className="text-[11px] text-slate-400 font-semibold mt-1">{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Barra */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
          <button
            onClick={() => setVerResolvidos(false)}
            className={cn('px-3 py-1.5 rounded-lg text-xs font-bold transition-all',
              !verResolvidos ? 'bg-white text-teal-700 shadow-sm' : 'text-slate-500 hover:text-slate-700')}
          >
            Abertos ({abertos.length})
          </button>
          <button
            onClick={() => setVerResolvidos(true)}
            className={cn('px-3 py-1.5 rounded-lg text-xs font-bold transition-all',
              verResolvidos ? 'bg-white text-teal-700 shadow-sm' : 'text-slate-500 hover:text-slate-700')}
          >
            Resolvidos ({resolvidos.length})
          </button>
        </div>

        <button
          onClick={() => refetch()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Atualizar
        </button>
      </div>

      {/* Lista */}
      {ordenada.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-10 text-center">
          <div className="w-12 h-12 rounded-2xl bg-teal-50 text-teal-600 flex items-center justify-center mx-auto mb-3">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <p className="text-sm font-bold text-slate-700">
            {verResolvidos ? 'Nada resolvido ainda.' : 'Nenhum problema aberto.'}
          </p>
          <p className="text-xs text-slate-400 mt-1">
            Os monitores rodam a cada 5 minutos.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {ordenada.map(e => (
            <Linha
              key={e.id}
              e={e}
              clinica={e.clinic_id ? nomeClinica.get(e.clinic_id) : undefined}
              onResolver={(id) => setStatus(id, 'resolved')}
            />
          ))}
        </div>
      )}

      <p className="flex items-center gap-1.5 text-[11px] text-slate-400 pt-1">
        <Activity className="w-3.5 h-3.5" />
        Erros iguais são agrupados e contados numa linha só. As <b className="font-semibold">condições</b> se
        resolvem sozinhas quando o problema é corrigido; os <b className="font-semibold">eventos</b> você encerra.
      </p>
    </div>
  );
}
