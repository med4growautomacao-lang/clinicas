import React, { useState, useRef, useCallback, useEffect } from "react";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { matchesSearch } from "../lib/search";
import {
  Settings,
  GripVertical,
  ChevronUp,
  ChevronDown,
  MessageSquare,
  Plus,
  Loader2,
  X,
  Edit2,
  Trash2,
  AlertCircle,
  Zap,
  Pencil,
  Send,
  ArrowLeft,
  Download,
  FileText,
  Search,
  Users,
  Check,
  CalendarPlus,
  ThumbsUp,
  ThumbsDown,
  Eye,
  EyeOff,
} from "lucide-react";
import { cn } from "@/src/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { useFunnelStages, useLeads, useTickets, useSettings, useTransitionRules, useConversions, useFinancial, useProtocols, useAppointments, useDoctors, usePatients, Conversion, Lead, Ticket } from "../hooks/useSupabase";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import { format, parseISO, formatDistanceToNow } from "date-fns";
import GoogleLogo from "../assets/logos/Logo Googleads.png";
import MetaLogo from "../assets/logos/Logo Metaads.png";
import WhatsAppLogo from "../assets/logos/Logo Whatsapp.png";
import SemOrigemLogo from "../assets/logos/Logo Sem origem.png";
import { Share2, Globe, Layout, Smartphone } from "lucide-react";
import { DateRangePicker } from "./DateRangePicker";

const SOURCE_LABELS: Record<string, string> = {
  'meta_ads': 'Meta Ads',
  'google_ads': 'Google Ads',
  'sincronizacao': 'Sincronização',
  'whatsapp': 'WhatsApp',
  'forms': 'Forms',
  '': 'Sem Origem',
};

