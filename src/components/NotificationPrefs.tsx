import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { supabase } from '../lib/supabase';
import { cn } from '@/src/lib/utils';
import type { NotificationPrefs as Prefs, NotificationEventKey } from '../hooks/useSupabase';
import {
  BellRing, MessageSquareWarning, CalendarDays, CalendarCheck, CalendarClock,
  CalendarX, Receipt, PartyPopper, AlertTriangle, Clock, Users, Save,
  Loader2, CheckCircle2, Smartphone, Info,
} from 'lucide-react';

// UI de Configuração de Notificações (Configurações › Notificações, abaixo do Grupo).
// Escreve clinics.notification_prefs. Vazio = tudo ligado (default seguro do notify_ops).
// Espelha 1:1 as chaves lidas por notify_ops / process_sla_unanswered — não inventar chave nova.
//
// Decisões de UX (reescrita 19/07 — a 1ª versão era contraintuitiva):
// - Colunas Sino/Grupo com cabeçalho COLADO e alinhado às células (largura fixa única).
// - Sem grupo criado: a coluna Grupo vira "—" com um aviso único (antes eram 8 toggles
//   mortos sem explicação). Master desligado: a coluna respectiva esmaece.
// - Cargos: chip "Todos" explícito + seleção direta (clicar um cargo no modo Todos
//   seleciona SÓ ele). Desmarcar o último volta para "Todos" — visível, sem o efeito
//   surpresa de "nenhum marcado = todos veem". Cargos só aparecem com o sino ligado.

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

