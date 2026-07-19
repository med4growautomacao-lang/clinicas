import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { supabase } from '../lib/supabase';
import { cn } from '@/src/lib/utils';
import type { NotificationPrefs as Prefs, NotificationEventKey } from '../hooks/useSupabase';
import {
  BellRing, MessageSquareWarning, CalendarDays, CalendarCheck, CalendarClock,
  CalendarX, Receipt, PartyPopper, AlertTriangle, Clock, Users, Save,
  Loader2, CheckCircle2, Smartphone,
} from 'lucide-react';

// UI de Configuração de Notificações (Configurações › Integrações › WhatsApp, abaixo do Grupo).
// Escreve clinics.notification_prefs. Vazio = tudo ligado (default seguro do notify_ops).
// Espelha 1:1 as chaves lidas por notify_ops / process_sla_unanswered — não inventar chave nova.

const ALL_ROLES = ['gestor', 'secretaria', 'vendedor', 'medico'] as const;
const ROLE_LABEL: Record<string, string> = {
  gestor: 'Gestor', secretaria: 'Secretária', vendedor: 'Vendedor', medico: 'Médico',
};

const EVENTS: { key: NotificationEventKey; label: string; desc: string; Icon: typeof CalendarDays }[] = [
  { key: 'handoff',          label: 'Transbordo',              desc: 'IA pede ajuda humana',        Icon: MessageSquareWarning },
  { key: 'agendamento_novo', label: 'Novo agendamento',        desc: 'Consulta marcada pela IA',    Icon: CalendarDays },
  { key: 'confirmacao',      label: 'Consulta confirmada',     desc: 'Paciente confirmou',          Icon: CalendarCheck },
  { key: 'remarcacao',       label: 'Remarcação',              desc: 'Paciente pediu remarcar',     Icon: CalendarClock },
  { key: 'cancelamento',     label: 'Cancelamento',            desc: 'Consulta cancelada',          Icon: CalendarX },
  { key: 'comprovante',      label: 'Comprovante de pagamento', desc: 'Paciente enviou comprovante', Icon: Receipt },
  { key: 'venda',            label: 'Venda realizada',         desc: 'Ticket ganho',                Icon: PartyPopper },
  { key: 'nao_atendido',     label: 'Lead não atendido (SLA)', desc: 'Ninguém respondeu no prazo',  Icon: AlertTriangle },
];

function Toggle({ on, onClick, disabled, title }: { on: boolean; onClick: () => void; disabled?: boolean; title?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors outline-none focus:ring-4 focus:ring-teal-100',
        disabled ? 'bg-slate-100 cursor-not-allowed' : on ? 'bg-teal-500' : 'bg-slate-200 hover:bg-slate-300',
      )}
    >
      <span className={cn('inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform', on ? 'translate-x-5' : 'translate-x-0.5')} />
    </button>
  );
}

