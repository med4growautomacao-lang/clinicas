import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { useToast } from './ui/toast';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Loader2, RefreshCw, UserX, MessageCircle, Stethoscope, HeartCrack,
  Bot, Bell, Check, MessagesSquare, X, ArrowRight, ArrowLeft, Sparkles, PartyPopper, CalendarCheck, History, Lock,
} from 'lucide-react';
import { cn } from '@/src/lib/utils';

interface PendingLead {
  ticket_id: string;
  lead_id: string;
  name: string;
  phone: string | null;
  avatar_url: string | null;
  last_appt: string | null;   // data do último atendimento (agenda)
  last_appt_time: string | null; // hora do último atendimento (agenda)
  next_appt: string | null;   // data do próximo agendamento (agenda)
  next_appt_time: string | null; // hora do próximo agendamento (agenda)
  is_scheduled: boolean;      // já tem consulta na agenda (paciente agendado) → não mexe no ticket
}

type Category = 'contato_geral' | 'lead_potencial' | 'lead_perdido' | 'paciente';

// Card em tamanho de DESIGN fixo. A responsividade vem de escalar o palco inteiro (card + posições
// do Cover Flow) por um único transform: scale — assim tudo encolhe na MESMA proporção.
const CARD_SIZE: React.CSSProperties = { width: 380, height: 580 };

// ─────────────────────────────────────────────────────────────────────────────
// Conversa — painel GRANDE centralizado (não preso no card)
// ─────────────────────────────────────────────────────────────────────────────
function ChatViewer({ leadId, name, onClose }: { leadId: string; name: string; onClose: () => void }) {
  const [msgs, setMsgs] = useState<{ id: string; dir: string; content: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const { data } = await supabase.from('chat_messages').select('id, direction, message, created_at')
        .eq('lead_id', leadId).order('created_at', { ascending: true }).limit(500);
      if (!alive) return;
      setMsgs((data || []).map((m: any) => ({ id: m.id, dir: m.direction, content: m.message?.content ?? '' })));
      setLoading(false);
      setTimeout(() => endRef.current?.scrollIntoView(), 60);
    })();
    return () => { alive = false; };
  }, [leadId]);

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4" onClick={onClose}>
      <motion.div onClick={e => e.stopPropagation()}
        initial={{ y: 30, opacity: 0, scale: 0.98 }} animate={{ y: 0, opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        className="relative w-[460px] max-w-[94vw] h-[86%] max-h-[760px] bg-white rounded-3xl shadow-2xl flex flex-col overflow-hidden">
        <div className="pointer-events-none absolute inset-0 z-40 rounded-3xl ring-2 ring-inset ring-teal-600/25" />
        <div className="pointer-events-none absolute top-0 inset-x-0 h-[3px] z-40 bg-gradient-to-r from-transparent via-teal-300 to-transparent" />
        <div className="flex items-center justify-between px-5 py-3.5 bg-teal-600 text-white shrink-0">
          <span className="text-sm font-bold flex items-center gap-2 min-w-0">
            <MessagesSquare className="w-4 h-4 shrink-0" /> <span className="truncate">{name || 'Conversa'}</span>
          </span>
          <button onClick={onClose} className="flex items-center gap-1.5 pl-3 pr-3.5 py-1.5 rounded-full bg-white/20 hover:bg-white/30 text-white text-sm font-bold transition-all shrink-0">
            <X className="w-4 h-4" /> Fechar
          </button>
        </div>
        <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-1.5 bg-slate-50">
          {loading ? (
            <div className="flex items-center justify-center h-full text-slate-400"><Loader2 className="w-5 h-5 animate-spin" /></div>
          ) : msgs.length === 0 ? (
            <div className="flex items-center justify-center h-full text-slate-400 text-sm">Sem mensagens importadas.</div>
          ) : msgs.map(m => (
            <div key={m.id} className={cn('flex', m.dir === 'inbound' ? 'justify-start' : 'justify-end')}>
              <div className={cn('max-w-[78%] px-3 py-2 rounded-2xl text-sm leading-snug whitespace-pre-wrap break-words',
                m.dir === 'inbound' ? 'bg-white border border-slate-200 text-slate-700 rounded-tl-sm' : 'bg-teal-600 text-white rounded-tr-sm')}>
                {m.content || <span className="italic opacity-60">(mídia)</span>}
              </div>
            </div>
          ))}
          <div ref={endRef} />
        </div>
        <button onClick={onClose} className="shrink-0 py-3.5 bg-slate-800 hover:bg-slate-900 text-white font-bold text-sm transition-all">
          Fechar conversa
        </button>
      </motion.div>
    </div>
  );
}