function ExportModal({ onClose }: { onClose: () => void }) {
  const { activeClinicId } = useAuth();
  const { data: leads } = useLeads();
  const { data: stages } = useFunnelStages();

  const today = format(new Date(), 'yyyy-MM-dd');
  const thirtyAgo = format(new Date(Date.now() - 30 * 86400000), 'yyyy-MM-dd');

  const [fmt, setFmt] = useState<'csv' | 'json'>('csv');
  const [dateFrom, setDateFrom] = useState(thirtyAgo);
  const [dateTo, setDateTo] = useState(today);
  const [selectedLeadId, setSelectedLeadId] = useState('');
  const [selectedLeadName, setSelectedLeadName] = useState('Todos os leads');
  const [selectedSource, setSelectedSource] = useState<string | null>(null); // null = todas
  const [selectedStageId, setSelectedStageId] = useState('');
  const [leadSearch, setLeadSearch] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const allSources: string[] = Array.from(new Set<string>(leads.map((l: any) => ((l.source ?? '') as string)))).sort();

  const filteredLeads = leads.filter(l =>
    matchesSearch(leadSearch, { name: l.name, email: l.email, phone: l.phone }, ['phone'])
  );

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleExport = async () => {
    if (!activeClinicId) return;
    setExporting(true);
    try {
      let query = supabase
        .from('chat_messages')
        .select('id, direction, sender, message, created_at, lead_id, leads!left(name, phone, source, capture_channel, stage_id)')
        .eq('clinic_id', activeClinicId)
        .gte('created_at', dateFrom + 'T00:00:00')
        .lte('created_at', dateTo + 'T23:59:59')
        .order('created_at', { ascending: true });

      if (selectedLeadId) query = (query as any).eq('lead_id', selectedLeadId);

      const { data: rows, error } = await query;
      if (error) throw error;

      const stageMap: Record<string, string> = {};
      stages.forEach(s => { stageMap[s.id] = s.name; });

      let filtered = (rows || []).filter((r: any) => {
        const lead = r.leads;
        if (selectedSource !== null && (lead?.source ?? '') !== selectedSource) return false;
        if (selectedStageId && lead?.stage_id !== selectedStageId) return false;
        return true;
      });

      const getContent = (msg: any): string => {
        if (!msg) return '';
        if (typeof msg === 'string') return msg;
        return msg.content || msg.text || msg.output || JSON.stringify(msg);
      };

      const filename = `conversas_${dateFrom}_${dateTo}`;

      if (fmt === 'csv') {
        const header = ['Data', 'Lead', 'Telefone', 'Origem', 'Etapa', 'Direção', 'Remetente', 'Mensagem'];
        const csvRows = filtered.map((r: any) => {
          const lead = r.leads;
          const stageName = lead?.stage_id ? (stageMap[lead.stage_id] || '') : '';
          const source = SOURCE_LABELS[lead?.source ?? ''] || lead?.source || '';
          const msg = getContent(r.message).replace(/"/g, '""').replace(/\n/g, ' ');
          return [
            r.created_at?.slice(0, 19).replace('T', ' '),
            `"${lead?.name || ''}"`,
            lead?.phone || '',
            source,
            `"${stageName}"`,
            r.direction === 'inbound' ? 'Recebida' : 'Enviada',
            r.sender,
            `"${msg}"`
          ].join(',');
        });
        const content = [header.join(','), ...csvRows].join('\n');
        const blob = new Blob(['\uFEFF' + content], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = filename + '.csv'; a.click();
        URL.revokeObjectURL(url);
      } else {
        const grouped: Record<string, any> = {};
        filtered.forEach((r: any) => {
          const lid = r.lead_id || 'sem_lead';
          if (!grouped[lid]) {
            const lead = r.leads;
            grouped[lid] = {
              lead: { id: lid, name: lead?.name || '', phone: lead?.phone || '', source: lead?.source || '', stage: lead?.stage_id ? (stageMap[lead.stage_id] || '') : '' },
              messages: []
            };
          }
          grouped[lid].messages.push({ created_at: r.created_at, direction: r.direction, sender: r.sender, content: getContent(r.message) });
        });
        const blob = new Blob([JSON.stringify(Object.values(grouped), null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = filename + '.json'; a.click();
        URL.revokeObjectURL(url);
      }
    } catch (e) {
      console.error('Export error:', e);
    } finally {
      setExporting(false);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[80] flex items-center justify-center p-4" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        onClick={e => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg border border-slate-100 overflow-hidden"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-teal-50 rounded-xl flex items-center justify-center">
              <Download className="w-5 h-5 text-teal-600" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900">Exportar Conversas</h3>
              <p className="text-xs text-slate-400">Escolha os filtros e o formato</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-full transition-all">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5 max-h-[70vh] overflow-y-auto">
          {/* Formato */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Formato</label>
            <div className="flex gap-2">
              {(['csv', 'json'] as const).map(f => (
                <button key={f} onClick={() => setFmt(f)}
                  className={cn("flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold border transition-all",
                    fmt === f ? "bg-teal-600 text-white border-teal-600" : "bg-white text-slate-600 border-slate-200 hover:border-teal-300"
                  )}>
                  <FileText className="w-4 h-4" />{f.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          {/* Período */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Período</label>
            <DateRangePicker
              from={dateFrom}
              to={dateTo}
              onFromChange={setDateFrom}
              onToChange={setDateTo}
              numberOfMonths={1}
            />
          </div>

          {/* Lead — dropdown com busca integrada */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Lead</label>
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => { setDropdownOpen(v => !v); setLeadSearch(''); }}
                className="w-full flex items-center justify-between px-3 py-2 text-sm border border-slate-200 rounded-xl bg-white text-slate-700 font-medium hover:border-teal-300 transition-all"
              >
                <span className="truncate">{selectedLeadName}</span>
                <ChevronDown className="w-4 h-4 text-slate-400 shrink-0 ml-2" />
              </button>
              {dropdownOpen && (
                <div className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
                  <div className="p-2 border-b border-slate-100">
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                      <input
                        autoFocus
                        type="text"
                        placeholder="Buscar lead..."
                        value={leadSearch}
                        onChange={e => setLeadSearch(e.target.value)}
                        className="w-full pl-8 pr-3 py-1.5 text-sm border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-teal-200"
                      />
                    </div>
                  </div>
                  <div className="max-h-48 overflow-y-auto">
                    <button
                      onClick={() => { setSelectedLeadId(''); setSelectedLeadName('Todos os leads'); setDropdownOpen(false); }}
                      className="w-full text-left px-3 py-2 text-sm font-medium text-slate-700 hover:bg-teal-50 hover:text-teal-700 transition-colors"
                    >Todos os leads</button>
                    {filteredLeads.map(l => (
                      <button key={l.id}
                        onClick={() => { setSelectedLeadId(l.id); setSelectedLeadName(l.name + (l.phone ? ` — ${l.phone}` : '')); setDropdownOpen(false); }}
                        className={cn("w-full text-left px-3 py-2 text-sm hover:bg-teal-50 hover:text-teal-700 transition-colors",
                          selectedLeadId === l.id ? "bg-teal-50 text-teal-700 font-semibold" : "text-slate-700")}
                      >
                        <span className="font-medium">{l.name}</span>
                        {l.phone && <span className="text-slate-400 ml-1 text-xs">{l.phone}</span>}
                      </button>
                    ))}
                    {filteredLeads.length === 0 && (
                      <p className="px-3 py-3 text-sm text-slate-400 text-center">Nenhum lead encontrado</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Origem */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Origem</label>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => setSelectedSource(null)}
                className={cn("px-3 py-1.5 rounded-full text-xs font-bold border transition-all",
                  selectedSource === null ? "bg-teal-600 text-white border-teal-600" : "bg-white text-slate-600 border-slate-200 hover:border-teal-300"
                )}>Todas</button>
              {allSources.map(s => (
                <button key={s === '' ? '__none__' : s} onClick={() => setSelectedSource(s)}
                  className={cn("px-3 py-1.5 rounded-full text-xs font-bold border transition-all",
                    selectedSource !== null && selectedSource === s ? "bg-teal-600 text-white border-teal-600" : "bg-white text-slate-600 border-slate-200 hover:border-teal-300"
                  )}>{SOURCE_LABELS[s] || s || 'Sem Origem'}</button>
              ))}
            </div>
          </div>

          {/* Etapa */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Etapa do Funil</label>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => setSelectedStageId('')}
                className={cn("px-3 py-1.5 rounded-full text-xs font-bold border transition-all",
                  selectedStageId === '' ? "bg-teal-600 text-white border-teal-600" : "bg-white text-slate-600 border-slate-200 hover:border-teal-300"
                )}>Todas</button>
              {stages.map(s => (
                <button key={s.id} onClick={() => setSelectedStageId(s.id)}
                  className={cn("px-3 py-1.5 rounded-full text-xs font-bold border transition-all",
                    selectedStageId === s.id ? "bg-teal-600 text-white border-teal-600" : "bg-white text-slate-600 border-slate-200 hover:border-teal-300"
                  )}>{s.name}</button>
              ))}
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between gap-3 bg-slate-50/50">
          <button onClick={onClose} className="px-4 py-2 text-sm font-semibold text-slate-600 hover:text-slate-800 transition-colors">
            Cancelar
          </button>
          <button onClick={handleExport} disabled={exporting}
            className="flex items-center gap-2 px-6 py-2.5 bg-teal-600 hover:bg-teal-700 text-white text-sm font-bold rounded-xl transition-all shadow-sm disabled:opacity-50">
            {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            {exporting ? 'Exportando...' : `Exportar ${fmt.toUpperCase()}`}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function calcBusinessMinutes(since: Date, bh: { start: string; end: string; days: number[] }, endDate?: Date): number {
  const now = endDate || new Date();
  if (since >= now) return 0;
  const [sh, sm] = bh.start.split(':').map(Number);
  const [eh, em] = bh.end.split(':').map(Number);
  const startMins = sh * 60 + sm;
  const endMins = eh * 60 + em;
  if (endMins <= startMins) return 0;
  let total = 0;
  const cur = new Date(since);
  // Snap to start of business if currently before business hours
  const curMins = cur.getHours() * 60 + cur.getMinutes();
  if (bh.days.includes(cur.getDay()) && curMins < startMins) {
    cur.setHours(sh, sm, 0, 0);
  }
  let guard = 0;
  while (cur < now && guard++ < 10000) {
    const dow = cur.getDay();
    if (bh.days.includes(dow)) {
      const mins = cur.getHours() * 60 + cur.getMinutes();
      if (mins >= startMins && mins < endMins) {
        const remaining = Math.min(endMins - mins, (now.getTime() - cur.getTime()) / 60000);
        total += remaining;
        cur.setHours(eh, em, 0, 0);
        continue;
      }
    }
    cur.setDate(cur.getDate() + 1);
    cur.setHours(sh, sm, 0, 0);
  }
  return total;
}
import { ptBR } from "date-fns/locale";
import { LeadChat } from "./LeadChat";

const SCROLL_SPEED = 3.5;
const MOMENTUM_DECAY = 0.92;

function KanbanScrollContainer({ children }: { children: React.ReactNode }) {
  const outerRef = useRef<HTMLDivElement>(null);   // clip container
  const innerRef = useRef<HTMLDivElement>(null);   // flex row — recebe transform
  const topScrollRef = useRef<HTMLDivElement>(null);
  const scrollPhantomRef = useRef<HTMLDivElement>(null); // define largura da barra

  const isPanning = useRef(false);
  const isPendingPan = useRef(false);
  const hasMoved = useRef(false);
  const isCardDragging = useRef(false);
  const mouseDownX = useRef(0);
  const lastX = useRef(0);
  const velocity = useRef(0);
  const pendingDx = useRef(0);
  const offset = useRef(0);   // posição atual do scroll
  const maxOffset = useRef(0);
  const rafId = useRef<number | null>(null);
  const fromScrollbar = useRef(false);
  const dragEdgeDir = useRef(0);   // velocidade do edge-scroll durante drag
  const dragEdgeRaf = useRef<number | null>(null);

  // Aplica o offset via transform — sem reflow, direto no compositor
  const applyOffset = useCallback((newOffset: number) => {
    const clamped = Math.max(0, Math.min(newOffset, maxOffset.current));
    offset.current = clamped;
    if (innerRef.current) innerRef.current.style.transform = `translateX(${-clamped}px)`;
    if (topScrollRef.current && !fromScrollbar.current)
      topScrollRef.current.scrollLeft = clamped;
  }, []);

  // Atualiza largura do phantom e maxOffset quando colunas mudam
  useEffect(() => {
    const update = () => {
      if (!outerRef.current || !innerRef.current) return;
      const totalW = innerRef.current.scrollWidth;
      const viewW = outerRef.current.clientWidth;
      maxOffset.current = Math.max(0, totalW - viewW);
      if (scrollPhantomRef.current) scrollPhantomRef.current.style.width = totalW + 'px';
    };
    update();
    const obs = new ResizeObserver(update);
    if (innerRef.current) obs.observe(innerRef.current);
    if (outerRef.current) obs.observe(outerRef.current);
    return () => obs.disconnect();
  }, []);

  const rafLoop = useCallback(() => {
    if (isPanning.current) {
      if (pendingDx.current !== 0) {
        applyOffset(offset.current + pendingDx.current);
        pendingDx.current = 0;
      }
      rafId.current = requestAnimationFrame(rafLoop);
    } else if (Math.abs(velocity.current) > 0.5) {
      applyOffset(offset.current + velocity.current);
      velocity.current *= MOMENTUM_DECAY;
      rafId.current = requestAnimationFrame(rafLoop);
    } else {
      velocity.current = 0;
      pendingDx.current = 0;
      rafId.current = null;
    }
  }, [applyOffset]);

  // Loop de edge-scroll durante drag de card
  const dragEdgeLoop = useCallback(() => {
    if (dragEdgeDir.current === 0) { dragEdgeRaf.current = null; return; }
    applyOffset(offset.current + dragEdgeDir.current);
    dragEdgeRaf.current = requestAnimationFrame(dragEdgeLoop);
  }, [applyOffset]);

  const onDragOverEdge = useCallback((e: React.DragEvent) => {
    if (!outerRef.current) return;
    const rect = outerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const EDGE = 300;
    const MAX_SPEED = 28;
    if (x < EDGE) {
      dragEdgeDir.current = -MAX_SPEED * (1 - x / EDGE);
    } else if (x > rect.width - EDGE) {
      dragEdgeDir.current = MAX_SPEED * (1 - (rect.width - x) / EDGE);
    } else {
      dragEdgeDir.current = 0;
    }
    if (dragEdgeDir.current !== 0 && !dragEdgeRaf.current) {
      dragEdgeRaf.current = requestAnimationFrame(dragEdgeLoop);
    }
  }, [dragEdgeLoop]);

  const stopPan = useCallback(() => {
    isPendingPan.current = false;
    if (!isPanning.current) return;
    isPanning.current = false;
    if (outerRef.current) {
      outerRef.current.style.cursor = '';
      outerRef.current.style.userSelect = '';
    }
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const dx = lastX.current - e.pageX;
      lastX.current = e.pageX;

      if (isPanning.current) {
        hasMoved.current = true;
        velocity.current = dx * SCROLL_SPEED * 0.35 + velocity.current * 0.65;
        pendingDx.current += dx * SCROLL_SPEED;
      } else if (isPendingPan.current && !isCardDragging.current) {
        if (Math.abs(mouseDownX.current - e.pageX) > 5) {
          isPanning.current = true;
          isPendingPan.current = false;
          if (outerRef.current) {
            outerRef.current.style.cursor = 'grabbing';
            outerRef.current.style.userSelect = 'none';
          }
          if (rafId.current) cancelAnimationFrame(rafId.current);
          rafId.current = requestAnimationFrame(rafLoop);
          velocity.current = dx * SCROLL_SPEED;
          pendingDx.current += dx * SCROLL_SPEED;
        }
      }
    };
    const handleMouseUp = () => stopPan();
    // Garante reset mesmo quando dragend não borbulha até o container
    const handleDragEnd = () => {
      isCardDragging.current = false;
      dragEdgeDir.current = 0;
      if (dragEdgeRaf.current) { cancelAnimationFrame(dragEdgeRaf.current); dragEdgeRaf.current = null; }
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('dragend', handleDragEnd);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('dragend', handleDragEnd);
    };
  }, [rafLoop, stopPan]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('input') || target.closest('textarea') || target.closest('select')) return;
    isCardDragging.current = false; // limpa qualquer estado de drag residual
    if (isPanning.current) return;
    if (rafId.current) { cancelAnimationFrame(rafId.current); rafId.current = null; }
    velocity.current = 0;
    pendingDx.current = 0;
    mouseDownX.current = e.pageX;
    lastX.current = e.pageX;
    isPendingPan.current = true;
  }, []);

  const onContextMenu = useCallback((e: React.MouseEvent) => {
    if (hasMoved.current) { e.preventDefault(); hasMoved.current = false; }
  }, []);

  const onDragStart = useCallback(() => {
    if (rafId.current) { cancelAnimationFrame(rafId.current); rafId.current = null; }
    isCardDragging.current = true;
    isPanning.current = false;
    isPendingPan.current = false;
    velocity.current = 0;
    pendingDx.current = 0;
    if (outerRef.current) outerRef.current.style.cursor = '';
  }, []);

  const onDragEnd = useCallback(() => {
    isCardDragging.current = false;
    dragEdgeDir.current = 0;
    if (dragEdgeRaf.current) { cancelAnimationFrame(dragEdgeRaf.current); dragEdgeRaf.current = null; }
    if (outerRef.current) outerRef.current.style.cursor = '';
  }, []);

  return (
    <div className="flex flex-col h-full">
      {/* Barra de scroll superior — nativa, sincroniza via applyOffset */}
      <div
        ref={topScrollRef}
        className="overflow-x-scroll custom-scrollbar mb-3"
        style={{ height: 16 }}
        onScroll={(e) => {
          fromScrollbar.current = true;
          applyOffset(e.currentTarget.scrollLeft);
          fromScrollbar.current = false;
        }}
      >
        <div ref={scrollPhantomRef} style={{ height: 1 }} />
      </div>

      {/* Outer: clip horizontal */}
      <div
        ref={outerRef}
        className="overflow-hidden h-full"
        onMouseDown={onMouseDown}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragOver={onDragOverEdge}
        onDragLeave={() => { dragEdgeDir.current = 0; }}
        onContextMenu={onContextMenu}
      >
        {/* Inner: transform no compositor — sem reflow */}
        <div
          ref={innerRef}
          className="flex gap-4 pb-2 h-full"
          style={{ willChange: 'transform' }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

function LossModal({ lead, onClose, onCancel, onConfirm }: {
  lead: { id: string; name: string };
  onClose: () => void;
  onCancel: () => void;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [selected, setSelected] = useState('');
  const [customText, setCustomText] = useState('');
  const [saving, setSaving] = useState(false);

  const REASONS = ['Preço alto', 'Escolheu concorrente', 'Não respondeu', 'Sem interesse', 'Fora do perfil', 'Agendou e não compareceu', 'Tentativas de follow-up esgotadas', 'Outro'];
  const isOutro = selected === 'Outro';
  const finalReason = isOutro ? customText.trim() : selected;
  const canConfirm = !saving && finalReason.length > 0;

  const handleConfirm = async () => {
    if (!canConfirm) return;
    setSaving(true);
    await onConfirm(finalReason);
    setSaving(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onCancel}>
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="h-1.5 bg-rose-500" />
        <div className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-black text-slate-900">Motivo da Perda</h3>
              <p className="text-xs text-slate-500 font-medium mt-0.5">{lead.name}</p>
            </div>
            <button onClick={onCancel} className="p-1.5 hover:bg-slate-100 rounded-lg"><X className="w-4 h-4 text-slate-400" /></button>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Motivo</label>
            <div className="flex flex-wrap gap-1.5">
              {REASONS.map(r => (
                <button key={r} type="button" onClick={() => setSelected(r)}
                  className={cn("px-3 py-1.5 rounded-lg text-xs font-bold border transition-all",
                    selected === r ? "bg-rose-600 text-white border-rose-600" : "bg-white text-slate-600 border-slate-200 hover:border-rose-300"
                  )}>
                  {r}
                </button>
              ))}
            </div>
          </div>

          {isOutro && (
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-rose-500 uppercase tracking-wider">Qual o motivo? *</label>
              <textarea
                autoFocus
                value={customText}
                onChange={e => setCustomText(e.target.value)}
                placeholder="Descreva o motivo da perda..."
                rows={3}
                className={cn(
                  "w-full px-3 py-2.5 border rounded-xl text-sm font-medium focus:outline-none focus:ring-2 resize-none transition-colors",
                  customText.trim() ? "border-slate-200 focus:ring-rose-500/20 focus:border-rose-500" : "border-rose-300 focus:ring-rose-500/20 focus:border-rose-500 bg-rose-50/30"
                )}
              />
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button onClick={onCancel} className="flex-1 py-2.5 rounded-xl text-sm font-bold border border-slate-200 text-slate-500 hover:bg-slate-50 transition-all">
              Cancelar
            </button>
            <button
              onClick={handleConfirm}
              disabled={!canConfirm}
              className="flex-1 py-2.5 rounded-xl text-sm font-black bg-rose-600 hover:bg-rose-700 text-white transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Confirmar Perda'}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

const formatBRL = (val: number | string) => {
  const n = typeof val === 'string' ? Number(val) : val;
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(n || 0);
};

function CurrencyInput({ value, onChange, className, placeholder, autoFocus }: {
  value: string | number;
  onChange: (val: string) => void;
  className?: string;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawValue = e.target.value.replace(/\D/g, '');
    if (rawValue === '') {
      onChange('');
      return;
    }
    const numericValue = parseInt(rawValue, 10) / 100;
    onChange(numericValue.toFixed(2));
  };

  const displayValue = value && !isNaN(Number(value))
    ? new Intl.NumberFormat('pt-BR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(Number(value))
    : '';

  return (
    <div className={cn(
      "flex items-center w-full px-4 py-3 border border-slate-200 rounded-xl bg-white shadow-sm focus-within:ring-2 focus-within:ring-teal-500/20 focus-within:border-teal-500 transition-all",
      className
    )}>
      <span className="text-slate-400 font-black text-sm mr-2 select-none shrink-0">R$</span>
      <input
        type="text"
        autoFocus={autoFocus}
        value={displayValue}
        onChange={handleChange}
        placeholder={placeholder || "0,00"}
        className="w-full bg-transparent border-none outline-none text-sm font-bold p-0 placeholder:text-slate-300 focus:ring-0"
      />
    </div>
  );
}

function GanhoModal({ lead, onClose, onCancel, onCreate }: {
  lead: { id: string; name: string };
  onClose: () => void;
  onCancel: () => void;
  onCreate: (data: Omit<Conversion, 'id' | 'clinic_id' | 'created_at'>) => Promise<boolean>;
}) {
  const { create: createTransaction } = useFinancial();
  const { data: protocols } = useProtocols();

  const [value, setValue] = useState('');
  const [description, setDescription] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('pix');
  const [txStatus, setTxStatus] = useState<'pago' | 'pendente'>('pago');
  const [protocolIds, setProtocolIds] = useState<string[]>([]);
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  const toggleProtocol = (id: string) =>
    setProtocolIds(prev => prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]);

  const handleSave = async () => {
    if (!value || Number(value) <= 0) return;
    setSaving(true);
    const ok = await onCreate({
      lead_id: lead.id,
      value: Number(value),
      description: description || null,
      payment_method: paymentMethod,
      protocol_ids: protocolIds,
      converted_at: new Date(date + 'T12:00:00').toISOString(),
    });
    if (ok) {
      await createTransaction({
        type: 'receita',
        category: 'Consulta',
        amount: Number(value),
        description: description || 'Venda registrada',
        payment_method: paymentMethod as any,
        status: txStatus,
        date,
        protocol_ids: protocolIds,
      });
      setDone(true);
      setTimeout(onClose, 1000);
    }
    setSaving(false);
  };

  const METHODS = [
    { id: 'pix', label: 'Pix' },
    { id: 'cartao', label: 'Cartão' },
    { id: 'dinheiro', label: 'Dinheiro' },
    { id: 'plano', label: 'Plano' },
  ];

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onCancel}>
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="h-1.5 bg-emerald-500" />
        <div className="p-6 space-y-4 max-h-[85vh] overflow-y-auto custom-scrollbar">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-black text-slate-900">Registrar Venda</h3>
              <p className="text-xs text-slate-500 font-medium mt-0.5">{lead.name}</p>
            </div>
            <button onClick={onCancel} className="p-1.5 hover:bg-slate-100 rounded-lg"><X className="w-4 h-4 text-slate-400" /></button>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Valor (R$)</label>
            <CurrencyInput
              autoFocus
              value={value}
              onChange={setValue}
              className="focus:ring-emerald-500/20 focus:border-emerald-500"
            />
          </div>

          {/* Status */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Status do Pagamento</label>
            <div className="flex gap-2">
              {(['pago', 'pendente'] as const).map(s => (
                <button key={s} type="button" onClick={() => setTxStatus(s)}
                  className={cn("flex-1 py-2 rounded-xl text-xs font-bold border transition-all capitalize",
                    txStatus === s ? "bg-emerald-600 text-white border-emerald-600" : "bg-white text-slate-600 border-slate-200 hover:border-emerald-300"
                  )}>
                  {s === 'pago' ? 'Pago' : 'Pendente'}
                </button>
              ))}
            </div>
          </div>

          {/* Forma de Pagamento */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Forma de Pagamento</label>
            <div className="flex flex-wrap gap-1.5">
              {METHODS.map(m => (
                <button key={m.id} type="button" onClick={() => setPaymentMethod(m.id)}
                  className={cn("px-3 py-1.5 rounded-lg text-xs font-bold border transition-all",
                    paymentMethod === m.id ? "bg-emerald-600 text-white border-emerald-600" : "bg-white text-slate-600 border-slate-200 hover:border-emerald-300"
                  )}>
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* Protocolos */}
          {protocols.length > 0 && (
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Protocolos</label>
              <div className="flex flex-wrap gap-1.5">
                {protocols.filter(p => p.is_active).map(p => (
                  <button key={p.id} type="button" onClick={() => toggleProtocol(p.id)}
                    className={cn("px-3 py-1.5 rounded-lg text-xs font-bold border transition-all",
                      protocolIds.includes(p.id) ? "bg-teal-600 text-white border-teal-600" : "bg-white text-slate-600 border-slate-200 hover:border-teal-300"
                    )}>
                    {p.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Descrição */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Descrição (opcional)</label>
            <input
              type="text" value={description} onChange={e => setDescription(e.target.value)}
              placeholder="Ex: Consulta inicial, Pacote mensal..."
              className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
            />
          </div>

          {/* Data */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Data</label>
            <input
              type="date" value={date} onChange={e => setDate(e.target.value)}
              className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
            />
          </div>

          <button
            onClick={handleSave}
            disabled={saving || !value || Number(value) <= 0}
            className={cn(
              "w-full py-3 rounded-xl text-sm font-black transition-all flex items-center justify-center gap-2",
              done ? "bg-emerald-500 text-white" :
                saving ? "bg-slate-100 text-slate-400" :
                  !value || Number(value) <= 0 ? "bg-slate-100 text-slate-400 cursor-not-allowed" :
                    "bg-emerald-600 hover:bg-emerald-700 text-white"
            )}
          >
            {done ? <><Check className="w-4 h-4" /> Registrado!</> :
              saving ? <Loader2 className="w-4 h-4 animate-spin" /> :
                <><ThumbsUp className="w-4 h-4" /> Registrar Ganho</>}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function OrcamentoModal({ lead, onClose, onCancel, onConfirm }: {
  lead: { id: string; name: string };
  onClose: () => void;
  onCancel: () => void;
  onConfirm: (data: Omit<Conversion, 'id' | 'clinic_id' | 'created_at'>) => Promise<boolean>;
}) {
  const [value, setValue] = useState('');
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  const handleSave = async () => {
    if (!value || Number(value) <= 0) return;
    setSaving(true);
    const ok = await onConfirm({
      lead_id: lead.id,
      value: Number(value),
      description: 'Orçamento Enviado',
      payment_method: 'outros',
      protocol_ids: [],
      converted_at: new Date(date + 'T12:00:00').toISOString(),
    });
    if (ok) {
      setDone(true);
      setTimeout(onClose, 1000);
    }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onCancel}>
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="h-1.5 bg-blue-500" />
        <div className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-black text-slate-900">Registrar Orçamento</h3>
              <p className="text-xs text-slate-500 font-medium mt-0.5">{lead.name}</p>
            </div>
            <button onClick={onCancel} className="p-1.5 hover:bg-slate-100 rounded-lg"><X className="w-4 h-4 text-slate-400" /></button>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Valor do Orçamento (R$)</label>
            <CurrencyInput
              autoFocus
              value={value}
              onChange={setValue}
              className="focus:ring-blue-500/20 focus:border-blue-500"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Data do Envio</label>
            <input
              type="date" value={date} onChange={e => setDate(e.target.value)}
              className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
            />
          </div>

          <div className="flex gap-2 pt-1">
            <button onClick={onCancel} className="flex-1 py-2.5 rounded-xl text-sm font-bold border border-slate-200 text-slate-500 hover:bg-slate-50 transition-all">
              Cancelar
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !value || Number(value) <= 0}
              className={cn(
                "flex-1 py-2.5 rounded-xl text-sm font-black transition-all flex items-center justify-center gap-2",
                done ? "bg-emerald-500 text-white" :
                  saving ? "bg-slate-100 text-slate-400" :
                    "bg-blue-600 hover:bg-blue-700 text-white"
              )}
            >
              {done ? <><Check className="w-4 h-4" /> Registrado!</> :
                saving ? <Loader2 className="w-4 h-4 animate-spin" /> :
                  'Confirmar Orçamento'}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}


export function LeadKanban() {
  const { data: stages, loading: stagesLoading, reorder: reorderStages, update: updateStage, create: createStage, remove: removeStage } = useFunnelStages();
  const { data: leads, create, update, remove } = useLeads({ pageSize: 150 });
  const { tickets, loading: ticketsLoading, moveTicket, openTicket, closeTicket, finalizeTicket } = useTickets();
  const { byLead: conversionsByLead, create: createConversion } = useConversions();
  const { aiConfig, updateAI } = useSettings();
  const [ganhoLead, setGanhoLead] = useState<{ id: string; name: string; prevStageId: string | null; ticketId: string } | null>(null);
  const [orcamentoLead, setOrcamentoLead] = useState<{ id: string; name: string; prevStageId: string | null; ticketId: string } | null>(null);
  const [lossLead, setLossLead] = useState<{ id: string; name: string; prevStageId: string | null; ticketId: string } | null>(null);
  const { data: transitionRules, create: createRule, remove: removeRule, update: updateRule, reorder: reorderRules } = useTransitionRules();
  const [showModal, setShowModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [selectedLead, setSelectedLead] = useState<any>(null);
  const [formData, setFormData] = useState({ name: '', phone: '', source: 'sincronizacao', capture_channel: 'whatsapp', stage_id: '', estimated_value: '', loss_reason: '', avatar_url: '' });
  const [submitting, setSubmitting] = useState(false);
  const [chatLead, setChatLead] = useState<{ lead: any; ticketId: string } | null>(null);
  const [scheduleLead, setScheduleLead] = useState<{ lead: Lead; ticketId: string } | null>(null);
  const [scheduleForm, setScheduleForm] = useState({ doctor_id: '', date: '', time: '', notes: '', modality: 'presencial' as 'presencial' | 'online' });
  const [scheduleSubmitting, setScheduleSubmitting] = useState(false);
  const [scheduleSlots, setScheduleSlots] = useState<string[] | null>(null);
  const [scheduleSlotsLoading, setScheduleSlotsLoading] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);

  useEffect(() => {
    if (!scheduleForm.doctor_id || !scheduleForm.date) {
      setScheduleSlots(null);
      return;
    }
    let cancelled = false;
    setScheduleSlotsLoading(true);
    supabase.rpc('get_available_slots', {
      p_doctor_id: scheduleForm.doctor_id,
      p_date: scheduleForm.date,
    }).then(({ data, error }) => {
      if (cancelled) return;
      if (error) { console.error('get_available_slots:', error); setScheduleSlots([]); }
      else setScheduleSlots((data || []).map((s: any) => (s.slot_time || '').toString().substring(0, 5)));
      setScheduleSlotsLoading(false);
    });
    return () => { cancelled = true; };
  }, [scheduleForm.doctor_id, scheduleForm.date]);
  const { create: createAppointment } = useAppointments();
  const { data: doctors } = useDoctors();
  const { data: patients, create: createPatient } = usePatients();
  const [localStages, setLocalStages] = useState<any[]>([]);
  const [isAddingStage, setIsAddingStage] = useState(false);
  const [newStageName, setNewStageName] = useState("");
  const [editingStageId, setEditingStageId] = useState<string | null>(null);
  const [editingStageName, setEditingStageName] = useState("");
  const [showAutomationModal, setShowAutomationModal] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<'all' | 'meta' | 'google' | 'sem_origem'>('all');
  const [showResolved, setShowResolved] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [columnPages, setColumnPages] = useState<Record<string, number>>({});
  const COLUMN_PAGE_SIZE = 20;
  const [entryDateFrom, setEntryDateFrom] = useState('');
  const [entryDateTo, setEntryDateTo] = useState('');
  const [convDateFrom, setConvDateFrom] = useState('');
  const [convDateTo, setConvDateTo] = useState('');
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [statusDropdownTicketId, setStatusDropdownTicketId] = useState<string | null>(null);
  const [confirmingResolveId, setConfirmingResolveId] = useState<string | null>(null);
  useEffect(() => {
    if (!statusDropdownTicketId && !confirmingResolveId) return;
    const close = () => {
      setStatusDropdownTicketId(null);
      setConfirmingResolveId(null);
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [statusDropdownTicketId, confirmingResolveId]);
  const [isAddingRule, setIsAddingRule] = useState(false);
  const [newRule, setNewRule] = useState({ keywords: '', target_stage_id: '', context: '', lead_response: '', message_to_send: '' });

  const [draggedLead, setDraggedLead] = useState<any>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);

  const handleDragStart = (e: React.DragEvent, ticket: Ticket) => {
    setDraggedLead(ticket);
    e.dataTransfer.setData("ticketId", ticket.id);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent, stageId: string) => {
    e.preventDefault();
    setDragOverStage(stageId);
  };

  const handleDrop = async (e: React.DragEvent, targetStageId: string) => {
    e.preventDefault();
    setDragOverStage(null);

    if (draggedLead && draggedLead.stage_id !== targetStageId) {
      const targetStage = stages.find(s => s.id === targetStageId);
      await moveTicket(draggedLead.id, targetStageId);

      if (targetStage?.slug === 'ganho') {
        setGanhoLead({ id: draggedLead.lead_id, name: draggedLead.lead?.name ?? '', prevStageId: draggedLead.stage_id, ticketId: draggedLead.id });
      } else if (targetStage?.slug === 'perdido') {
        setLossLead({ id: draggedLead.lead_id, name: draggedLead.lead?.name ?? '', prevStageId: draggedLead.stage_id, ticketId: draggedLead.id });
      } else if (targetStage?.slug === 'orcamento') {
        setOrcamentoLead({ id: draggedLead.lead_id, name: draggedLead.lead?.name ?? '', prevStageId: draggedLead.stage_id, ticketId: draggedLead.id });
      }
    }
    setDraggedLead(null);
  };

  const handleSubmit = async () => {
    if (!formData.name.trim()) return;
    setSubmitting(true);

    try {
      const targetStageId = formData.stage_id || (stages[0]?.id ?? '');
      const isPerdido = stages.find(s => s.id === targetStageId)?.slug === 'perdido';
      const isConversao = stages.find(s => s.id === targetStageId)?.slug === 'ganho';
      const isOrcamento = stages.find(s => s.id === targetStageId)?.slug === 'orcamento';

      const payload = {
        name: formData.name,
        phone: formData.phone || null,
        source: formData.source || null,
        capture_channel: formData.capture_channel || 'whatsapp',
        stage_id: targetStageId || null,
        estimated_value: formData.estimated_value ? Number(formData.estimated_value) : 0,
        loss_reason: isPerdido ? (formData.loss_reason || null) : null,
        avatar_url: formData.avatar_url || null,
      };

      if (selectedLead) {
        const ok = await update(selectedLead.id, payload);
        if (!ok) return;
        if (targetStageId && selectedLead._ticketId) {
          const openT = tickets.find(t => t.id === selectedLead._ticketId);
          if (openT && targetStageId !== openT.stage_id) {
            if (isPerdido) {
              await closeTicket(openT.id, 'perdido');
            } else if (isConversao) {
              setGanhoLead({ id: selectedLead.id, name: selectedLead.name, prevStageId: openT.stage_id, ticketId: openT.id });
            } else if (isOrcamento) {
              setOrcamentoLead({ id: selectedLead.id, name: selectedLead.name, prevStageId: openT.stage_id, ticketId: openT.id });
            } else {
              await moveTicket(openT.id, targetStageId);
            }
          }
        }
      } else {
        const newLead = await create(payload);
        if (newLead && targetStageId && !isPerdido) {
          await openTicket(newLead.id, targetStageId);
        }
      }

      setFormData({ name: '', phone: '', source: 'sincronizacao', capture_channel: 'whatsapp', stage_id: '', estimated_value: '', loss_reason: '', avatar_url: '' });
      setSelectedLead(null);
      setShowModal(false);
    } catch (err) {
      console.error('Erro ao salvar lead:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedLead) return;
    setSubmitting(true);
    await remove(selectedLead.id);
    setShowDeleteConfirm(false);
    setSelectedLead(null);
    setSubmitting(false);
  };

  const openEditModal = (ticket: Ticket) => {
    const lead = ticket.lead!;
    setSelectedLead({ ...lead, _ticketId: ticket.id });
    const conversions = conversionsByLead[lead.id];
    const lastConversion = conversions?.[conversions.length - 1];
    const realValue = lastConversion ? lastConversion.value : (lead.estimated_value || '');

    setFormData({
      name: lead.name,
      phone: lead.phone || '',
      source: lead.source || '',
      capture_channel: lead.capture_channel || 'whatsapp',
      stage_id: ticket.stage_id || '',
      estimated_value: realValue.toString(),
      loss_reason: lead.loss_reason || '',
      avatar_url: lead.avatar_url || ''
    });
    setShowModal(true);
  };

  const openDeleteConfirm = (ticket: Ticket) => {
    setSelectedLead({ ...ticket.lead!, _ticketId: ticket.id });
    setShowDeleteConfirm(true);
  };

  const stageColors: Record<string, string> = {
    'bg-blue-500': 'bg-blue-500',
    'bg-emerald-500': 'bg-emerald-500',
    'bg-teal-500': 'bg-teal-500',
    'bg-amber-500': 'bg-amber-500',
    'bg-rose-500': 'bg-rose-500',
    'bg-purple-500': 'bg-purple-500',
    'bg-indigo-500': 'bg-indigo-500',
    'bg-slate-500': 'bg-slate-500',
    'bg-green-600': 'bg-green-600',
    'bg-red-600': 'bg-red-600',
    'bg-orange-500': 'bg-orange-500',
  };

  const filteredTickets = React.useMemo(() => {
    const hasSourceFilter = sourceFilter !== 'all';
    const hasEntryFilter = entryDateFrom || entryDateTo;
    const hasConvFilter = convDateFrom || convDateTo;
    const hasSearch = searchQuery.trim().length > 0;
    const base = showResolved ? tickets : tickets.filter(t => t.status !== 'closed');
    if (!hasSourceFilter && !hasEntryFilter && !hasConvFilter && !hasSearch) return base;

    const lowerSearch = searchQuery.toLowerCase();

    return base.filter(ticket => {
      const lead = ticket.lead;
      if (!lead) return true;
      if (hasSearch) {
        // Normalização para busca por nome (ignora acentos)
        const normalize = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
        const normalizedName = normalize(lead.name || "");
        const normalizedSearch = normalize(lowerSearch);
        const nameMatch = normalizedName.includes(normalizedSearch);
        
        // Normalização para busca por telefone (apenas números)
        const cleanPhone = (lead.phone || "").replace(/\D/g, "");
        const cleanSearch = lowerSearch.replace(/\D/g, "");
        const phoneMatch = cleanSearch.length > 0 && cleanPhone.includes(cleanSearch);

        if (!nameMatch && !phoneMatch) return false;
      }
      if (hasSourceFilter) {
        const isMeta = !!lead.fb_campaign_name || lead.source === 'meta_ads';
        const isGoogle = !!lead.g_campaign_name || lead.source === 'google_ads';
        if (sourceFilter === 'meta' && !isMeta) return false;
        if (sourceFilter === 'google' && !isGoogle) return false;
        if (sourceFilter === 'sem_origem' && (isMeta || isGoogle)) return false;
      }
      if (hasEntryFilter) {
        const opened = ticket.opened_at.slice(0, 10);
        if (entryDateFrom && opened < entryDateFrom) return false;
        if (entryDateTo && opened > entryDateTo) return false;
      }
      if (hasConvFilter) {
        const convs = conversionsByLead[lead.id] || [];
        const inRange = convs.some(c => {
          const d = (c.converted_at || '').slice(0, 10);
          if (convDateFrom && d < convDateFrom) return false;
          if (convDateTo && d > convDateTo) return false;
          return true;
        });
        if (!inRange) return false;
      }
      return true;
    });
  }, [tickets, sourceFilter, entryDateFrom, entryDateTo, convDateFrom, convDateTo, conversionsByLead, showResolved, searchQuery]);

  const hasActiveFilters = sourceFilter !== 'all' || entryDateFrom || entryDateTo || convDateFrom || convDateTo || searchQuery.trim().length > 0;

  React.useEffect(() => { setColumnPages({}); }, [sourceFilter, entryDateFrom, entryDateTo, convDateFrom, convDateTo, searchQuery]);

  if (stagesLoading || ticketsLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 text-teal-600 animate-spin" />
      </div>
    );
  }

  if (showAutomationModal) {
    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => { setShowAutomationModal(false); setEditingRuleId(null); setIsAddingRule(false); setNewRule({ keywords: '', target_stage_id: '', context: '', lead_response: '', message_to_send: '' }); }}
              className="w-10 h-10 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-colors"
            >
              <ArrowLeft className="w-5 h-5 text-slate-600" />
            </button>
            <div>
              <h2 className="text-3xl font-bold tracking-tight text-slate-900">
                Regras de <span className="text-teal-600">Funil</span>
              </h2>
              <p className="text-slate-500 font-medium text-base">Configure as regras de movimentacao automatica dos leads.</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <p className="text-xs font-medium text-slate-400">
              {transitionRules.length} {transitionRules.length === 1 ? 'regra configurada' : 'regras configuradas'}
            </p>
            {!isAddingRule && !editingRuleId && (
              <Button className="py-5 px-6 group" onClick={() => setIsAddingRule(true)}>
                <Plus className="w-5 h-5 mr-2 group-hover:rotate-90 transition-transform" />
                Nova Regra
              </Button>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="space-y-4">
          {transitionRules.length === 0 && !isAddingRule ? (
            <div className="text-center py-24 bg-white rounded-2xl border border-slate-200">
              <div className="w-20 h-20 mx-auto mb-5 rounded-2xl bg-slate-50 border-2 border-dashed border-slate-200 flex items-center justify-center">
                <Zap className="w-9 h-9 text-slate-300" />
              </div>
              <p className="text-lg font-bold text-slate-500">Nenhuma automacao configurada</p>
              <p className="text-sm text-slate-400 mt-2 max-w-md mx-auto">Crie regras para mover leads automaticamente entre etapas com base no contexto da conversa.</p>
              <Button
                onClick={() => setIsAddingRule(true)}
                className="mt-6 bg-teal-600 hover:bg-teal-700 text-white gap-2 shadow-lg shadow-teal-100 py-5 px-6"
              >
                <Plus className="w-5 h-5" />
                Criar Primeira Regra
              </Button>
            </div>
          ) : (
            <div className="grid gap-4">
              {transitionRules.map((rule, idx) => (
                editingRuleId === rule.id ? (
                  /* Inline Edit Form */
                  <motion.div key={rule.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-2xl border-2 border-teal-200 bg-gradient-to-b from-teal-50/50 to-white overflow-hidden shadow-lg shadow-teal-50">
                    <div className="px-6 py-4 bg-teal-50 border-b border-teal-100 flex items-center gap-3">
                      <span className="w-7 h-7 rounded-lg bg-teal-600 text-white text-xs font-black flex items-center justify-center">{idx + 1}</span>
                      <p className="text-sm font-bold text-teal-800">âœï¸ Editando regra</p>
                    </div>
                    <div className="p-6 space-y-5">
                      <div className="grid grid-cols-2 gap-5">
                        <div className="space-y-2">
                          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                            <MessageSquare className="w-3 h-3 text-blue-500" />
                            Contexto
                          </label>
                          <textarea
                            rows={3}
                            value={newRule.context}
                            onChange={e => setNewRule(p => ({ ...p, context: e.target.value }))}
                            placeholder="Ex: Para qualificar o Lead apos explicar como funciona a consulta..."
                            className="w-full px-3 py-2.5 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-200 focus:border-teal-400 font-medium resize-none transition-all"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                            <Send className="w-3 h-3 text-emerald-500" />
                            Mensagem a Enviar
                          </label>
                          <textarea
                            rows={3}
                            value={newRule.message_to_send}
                            onChange={e => setNewRule(p => ({ ...p, message_to_send: e.target.value }))}
                            placeholder="Ex: Parabens pela decisao! Para continuarmos..."
                            className="w-full px-3 py-2.5 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-200 focus:border-teal-400 font-medium resize-none transition-all"
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-5">
                        <div className="space-y-2">
                          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                            <MessageSquare className="w-3 h-3 text-amber-500" />
                            Resposta Esperada do Lead
                          </label>
                          <input
                            type="text"
                            value={newRule.lead_response}
                            onChange={e => setNewRule(p => ({ ...p, lead_response: e.target.value }))}
                            placeholder="Ex: Se a resposta for sim ou positiva"
                            className="w-full px-3 py-2.5 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-200 focus:border-teal-400 font-medium transition-all"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                            <Zap className="w-3 h-3 text-violet-500" />
                            Gatilho
                          </label>
                          <input
                            type="text"
                            value={newRule.keywords}
                            onChange={e => setNewRule(p => ({ ...p, keywords: e.target.value }))}
                            placeholder="[QUALIFICADO]"
                            className="w-full px-3 py-2.5 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-200 focus:border-teal-400 font-mono font-medium transition-all"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Etapa Destino</label>
                          <select
                            value={newRule.target_stage_id}
                            onChange={e => setNewRule(p => ({ ...p, target_stage_id: e.target.value }))}
                            className="w-full px-3 py-2.5 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-200 focus:border-teal-400 font-medium transition-all"
                          >
                            <option value="">Selecione...</option>
                            {stages.map(s => (
                              <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div className="flex gap-3 pt-2">
                        <Button
                          className="bg-teal-600 hover:bg-teal-700 shadow-lg shadow-teal-100 px-6"
                          disabled={!newRule.keywords.trim() || !newRule.target_stage_id || submitting}
                          onClick={async () => {
                            setSubmitting(true);
                            await updateRule(editingRuleId, newRule);
                            setNewRule({ keywords: '', target_stage_id: '', context: '', lead_response: '', message_to_send: '' });
                            setSubmitting(false);
                            setEditingRuleId(null);
                          }}
                        >
                          {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
                          Salvar Edicao
                        </Button>
                        <Button variant="ghost" className="text-slate-500" onClick={() => { setEditingRuleId(null); setNewRule({ keywords: '', target_stage_id: '', context: '', lead_response: '', message_to_send: '' }); }}>Cancelar</Button>
                      </div>
                    </div>
                  </motion.div>
                ) : (
                  /* Read-only Rule Card */
                  <motion.div
                    key={rule.id}
                    initial={{ opacity: 0, y: -5 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="rounded-2xl border border-slate-200 overflow-hidden bg-white hover:shadow-lg transition-shadow group"
                  >
                    <div className="flex items-center justify-between px-6 py-4 bg-slate-50/80 border-b border-slate-100">
                      <div className="flex items-center gap-3">
                        <div className="flex flex-col gap-0.5">
                          <button
                            disabled={idx === 0}
                            onClick={() => {
                              const next = [...transitionRules];
                              [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
                              reorderRules(next);
                            }}
                            className="p-0.5 rounded text-slate-300 hover:text-teal-600 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                          >
                            <ChevronUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            disabled={idx === transitionRules.length - 1}
                            onClick={() => {
                              const next = [...transitionRules];
                              [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
                              reorderRules(next);
                            }}
                            className="p-0.5 rounded text-slate-300 hover:text-teal-600 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                          >
                            <ChevronDown className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <span className="w-7 h-7 rounded-lg bg-teal-600 text-white text-xs font-black flex items-center justify-center shadow-sm">
                          {idx + 1}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-slate-700">Mover para</span>
                          <div className={cn("w-2.5 h-2.5 rounded-full", stages.find(s => s.id === rule.target_stage_id)?.color || 'bg-slate-400')} />
                          <span className="text-sm font-black text-teal-700">
                            {stages.find(s => s.id === rule.target_stage_id)?.name || 'â€”'}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => {
                            setEditingRuleId(rule.id);
                            setNewRule({
                              keywords: rule.keywords || '',
                              target_stage_id: rule.target_stage_id || '',
                              context: rule.context || '',
                              lead_response: rule.lead_response || '',
                              message_to_send: rule.message_to_send || ''
                            });
                          }}
                          className="p-2 rounded-lg text-slate-400 hover:text-teal-600 hover:bg-teal-50 transition-all"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => removeRule(rule.id)}
                          className="p-2 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-50 transition-all"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    <div className="px-6 py-4 grid grid-cols-2 lg:grid-cols-4 gap-4">
                      {rule.context && (
                        <div className="flex gap-2.5">
                          <div className="w-6 h-6 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0 mt-0.5">
                            <MessageSquare className="w-3.5 h-3.5 text-blue-500" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-[9px] font-bold text-blue-500 uppercase tracking-wider">Contexto</p>
                            <p className="text-xs text-slate-600 leading-relaxed mt-1">{rule.context}</p>
                          </div>
                        </div>
                      )}
                      {rule.lead_response && (
                        <div className="flex gap-2.5">
                          <div className="w-6 h-6 rounded-lg bg-amber-50 flex items-center justify-center flex-shrink-0 mt-0.5">
                            <MessageSquare className="w-3.5 h-3.5 text-amber-500" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-[9px] font-bold text-amber-500 uppercase tracking-wider">Resposta do Lead</p>
                            <p className="text-xs text-slate-600 leading-relaxed mt-1">{rule.lead_response}</p>
                          </div>
                        </div>
                      )}
                      {rule.message_to_send && (
                        <div className="flex gap-2.5">
                          <div className="w-6 h-6 rounded-lg bg-emerald-50 flex items-center justify-center flex-shrink-0 mt-0.5">
                            <Send className="w-3.5 h-3.5 text-emerald-500" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-[9px] font-bold text-emerald-500 uppercase tracking-wider">Mensagem a Enviar</p>
                            <p className="text-xs text-slate-600 leading-relaxed mt-1">{rule.message_to_send}</p>
                          </div>
                        </div>
                      )}
                      <div className="flex gap-2.5">
                        <div className="w-6 h-6 rounded-lg bg-violet-50 flex items-center justify-center flex-shrink-0 mt-0.5">
                          <Zap className="w-3.5 h-3.5 text-violet-500" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-[9px] font-bold text-violet-500 uppercase tracking-wider">Gatilho</p>
                          <code className="text-xs font-mono bg-slate-100 text-slate-700 px-2 py-1 rounded-md mt-1 inline-block">{rule.keywords}</code>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )
              ))}

              {/* Add New Rule Form */}
              {isAddingRule && !editingRuleId && (
                <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl border-2 border-teal-200 bg-gradient-to-b from-teal-50/50 to-white overflow-hidden shadow-lg shadow-teal-50">
                  <div className="px-6 py-4 bg-teal-50 border-b border-teal-100">
                    <p className="text-sm font-bold text-teal-800">âœ¨ Nova regra de automacao</p>
                  </div>
                  <div className="p-6 space-y-5">
                    <div className="grid grid-cols-2 gap-5">
                      <div className="space-y-2">
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                          <MessageSquare className="w-3 h-3 text-blue-500" />
                          Contexto
                        </label>
                        <textarea
                          rows={3}
                          value={newRule.context}
                          onChange={e => setNewRule(p => ({ ...p, context: e.target.value }))}
                          placeholder="Ex: Para qualificar o Lead apos explicar como funciona a consulta..."
                          className="w-full px-3 py-2.5 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-200 focus:border-teal-400 font-medium resize-none transition-all"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                          <Send className="w-3 h-3 text-emerald-500" />
                          Mensagem a Enviar
                        </label>
                        <textarea
                          rows={3}
                          value={newRule.message_to_send}
                          onChange={e => setNewRule(p => ({ ...p, message_to_send: e.target.value }))}
                          placeholder="Ex: Parabens pela decisao! Para continuarmos..."
                          className="w-full px-3 py-2.5 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-200 focus:border-teal-400 font-medium resize-none transition-all"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-5">
                      <div className="space-y-2">
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                          <MessageSquare className="w-3 h-3 text-amber-500" />
                          Resposta Esperada do Lead
                        </label>
                        <input
                          type="text"
                          value={newRule.lead_response}
                          onChange={e => setNewRule(p => ({ ...p, lead_response: e.target.value }))}
                          placeholder="Ex: Se a resposta for sim ou positiva"
                          className="w-full px-3 py-2.5 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-200 focus:border-teal-400 font-medium transition-all"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                          <Zap className="w-3 h-3 text-violet-500" />
                          Gatilho
                        </label>
                        <input
                          type="text"
                          value={newRule.keywords}
                          onChange={e => setNewRule(p => ({ ...p, keywords: e.target.value }))}
                          placeholder="[QUALIFICADO]"
                          className="w-full px-3 py-2.5 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-200 focus:border-teal-400 font-mono font-medium transition-all"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Etapa Destino</label>
                        <select
                          value={newRule.target_stage_id}
                          onChange={e => setNewRule(p => ({ ...p, target_stage_id: e.target.value }))}
                          className="w-full px-3 py-2.5 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-200 focus:border-teal-400 font-medium transition-all"
                        >
                          <option value="">Selecione...</option>
                          {stages.map(s => (
                            <option key={s.id} value={s.id}>{s.name}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="flex gap-3 pt-2">
                      <Button
                        className="bg-teal-600 hover:bg-teal-700 shadow-lg shadow-teal-100 px-6"
                        disabled={!newRule.keywords.trim() || !newRule.target_stage_id || submitting}
                        onClick={async () => {
                          setSubmitting(true);
                          await createRule(newRule);
                          setNewRule({ keywords: '', target_stage_id: '', context: '', lead_response: '', message_to_send: '' });
                          setSubmitting(false);
                          setIsAddingRule(false);
                        }}
                      >
                        {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
                        Criar Regra
                      </Button>
                      <Button variant="ghost" className="text-slate-500" onClick={() => { setIsAddingRule(false); setNewRule({ keywords: '', target_stage_id: '', context: '', lead_response: '', message_to_send: '' }); }}>Cancelar</Button>
                    </div>
                  </div>
                </motion.div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full gap-4">
      {/* ── Cabeçalho + Filtros ── */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Filtro de origem */}
        <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-xl p-0.5 shadow-sm">
          {([
            { id: 'all', label: 'Todos', logo: null },
            { id: 'meta', label: 'Meta', logo: MetaLogo },
            { id: 'google', label: 'Google', logo: GoogleLogo },
            { id: 'sem_origem', label: 'Sem Origem', logo: SemOrigemLogo },
          ] as const).map(opt => (
            <button
              key={opt.id}
              onClick={() => setSourceFilter(opt.id)}
              className={cn(
                "flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-bold transition-all",
                sourceFilter === opt.id
                  ? "bg-slate-900 text-white shadow-sm"
                  : "text-slate-500 hover:text-slate-800 hover:bg-slate-50"
              )}
            >
              {opt.logo && <img src={opt.logo} className={cn("w-3 h-3 rounded", opt.id === 'sem_origem' && "opacity-60")} />}
              {opt.label}
            </button>
          ))}
        </div>

        <DateRangePicker
          label="Entrada"
          from={entryDateFrom}
          to={entryDateTo}
          onFromChange={setEntryDateFrom}
          onToChange={setEntryDateTo}
        />

        <DateRangePicker
          label="Ganho"
          from={convDateFrom}
          to={convDateTo}
          onFromChange={setConvDateFrom}
          onToChange={setConvDateTo}
        />

        <div className="relative w-48">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
          <input
            type="text"
            placeholder="Buscar lead..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-teal-200 focus:border-teal-400 transition-all bg-white font-medium shadow-sm"
          />
        </div>

        {hasActiveFilters && (
          <button
            onClick={() => { setSourceFilter('all'); setEntryDateFrom(''); setEntryDateTo(''); setConvDateFrom(''); setConvDateTo(''); setSearchQuery(''); }}
            className="text-[10px] font-bold text-rose-500 hover:text-rose-700 uppercase tracking-wider flex items-center gap-1 shrink-0"
            title="Limpar Filtros"
          >
            <X className="w-3 h-3" />
          </button>
        )}

        <div className="flex items-center gap-1.5 ml-auto">
          <Button variant="outline" size="icon" title={showResolved ? 'Ocultar resolvidos' : 'Mostrar resolvidos'} className={cn("h-8 w-8", showResolved ? "text-teal-600 border-teal-300 bg-teal-50 hover:bg-teal-100" : "text-slate-400 hover:text-teal-600")} onClick={() => setShowResolved(v => !v)}>
            {showResolved ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
          </Button>
          <Button variant="outline" size="icon" className="h-8 w-8 text-slate-400 hover:text-teal-600" onClick={() => setExportOpen(true)} title="Exportar">
            <Download className="w-3.5 h-3.5" />
          </Button>
          <Button variant="outline" size="icon" className="h-8 w-8 text-slate-400 hover:text-teal-600" onClick={() => { setShowAutomationModal(true); }} title="Automações">
            <Zap className="w-3.5 h-3.5" />
          </Button>
          <Button variant="outline" size="icon" className="h-8 w-8 text-slate-400 hover:text-teal-600" onClick={() => { setLocalStages([...stages]); setShowSettingsModal(true); }} title="Configurar Funil">
            <Settings className="w-3.5 h-3.5" />
          </Button>
          <Button
            size="icon"
            className="h-8 w-8 bg-teal-600 hover:bg-teal-700 text-white shadow-sm transition-all rounded-lg"
            onClick={() => { setSelectedLead(null); setFormData({ name: '', phone: '', source: 'sincronizacao', capture_channel: 'whatsapp', stage_id: stages[0]?.id || '', estimated_value: '', loss_reason: '', avatar_url: '' }); setShowModal(true); }}
            title="Novo Lead"
          >
            <Plus className="w-5 h-5" />
          </Button>
        </div>
      </div>

      <div className="flex-1 min-h-0">
        <KanbanScrollContainer>
          {stages.map((stage) => {
            const stageTickets = filteredTickets.filter(t => t.stage_id === stage.id);
            const stageTotal = stageTickets.reduce((sum, t) => {
              const conversions = t.lead ? conversionsByLead[t.lead.id] : undefined;
              const lastConversion = conversions?.[conversions.length - 1];
              const realValue = lastConversion ? Number(lastConversion.value || 0) : 0;
              const valueToAdd = realValue > 0 ? realValue : Number(t.lead?.estimated_value || 0);
              return sum + valueToAdd;
            }, 0);
            const visibleCount = (columnPages[stage.id] || 1) * COLUMN_PAGE_SIZE;
            const visibleTickets = stageTickets.slice(0, visibleCount);
            const hasMoreInColumn = visibleCount < stageTickets.length;
            return (
              <div key={stage.id} className="w-[300px] shrink-0 flex flex-col gap-2 h-full">
                <div className="flex items-center gap-2 px-2" draggable={false} onDragStart={e => e.preventDefault()}>
                  <div className={cn("w-2 h-2 shrink-0 rounded-full", stageColors[stage.color || 'bg-slate-500'] || 'bg-slate-500')} />
                  <h3 className="font-bold text-slate-700 text-xs uppercase tracking-wider truncate flex-1">{stage.name}</h3>
                  <span className="bg-slate-200 text-slate-600 text-[10px] font-bold px-1.5 py-0.5 rounded-md shrink-0">{stageTickets.length}</span>
                  <span className="text-[10px] font-bold text-slate-400 shrink-0">
                    {formatBRL(stageTotal)}
                  </span>
                  <button className="text-slate-400 hover:text-slate-600 shrink-0" onClick={() => { setSelectedLead(null); setFormData({ name: '', phone: '', source: 'sincronizacao', capture_channel: 'whatsapp', stage_id: stage.id, estimated_value: '', loss_reason: '', avatar_url: '' }); setShowModal(true); }}>
                    <Plus className="w-4 h-4" />
                  </button>
                </div>

                <div
                  className={cn(
                    "flex-1 min-h-0 bg-slate-100/50 rounded-xl p-3 flex flex-col gap-3 overflow-y-auto overflow-x-hidden custom-scrollbar transition-colors border-2 border-transparent",
                    dragOverStage === stage.id && "bg-teal-50 border-teal-200"
                  )}
                  onDragOver={(e) => handleDragOver(e, stage.id)}
                  onDragLeave={() => setDragOverStage(null)}
                  onDrop={(e) => handleDrop(e, stage.id)}
                  onDragStart={e => { if (!(e.target as HTMLElement).closest('[draggable="true"]')) e.preventDefault(); }}
                  onScroll={(e) => {
                    const el = e.currentTarget;
                    if (hasMoreInColumn && el.scrollTop + el.clientHeight >= el.scrollHeight - 100) {
                      setColumnPages(prev => ({ ...prev, [stage.id]: (prev[stage.id] || 1) + 1 }));
                    }
                  }}
                >
                  {visibleTickets.map((ticket) => {
                    const lead = ticket.lead!;
                    const isClosed = ticket.status === 'closed';
                    const isPerdido = stage.slug === 'perdido';
                    const semMotivo = isPerdido && !lead.loss_reason && !ticket.loss_reason && !isClosed;
                    const lastContact = lead.last_message_at ?? lead.created_at;
                    const frozen = isClosed || !!lead.converted_patient_id || isPerdido;
                    // Contagem persistente do banco + ciclo atual estourado
                    const currentCycleBreach = (() => {
                      if (frozen || !aiConfig?.sla_minutes || !aiConfig?.business_hours || !lead.last_message_at) return false;
                      // So conta se o lead mandou msg depois da ultima resposta (ciclo aberto)
                      if (lead.last_outbound_at && parseISO(lead.last_outbound_at) > parseISO(lead.last_message_at)) return false;
                      const endDate = frozen && lead.updated_at ? parseISO(lead.updated_at) : undefined;
                      const mins = calcBusinessMinutes(parseISO(lead.last_message_at), aiConfig.business_hours, endDate);
                      return mins > aiConfig.sla_minutes;
                    })();
                    const slaBreach = lead.sla_breach_count + (currentCycleBreach ? 1 : 0);
                    const aguardando = !frozen && !!lead.last_outbound_at && (
                      !lead.last_message_at || parseISO(lead.last_outbound_at) > parseISO(lead.last_message_at)
                    );
                    const precisaResponder = !frozen && !!lead.last_message_at && (
                      !lead.last_outbound_at || parseISO(lead.last_message_at) > parseISO(lead.last_outbound_at)
                    );
                    const outcomeLabel: Record<string, string> = { ganho: 'Ganho', perdido: 'Perdido' };
                    return (
                      <motion.div
                        key={ticket.id}
                        draggable={!isClosed && !lead.converted_patient_id}
                        onDragStart={!isClosed && !lead.converted_patient_id ? (e) => handleDragStart(e as unknown as React.DragEvent<Element>, ticket) : undefined}
                        whileHover={{ y: isClosed ? 0 : -1 }}
                        className={cn(
                          "px-3 py-2.5 rounded-lg border shadow-sm transition-all group",
                          !frozen && !isClosed ? "cursor-pointer active:cursor-move hover:shadow-md" : "cursor-default",
                          isClosed && "opacity-50 grayscale-[0.5] hover:opacity-75",
                          draggedLead?.id === ticket.id && "opacity-50",
                          semMotivo && "animate-pulse",
                          isClosed ? "bg-slate-50/80 border-slate-200"
                            : ticket.outcome === 'ganho' ? "bg-emerald-50 border-emerald-200"
                              : ticket.outcome === 'perdido' ? "bg-rose-50 border-rose-200"
                                : isPerdido ? "bg-white border-rose-200"
                                  : (!!lead.fb_campaign_name || lead.source === 'meta_ads') ? "bg-blue-50/60 border-blue-200/80"
                                    : (!!lead.g_campaign_name || lead.source === 'google_ads') ? "bg-emerald-50/60 border-emerald-200/80"
                                      : lead.source === 'sincronizacao' ? "bg-violet-50/60 border-violet-200/80"
                                        : "bg-white border-slate-200"
                        )}
                      >
                        {/* Header: fonte + acoes */}
                        {(() => {
                          const isMeta = !!lead.fb_campaign_name || lead.source === 'meta_ads';
                          const isGoogle = !!lead.g_campaign_name || lead.source === 'google_ads';
                          const isSync = !isMeta && !isGoogle && lead.source === 'sincronizacao';
                          const campaignName = lead.fb_campaign_name || lead.g_campaign_name;

                          const hasUtms = !!(
                            lead.fb_campaign_name || lead.fb_adset_name || lead.fb_ad_name || lead.fb_clid ||
                            lead.g_campaign_name || lead.g_adset_name || lead.g_ad_name || lead.g_term_name || lead.g_source_name ||
                            lead.ctwa_clid || lead.rast_id || lead.source
                          );

                          return (
                            <div className="flex justify-between items-start mb-2">
                              <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                                <div className="relative group/utm inline-flex items-center gap-1.5 cursor-help w-max">
                                  {isMeta && (
                                    <img src={MetaLogo} alt="Meta" className="w-3.5 h-3.5 rounded shrink-0" />
                                  )}
                                  {isGoogle && !isMeta && (
                                    <img src={GoogleLogo} alt="Google" className="w-3.5 h-3.5 rounded shrink-0" />
                                  )}
                                  {!isMeta && !isGoogle && (
                                    <img src={SemOrigemLogo} alt="Sem Origem" className="w-3.5 h-3.5 rounded shrink-0 opacity-40" />
                                  )}
                                  <span className={cn(
                                    "text-[9px] font-black uppercase tracking-[0.1em] truncate",
                                    isMeta ? "text-blue-500" : isGoogle ? "text-emerald-500" : isSync ? "text-violet-500" : "text-slate-400"
                                  )}>
                                    {isMeta ? 'Meta Ads' : isGoogle ? 'Google Ads' : isSync ? 'Sincronização' : 'Sem Origem'}
                                  </span>

                                  {hasUtms && (
                                    <div className="absolute left-0 top-full mt-2 z-50 hidden group-hover/utm:flex flex-col bg-slate-900 text-slate-100 text-[10px] p-2.5 rounded-xl shadow-xl w-max max-w-[250px] border border-slate-700 pointer-events-none">
                                      <div className="font-black text-slate-400 mb-1.5 uppercase tracking-wider text-[8px]">Dados da Origem</div>

                                      {lead.source && <p className="mb-0.5 flex gap-1"><span className="text-slate-500 font-medium shrink-0">utm_source:</span> <span className="font-bold truncate">{lead.source}</span></p>}

                                      {/* Meta */}
                                      {lead.fb_campaign_name && <p className="mb-0.5 flex gap-1"><span className="text-slate-500 font-medium shrink-0">utm_campaign:</span> <span className="font-bold truncate" title={lead.fb_campaign_name}>{lead.fb_campaign_name}</span></p>}
                                      {lead.fb_adset_name && <p className="mb-0.5 flex gap-1"><span className="text-slate-500 font-medium shrink-0">utm_adset:</span> <span className="font-bold truncate" title={lead.fb_adset_name}>{lead.fb_adset_name}</span></p>}
                                      {lead.fb_ad_name && <p className="mb-0.5 flex gap-1"><span className="text-slate-500 font-medium shrink-0">utm_ad:</span> <span className="font-bold truncate" title={lead.fb_ad_name}>{lead.fb_ad_name}</span></p>}
                                      {lead.fb_clid && <p className="mb-0.5 flex gap-1"><span className="text-slate-500 font-medium shrink-0">fbclid:</span> <span className="font-bold truncate" title={lead.fb_clid}>{lead.fb_clid}</span></p>}

                                      {/* Google */}
                                      {lead.g_campaign_name && <p className="mb-0.5 flex gap-1"><span className="text-slate-500 font-medium shrink-0">utm_campaign:</span> <span className="font-bold truncate" title={lead.g_campaign_name}>{lead.g_campaign_name}</span></p>}
                                      {lead.g_adset_name && <p className="mb-0.5 flex gap-1"><span className="text-slate-500 font-medium shrink-0">utm_adgroup:</span> <span className="font-bold truncate" title={lead.g_adset_name}>{lead.g_adset_name}</span></p>}
                                      {lead.g_ad_name && <p className="mb-0.5 flex gap-1"><span className="text-slate-500 font-medium shrink-0">utm_ad:</span> <span className="font-bold truncate" title={lead.g_ad_name}>{lead.g_ad_name}</span></p>}
                                      {lead.g_term_name && <p className="mb-0.5 flex gap-1"><span className="text-slate-500 font-medium shrink-0">utm_term:</span> <span className="font-bold truncate" title={lead.g_term_name}>{lead.g_term_name}</span></p>}
                                      {lead.g_source_name && <p className="mb-0.5 flex gap-1"><span className="text-slate-500 font-medium shrink-0">g_source:</span> <span className="font-bold truncate" title={lead.g_source_name}>{lead.g_source_name}</span></p>}

                                      {/* Outros IDs de Rastreio */}
                                      {lead.ctwa_clid && <p className="mb-0.5 flex gap-1"><span className="text-slate-500 font-medium shrink-0">ctwa_clid:</span> <span className="font-bold truncate" title={lead.ctwa_clid}>{lead.ctwa_clid}</span></p>}
                                      {lead.rast_id && <p className="mb-0.5 flex gap-1"><span className="text-slate-500 font-medium shrink-0">rast_id:</span> <span className="font-bold truncate" title={lead.rast_id}>{lead.rast_id}</span></p>}
                                    </div>
                                  )}
                                </div>

                                {/* UTMs expostas */}
                                {(lead.fb_campaign_name || lead.g_campaign_name || lead.fb_adset_name || lead.g_adset_name || lead.g_term_name) && (
                                  <div className="mt-0.5 flex flex-col gap-0.5">
                                    {(lead.fb_campaign_name || lead.g_campaign_name) && (
                                      <div className="text-[9px] text-slate-500 truncate flex gap-1">
                                        <span className="font-semibold text-slate-400">Campanha:</span>
                                        <span className={isMeta ? "text-blue-600/80" : "text-emerald-600/80"}>{lead.fb_campaign_name || lead.g_campaign_name}</span>
                                      </div>
                                    )}
                                    {(lead.fb_adset_name || lead.g_adset_name) && (
                                      <div className="text-[9px] text-slate-500 truncate flex gap-1">
                                        <span className="font-semibold text-slate-400">AdGroup:</span>
                                        <span className={isMeta ? "text-blue-500/70" : "text-emerald-500/70"}>{lead.fb_adset_name || lead.g_adset_name}</span>
                                      </div>
                                    )}
                                    {lead.g_term_name && (
                                      <div className="text-[9px] text-slate-500 truncate flex gap-1">
                                        <span className="font-semibold text-slate-400">Termo:</span>
                                        <span className="text-emerald-500/70">{lead.g_term_name}</span>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                              <div className="flex flex-col items-end gap-1.5 shrink-0 ml-2">
                                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button title="Agendar consulta" onClick={() => { setScheduleLead({ lead, ticketId: ticket.id }); setScheduleForm({ doctor_id: doctors[0]?.id || '', date: '', time: '', notes: '', modality: 'presencial' }); setScheduleError(null); setScheduleSlots(null); }} className="p-0.5 text-slate-400 hover:text-indigo-600 rounded transition-colors"><CalendarPlus className="w-3 h-3" /></button>
                                  {!ticket.outcome && !isClosed && (
                                    <div className="relative">
                                      <button
                                        title="Status"
                                        onClick={e => { e.stopPropagation(); setStatusDropdownTicketId(statusDropdownTicketId === ticket.id ? null : ticket.id); }}
                                        className="p-0.5 text-slate-400 hover:text-violet-600 rounded transition-colors"
                                      >
                                        <Check className="w-3 h-3" />
                                      </button>
                                      {statusDropdownTicketId === ticket.id && (
                                        <div className="absolute right-0 top-5 z-50 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden w-28" onClick={e => e.stopPropagation()}>
                                          <button
                                            onClick={() => { setStatusDropdownTicketId(null); setGanhoLead({ id: lead.id, name: lead.name, prevStageId: ticket.stage_id, ticketId: ticket.id }); }}
                                            className="w-full flex items-center gap-2 px-3 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-50 transition-colors"
                                          >
                                            <ThumbsUp className="w-3 h-3" /> Ganho
                                          </button>
                                          <button
                                            onClick={() => { setStatusDropdownTicketId(null); setLossLead({ id: lead.id, name: lead.name, prevStageId: ticket.stage_id, ticketId: ticket.id }); }}
                                            className="w-full flex items-center gap-2 px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-50 transition-colors"
                                          >
                                            <ThumbsDown className="w-3 h-3" /> Perdido
                                          </button>
                                        </div>
                                      )}
                                    </div>
                                  )}
                                  <button title="Editar" onClick={() => openEditModal(ticket)} className="p-0.5 text-slate-400 hover:text-teal-600 rounded transition-colors"><Edit2 className="w-3 h-3" /></button>
                                  <button title="Excluir" onClick={() => openDeleteConfirm(ticket)} className="p-0.5 text-slate-400 hover:text-rose-600 rounded transition-colors"><Trash2 className="w-3 h-3" /></button>
                                </div>

                                {ticket.outcome && !isClosed && (
                                  <div className="mt-auto">
                                    {confirmingResolveId === ticket.id ? (
                                      <div className="flex gap-1 animate-in fade-in zoom-in duration-200">
                                        <button
                                          onClick={e => { e.stopPropagation(); finalizeTicket(ticket.id); setConfirmingResolveId(null); }}
                                          className="flex items-center justify-center px-1.5 py-1 bg-amber-500 text-white rounded text-[9px] font-black hover:bg-amber-600 transition-all shadow-sm"
                                        >
                                          Confirmar
                                        </button>
                                        <button
                                          onClick={e => { e.stopPropagation(); setConfirmingResolveId(null); }}
                                          className="px-1 flex items-center justify-center bg-white text-slate-600 py-1 rounded hover:bg-slate-100 border border-slate-200 transition-all shadow-sm shrink-0"
                                          title="Cancelar"
                                        >
                                          <X className="w-2.5 h-2.5" />
                                        </button>
                                      </div>
                                    ) : (
                                      <button
                                        onClick={e => { e.stopPropagation(); setConfirmingResolveId(ticket.id); }}
                                        className={cn(
                                          "flex items-center justify-center gap-1 px-2.5 py-1 rounded text-[9px] font-bold transition-all shadow-sm truncate",
                                          ticket.outcome === 'ganho'
                                            ? "bg-emerald-600 text-white hover:bg-emerald-700"
                                            : "bg-rose-600 text-white hover:bg-rose-700"
                                        )}
                                      >
                                        <Check className="w-2.5 h-2.5 shrink-0" />
                                        Resolver
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })()}

                        {/* Nome + telefone */}
                        <div className="flex items-center gap-3 mt-1.5">
                          {lead.avatar_url ? (
                            <div className="relative w-8 h-8 shrink-0">
                              <img
                                src={lead.avatar_url}
                                alt={lead.name}
                                className="w-8 h-8 rounded-full object-cover border border-slate-100"
                                onError={e => { e.currentTarget.style.display = 'none'; (e.currentTarget.nextElementSibling as HTMLElement).style.display = 'flex'; }}
                              />
                              <div style={{ display: 'none' }} className="absolute inset-0 w-8 h-8 rounded-full bg-teal-100 items-center justify-center border border-teal-100 text-teal-700 text-[10px] font-black">
                                {lead.name.charAt(0).toUpperCase()}
                              </div>
                            </div>
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center border border-slate-100 text-slate-500 text-[10px] font-black shrink-0">
                              {lead.name.charAt(0).toUpperCase()}
                            </div>
                          )}
                          <div className="min-w-0">
                            <h4 className="font-bold text-slate-900 text-sm leading-tight truncate">{lead.name}</h4>
                            {lead.phone && (
                              <p className="text-[10px] font-medium text-slate-400 mt-0.5">{lead.phone}</p>
                            )}
                          </div>
                        </div>

                        {/* Motivo da perda */}
                        {isPerdido && (
                          <div className={cn(
                            "mt-2 px-2 py-1 rounded text-[9px] font-bold flex items-center gap-1.5",
                            semMotivo
                              ? "bg-amber-50 border border-amber-200 text-amber-700"
                              : "bg-rose-50 border border-rose-100 text-rose-700"
                          )}>
                            <AlertCircle className="w-2.5 h-2.5 shrink-0" />
                            {semMotivo ? "Motivo da perda não preenchido" : (ticket.loss_reason || lead.loss_reason)}
                          </div>
                        )}

                        {/* Badges de status */}
                        {(aguardando || precisaResponder || slaBreach > 0) && (
                          <div className="flex items-center gap-1.5 mt-2">
                            {aguardando && (
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded border bg-blue-50 border-blue-200 text-blue-600">
                                Aguardando Lead
                              </span>
                            )}
                            {precisaResponder && (
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded border bg-amber-50 border-amber-200 text-amber-600">
                                Responder Lead
                              </span>
                            )}
                            {slaBreach > 0 && (
                              <span className={cn(
                                "text-[9px] font-bold px-1.5 py-0.5 rounded border",
                                slaBreach === 1
                                  ? "bg-amber-50 border-amber-200 text-amber-700"
                                  : "bg-rose-50 border-rose-100 text-rose-700"
                              )}>
                                {slaBreach}x SLA
                              </span>
                            )}
                          </div>
                        )}


                        {/* Footer: valor | tempo + chat */}
                        {(() => {
                          const conversions = conversionsByLead[lead.id];
                          const lastConversion = conversions?.[conversions.length - 1];
                          const realValue = lastConversion ? Number(lastConversion.value || 0) : 0;
                          const displayValue = realValue > 0 ? realValue : Number(lead.estimated_value || 0);
                          const isReal = realValue > 0;
                          return (
                            <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-100 gap-2">
                              <div className={cn(
                                "text-[9px] font-bold px-1.5 py-0.5 rounded border shrink-0",
                                isReal ? "bg-emerald-100 text-emerald-700 border-emerald-200" : "bg-teal-50 text-teal-700 border-teal-100"
                              )}>
                                {formatBRL(displayValue)}
                              </div>
                              <span className="text-[9px] font-medium text-slate-400 truncate text-right flex-1">
                                {formatDistanceToNow(parseISO(lastContact), { addSuffix: true, locale: ptBR })}
                              </span>
                              <button
                                onClick={() => setChatLead({ lead: ticket.lead, ticketId: ticket.id })}
                                className="p-1 text-slate-400 hover:text-teal-600 hover:bg-teal-50 rounded transition-colors shrink-0"
                                title="Abrir chat"
                              >
                                <MessageSquare className="w-3 h-3" />
                              </button>
                            </div>
                          );
                        })()}
                      </motion.div>
                    );
                  })}

                  {hasMoreInColumn && (
                    <div className="flex items-center justify-center py-2 text-[10px] font-bold text-slate-400 gap-1.5">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Role para ver mais
                    </div>
                  )}
                </div>
                <button onClick={() => { setFormData(p => ({ ...p, stage_id: stage.id, avatar_url: '' })); setShowModal(true); }} className="w-full py-1.5 border border-dashed border-slate-300 rounded-lg text-slate-400 text-xs font-semibold hover:bg-white hover:border-slate-400 transition-all flex items-center justify-center gap-1.5 shrink-0">
                  <Plus className="w-3 h-3" />
                  Adicionar Lead
                </button>
              </div>
            );
          })}
        </KanbanScrollContainer>
      </div>


      {/* Create Lead Modal */}
      <AnimatePresence>
        {showModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowModal(false)}>
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between p-6 border-b border-slate-100">
                <h3 className="text-lg font-bold text-slate-900">{selectedLead ? 'Editar Lead' : 'Novo Lead'}</h3>
                <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Nome *</label>
                  <input type="text" value={formData.name} onChange={e => setFormData(p => ({ ...p, name: e.target.value }))} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-200 font-medium text-sm" placeholder="Nome do lead" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Telefone</label>
                  <input
                    type="text"
                    value={formData.phone}
                    onChange={e => {
                      const val = e.target.value.replace(/\D/g, "");
                      let formatted = val;
                      if (val.length <= 11) {
                        if (val.length > 2) formatted = `(${val.slice(0, 2)}) ${val.slice(2)}`;
                        if (val.length > 7) formatted = `(${val.slice(0, 2)}) ${val.slice(2, 7)}-${val.slice(7, 11)}`;
                      }
                      setFormData(p => ({ ...p, phone: formatted }));
                    }}
                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-200 font-medium text-sm"
                    placeholder="(11) 99999-9999"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Plataforma</label>
                    <select value={formData.source} onChange={e => setFormData(p => ({ ...p, source: e.target.value }))} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-200 font-medium text-sm">
                      <option value="">Sem Origem</option>
                      <option value="sincronizacao">Sincronização</option>
                      <option value="meta_ads">Meta Ads</option>
                      <option value="google_ads">Google Ads</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Meio de Captação</label>
                    <select value={formData.capture_channel} onChange={e => setFormData(p => ({ ...p, capture_channel: e.target.value }))} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-200 font-medium text-sm">
                      <option value="whatsapp">WhatsApp</option>
                      <option value="forms">Formulário</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Valor do orçamento</label>
                    <CurrencyInput
                      value={formData.estimated_value}
                      onChange={val => setFormData(p => ({ ...p, estimated_value: val }))}
                      className="bg-slate-50 focus:ring-teal-200 border-slate-200"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">URL da Foto</label>
                    <input type="text" value={formData.avatar_url} onChange={e => setFormData(p => ({ ...p, avatar_url: e.target.value }))} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-200 font-medium text-sm" placeholder="https://..." />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Etapa do Funil</label>
                  <select value={formData.stage_id} onChange={e => setFormData(p => ({ ...p, stage_id: e.target.value }))} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-200 font-medium text-sm">
                    {stages.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                {stages.find(s => s.id === formData.stage_id)?.slug === 'perdido' && (
                  <div>
                    <label className="block text-xs font-semibold text-rose-500 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      Motivo da Perda
                    </label>
                    <select
                      value={formData.loss_reason}
                      onChange={e => setFormData(p => ({ ...p, loss_reason: e.target.value }))}
                      className="w-full px-4 py-2.5 bg-rose-50 border border-rose-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-200 font-medium text-sm"
                    >
                      <option value="">Selecione um motivo...</option>
                      <option value="Preco alto">Preco alto</option>
                      <option value="Escolheu concorrente">Escolheu concorrente</option>
                      <option value="Nao respondeu">Nao respondeu</option>
                      <option value="Sem interesse">Sem interesse</option>
                      <option value="Fora do perfil">Fora do perfil</option>
                      <option value="Agendou e nao compareceu">Agendou e nao compareceu</option>
                      <option value="Tentativas de follow-up esgotadas">Tentativas de follow-up esgotadas</option>
                      <option value="Outro">Outro</option>
                    </select>
                  </div>
                )}
              </div>


              <div className="flex gap-3 p-6 border-t border-slate-100 bg-slate-50">
                <Button variant="outline" className="flex-1" onClick={() => setShowModal(false)}>Cancelar</Button>
                <Button className="flex-1" onClick={handleSubmit} disabled={!formData.name.trim() || submitting}>
                  {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : selectedLead ? <Edit2 className="w-4 h-4 mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
                  {selectedLead ? 'Atualizar' : 'Cadastrar'}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {showDeleteConfirm && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4" onClick={() => setShowDeleteConfirm(false)}>
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="bg-white rounded-xl shadow-xl w-full max-sm overflow-hidden" onClick={e => e.stopPropagation()}>
              <div className="p-6 text-center">
                <div className="w-12 h-12 bg-rose-50 rounded-full flex items-center justify-center mx-auto mb-4"><AlertCircle className="w-6 h-6 text-rose-600" /></div>
                <h3 className="text-xl font-bold text-slate-900 mb-2">Excluir Lead</h3>
                <p className="text-slate-500">Tem certeza que deseja excluir este lead? Esta acao nao pode ser desfeita.</p>
                {selectedLead && (
                  <div className="mt-4 p-3 bg-slate-50 rounded-lg text-sm text-left border border-slate-100">
                    <p className="font-semibold text-slate-700">{selectedLead.name}</p>
                    <p className="text-slate-500 text-xs">
                      Valor do orçamento: {
                        formatBRL(
                          conversionsByLead[selectedLead.id]?.[conversionsByLead[selectedLead.id].length - 1]?.value ?? 
                          selectedLead.estimated_value ?? 
                          0
                        )
                      }
                    </p>
                  </div>
                )}
              </div>
              <div className="flex gap-3 p-6 border-t border-slate-100 bg-slate-50">
                <Button variant="outline" className="flex-1" onClick={() => setShowDeleteConfirm(false)}>Cancelar</Button>
                <Button variant="destructive" className="flex-1" onClick={handleDelete} disabled={submitting}>
                  {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Trash2 className="w-4 h-4 mr-2" />}
                  Excluir
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Stage Settings Modal */}
      <AnimatePresence>
        {showSettingsModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4" onClick={() => setShowSettingsModal(false)}>
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between p-6 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <div className="p-2 bg-teal-50 rounded-lg">
                    <Settings className="w-5 h-5 text-teal-600" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-slate-900">Configurar Etapas</h3>
                    <p className="text-xs text-slate-500">Reordene as fases do seu funil comercial.</p>
                  </div>
                </div>
                <button onClick={() => setShowSettingsModal(false)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
              </div>

              <div className="p-6 max-h-[400px] overflow-y-auto space-y-4 custom-scrollbar">
                <div className="space-y-2">
                  {localStages.map((stage, idx) => (
                    <div
                      key={stage.id}
                      className={cn(
                        "flex items-center justify-between p-3 rounded-xl border transition-all",
                        stage.slug ? "bg-slate-50 border-slate-200" : "bg-white border-slate-200 hover:border-teal-300 hover:shadow-sm"
                      )}
                    >
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <div className={cn("w-3 h-3 rounded-full shrink-0", stageColors[stage.color] || 'bg-slate-500')} />
                        {editingStageId === stage.id ? (
                          <input
                            autoFocus
                            type="text"
                            value={editingStageName}
                            onChange={e => setEditingStageName(e.target.value)}
                            onKeyDown={async (e) => {
                              if (e.key === 'Enter' && editingStageName.trim()) {
                                await updateStage(stage.id, { name: editingStageName.trim() });
                                setLocalStages(p => p.map(s => s.id === stage.id ? { ...s, name: editingStageName.trim() } : s));
                                setEditingStageId(null);
                              } else if (e.key === 'Escape') {
                                setEditingStageId(null);
                              }
                            }}
                            onBlur={async () => {
                              if (editingStageName.trim() && editingStageName.trim() !== stage.name) {
                                await updateStage(stage.id, { name: editingStageName.trim() });
                                setLocalStages(p => p.map(s => s.id === stage.id ? { ...s, name: editingStageName.trim() } : s));
                              }
                              setEditingStageId(null);
                            }}
                            className="flex-1 px-2 py-1 text-sm font-bold bg-white border border-teal-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-200"
                          />
                        ) : (
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-slate-700 truncate">{stage.name}</p>
                            {stage.slug && <span className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter">Sistema</span>}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-1 shrink-0 ml-2">
                        <button
                          disabled={idx === 0}
                          onClick={() => {
                            const newStages = [...localStages];
                            [newStages[idx], newStages[idx - 1]] = [newStages[idx - 1], newStages[idx]];
                            setLocalStages(newStages);
                          }}
                          className="p-1.5 text-slate-400 hover:text-teal-600 hover:bg-teal-50 rounded-md disabled:opacity-30"
                        >
                          <ChevronUp className="w-4 h-4" />
                        </button>
                        <button
                          disabled={idx === localStages.length - 1}
                          onClick={() => {
                            const newStages = [...localStages];
                            [newStages[idx], newStages[idx + 1]] = [newStages[idx + 1], newStages[idx]];
                            setLocalStages(newStages);
                          }}
                          className="p-1.5 text-slate-400 hover:text-teal-600 hover:bg-teal-50 rounded-md disabled:opacity-30"
                        >
                          <ChevronDown className="w-4 h-4" />
                        </button>
                        {!stage.is_system && (
                          <>
                            <button
                              onClick={() => { setEditingStageId(stage.id); setEditingStageName(stage.name); }}
                              className="p-1.5 text-slate-400 hover:text-teal-600 hover:bg-teal-50 rounded-md"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button
                              onClick={async () => {
                                if (confirm(`Deseja realmente excluir a etapa "${stage.name}"?`)) {
                                  await removeStage(stage.id);
                                  setLocalStages(p => p.filter(s => s.id !== stage.id));
                                }
                              }}
                              className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-md"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {isAddingStage ? (
                  <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="p-4 bg-teal-50/50 rounded-xl border border-teal-100 flex gap-2">
                    <input
                      autoFocus
                      type="text"
                      value={newStageName}
                      onChange={e => setNewStageName(e.target.value)}
                      placeholder="Nome da etapa"
                      className="flex-1 px-3 py-1.5 text-sm bg-white border border-teal-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-200"
                      onKeyDown={async (e) => {
                        if (e.key === 'Enter' && newStageName.trim()) {
                          const newStage = await createStage({
                            name: newStageName,
                            color: 'bg-teal-500',
                            is_fixed: false,
                            is_system: false
                          });
                          if (newStage) {
                            setLocalStages(p => [...p, newStage]);
                            setNewStageName("");
                            setIsAddingStage(false);
                          }
                        }
                      }}
                    />
                    <Button size="sm" onClick={async () => {
                      if (!newStageName.trim()) return;
                      const newStage = await createStage({
                        name: newStageName,
                        color: 'bg-teal-500',
                        is_fixed: false,
                        is_system: false
                      });
                      if (newStage) {
                        setLocalStages(p => [...p, newStage]);
                        setNewStageName("");
                        setIsAddingStage(false);
                      }
                    }}>Adicionar</Button>
                    <Button size="sm" variant="ghost" onClick={() => setIsAddingStage(false)}>X</Button>
                  </motion.div>
                ) : (
                  <button
                    onClick={() => setIsAddingStage(true)}
                    className="w-full py-3 border border-dashed border-slate-300 rounded-xl text-slate-400 text-sm font-bold hover:bg-slate-50 hover:border-slate-400 transition-all flex items-center justify-center gap-2"
                  >
                    <Plus className="w-4 h-4" />
                    Nova Etapa
                  </button>
                )}
              </div>

              <div className="flex gap-3 p-6 border-t border-slate-100 bg-slate-50">
                <Button variant="outline" className="flex-1" onClick={() => setShowSettingsModal(false)}>Cancelar</Button>
                <Button className="flex-1" onClick={async () => {
                  setSubmitting(true);
                  await reorderStages(localStages);
                  setSubmitting(false);
                  setShowSettingsModal(false);
                }} disabled={submitting}>
                  {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  Salvar Ordem
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>



      {/* Export Modal */}
      {exportOpen && <ExportModal onClose={() => setExportOpen(false)} />}

      {/* Ganho Modal */}
      {ganhoLead && (
        <GanhoModal
          lead={ganhoLead}
          onClose={() => setGanhoLead(null)}
          onCancel={() => {
            const { ticketId, prevStageId } = ganhoLead;
            setGanhoLead(null);
            if (prevStageId) moveTicket(ticketId, prevStageId);
          }}
          onCreate={async (data) => {
            const ok = await createConversion(data);
            if (ok) {
              const ganhoStage = stages.find(s => s.slug === 'ganho');
              if (ganhoStage) await moveTicket(ganhoLead.ticketId, ganhoStage.id);
              await closeTicket(ganhoLead.ticketId, 'ganho');
            }
            return ok;
          }}
        />
      )}

      {/* Loss Modal */}
      {lossLead && (
        <LossModal
          lead={lossLead}
          onClose={() => setLossLead(null)}
          onCancel={() => {
            const { ticketId, prevStageId } = lossLead;
            setLossLead(null);
            if (prevStageId) moveTicket(ticketId, prevStageId);
          }}
          onConfirm={async (reason) => {
            await update(lossLead.id, { loss_reason: reason || null });
            const perdidoStage = stages.find(s => s.slug === 'perdido');
            if (perdidoStage) await moveTicket(lossLead.ticketId, perdidoStage.id);
            await closeTicket(lossLead.ticketId, 'perdido', reason || undefined);
          }}
        />
      )}

      {/* Orçamento Modal */}
      {orcamentoLead && (
        <OrcamentoModal
          lead={orcamentoLead}
          onClose={() => setOrcamentoLead(null)}
          onCancel={() => {
            const { ticketId, prevStageId } = orcamentoLead;
            setOrcamentoLead(null);
            if (prevStageId) moveTicket(ticketId, prevStageId);
          }}
          onConfirm={async (data) => {
            const ok = await createConversion({
              ...data,
              description: 'Orçamento Enviado',
            });
            if (ok) {
              const orcStage = stages.find(s => s.slug === 'orcamento');
              if (orcStage) await moveTicket(orcamentoLead.ticketId, orcStage.id);
            }
            return ok;
          }}
        />
      )}

      {/* Lead Chat Drawer */}
      <AnimatePresence>
        {chatLead && (
          <LeadChat
            lead={chatLead.lead}
            ticketId={chatLead.ticketId}
            onClose={() => setChatLead(null)}
            isDragging={draggedLead !== null}
            onGanho={() => setGanhoLead({ id: chatLead.lead.id, name: chatLead.lead.name, prevStageId: null, ticketId: chatLead.ticketId })}
            onPerdido={() => setLossLead({ id: chatLead.lead.id, name: chatLead.lead.name, prevStageId: null, ticketId: chatLead.ticketId })}
            onStageChange={async (stageId) => {
              const targetStage = stages.find(s => s.id === stageId);
              const ticket = tickets.find(t => t.id === chatLead.ticketId);
              if (ticket && stageId !== ticket.stage_id) {
                if (targetStage?.slug === 'perdido') {
                  await closeTicket(ticket.id, 'perdido');
                } else if (targetStage?.slug === 'ganho') {
                  setGanhoLead({ id: chatLead.lead.id, name: chatLead.lead.name, prevStageId: ticket.stage_id, ticketId: ticket.id });
                } else if (targetStage?.slug === 'orcamento') {
                  setOrcamentoLead({ id: chatLead.lead.id, name: chatLead.lead.name, prevStageId: ticket.stage_id, ticketId: ticket.id });
                } else {
                  await moveTicket(ticket.id, stageId);
                }
              }
            }}
          />
        )}
      </AnimatePresence>

      {/* Quick Schedule Modal */}
      <AnimatePresence>
        {scheduleLead && (
          <div className="fixed inset-0 bg-black/50 z-[70] flex items-center justify-center p-4" onClick={() => setScheduleLead(null)}>
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white rounded-xl shadow-xl w-full max-w-sm overflow-hidden"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between p-5 border-b border-slate-100">
                <div>
                  <h3 className="text-base font-bold text-slate-900">Agendar Consulta</h3>
                  <p className="text-xs text-slate-400 mt-0.5">{scheduleLead.lead.name}</p>
                </div>
                <button onClick={() => setScheduleLead(null)} className="p-1.5 text-slate-400 hover:text-slate-600 rounded-full"><X className="w-4 h-4" /></button>
              </div>
              <div className="p-5 space-y-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Médico *</label>
                  <select value={scheduleForm.doctor_id} onChange={e => setScheduleForm(p => ({ ...p, doctor_id: e.target.value, time: '' }))} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium outline-none focus:ring-2 focus:ring-teal-200">
                    <option value="">Selecione</option>
                    {doctors.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Data *</label>
                  <input type="date" value={scheduleForm.date} onChange={e => setScheduleForm(p => ({ ...p, date: e.target.value, time: '' }))} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium outline-none focus:ring-2 focus:ring-teal-200" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Modalidade</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => setScheduleForm(p => ({ ...p, modality: 'presencial' }))} className={`py-2 rounded-lg border text-xs font-bold transition-all ${scheduleForm.modality === 'presencial' ? 'bg-emerald-500 text-white border-emerald-500' : 'bg-white text-slate-600 border-slate-200 hover:border-emerald-300'}`}>Presencial</button>
                    <button type="button" onClick={() => setScheduleForm(p => ({ ...p, modality: 'online' }))} className={`py-2 rounded-lg border text-xs font-bold transition-all ${scheduleForm.modality === 'online' ? 'bg-sky-500 text-white border-sky-500' : 'bg-white text-slate-600 border-slate-200 hover:border-sky-300'}`}>Online</button>
                  </div>
                </div>
                {scheduleForm.doctor_id && scheduleForm.date && (
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Horário *</label>
                    {scheduleSlotsLoading ? (
                      <div className="p-3 bg-slate-50 border border-slate-100 rounded-lg text-slate-400 text-xs font-bold flex items-center">
                        <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> Carregando horários...
                      </div>
                    ) : !scheduleSlots || scheduleSlots.length === 0 ? (
                      <div className="p-3 bg-rose-50 border border-rose-100 rounded-lg text-rose-600 text-xs font-bold">
                        Sem horários disponíveis nesta data.
                      </div>
                    ) : (
                      <div className="grid grid-cols-4 gap-1.5">
                        {scheduleSlots.map(s => (
                          <button key={s} type="button" onClick={() => setScheduleForm(p => ({ ...p, time: s }))} className={`py-1.5 text-xs font-bold rounded border transition-all ${scheduleForm.time === s ? 'bg-teal-600 text-white border-teal-600' : 'bg-white text-slate-600 border-slate-200 hover:border-teal-300'}`}>{s}</button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Observações</label>
                  <input type="text" value={scheduleForm.notes} onChange={e => setScheduleForm(p => ({ ...p, notes: e.target.value }))} placeholder="Opcional..." className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium outline-none focus:ring-2 focus:ring-teal-200" />
                </div>
                {scheduleError && (
                  <div className="p-3 bg-rose-50 border border-rose-100 rounded-lg text-rose-600 text-xs font-medium">
                    {scheduleError}
                  </div>
                )}
              </div>
              <div className="flex gap-3 p-5 border-t border-slate-100 bg-slate-50">
                <Button variant="outline" className="flex-1 font-bold" onClick={() => setScheduleLead(null)}>Cancelar</Button>
                <Button
                  className="flex-1 font-bold bg-teal-600 hover:bg-teal-700"
                  disabled={!scheduleForm.doctor_id || !scheduleForm.date || !scheduleForm.time || scheduleSubmitting}
                  onClick={async () => {
                    setScheduleSubmitting(true);
                    setScheduleError(null);
                    const sl = scheduleLead.lead;
                    // RPC atômica: resolve paciente + vincula lead + cria appointment com proteção a sobreposição
                    const { data, error } = await supabase.rpc('convert_lead_to_appointment', {
                      p_clinic_id: sl.clinic_id,
                      p_lead_id: sl.id,
                      p_doctor_id: scheduleForm.doctor_id,
                      p_date: scheduleForm.date,
                      p_time: scheduleForm.time,
                      p_modality: scheduleForm.modality,
                      p_notes: scheduleForm.notes || null,
                      p_ticket_id: scheduleLead.ticketId || null,
                    });
                    setScheduleSubmitting(false);
                    if (error) {
                      setScheduleError(error.message || 'Erro ao agendar.');
                      return;
                    }
                    const result = data as { success: boolean; error_code?: string };
                    if (!result?.success) {
                      const msgs: Record<string, string> = {
                        slot_conflict: 'Esse horário acabou de ser reservado. Escolha outro.',
                        lead_not_found: 'Lead não encontrado.',
                        doctor_not_found: 'Médico não encontrado.',
                        doctor_clinic_mismatch: 'Médico não pertence à clínica.',
                        doctor_inactive: 'Médico inativo.',
                      };
                      setScheduleError(msgs[result?.error_code || ''] || 'Não foi possível agendar.');
                      if (result?.error_code === 'slot_conflict') {
                        setScheduleSlots(null);
                        setTimeout(() => setScheduleForm(p => ({ ...p, time: '' })), 0);
                      }
                      return;
                    }
                    setScheduleLead(null);
                  }}
                >
                  {scheduleSubmitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <CalendarPlus className="w-4 h-4 mr-2" />}
                  Agendar
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