export function NotificationPrefs({ clinicId, hasGroup, initialPrefs, onSaved }: {
  clinicId: string;
  hasGroup: boolean;
  initialPrefs?: Prefs | null;
  onSaved?: () => void;
}) {
  const [prefs, setPrefs] = useState<Prefs>(initialPrefs || {});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => { setPrefs(initialPrefs || {}); }, [initialPrefs]);

  const baseline = useMemo(() => JSON.stringify(initialPrefs || {}), [initialPrefs]);
  const dirty = JSON.stringify(prefs) !== baseline;

  // Leitura com defaults (vazio = ligado).
  const groupAll = prefs.group_all ?? true;
  const sinoAll = prefs.sino_all ?? true;
  const slaEnabled = prefs.sla?.enabled ?? hasGroup;
  const slaMinutes = prefs.sla?.minutes ?? 15;
  const evSino = (ev: NotificationEventKey) => prefs.events?.[ev]?.sino ?? true;
  const evGrupo = (ev: NotificationEventKey) => prefs.events?.[ev]?.grupo ?? true;
  const evRoles = (ev: NotificationEventKey) => prefs.events?.[ev]?.roles ?? [];

  // Escrita imutável.
  const setEventField = (ev: NotificationEventKey, field: 'sino' | 'grupo', value: boolean) =>
    setPrefs(p => ({ ...p, events: { ...p.events, [ev]: { ...p.events?.[ev], [field]: value } } }));

  const toggleRole = (ev: NotificationEventKey, role: string) => setPrefs(p => {
    const current = p.events?.[ev]?.roles;
    const isAll = !current || current.length === 0;
    const set = new Set<string>(isAll ? ALL_ROLES : current);
    if (set.has(role)) set.delete(role); else set.add(role);
    let arr = ALL_ROLES.filter(r => set.has(r)) as unknown as string[];
    // Extremos (nenhum ou todos) = "todos" canônico (roles vazio → visível a todos os cargos).
    if (arr.length === 0 || arr.length === ALL_ROLES.length) arr = [];
    return { ...p, events: { ...p.events, [ev]: { ...p.events?.[ev], roles: arr } } };
  });

  const save = async () => {
    setSaving(true); setSaved(false); setError(false);
    // Merge sobre o que veio do banco — nunca reconstruir o JSONB do zero (preserva chaves futuras).
    const payload: Prefs = { ...(initialPrefs || {}), ...prefs };
    const { error: err } = await supabase.from('clinics').update({ notification_prefs: payload }).eq('id', clinicId);
    setSaving(false);
    if (err) { setError(true); return; }
    setSaved(true);
    onSaved?.();
    setTimeout(() => setSaved(false), 2500);
  };

  return (
    <div className="space-y-6">
      <Card className="border border-emerald-200 shadow-sm bg-white overflow-hidden">
        <CardHeader className="bg-emerald-100 border-b border-emerald-200 pb-6 px-8">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center shadow-sm border border-emerald-200">
              <BellRing className="w-6 h-6 text-emerald-600" />
            </div>
            <div>
              <CardTitle className="text-xl font-bold text-slate-800">Configuração de Notificações</CardTitle>
              <p className="text-xs text-slate-500 mt-1">Escolha o que avisa e para quem — no sino do app e no grupo do WhatsApp.</p>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-8 space-y-8">
          {/* Interruptores gerais */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex items-center justify-between gap-4 px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl">
              <div className="flex items-center gap-3 min-w-0">
                <Smartphone className="w-4 h-4 text-teal-500 shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs font-bold text-slate-700">Sino do app</p>
                  <p className="text-[11px] text-slate-400">Todas as notificações in-app</p>
                </div>
              </div>
              <Toggle on={sinoAll} onClick={() => setPrefs(p => ({ ...p, sino_all: !sinoAll }))} />
            </div>
            <div className={cn('flex items-center justify-between gap-4 px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl', !hasGroup && 'opacity-60')}>
              <div className="flex items-center gap-3 min-w-0">
                <Users className="w-4 h-4 text-teal-500 shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs font-bold text-slate-700">Grupo do WhatsApp</p>
                  <p className="text-[11px] text-slate-400">{hasGroup ? 'Todas as notificações no grupo' : 'Crie o grupo acima primeiro'}</p>
                </div>
              </div>
              <Toggle on={groupAll} disabled={!hasGroup} onClick={() => setPrefs(p => ({ ...p, group_all: !groupAll }))} />
            </div>
          </div>

          {/* SLA — lead não atendido */}
          <div className="px-5 py-4 bg-amber-50/60 border border-amber-100 rounded-2xl space-y-3">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs font-bold text-slate-700">Alertar lead não respondido</p>
                  <p className="text-[11px] text-slate-500">Respeita o horário de funcionamento da clínica (expediente dos profissionais).</p>
                </div>
              </div>
              <Toggle on={slaEnabled} onClick={() => setPrefs(p => ({ ...p, sla: { ...p.sla, enabled: !slaEnabled } }))} />
            </div>
            {slaEnabled && (
              <div className="flex items-center gap-2 pl-7">
                <Clock className="w-3.5 h-3.5 text-slate-400" />
                <span className="text-[11px] text-slate-500">Avisar após</span>
                <input
                  type="number" min={1} max={240} value={slaMinutes}
                  onChange={e => {
                    const n = Math.max(1, Math.min(240, parseInt(e.target.value || '15', 10) || 15));
                    setPrefs(p => ({ ...p, sla: { ...p.sla, minutes: n } }));
                  }}
                  className="w-16 px-2 py-1 border border-slate-200 rounded-lg text-sm font-bold text-slate-700 text-center focus:ring-2 focus:ring-amber-100 focus:border-amber-300 outline-none"
                />
                <span className="text-[11px] text-slate-500">min sem resposta</span>
              </div>
            )}
          </div>

          {/* Matriz por evento */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Por tipo de notificação</span>
            </div>
            {/* Cabeçalho (desktop) */}
            <div className="hidden md:grid grid-cols-[1fr_auto_auto_auto] gap-x-6 px-4 pb-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              <span>Evento</span>
              <span className="text-center w-10">Sino</span>
              <span className="text-center w-10">Grupo</span>
              <span className="text-right">Cargos que veem no sino</span>
            </div>
            <div className="space-y-2">
              {EVENTS.map(({ key, label, desc, Icon }) => {
                const roles = evRoles(key);
                const isAll = roles.length === 0;
                return (
                  <div key={key} className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto_auto] gap-x-6 gap-y-3 items-center px-4 py-3 bg-white border border-slate-100 rounded-xl">
                    <div className="flex items-center gap-3 min-w-0">
                      <Icon className="w-4 h-4 text-slate-400 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-slate-700 truncate">{label}</p>
                        <p className="text-[11px] text-slate-400 truncate">{desc}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 md:block md:w-10 md:text-center">
                      <span className="md:hidden text-[11px] font-semibold text-slate-500 w-12">Sino</span>
                      <Toggle on={evSino(key)} onClick={() => setEventField(key, 'sino', !evSino(key))} title="Notificar no sino do app" />
                    </div>
                    <div className="flex items-center gap-2 md:block md:w-10 md:text-center">
                      <span className="md:hidden text-[11px] font-semibold text-slate-500 w-12">Grupo</span>
                      <Toggle on={evGrupo(key)} disabled={!hasGroup} onClick={() => setEventField(key, 'grupo', !evGrupo(key))} title="Enviar ao grupo do WhatsApp" />
                    </div>
                    <div className="flex flex-wrap gap-1.5 md:justify-end">
                      {ALL_ROLES.map(role => {
                        const active = isAll || roles.includes(role);
                        return (
                          <button
                            key={role}
                            type="button"
                            onClick={() => toggleRole(key, role)}
                            className={cn(
                              'px-2.5 py-1 rounded-full text-[11px] font-bold border transition-all',
                              active
                                ? 'bg-teal-50 border-teal-200 text-teal-700'
                                : 'bg-white border-slate-200 text-slate-400 hover:border-slate-300',
                            )}
                          >
                            {ROLE_LABEL[role]}
                          </button>
                        );
                      })}
                      {isAll && <span className="self-center text-[10px] text-slate-400 ml-1">todos</span>}
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="text-[11px] text-slate-400 mt-3">
              Selecione cargos para restringir quem vê no sino. Todos marcados (ou nenhum) = visível para todos.
            </p>
          </div>

          {/* Salvar */}
          <div className="flex items-center gap-4 pt-2 border-t border-slate-100">
            <Button
              onClick={save}
              disabled={saving || !dirty}
              className="bg-gradient-to-r from-teal-600 to-teal-500 hover:from-teal-700 hover:to-teal-600 text-white gap-2 h-11 px-8 font-bold shadow-lg shadow-teal-500/20 transition-all active:scale-[0.98] disabled:opacity-50 rounded-xl"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {saving ? 'Salvando...' : 'Salvar preferências'}
            </Button>
            {saved && <span className="text-sm font-bold text-emerald-600 flex items-center gap-1"><CheckCircle2 className="w-4 h-4" /> Salvo!</span>}
            {error && <span className="text-sm font-bold text-rose-600">Erro ao salvar</span>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