// Fundo do card: foto grande (LoL) ou gradiente com iniciais.
function CardBackdrop({ lead }: { lead: PendingLead }) {
  const initials = (lead.name || 'L').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  return (
    <>
      {lead.avatar_url ? (
        <img src={lead.avatar_url} alt="" className="absolute inset-0 w-full h-full object-cover scale-110" />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-teal-700 via-teal-800 to-slate-900 flex items-start justify-center pt-16">
          <span className="text-[7rem] font-black text-white/15 select-none">{initials}</span>
        </div>
      )}
      <div className="absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-slate-950/40 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-[72%] bg-gradient-to-t from-slate-950 via-slate-950/85 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-[38%] bg-slate-950/55" />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Card ativo — auditoria
// ─────────────────────────────────────────────────────────────────────────────
function ActiveAuditCard({ lead, onApplied, onOpenChat }: { lead: PendingLead; onApplied: () => void; onOpenChat: () => void }) {
  const showToast = useToast();
  const hasAppt = !!(lead.last_appt || lead.next_appt);
  const isExisting = lead.is_scheduled; // já é cliente (agendado OU venda ganha) → confirma sem mexer no ticket
  const [patientMode, setPatientMode] = useState(isExisting || hasAppt);
  const [lastDate, setLastDate] = useState(lead.last_appt || '');
  const [resolvePast, setResolvePast] = useState(true);
  const [nextDate, setNextDate] = useState(lead.next_appt || '');
  const [nextTime, setNextTime] = useState((lead.next_appt_time || '').slice(0, 5)); // HH:MM da agenda
  // Agendado (tem consulta na agenda): IA e follow-up ambos OFF por padrão (não assumir a conversa
  // nem re-enviar confirmação/lembrete). Contato novo: ambos ON.
  const [ai, setAi] = useState(!lead.is_scheduled);
  const [followup, setFollowup] = useState(!lead.is_scheduled);
  // Cadeado "Atendimento pessoal" (ex.: paciente que a dra atende no próprio WhatsApp):
  // IA/follow-up nunca assumem e nada religa sozinho (blindado no banco).
  const [humanOnly, setHumanOnly] = useState(false);
  const toggleLock = () => setHumanOnly(v => { const nv = !v; if (nv) { setAi(false); setFollowup(false); } return nv; });
  const guardAi = (fn: (v: boolean) => boolean) => { if (!humanOnly) setAi(fn); };
  const guardFu = (fn: (v: boolean) => boolean) => { if (!humanOnly) setFollowup(fn); };
  const [saving, setSaving] = useState(false);

  const apply = async (category: Category) => {
    setSaving(true);
    const { data, error } = await supabase.rpc('onboarding_audit_apply', {
      p_ticket_id: lead.ticket_id, p_category: category,
      p_last_appt_date: category === 'paciente' && lastDate ? lastDate : null,
      p_resolve_past: resolvePast,
      p_next_appt_date: category === 'paciente' && nextDate ? nextDate : null,
      p_next_appt_time: category === 'paciente' && nextDate && nextTime ? nextTime : null,
      p_ai_enabled: ai, p_followup_enabled: followup,
      p_scheduled: lead.is_scheduled,
      p_human_only: humanOnly,
    });
    setSaving(false);
    if (error || !data?.success) {
      const code = data?.error_code || error?.message || 'erro';
      showToast(code === 'resolve_past_required_with_open_current'
        ? 'Marque "resolver" no atendimento anterior para poder ter também um próximo agendamento.'
        : `Não deu para aplicar: ${code}`, 'error');
      return;
    }
    onApplied();
  };

  const Cat = ({ icon: Icon, label, accent, onClick }: any) => (
    <button onClick={onClick} disabled={saving}
      className={cn('flex flex-col items-center justify-center gap-1 py-3 rounded-2xl border font-bold text-[13px] text-white/90',
        'bg-white/10 border-white/15 backdrop-blur-md transition-all hover:scale-[1.03] active:scale-95 disabled:opacity-50', accent)}>
      <Icon className="w-5 h-5" /> {label}
    </button>
  );
  const Toggle = ({ on, set, icon: Icon, label }: any) => (
    <button onClick={() => set((v: boolean) => !v)}
      className={cn('flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-xl text-xs font-bold border backdrop-blur-md transition-all',
        on ? 'bg-teal-400/25 border-teal-300/50 text-teal-50 shadow-[0_0_20px_rgba(45,212,191,0.25)]' : 'bg-white/5 border-white/15 text-white/40')}>
      <Icon className="w-3.5 h-3.5" /> {label} {on ? 'ON' : 'OFF'}
    </button>
  );

  return (
    <div style={CARD_SIZE} className="relative rounded-[28px] overflow-hidden shadow-2xl ring-1 ring-white/10">
      <div className="pointer-events-none absolute inset-0 z-20 rounded-[28px] ring-1 ring-inset ring-white/15" />
      <div className="pointer-events-none absolute top-0 inset-x-0 h-[3px] z-20 bg-gradient-to-r from-transparent via-teal-300/70 to-transparent" />
      <CardBackdrop lead={lead} />

      <button onClick={onOpenChat}
        className="absolute top-3 right-3 z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/15 hover:bg-white/25 backdrop-blur-md text-white text-xs font-bold transition-all">
        <MessageCircle className="w-3.5 h-3.5" /> Ver conversa
      </button>
      {(hasAppt || isExisting) && (
        <div className="absolute top-3 left-3 z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-teal-500/85 backdrop-blur-md text-white text-xs font-bold">
          <CalendarCheck className="w-3.5 h-3.5" /> {!hasAppt ? 'Venda ganha' : (isExisting ? 'Já agendado' : 'Tem agendamento')}
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 z-10 p-5 flex flex-col gap-3">
        <div>
          <p className="text-white font-black text-2xl leading-tight drop-shadow-lg">{lead.name || 'Sem nome'}</p>
          <p className="text-white/60 text-xs font-semibold">{lead.phone || '—'}</p>
        </div>
        <div className="h-px bg-gradient-to-r from-white/40 via-white/10 to-transparent" />

        {!patientMode ? (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Cat icon={UserX} label="Contato geral" accent="hover:bg-slate-200/20" onClick={() => apply('contato_geral')} />
              <Cat icon={MessageCircle} label="Lead potencial" accent="hover:bg-sky-400/25 hover:border-sky-300/40" onClick={() => apply('lead_potencial')} />
              <Cat icon={HeartCrack} label="Lead perdido" accent="hover:bg-rose-400/25 hover:border-rose-300/40" onClick={() => apply('lead_perdido')} />
              <Cat icon={Stethoscope} label="Paciente" accent="hover:bg-teal-400/25 hover:border-teal-300/40" onClick={() => setPatientMode(true)} />
            </div>
            <div className="flex gap-2">
              <button onClick={toggleLock}
                title={humanOnly ? 'Atendimento pessoal: IA e follow-up nunca assumem. Clique para destravar.' : 'Marcar como atendimento pessoal (IA nunca assume este contato)'}
                className={cn('flex items-center justify-center px-2.5 py-2 rounded-xl text-xs font-bold border backdrop-blur-md transition-all',
                  humanOnly ? 'bg-amber-400/30 border-amber-300/60 text-amber-100 shadow-[0_0_20px_rgba(251,191,36,0.3)]' : 'bg-white/5 border-white/15 text-white/40')}>
                <Lock className="w-3.5 h-3.5" />
              </button>
              <Toggle on={ai} set={guardAi} icon={Bot} label="IA" /><Toggle on={followup} set={guardFu} icon={Bell} label="Follow-up" />
            </div>
          </>
        ) : (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <span className="text-teal-200 font-black text-sm flex items-center gap-1.5"><Stethoscope className="w-4 h-4" /> {isExisting ? 'Cliente existente' : 'Paciente'}</span>
              {/* Cliente existente (ganho/agendado) só pode ser confirmado como paciente; sem voltar para as outras categorias. */}
              {!isExisting && <button onClick={() => setPatientMode(false)} className="text-xs text-white/50 hover:text-white font-bold">← voltar</button>}
            </div>
            {(hasAppt || isExisting) && <p className="text-[11px] text-teal-200/90 font-semibold flex items-center gap-1 -mt-1"><CalendarCheck className="w-3.5 h-3.5" /> {!hasAppt ? 'Cliente com venda registrada — só defina IA e follow-up' : (isExisting ? 'Já na agenda — só defina IA e follow-up' : 'Datas puxadas da agenda')}</p>}
            {(!isExisting || hasAppt) && (
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-bold text-white/60 uppercase tracking-wide">Último atend.</span>
                <input type="date" value={lastDate} onChange={e => setLastDate(e.target.value)}
                  className="px-2 py-1.5 text-xs bg-white/90 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-300" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-bold text-white/60 uppercase tracking-wide">Próximo agend.</span>
                <div className="flex gap-1">
                  <input type="date" value={nextDate} onChange={e => setNextDate(e.target.value)}
                    className="min-w-0 flex-1 px-2 py-1.5 text-xs bg-white/90 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-300" />
                  <input type="time" value={nextTime} onChange={e => setNextTime(e.target.value)} title="Horário do agendamento"
                    className="w-[74px] shrink-0 px-1.5 py-1.5 text-xs bg-white/90 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-300" />
                </div>
              </label>
            </div>
            )}
            {lastDate && (
              <label className="flex items-center gap-2 text-[11px] font-semibold text-white/80">
                <input type="checkbox" checked={resolvePast} onChange={e => setResolvePast(e.target.checked)} className="accent-teal-500 w-4 h-4" />
                Resolver o atendimento anterior (concluído)
              </label>
            )}
            <div className="flex gap-2">
              <button onClick={toggleLock}
                title={humanOnly ? 'Atendimento pessoal: IA e follow-up nunca assumem. Clique para destravar.' : 'Marcar como atendimento pessoal (IA nunca assume este contato)'}
                className={cn('flex items-center justify-center px-2.5 py-2 rounded-xl text-xs font-bold border backdrop-blur-md transition-all',
                  humanOnly ? 'bg-amber-400/30 border-amber-300/60 text-amber-100 shadow-[0_0_20px_rgba(251,191,36,0.3)]' : 'bg-white/5 border-white/15 text-white/40')}>
                <Lock className="w-3.5 h-3.5" />
              </button>
              <Toggle on={ai} set={guardAi} icon={Bot} label="IA" /><Toggle on={followup} set={guardFu} icon={Bell} label="Follow-up" />
            </div>
            <button onClick={() => apply('paciente')} disabled={saving}
              className="flex items-center justify-center gap-2 py-2.5 rounded-2xl bg-teal-500 hover:bg-teal-400 text-white font-black transition-all disabled:opacity-60 shadow-[0_0_24px_rgba(45,212,191,0.4)]">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Confirmar paciente
            </button>
          </motion.div>
        )}
      </div>
    </div>
  );
}

function PeekCard({ lead }: { lead: PendingLead }) {
  return (
    <div style={CARD_SIZE} className="relative rounded-[28px] overflow-hidden shadow-xl ring-1 ring-white/10 select-none">
      <CardBackdrop lead={lead} />
      <div className="absolute inset-x-0 bottom-0 p-5"><p className="text-white/90 font-black text-xl drop-shadow">{lead.name || 'Sem nome'}</p></div>
    </div>
  );
}

// Frase motivacional conforme volume/progresso (texto e emoji separados: o emoji renderiza natural).
function motivacional(done: number, total: number): { t: string; e: string } {
  const remaining = total - done;
  if (remaining <= 1) return { t: 'Falta só 1! Reta final', e: '🏁' };
  if (remaining <= 3) return { t: `Quase lá, só mais ${remaining}`, e: '💪' };
  const pct = total > 0 ? done / total : 0;
  if (pct >= 0.75) return { t: 'Já passou de 3/4. Bora fechar!', e: '🔥' };
  if (pct >= 0.5) return { t: 'Mais da metade feita, tá voando', e: '⚡' };
  if (pct >= 0.25) return { t: 'Pegou o ritmo, continue assim', e: '🙌' };
  if (done > 0) return { t: 'Boa! Um de cada vez, sem pressa', e: '👏' };
  if (total > 40) return { t: 'São bastante, mas a gente faz junto. Bora!', e: '🚀' };
  if (total > 15) return { t: 'Um de cada vez e logo termina. Vamos!', e: '🚀' };
  return { t: 'Rapidinho isso aqui, bora começar!', e: '✨' };
}

function positionFor(offset: number) {
  if (offset < 0) return { x: -680, rotateY: 40, scale: 0.78, opacity: 0, zIndex: 0 };
  if (offset === 0) return { x: 0, rotateY: 0, scale: 1, opacity: 1, zIndex: 40 };
  if (offset === 1) return { x: 310, rotateY: -40, scale: 0.85, opacity: 0.7, zIndex: 30 };
  if (offset === 2) return { x: 530, rotateY: -44, scale: 0.72, opacity: 0.35, zIndex: 20 };
  return { x: 710, rotateY: -46, scale: 0.62, opacity: 0.12, zIndex: 10 };
}

// Histórico do período em segundo plano (deep-sync) + barrinha de progresso. O disparo é
// AUTOMÁTICO (no refazer e após o import); o botão fica só de fallback/repuxar.
function DeepSyncProgress({ clinicId, onProgress }: { clinicId: string; onProgress?: () => void }) {
  const showToast = useToast();
  const [st, setSt] = useState<any>(null);
  const [starting, setStarting] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const onProgressRef = useRef(onProgress);
  useEffect(() => { onProgressRef.current = onProgress; }, [onProgress]);

  const poll = useCallback(async () => {
    const { data } = await supabase.rpc('onboarding_deep_sync_status', { p_clinic_id: clinicId });
    setSt(data);
    onProgressRef.current?.();
  }, [clinicId]);

  useEffect(() => { poll(); return () => { if (timer.current) { clearInterval(timer.current); timer.current = null; } }; }, [poll]);
  useEffect(() => {
    const running = st?.exists && (st.status === 'pending' || st.status === 'running');
    if (running && !timer.current) timer.current = setInterval(poll, 5000);
    else if (!running && timer.current) { clearInterval(timer.current); timer.current = null; }
  }, [st, poll]);

  const start = async () => {
    setStarting(true);
    const { data, error } = await supabase.rpc('onboarding_deep_sync_start', { p_clinic_id: clinicId });
    setStarting(false);
    if (error || !data?.success) { showToast('Falha ao iniciar o histórico: ' + (error?.message || data?.error_code || 'erro'), 'error'); return; }
    showToast('Puxando 90 dias de histórico em segundo plano.', 'success');
    poll();
  };

  const running = st?.exists && (st.status === 'pending' || st.status === 'running');
  const done = st?.exists && st.status === 'done';

  return (
    <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-3.5 text-left">
      {running ? (
        <>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-bold text-slate-600 flex items-center gap-1.5"><History className="w-3.5 h-3.5 text-teal-600" /> Puxando o histórico do período…</span>
            <span className="text-xs font-black text-teal-700">{st.percent}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-slate-200 overflow-hidden">
            <div className="h-full bg-teal-500 transition-all" style={{ width: `${st.percent}%` }} />
          </div>
          <p className="text-[10px] text-slate-400 mt-1.5">Em segundo plano; pode organizar enquanto chega. {st.chats_done}/{st.chats_total} conversas.</p>
        </>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-bold text-slate-600 flex items-center gap-1.5"><History className="w-3.5 h-3.5 text-teal-600" /> {done ? 'Histórico de 90 dias concluído' : 'Puxar histórico de 90 dias'}</p>
            <p className="text-[10px] text-slate-400">{done ? 'As conversas antigas já foram trazidas.' : 'Normalmente inicia sozinho; use o botão se precisar puxar de novo (depende do celular online).'}</p>
          </div>
          <button onClick={start} disabled={starting}
            className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold transition-all disabled:opacity-60">
            {starting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <History className="w-3.5 h-3.5" />} {done ? 'Puxar de novo' : 'Puxar 90 dias'}
          </button>
        </div>
      )}
    </div>
  );
}

export function OnboardingModal({ clinicId, onComplete }: { clinicId: string; onComplete: () => void }) {
  const showToast = useToast();
  const [phase, setPhase] = useState<'intro' | 'audit' | 'done'>('intro');
  const [leads, setLeads] = useState<PendingLead[]>([]);
  const [index, setIndex] = useState(0);
  const [applied, setApplied] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [synced, setSynced] = useState(false);
  const [chat, setChat] = useState<{ leadId: string; name: string } | null>(null);

  // Escala o palco do Cover Flow inteiro (card + posições vizinhas) para caber na altura disponível.
  const stageRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const compute = () => setScale(Math.min(1, el.clientHeight / 640));
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [phase]);

  const [bulkSaving, setBulkSaving] = useState(false);

  const fetchPending = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    const { data, error } = await supabase.rpc('onboarding_pending_leads', { p_clinic_id: clinicId });
    if (error) { if (!quiet) setLoading(false); return null; } // sinaliza falha: quem decide fluxo não confunde com "vazio"
    const rows: PendingLead[] = (data || []).map((r: any) => ({
      ticket_id: r.ticket_id, lead_id: r.lead_id, name: r.name, phone: r.phone,
      avatar_url: r.avatar_url, last_appt: r.last_appt, last_appt_time: r.last_appt_time,
      next_appt: r.next_appt, next_appt_time: r.next_appt_time, is_scheduled: r.is_scheduled,
    }));
    setLeads(rows);
    if (rows.length > 0) setSynced(true);
    if (!quiet) setLoading(false);
    return rows;
  }, [clinicId]);

  useEffect(() => { fetchPending(); }, [fetchPending]);

  // Enquanto o deep-sync roda e a pessoa ainda está na INTRO, a fila cresce sozinha (não mexe
  // durante a auditoria para o Cover Flow não mudar debaixo do dedo).
  const phaseRef = useRef(phase);
  useEffect(() => { phaseRef.current = phase; }, [phase]);
  const refreshWhileIntro = useCallback(() => {
    if (phaseRef.current === 'intro') fetchPending(true);
  }, [fetchPending]);

  const runImport = async () => {
    setImporting(true);
    const { data, error } = await supabase.rpc('onboarding_import_conversations', { p_clinic_id: clinicId });
    setImporting(false);
    if (error || !data?.success) {
      const msg = error?.message || data?.error_code || 'erro';
      // Clínica grande estoura o teto de 8s do banco: cai para o caminho em segundo plano
      // (deep-sync), que importa a mesma coisa via cron sem limite de tempo.
      if (/timeout|57014/i.test(String(msg))) {
        await supabase.rpc('onboarding_deep_sync_start', { p_clinic_id: clinicId });
        setSynced(true);
        showToast('Volume grande: a importação continuará em segundo plano. Acompanhe a barra abaixo.', 'info');
        return;
      }
      showToast('Falha ao sincronizar: ' + msg, 'error');
      return;
    }
    showToast(`Sincronizado: ${data.new_leads} leads, ${data.new_messages} mensagens.`, 'success');
    setSynced(true);
    // Dispara o histórico do período automaticamente (não depende de clique).
    supabase.rpc('onboarding_deep_sync_start', { p_clinic_id: clinicId });
    await fetchPending();
  };

  const goNext = (fromIdx: number, done: Set<string>) => {
    if (done.size >= leads.length) { setPhase('done'); return; }
    for (let s = 1; s <= leads.length; s++) {
      const j = (fromIdx + s) % leads.length;
      if (!done.has(leads[j].ticket_id)) { setIndex(j); return; }
    }
    setPhase('done');
  };
  const onApplied = () => {
    const nd = new Set(applied); nd.add(leads[index].ticket_id); setApplied(nd);
    goNext(index, nd);
  };
  const onSkip = () => { if (leads[index]?.is_scheduled) return; goNext(index, applied); };
  const remaining = leads.length - applied.size;
  // Cliente já existente (ganho/agendado, is_scheduled) ainda não decidido nesta sessão.
  // NÃO pode ser pulado nem escapado: se sair sem decisão, some (não vai pra Sincronização, não pisca).
  const isPendingExisting = (l: PendingLead) => l.is_scheduled && !applied.has(l.ticket_id);
  const existingPending = leads.filter(isPendingExisting).length;
  const pendingExistingIdx = () => leads.findIndex(isPendingExisting);
  // Confirma TODOS os clientes existentes de uma vez (padrão paciente, IA/follow-up OFF), sem tocar nos tickets.
  const confirmAllExisting = async () => {
    setBulkSaving(true);
    const { data, error } = await supabase.rpc('onboarding_confirm_all_existing', { p_clinic_id: clinicId });
    setBulkSaving(false);
    if (error || !data?.success) { showToast('Falha ao confirmar existentes: ' + (error?.message || data?.error_code || 'erro'), 'error'); return; }
    showToast(data.count > 0 ? `${data.count} cliente(s) existente(s) confirmado(s).` : 'Nenhum cliente existente pendente.', data.count > 0 ? 'success' : 'info');
    const rows = await fetchPending();
    if (!rows) return; // refetch falhou: não avança o fluxo às cegas
    setApplied(new Set());
    setIndex(0);
    setPhase(rows.length === 0 ? 'done' : 'audit');
  };
  const liberate = () => {
    const idx = pendingExistingIdx();
    if (idx >= 0) {
      showToast('Clientes já existentes (ganho/agendado) precisam ser confirmados antes de liberar.', 'info');
      setPhase('audit');
      setIndex(idx);
      return;
    }
    showToast('Comercial liberado. Os follow-ups seguem desligados, reative em Configurações › IA quando quiser.', 'info');
    onComplete();
  };

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-slate-900/30 backdrop-blur-lg overflow-hidden">
      <AnimatePresence>
        {chat && <ChatViewer leadId={chat.leadId} name={chat.name} onClose={() => setChat(null)} />}
      </AnimatePresence>

      {phase === 'intro' && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          className="w-[460px] max-w-[90vw] bg-white rounded-3xl shadow-2xl border border-slate-200 p-8 text-center">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-teal-600 flex items-center justify-center text-white mb-4"><Sparkles className="w-7 h-7" /></div>
          <h2 className="text-2xl font-black text-slate-900">Vamos organizar seus contatos</h2>
          <p className="text-slate-500 text-sm mt-2 leading-relaxed">
            Trouxemos suas conversas do WhatsApp. Passe por cada contato e diga o que ele é, um de cada vez.
            Quem já tem agendamento na sua agenda vem marcado e pré-preenchido. Pode liberar o Comercial a qualquer momento:
            quem ficar pendente aparece piscando em vermelho na coluna Sincronização para organizar depois.
          </p>
          {synced && (
            <div className="mt-4 text-left rounded-2xl border border-amber-200 bg-amber-50 p-3.5 flex items-start gap-2">
              <Bell className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
              <p className="text-amber-800 text-xs leading-relaxed">
                <strong>Follow-ups desativados.</strong> Os disparos automáticos (confirmação, lembrete, reengajamento, pós-atendimento) foram desligados durante a organização, para não sair mensagem em massa. No final, avisamos para você reativá-los.
              </p>
            </div>
          )}
          {loading ? (
            <div className="mt-6 flex justify-center text-slate-400"><Loader2 className="w-5 h-5 animate-spin" /></div>
          ) : !synced ? (
            <button onClick={runImport} disabled={importing}
              className="mt-6 w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-black transition-all disabled:opacity-60">
              {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Sincronizar conversas
            </button>
          ) : leads.length === 0 ? (
            <button onClick={onComplete}
              className="mt-6 w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black transition-all">
              <Check className="w-4 h-4" /> Concluir onboarding
            </button>
          ) : (
            <button onClick={() => setPhase('audit')}
              className="mt-6 w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-black transition-all">
              Começar ({leads.length}) <ArrowRight className="w-4 h-4" />
            </button>
          )}
          {synced && <DeepSyncProgress clinicId={clinicId} onProgress={refreshWhileIntro} />}
          {existingPending > 0 && (
            <button onClick={confirmAllExisting} disabled={bulkSaving}
              className="mt-3 w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-sm transition-all disabled:opacity-60">
              {bulkSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Confirmar todos os {existingPending} clientes existentes
            </button>
          )}
          {!loading && !(synced && leads.length === 0) && (
            <button onClick={liberate} className="mt-3 text-xs text-slate-400 hover:text-slate-600 underline underline-offset-2 transition-colors">
              Liberar Comercial sem organizar agora
            </button>
          )}
        </motion.div>
      )}

      {phase === 'audit' && (
        <div className="w-full h-full flex flex-col items-center justify-between py-8">
          <button onClick={liberate}
            className="absolute top-5 right-5 z-10 flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-white/90 hover:bg-white text-slate-700 text-xs font-bold shadow-md transition-all">
            Liberar Comercial <X className="w-3.5 h-3.5" />
          </button>
          <div className="flex flex-col items-center gap-2 shrink-0">
            <div className="flex items-center gap-3">
              <button onClick={() => setIndex(i => Math.max(0, i - 1))} disabled={index === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/90 hover:bg-white text-slate-700 text-xs font-bold shadow-sm transition-all disabled:opacity-30 disabled:cursor-not-allowed">
                <ArrowLeft className="w-4 h-4" /> Voltar
              </button>
              <span className="text-xs font-black text-slate-600 uppercase tracking-widest">faltam {remaining} de {leads.length}</span>
              {leads[index]?.is_scheduled ? (
                <span className="px-3 py-1.5 rounded-full bg-amber-100 text-amber-700 text-xs font-bold shadow-sm">Cliente existente · confirme para prosseguir</span>
              ) : (
                <button onClick={onSkip}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/90 hover:bg-white text-slate-700 text-xs font-bold shadow-sm transition-all">
                  Pular <ArrowRight className="w-4 h-4" />
                </button>
              )}
            </div>
            {existingPending > 0 && (
              <button onClick={confirmAllExisting} disabled={bulkSaving}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-sm transition-all disabled:opacity-60">
                {bulkSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Confirmar todos os {existingPending} existentes
              </button>
            )}
          </div>
          <div ref={stageRef} className="relative flex-1 min-h-0 w-full flex items-center justify-center overflow-hidden">
            <div className="relative w-full h-[640px] flex items-center justify-center" style={{ perspective: 1600, transform: `scale(${scale})` }}>
            {leads.map((lead, i) => {
              const offset = i - index;
              if (offset < -1 || offset > 3) return null;
              return (
                <motion.div key={lead.ticket_id} className="absolute" style={{ transformStyle: 'preserve-3d' }}
                  initial={false} animate={positionFor(offset)} transition={{ type: 'spring', stiffness: 240, damping: 28 }}>
                  {offset === 0
                    ? <ActiveAuditCard key={lead.ticket_id + ':' + index} lead={lead} onApplied={onApplied} onOpenChat={() => setChat({ leadId: lead.lead_id, name: lead.name })} />
                    : <PeekCard lead={lead} />}
                </motion.div>
              );
            })}
            </div>
          </div>
          <p className="shrink-0 text-2xl md:text-3xl font-black tracking-tight text-center px-6">
            <span className="bg-gradient-to-r from-teal-700 via-emerald-600 to-slate-900 bg-clip-text text-transparent">
              {motivacional(applied.size, leads.length).t}
            </span>{' '}
            <span>{motivacional(applied.size, leads.length).e}</span>
          </p>
        </div>
      )}

      {phase === 'done' && (
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
          className="w-[440px] max-w-[90vw] bg-white rounded-3xl shadow-2xl border border-slate-200 p-8 text-center">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-emerald-500 flex items-center justify-center text-white mb-4"><PartyPopper className="w-8 h-8" /></div>
          <h2 className="text-2xl font-black text-slate-900">Tudo organizado! 🎉</h2>
          <p className="text-slate-500 text-sm mt-2">Seus contatos foram distribuídos no funil. O Comercial está liberado.</p>
          <div className="mt-5 text-left rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <div className="flex items-center gap-2 text-amber-800 font-bold text-sm">
              <Bell className="w-4 h-4" /> Follow-ups desligados
            </div>
            <p className="text-amber-700 text-xs mt-1.5 leading-relaxed">
              Durante a organização, os disparos automáticos (confirmação, lembrete, reengajamento, pós-atendimento) ficaram <strong>desligados</strong> para não sair mensagem em massa. Reative-os quando quiser em <strong>Configurações › IA</strong>. Na hora de ligar, o sistema mostra quais leads serão afetados antes de disparar.
            </p>
          </div>
          <button onClick={onComplete} className="mt-6 w-full py-3 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-black transition-all">Ir para o Comercial</button>
        </motion.div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
export function OnboardingGate() {
  const { activeClinicId } = useAuth();
  const [status, setStatus] = useState<{ should: boolean; pending: number } | null>(null);
  const [forceOpen, setForceOpen] = useState(false);

  const check = useCallback(async () => {
    if (!activeClinicId) { setStatus(null); return; }
    const { data } = await supabase.rpc('onboarding_gate_status', { p_clinic_id: activeClinicId });
    setStatus({ should: !!data?.should_onboard, pending: data?.pending ?? 0 });
  }, [activeClinicId]);

  useEffect(() => { check(); }, [check]);

  if (!activeClinicId || !status) return null;

  // Trava macia: abre no 1º ciclo (should) ou quando o usuário clica "Organizar" (forceOpen).
  if (status.should || forceOpen) {
    return (
      <OnboardingModal
        clinicId={activeClinicId}
        onComplete={async () => {
          await supabase.rpc('onboarding_mark_done', { p_clinic_id: activeClinicId });
          setForceOpen(false);
          await check();
        }}
      />
    );
  }

  // Já liberado, mas sobraram pendentes na Sincronização → pílula flutuante para retomar.
  if (status.pending > 0) {
    return (
      <button onClick={() => setForceOpen(true)}
        className="absolute bottom-5 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 px-4 py-2.5 rounded-full bg-rose-600 hover:bg-rose-700 text-white text-sm font-black shadow-lg animate-pulse transition-all">
        <Bell className="w-4 h-4" /> Organizar {status.pending} pendente{status.pending > 1 ? 's' : ''}
      </button>
    );
  }

  return null;
}