// Largura ÚNICA das colunas de toggle — cabeçalho e células usam a mesma, senão desalinha.
const COL = 'w-16 flex justify-center';

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
        disabled ? 'bg-slate-100 cursor-not-allowed opacity-60' : on ? 'bg-teal-500' : 'bg-slate-200 hover:bg-slate-300',
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

  const groupUsable = hasGroup && groupAll;

  // Escrita imutável.
  const setEventField = (ev: NotificationEventKey, field: 'sino' | 'grupo', value: boolean) =>
    setPrefs(p => ({ ...p, events: { ...p.events, [ev]: { ...p.events?.[ev], [field]: value } } }));

  // Chips de cargo: no modo "Todos" (roles=[]), clicar um cargo seleciona SÓ ele.
  // Desmarcar o último (ou marcar todos) volta ao "Todos" canônico (roles=[]).
  const toggleRole = (ev: NotificationEventKey, role: string) => setPrefs(p => {
    const current = p.events?.[ev]?.roles;
    const isAll = !current || current.length === 0;
    let arr: string[];
    if (isAll) {
      arr = [role];
    } else {
      const set = new Set<string>(current);
      if (set.has(role)) set.delete(role); else set.add(role);
      arr = ALL_ROLES.filter(r => set.has(r)) as unknown as string[];
      if (arr.length === 0 || arr.length === ALL_ROLES.length) arr = [];
    }
    return { ...p, events: { ...p.events, [ev]: { ...p.events?.[ev], roles: arr } } };
  });

  const setAllRoles = (ev: NotificationEventKey) => setPrefs(p => (
    { ...p, events: { ...p.events, [ev]: { ...p.events?.[ev], roles: [] } } }
  ));

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
          {/* Canais (interruptores gerais) */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex items-center justify-between gap-4 px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl">
              <div className="flex items-center gap-3 min-w-0">
                <Smartphone className="w-4 h-4 text-teal-500 shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs font-bold text-slate-700">Sino do app</p>
                  <p className="text-[11px] text-slate-400">{sinoAll ? 'Notificações in-app ligadas' : 'Desligado — nada aparece no sino'}</p>
                </div>
              </div>
              <Toggle on={sinoAll} onClick={() => setPrefs(p => ({ ...p, sino_all: !sinoAll }))} />
            </div>
            <div className={cn('flex items-center justify-between gap-4 px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl', !hasGroup && 'opacity-60')}>
              <div className="flex items-center gap-3 min-w-0">
                <Users className="w-4 h-4 text-teal-500 shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs font-bold text-slate-700">Grupo do WhatsApp</p>
                  <p className="text-[11px] text-slate-400">{hasGroup ? (groupAll ? 'Avisos no grupo ligados' : 'Desligado — nada vai ao grupo') : 'Sem grupo — crie no quadro acima'}</p>
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
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Por tipo de notificação</span>
            </div>
            <p className="text-[11px] text-slate-400 mb-3">
              Cada linha é um aviso: ligue/desligue por canal e escolha quais cargos o veem no sino.
            </p>

            {!hasGroup && (
              <div className="flex items-center gap-2 px-4 py-2.5 mb-3 bg-slate-50 border border-slate-200 rounded-xl">
                <Info className="w-4 h-4 text-slate-400 shrink-0" />
                <p className="text-[11px] text-slate-500">
                  A coluna <b>Grupo</b> fica disponível depois de criar o Grupo de Notificações (quadro acima).
                </p>
              </div>
            )}

            {/* Cabeçalho (desktop) — larguras IGUAIS às células, senão desalinha */}
            <div className="hidden md:flex items-center gap-x-4 px-4 pb-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              <span className="flex-1">Evento</span>
              <span className={cn(COL, 'items-center gap-1', !sinoAll && 'opacity-40')}>
                <Smartphone className="w-3 h-3" /> Sino
              </span>
              <span className={cn(COL, 'items-center gap-1', !groupUsable && 'opacity-40')}>
                <Users className="w-3 h-3" /> Grupo
              </span>
              <span className="w-[340px] text-left">Quem vê no sino</span>
            </div>

            <div className="space-y-2">
              {EVENTS.map(({ key, label, desc, Icon }) => {
                const roles = evRoles(key);
                const isAll = roles.length === 0;
                const sinoOn = evSino(key);
                return (
                  <div key={key} className="flex flex-col md:flex-row md:items-center gap-x-4 gap-y-3 px-4 py-3 bg-white border border-slate-100 rounded-xl">
                    {/* Evento */}
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <Icon className="w-4 h-4 text-slate-400 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-slate-700 truncate">{label}</p>
                        <p className="text-[11px] text-slate-400 truncate">{desc}</p>
                      </div>
                    </div>

                    {/* Sino */}
                    <div className={cn('flex items-center gap-2', 'md:w-16 md:justify-center')}>
                      <span className="md:hidden text-[11px] font-semibold text-slate-500 w-12">Sino</span>
                      <Toggle
                        on={sinoOn}
                        disabled={!sinoAll}
                        onClick={() => setEventField(key, 'sino', !sinoOn)}
                        title={sinoAll ? 'Notificar no sino do app' : 'O sino geral está desligado (acima)'}
                      />
                    </div>

                    {/* Grupo */}
                    <div className={cn('flex items-center gap-2', 'md:w-16 md:justify-center')}>
                      <span className="md:hidden text-[11px] font-semibold text-slate-500 w-12">Grupo</span>
                      {hasGroup ? (
                        <Toggle
                          on={evGrupo(key)}
                          disabled={!groupAll}
                          onClick={() => setEventField(key, 'grupo', !evGrupo(key))}
                          title={groupAll ? 'Enviar ao grupo do WhatsApp' : 'O grupo geral está desligado (acima)'}
                        />
                      ) : (
                        <span className="text-slate-300 font-bold" title="Crie o Grupo de Notificações no quadro acima">—</span>
                      )}
                    </div>

                    {/* Cargos (só fazem sentido com o sino do evento ligado) */}
                    <div className="md:w-[340px]">
                      {sinoOn && sinoAll ? (
                        <div className="flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            onClick={() => setAllRoles(key)}
                            className={cn(
                              'px-2.5 py-1 rounded-full text-[11px] font-bold border transition-all',
                              isAll
                                ? 'bg-teal-600 border-teal-600 text-white shadow-sm'
                                : 'bg-white border-slate-200 text-slate-400 hover:border-slate-300',
                            )}
                          >
                            Todos
                          </button>
                          {ALL_ROLES.map(role => {
                            const active = !isAll && roles.includes(role);
                            return (
                              <button
                                key={role}
                                type="button"
                                onClick={() => toggleRole(key, role)}
                                className={cn(
                                  'px-2.5 py-1 rounded-full text-[11px] font-bold border transition-all',
                                  active
                                    ? 'bg-teal-600 border-teal-600 text-white shadow-sm'
                                    : 'bg-white border-slate-200 text-slate-400 hover:border-slate-300',
                                )}
                              >
                                {ROLE_LABEL[role]}
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <span className="text-[11px] text-slate-300">— sino desligado</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
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
            {dirty && !saving && <span className="text-[11px] text-slate-400">Alterações não salvas</span>}
            {saved && <span className="text-sm font-bold text-emerald-600 flex items-center gap-1"><CheckCircle2 className="w-4 h-4" /> Salvo!</span>}
            {error && <span className="text-sm font-bold text-rose-600">Erro ao salvar</span>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
