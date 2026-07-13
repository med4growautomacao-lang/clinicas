import React, { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { useToast } from "./ui/toast";
import { matchesSearch, leadSearchOrFilter } from "../lib/search";
import { LeadJourney } from "./LeadJourney";
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
  UserX,
  Store,
  Package,
  Printer,
} from "lucide-react";
import { cn } from "@/src/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { useFunnelStages, useLeads, useNotLeads, useTickets, useSettings, useTransitionRules, useConversions, useFinancial, useProtocols, useProducts, Product, ProductInput, ProductAttribute, useQuoteImages, useAppointments, useDoctors, usePatients, useConsultationTypes, useProductionOrders, useInventoryItems, useOrcamentos, getVigenteOrcamento, Conversion, Lead, Ticket, TransitionRule } from "../hooks/useSupabase";
import { NotLeadPanel } from "./NotLeadPanel";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import { format, parseISO, formatDistanceToNow } from "date-fns";
import GoogleLogo from "../assets/logos/Logo Googleads.png";
import MetaLogo from "../assets/logos/Logo Metaads.png";
import WhatsAppLogo from "../assets/logos/Logo Whatsapp.png";
import SemOrigemLogo from "../assets/logos/Logo Sem origem.png";
import { Share2, Globe, Layout, Smartphone, Sparkles, Instagram, PhoneOff, RotateCcw } from "lucide-react";
import { DateRangePicker } from "./DateRangePicker";
import { UtmLeadFilter, leadUtmKey, NO_UTM_KEY } from "./filters/UtmLeadFilter";
import { QuoteDocument, formatValidade, useImageDataUrl } from "./QuoteDocument";
import { ProductionOrderDocument } from "./ProductionOrderDocument";

const SOURCE_LABELS: Record<string, string> = {
  'meta_ads': 'Meta Ads',
  'google_ads': 'Google Ads',
  'instagram': 'Instagram',
  'sincronizacao': 'Sincronização',
  'whatsapp': 'WhatsApp',
  'forms': 'Forms',
  '': 'Orgânico',
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
        .select('id, direction, sender, message, created_at, lead_id, leads!left(name, phone, source, capture_channel)')
        .eq('clinic_id', activeClinicId)
        .gte('created_at', dateFrom + 'T00:00:00')
        .lte('created_at', dateTo + 'T23:59:59')
        .order('created_at', { ascending: true });

      if (selectedLeadId) query = (query as any).eq('lead_id', selectedLeadId);

      const { data: rows, error } = await query;
      if (error) throw error;

      const stageMap: Record<string, string> = {};
      stages.forEach(s => { stageMap[s.id] = s.name; });

      // Stage atual de cada lead vem do ticket aberto (vw_lead_active_stage)
      const leadIds = Array.from(new Set((rows || []).map((r: any) => r.lead_id).filter(Boolean)));
      const stageByLead: Record<string, string | null> = {};
      if (leadIds.length > 0) {
        const { data: vwRows } = await supabase
          .from('vw_lead_active_stage')
          .select('lead_id, stage_id')
          .in('lead_id', leadIds);
        (vwRows || []).forEach((s: any) => { stageByLead[s.lead_id] = s.stage_id; });
      }

      let filtered = (rows || []).filter((r: any) => {
        const lead = r.leads;
        if (selectedSource !== null && (lead?.source ?? '') !== selectedSource) return false;
        if (selectedStageId) {
          const currentStage = r.lead_id ? stageByLead[r.lead_id] : null;
          if (currentStage !== selectedStageId) return false;
        }
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
          const currentStageId = r.lead_id ? stageByLead[r.lead_id] : null;
          const stageName = currentStageId ? (stageMap[currentStageId] || '') : '';
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
            const currentStageId = r.lead_id ? stageByLead[r.lead_id] : null;
            grouped[lid] = {
              lead: { id: lid, name: lead?.name || '', phone: lead?.phone || '', source: lead?.source || '', stage: currentStageId ? (stageMap[currentStageId] || '') : '' },
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
                  )}>{SOURCE_LABELS[s] || s || 'Orgânico'}</button>
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

  const REASONS = ['Preço alto', 'Escolheu concorrente', 'Não respondeu', 'Sem interesse', 'Fora do perfil', 'Fora do raio', 'Agendou e não compareceu', 'Tentativas de follow-up esgotadas', 'Outro'];
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

function GanhoModal({ lead, onClose, onCancel, onCreate, createPatient, updateLead }: {
  lead: { id: string; name: string; phone?: string | null; patientId?: string | null };
  onClose: () => void;
  onCancel: () => void;
  onCreate: (data: Omit<Conversion, 'id' | 'clinic_id' | 'created_at'>) => Promise<boolean>;
  createPatient: (p: { name: string; phone: string | null }) => Promise<{ id: string } | null>;
  updateLead: (id: string, payload: { converted_patient_id: string }) => Promise<unknown>;
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
    // Garante um paciente vinculado ao lead ANTES de fechar o ticket — senão o trigger
    // fn_auto_create_lead_on_patient abriria um ticket novo. Sem patient_id, a receita
    // nasce órfã e some do "Faturamento real" quando há filtro de coorte (Entrada).
    let patientId = lead.patientId ?? null;
    if (!patientId) {
      const np = await createPatient({ name: lead.name, phone: lead.phone ?? null });
      if (np?.id) {
        patientId = np.id;
        // O trigger já liga por telefone; este update cobre o caso de lead sem telefone.
        await updateLead(lead.id, { converted_patient_id: np.id });
      }
    }
    // Cria a receita PRIMEIRO para vincular a conversão a ela (financial_transaction_id).
    // Esse vínculo deixa a limpeza automática confiável: quando o ticket sai de 'ganho', o
    // gatilho fn_purge_ticket_sale apaga a conversão E a receita ligada (sem órfão no Financeiro).
    const tx = await createTransaction({
      type: 'receita',
      category: 'Consulta',
      amount: Number(value),
      description: description || 'Venda registrada',
      payment_method: paymentMethod as any,
      status: txStatus,
      date,
      protocol_ids: protocolIds,
      patient_id: patientId ?? undefined,
    });
    const ok = await onCreate({
      lead_id: lead.id,
      value: Number(value),
      description: description || null,
      payment_method: paymentMethod,
      protocol_ids: protocolIds,
      converted_at: new Date(date + 'T12:00:00').toISOString(),
      financial_transaction_id: (tx as any)?.id ?? null,
    });
    if (ok) {
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

// Quantidade "bonita": sem casas decimais forçadas (30, 1,5, 12,25...).
const formatQty = (n: number) => Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 3 });

// Pequena pausa (usada só na espera de propagação da URL do Storage).
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
// `delay` nativo da uazapi (ms): espaça os envios NO SERVIDOR e mostra "enviando…" (presença).
// Awaited + sequencial => serializa e evita a rajada que o WhatsApp rejeita.
const DOC_SEND_DELAY_MS = 1000;   // documento do orçamento
const PHOTO_SEND_DELAY_MS = 1500; // cada foto do banco
// Espera o arquivo recém-subido ficar acessível publicamente antes de o uazapi buscá-lo pela URL.
const waitForPublicUrl = async (url: string, tries = 5) => {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url, { method: 'HEAD', cache: 'no-store' }); if (r.ok) return true; } catch { /* rede */ }
    await sleep(500);
  }
  return false;
};

// Token de acesso FRESCO: o access token do Supabase vence (~1h) e com o modal aberto muito tempo
// a `send-quote` voltava 401 (Unauthorized). Renova se estiver ausente ou perto de expirar (<60s).
async function ensureFreshToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  const s = data.session;
  const expMs = (s?.expires_at ?? 0) * 1000;
  if (s?.access_token && expMs > Date.now() + 60_000) return s.access_token;
  const { data: r } = await supabase.auth.refreshSession();
  return r.session?.access_token ?? s?.access_token ?? null;
}
// Invoca a edge `send-quote` com Authorization fresco; devolve também o status HTTP (p/ tratar 401).
async function callSendQuote(payload: any): Promise<{ data: any; error: any; status?: number }> {
  const token = await ensureFreshToken();
  const { data, error } = await supabase.functions.invoke('send-quote', {
    body: payload,
    ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
  });
  const status = (error as any)?.context?.status as number | undefined;
  return { data, error, status };
}

// Produtos vendidos por m²: a área = quantidade (comprimento) × altura. A altura vem do
// campo personalizado "altura" do produto. Multiplicador = altura (>0) quando a unidade é m².
const isM2Unit = (unit?: string) => /m²|m2/i.test(unit || '');
// Item cobrado por área: toggle explícito do produto OU unidade m².
const isAreaItem = (item?: { unit?: string; charge_by_area?: boolean }) => !!item && (item.charge_by_area === true || isM2Unit(item.unit));
const alturaOf = (attributes?: { label: string; value: string }[]) => {
  const a = (attributes || []).find(x => (x.label || '').toLowerCase().includes('altura'));
  const n = a ? Number(String(a.value).replace(',', '.').replace(/[^\d.]/g, '')) : 0;
  return n > 0 ? n : 0;
};
// Altura efetiva p/ itens por área: valor digitado na linha (l.altura) tem prioridade sobre o campo do produto.
const lineAlturaFor = (byArea: boolean, attributes: { label: string; value: string }[] | undefined, lineAltura?: string) => {
  if (!byArea) return 1;
  const typed = Number(String(lineAltura ?? '').replace(',', '.'));
  if (String(lineAltura ?? '').trim() !== '' && !isNaN(typed) && typed > 0) return typed;
  const fb = alturaOf(attributes);
  return fb > 0 ? fb : 1;
};

// Texto legível sobre um fundo colorido (hex #rrggbb): claro→escuro, escuro→branco.
const contrastText = (hex?: string | null) => {
  if (!hex) return '#334155';
  const h = hex.replace('#', '');
  if (h.length !== 6) return '#334155';
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62 ? '#0f172a' : '#ffffff';
};

// Seletor de produto/protocolo estilizado (substitui o <select> nativo, seguindo o design do
// sistema): cada produto aparece PREENCHIDO com a sua cor configurada. O dropdown é renderizado
// via portal (position:fixed no rect do botão) p/ não ser cortado pelo scroll/overflow do modal.
function ProductPicker({ value, products, protocols, useProd, useProt, sourceNoun, onSelect }: {
  value: string;
  products: { id: string; name: string; color?: string | null }[];
  protocols: { id: string; name: string }[];
  useProd: boolean;
  useProt: boolean;
  sourceNoun: string;
  onSelect: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<{ left: number; top: number; width: number } | null>(null);

  const selProd = value.startsWith('p:') ? products.find(p => `p:${p.id}` === value) : null;
  const selProt = value.startsWith('t:') ? protocols.find(p => `t:${p.id}` === value) : null;
  const selName = selProd?.name ?? selProt?.name ?? '';
  const selColor = selProd?.color ?? null;

  useEffect(() => {
    if (!open) return;
    const place = () => { const r = btnRef.current?.getBoundingClientRect(); if (r) setRect({ left: r.left, top: r.bottom + 4, width: r.width }); };
    place();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!btnRef.current?.contains(t) && !menuRef.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  const pick = (v: string) => { setOpen(false); onSelect(v); };

  return (
    <div className="flex-1 min-w-0">
      <button
        type="button"
        ref={btnRef}
        onClick={() => setOpen(o => !o)}
        className="w-full min-w-0 px-2.5 py-2 border border-slate-200 rounded-lg text-sm font-medium bg-white flex items-center gap-2 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
      >
        {selColor && <span className="w-3.5 h-3.5 rounded-[3px] shrink-0 border border-black/10" style={{ backgroundColor: selColor }} />}
        <span className={cn("flex-1 min-w-0 truncate text-left", !selName && "text-slate-400")}>{selName || `Selecione um ${sourceNoun}…`}</span>
        <ChevronDown className={cn("w-4 h-4 text-slate-400 shrink-0 transition-transform", open && "rotate-180")} />
      </button>
      {open && rect && createPortal(
        <div
          ref={menuRef}
          style={{ position: 'fixed', left: rect.left, top: rect.top, width: rect.width, zIndex: 200 }}
          className="max-h-64 overflow-auto rounded-xl border border-slate-200 bg-white shadow-xl py-1"
        >
          <button type="button" onClick={() => pick('')} className="w-full text-left px-3 py-2 text-sm font-medium text-slate-400 hover:bg-slate-50">Selecione um {sourceNoun}…</button>
          {useProd && products.length > 0 && (
            <>
              <div className="px-3 pt-1.5 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">Produtos</div>
              {products.map(op => {
                const on = value === `p:${op.id}`;
                const colored = !!op.color;
                return (
                  <button
                    key={op.id}
                    type="button"
                    onClick={() => pick(`p:${op.id}`)}
                    style={colored ? { backgroundColor: op.color as string, color: contrastText(op.color) } : undefined}
                    className={cn("w-full text-left px-3 py-2 text-sm font-medium flex items-center justify-between gap-2", colored ? "hover:opacity-90" : "text-slate-700 hover:bg-slate-50")}
                  >
                    <span className="truncate">{op.name}</span>
                    {on && <Check className="w-4 h-4 shrink-0" />}
                  </button>
                );
              })}
            </>
          )}
          {useProt && protocols.length > 0 && (
            <>
              <div className="px-3 pt-1.5 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">Protocolos</div>
              {protocols.map(op => {
                const on = value === `t:${op.id}`;
                return (
                  <button key={op.id} type="button" onClick={() => pick(`t:${op.id}`)} className="w-full text-left px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 flex items-center justify-between gap-2">
                    <span className="truncate">{op.name}</span>
                    {on && <Check className="w-4 h-4 shrink-0 text-blue-600" />}
                  </button>
                );
              })}
            </>
          )}
          {useProd && (
            <>
              <div className="border-t border-slate-100 my-1" />
              <button type="button" onClick={() => pick('__new__')} className="w-full text-left px-3 py-2 text-sm font-bold text-teal-600 hover:bg-teal-50">➕ Cadastrar novo produto…</button>
            </>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}

// Modal ao mover para "Orçamento Enviado": monta o orçamento selecionando produtos do
// catálogo (produto + quantidade => subtotal = qtd × valor/unidade) e soma o total.
// NÃO gera conversão — só grava metadados no lead (estimated_value = total) e no ticket
// (notes = resumo itemizado em texto). Se a clínica ainda não tem catálogo, cai no modo
// manual (digita o valor), preservando o comportamento anterior.
function OrcamentoModal({ lead, initialQuote, onClose, onCancel, onConfirm }: {
  lead: { id: string; name: string; phone?: string | null };
  initialQuote?: any;
  onClose: () => void;
  onCancel: () => void;
  onConfirm: (value: number, description: string, quoteData: any, status: 'rascunho' | 'enviado') => Promise<boolean>;
}) {
  const iq: any = initialQuote ?? null; // orçamento salvo (editar) — tem prioridade sobre o modelo
  const showToast = useToast();
  const { activeClinicId } = useAuth();
  const { clinic } = useSettings();
  const { data: products, create: createProduct } = useProducts();
  const { data: protocols } = useProtocols();
  const { data: quoteImages } = useQuoteImages();
  const logoDataUrl = useImageDataUrl(clinic?.logo_url);
  const [imgChecked, setImgChecked] = useState<Record<string, boolean>>({});
  const imgTouchedRef = useRef(false);       // usuário mexeu na seleção manualmente → não re-semear
  const iqImgSeededRef = useRef(false);       // restauração da seleção do orçamento salvo (1x)
  const [quickNewFor, setQuickNewFor] = useState<number | null>(null); // linha que está cadastrando produto novo
  const qtyRefs = useRef<Record<number, HTMLInputElement | null>>({}); // foca a quantidade ao selecionar o item

  // Fontes de item conforme a Configuração do Orçamento da clínica (padrão: ambas ligadas).
  const useProd = clinic?.quote_use_products !== false;
  const useProt = clinic?.quote_use_protocols !== false;
  const showTotal = clinic?.quote_show_total !== false; // mostra/envia a soma total (config da clínica)
  const activeProducts = useMemo(() => useProd ? products.filter(p => p.is_active) : [], [products, useProd]);
  const activeProtocols = useMemo(() => useProt ? protocols.filter(p => p.is_active) : [], [protocols, useProt]);
  // No orçamento escolhe-se o MODELO (altura null); a altura é digitada na linha e o SKU daquela
  // altura é resolvido/criado na aprovação. Os SKUs por altura ficam fora do seletor (só aparecem
  // se já estiverem escolhidos numa linha antiga — ver pickerProducts).
  const baseProducts = useMemo(() => activeProducts.filter(p => p.altura == null), [activeProducts]);

  // Item unificado (produto OU protocolo). Protocolo = valor fixo, sem unidade/especificações.
  type CatItem = { id: string; kind: 'product' | 'protocol'; name: string; description: string | null; unit: string; unit_price: number; attributes: ProductAttribute[]; charge_by_area?: boolean; altura?: number | null };
  const catalogItems = useMemo<CatItem[]>(() => [
    ...activeProducts.map(p => ({ id: `p:${p.id}`, kind: 'product' as const, name: p.name, description: p.description, unit: p.unit, unit_price: Number(p.unit_price), attributes: p.attributes ?? [], charge_by_area: !!p.charge_by_area, altura: p.altura ?? null })),
    ...activeProtocols.map(t => ({ id: `t:${t.id}`, kind: 'protocol' as const, name: t.name, description: t.description, unit: 'serviço', unit_price: Number(t.price ?? 0), attributes: [] as ProductAttribute[], charge_by_area: false, altura: null })),
  ], [activeProducts, activeProtocols]);
  const itemById = useMemo(() => {
    const m: Record<string, CatItem> = {};
    catalogItems.forEach(it => { m[it.id] = it; });
    return m;
  }, [catalogItems]);
  const hasCatalog = catalogItems.length > 0;

  // Rótulos adaptados às fontes ativas na Configuração do Orçamento.
  const onlyProt = useProt && !useProd;
  const sourceNoun = (useProd && useProt) ? 'item' : (onlyProt ? 'protocolo' : 'produto');
  const sectionLabel = (useProd && useProt) ? 'Itens' : (onlyProt ? 'Protocolos' : 'Produtos');

  type Line = { productId: string; qty: string; price: string; discount: string; fee: string; altura?: string };
  const [lines, setLines] = useState<Line[]>(Array.isArray(iq?.lines) && iq.lines.length ? iq.lines : [{ productId: '', qty: '', price: '', discount: '', fee: '', altura: '' }]);
  const [feeOpen, setFeeOpen] = useState<Record<number, boolean>>({}); // desconto/frete por linha (ocultos por padrão; setinha p/ mostrar)
  const [manualValue, setManualValue] = useState(iq?.manualValue ?? '');
  const [notes, setNotes] = useState(iq?.notes ?? '');

  // Etapa 2 (opcional): configuracao da mensagem enviada por WhatsApp.
  // Valores iniciais vêm do "modelo do orçamento" da clínica (clinic.quote_template).
  const firstName = (lead.name || '').trim().split(/\s+/)[0] || '';
  const tpl: any = clinic?.quote_template ?? {};
  const initSaudacao = String(tpl.saudacao ?? 'Olá {nome}! 👋').split('{nome}').join(firstName).replace(/\s+([!?.,])/g, '$1');
  const [step, setStep] = useState<1 | 2>(1);
  const [saudacao, setSaudacao] = useState(iq?.saudacao ?? initSaudacao);
  const [rodape, setRodape] = useState(iq?.rodape ?? String(tpl.rodape ?? 'Qualquer dúvida, estou à disposição! 😊'));
  const [validade, setValidade] = useState(iq?.validade ?? String(tpl.validade ?? ''));
  const [pagamento, setPagamento] = useState(iq?.pagamento ?? String(tpl.pagamento ?? ''));
  // Data prometida de entrega (fábrica): alimenta o algoritmo de produção na aprovação.
  const [dataEntrega, setDataEntrega] = useState<string>(iq?.dataEntrega ?? '');
  // Simulação de disponibilidade/prazo (read-only) para sugerir a data de entrega.
  const [eta, setEta] = useState<any>(null);
  const [etaLoading, setEtaLoading] = useState(false);
  const [includeSpecs, setIncludeSpecs] = useState<boolean>(iq?.includeSpecs ?? (tpl.include_specs ?? true));
  const [messageText, setMessageText] = useState('');
  const [msgTouched, setMsgTouched] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  // Formato de envio (texto | imagem | pdf) + documento formal. Padrão vem do modelo da clínica.
  const [format, setFormat] = useState<'texto' | 'imagem' | 'pdf'>(iq?.format ?? (tpl.format ?? 'imagem'));
  const docRef = useRef<HTMLDivElement>(null);
  const previewWrapRef = useRef<HTMLDivElement>(null);
  const [previewScale, setPreviewScale] = useState(0.45);
  const [docHeight, setDocHeight] = useState(520);
  const [quoteMeta] = useState(() => ({
    number: String(Date.now() % 100000).padStart(5, '0'),
    date: new Date().toLocaleDateString('pt-BR'),
  }));

  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  // clinic.quote_template chega de forma assíncrona (useSettings). Quando chegar, aplica o
  // modelo aos campos 1x (antes do usuário mexer) — os useState iniciais só pegam os defaults.
  // Ao EDITAR um orçamento salvo (iq), o modelo não sobrescreve (já vem marcado como aplicado).
  const templateAppliedRef = useRef(!!iq);
  useEffect(() => {
    if (templateAppliedRef.current) return;
    const qt = clinic?.quote_template;
    if (!qt) return;
    templateAppliedRef.current = true;
    if (qt.saudacao != null) setSaudacao(String(qt.saudacao).split('{nome}').join(firstName).replace(/\s+([!?.,])/g, '$1'));
    if (qt.rodape != null) setRodape(String(qt.rodape));
    if (qt.validade != null) setValidade(String(qt.validade));
    if (qt.pagamento != null) setPagamento(String(qt.pagamento));
    if (qt.include_specs != null) setIncludeSpecs(!!qt.include_specs);
    if (qt.format != null) setFormat(qt.format);
  }, [clinic]);

  // Produtos (uuid, sem prefixo) presentes nas linhas do orçamento.
  const productUuids = useMemo(() => {
    const s = new Set<string>();
    lines.forEach(l => { if (l.productId.startsWith('p:')) s.add(l.productId.slice(2)); });
    return Array.from(s);
  }, [lines]);

  // Restaura a seleção de fotos salva no orçamento (ao editar) — tem prioridade e trava a re-semeadura.
  useEffect(() => {
    if (iqImgSeededRef.current) return;
    if (!Array.isArray(iq?.imageIds)) { iqImgSeededRef.current = true; return; }
    if (quoteImages.length === 0) return;
    iqImgSeededRef.current = true;
    imgTouchedRef.current = true;
    const set = new Set<string>(iq.imageIds);
    const map: Record<string, boolean> = {};
    quoteImages.forEach(i => { map[i.id] = set.has(i.id); });
    setImgChecked(map);
  }, [quoteImages]);

  // Semeia a seleção de fotos pela CONFIGURAÇÃO de cada produto (definida na edição do produto).
  // Com vários produtos = UNIÃO das fotos (Set dedup: foto repetida entre produtos entra 1x só).
  // Se nenhum produto da linha tem seleção própria, cai no padrão global "send_by_default".
  // Para de semear assim que o usuário mexe manualmente (imgTouchedRef).
  useEffect(() => {
    if (imgTouchedRef.current || quoteImages.length === 0) return;
    const chosen = productUuids
      .map(id => products.find(p => p.id === id))
      .filter((p): p is Product => !!p);
    const configured = chosen.filter(p => Array.isArray(p.quote_image_ids));
    let selectedIds: Set<string>;
    if (configured.length > 0) {
      selectedIds = new Set<string>();
      configured.forEach(p => (p.quote_image_ids || []).forEach(id => selectedIds.add(id)));
    } else {
      selectedIds = new Set(quoteImages.filter(i => i.send_by_default).map(i => i.id));
    }
    const map: Record<string, boolean> = {};
    quoteImages.forEach(i => { map[i.id] = selectedIds.has(i.id); });
    setImgChecked(map);
  }, [quoteImages, products, productUuids]);

  const selectedImages = quoteImages.filter(i => imgChecked[i.id] ?? i.send_by_default);
  const allImagesOn = quoteImages.length > 0 && quoteImages.every(i => imgChecked[i.id] ?? i.send_by_default);
  const toggleAllImages = () => {
    imgTouchedRef.current = true;
    const next = !allImagesOn;
    const map: Record<string, boolean> = {};
    quoteImages.forEach(i => { map[i.id] = next; });
    setImgChecked(map);
  };

  // Valor unitario efetivo: o preco editado na linha, ou o cadastrado no produto.
  const unitPrice = (l: Line) => {
    const p = itemById[l.productId];
    if (!p) return 0;
    const edited = Number(String(l.price).replace(',', '.'));
    return (l.price !== '' && !isNaN(edited) && edited >= 0) ? edited : Number(p.unit_price);
  };
  // Altura efetiva da linha (só p/ itens por área): valor digitado na linha, ou o "altura" do produto, ou 1.
  const lineAltura = (l: Line) => lineAlturaFor(isAreaItem(itemById[l.productId]), itemById[l.productId]?.attributes, l.altura);
  // Desconto (%) e frete (R$) sao POR PRODUTO (por linha).
  // Em m², a base = quantidade (comprimento) × altura × valor/m² (área).
  const lineBase = (l: Line) => {
    const p = itemById[l.productId];
    const q = Number(String(l.qty).replace(',', '.'));
    if (!p || !q || q <= 0) return 0;
    return q * lineAltura(l) * unitPrice(l);
  };
  const linePct = (l: Line) => Math.min(100, Math.max(0, Number(String(l.discount).replace(',', '.')) || 0));
  const lineDiscountValue = (l: Line) => lineBase(l) * (linePct(l) / 100);
  const lineFeeValue = (l: Line) => Number(l.fee || 0);
  const lineTotal = (l: Line) => {
    const base = lineBase(l);
    if (base <= 0) return 0; // sem produto/quantidade valida -> ignora ajustes
    return Math.max(0, base - lineDiscountValue(l)) + lineFeeValue(l);
  };
  const computedTotal = useMemo(
    () => lines.reduce((s, l) => s + lineTotal(l), 0),
    [lines, itemById]
  );
  const total = hasCatalog ? computedTotal : Number(manualValue || 0);

  const addLine = () => setLines(prev => [...prev, { productId: '', qty: '', price: '', discount: '', fee: '', altura: '' }]);
  const removeLine = (i: number) => setLines(prev => prev.length === 1 ? prev : prev.filter((_, idx) => idx !== i));
  const updateLine = (i: number, field: 'qty' | 'price' | 'discount' | 'fee' | 'altura', val: string) =>
    setLines(prev => prev.map((l, idx) => idx === i ? { ...l, [field]: val } : l));
  // Ao escolher o produto, semeia o valor unitario (e a altura, se m², vinda do campo "altura").
  // Opcao especial "__new__": abre o mini-modal de cadastro de produto para esta linha.
  const selectProduct = (i: number, productId: string) => {
    if (productId === '__new__') { setQuickNewFor(i); return; }
    const it = itemById[productId];
    // SKU com altura FIXA (flatten): a altura vem do produto, não é digitada. Senão, cai no atributo "altura".
    const altAttr = (it?.attributes ?? []).find(a => (a.label || '').toLowerCase().includes('altura'));
    const altSeed = it?.altura != null ? String(it.altura)
      : (isAreaItem(it) && altAttr ? String(altAttr.value) : '');
    setLines(prev => prev.map((l, idx) => idx === i
      ? { ...l, productId, price: productId ? String(it?.unit_price ?? '') : '', altura: altSeed }
      : l));
    if (productId) requestAnimationFrame(() => qtyRefs.current[i]?.focus());
  };
  // Produto recém-criado no mini-modal: seleciona na linha que disparou o cadastro.
  const handleProductCreated = (p: Product) => {
    const idx = quickNewFor;
    setLines(prev => prev.map((l, i) => i === idx
      ? { ...l, productId: `p:${p.id}`, price: String(p.unit_price ?? '') }
      : l));
    setQuickNewFor(null);
    if (idx != null) requestAnimationFrame(() => qtyRefs.current[idx]?.focus());
  };

  const buildDescription = () => {
    const parts: string[] = [];
    if (hasCatalog) {
      lines.forEach(l => {
        const p = itemById[l.productId];
        const base = lineBase(l);
        if (!p || base <= 0) return;
        const q = Number(String(l.qty).replace(',', '.'));
        let line = `${p.name} — ${formatQty(q)} ${p.unit} × ${formatBRL(unitPrice(l))} = ${formatBRL(base)}`;
        const adj: string[] = [];
        if (linePct(l) > 0) adj.push(`desconto ${formatQty(linePct(l))}%: -${formatBRL(lineDiscountValue(l))}`);
        if (lineFeeValue(l) > 0) adj.push(`frete: +${formatBRL(lineFeeValue(l))}`);
        if (adj.length) line += ` [${adj.join('; ')}] = ${formatBRL(lineTotal(l))}`;
        parts.push(line);
      });
    }
    if (parts.length) parts.push(`TOTAL: ${formatBRL(total)}`);
    if (notes.trim()) parts.push(`${parts.length ? '\n' : ''}Obs: ${notes.trim()}`);
    return parts.join('\n');
  };

  // Mensagem formatada para o WhatsApp, montada a partir dos campos da etapa 2 + orçamento.
  const buildWhatsappMessage = () => {
    const out: string[] = [];
    if (saudacao.trim()) { out.push(saudacao.trim()); out.push(''); }
    out.push('*Orçamento*');
    lines.forEach(l => {
      const p = itemById[l.productId];
      const base = lineBase(l);
      if (!p || base <= 0) return;
      const q = Number(String(l.qty).replace(',', '.'));
      out.push('');
      out.push(`*${p.name}*`);
      if (includeSpecs && (p.attributes?.length ?? 0) > 0) {
        out.push((p.attributes ?? []).map(a => `${a.label}${a.value ? `: ${a.value}` : ''}`).join(' | '));
      }
      // Sem o valor por m²/unitário: só a quantidade/dimensões e o total do item.
      const dims = isAreaItem(p) ? `${formatQty(q)}m × ${formatQty(lineAltura(l))}m` : `${formatQty(q)} ${p.unit}`;
      out.push(`${dims}: ${formatBRL(lineTotal(l))}`);
    });
    if (showTotal) { out.push(''); out.push(`*TOTAL: ${formatBRL(total)}*`); }
    if (validade.trim()) out.push(`Validade: ${formatValidade(validade)}`);
    if (pagamento.trim()) out.push(`Pagamento: ${pagamento.trim()}`);
    if (notes.trim()) { out.push(''); out.push(notes.trim()); }
    if (rodape.trim()) { out.push(''); out.push(rodape.trim()); }
    return out.join('\n');
  };
  const generatedMessage = buildWhatsappMessage();
  // Enquanto o usuário não editar manualmente, o preview acompanha os campos.
  useEffect(() => { if (!msgTouched) setMessageText(generatedMessage); }, [generatedMessage, msgTouched]);

  // Itens do documento formal (imagem/PDF).
  const docItems = lines
    .filter(l => itemById[l.productId] && lineBase(l) > 0)
    .map(l => {
      const p = itemById[l.productId]!;
      const q = Number(String(l.qty).replace(',', '.'));
      const isArea = isAreaItem(p);
      // Sem o valor por m²/unitário no documento: só a quantidade/dimensões (o total vai na coluna VALOR).
      const dims = isArea ? `${formatQty(q)}m × ${formatQty(lineAltura(l))}m` : `${formatQty(q)} ${p.unit}`;
      const meta = [dims];
      if (linePct(l) > 0) meta.push(`desc ${formatQty(linePct(l))}%`);
      if (lineFeeValue(l) > 0) meta.push(`frete ${formatBRL(lineFeeValue(l))}`);
      return {
        name: p.name,
        description: p.description || null,
        specs: includeSpecs ? (p.attributes ?? []).map(a => `${a.label}${a.value ? `: ${a.value}` : ''}`) : [],
        qtyLine: meta.join(' · '),
        value: lineTotal(l),
      };
    });
  const docItemsFinal = docItems.length ? docItems : [{ name: notes.trim() || 'Serviço', description: null, specs: [] as string[], qtyLine: '', value: total }];

  const quoteDocProps = {
    clinicName: clinic?.name ?? '',
    clinicLegalName: clinic?.legal_name ?? null,
    clinicPhone: clinic?.phone ?? null,
    clinicEmail: clinic?.email ?? null,
    clinicInstagram: clinic?.instagram ?? null,
    clinicAddress: clinic?.address ?? null,
    clinicCnpj: clinic?.cnpj ?? null,
    logoDataUrl,
    clientName: lead.name,
    clientPhone: lead.phone ?? null,
    number: quoteMeta.number,
    dateStr: quoteMeta.date,
    items: docItemsFinal,
    total,
    showTotal,
    pagamento: pagamento.trim(),
    validade: validade.trim(),
    accent: clinic?.primary_color || '#1d4ed8',
  };

  // Mede a prévia do documento (escala p/ largura do modal) quando na etapa 2 em imagem/PDF.
  useEffect(() => {
    if (step !== 2 || format === 'texto') return;
    const el = docRef.current, wrap = previewWrapRef.current;
    if (!el || !wrap) return;
    const scale = wrap.clientWidth / 794;
    setPreviewScale(scale);
    setDocHeight(Math.round(el.offsetHeight * scale));
  }, [step, format, saudacao, rodape, validade, pagamento, includeSpecs, notes, total, lines]);

  const mapSendError = (code: string) => (({
    whatsapp_nao_conectado: 'WhatsApp da clínica não está conectado.',
    telefone_invalido: 'Telefone do lead inválido.',
    forbidden: 'Sem permissão para enviar por esta clínica.',
    uazapi_error: 'O WhatsApp recusou o envio. Verifique o número.',
    send_failed: 'Falha na conexão com o WhatsApp.',
    missing_params: 'Dados insuficientes para enviar.',
  } as Record<string, string>)[code] || 'Não foi possível enviar. Tente novamente.');

  // Snapshot estruturado p/ reabrir o orçamento depois (persistido em tickets.quote_data).
  const buildQuoteSnapshot = () => ({ lines, manualValue, notes, saudacao, rodape, validade, pagamento, dataEntrega, includeSpecs, format, imageIds: selectedImages.map(i => i.id) });

  // Linhas de produto com quantidade > 0 (base p/ simular disponibilidade/prazo).
  const telaLines = useMemo(
    () => lines.filter(l => l.productId.startsWith('p:') && (parseFloat(String(l.qty ?? '').replace(',', '.')) || 0) > 0),
    [lines],
  );
  // Verifica estoque + capacidade de produção (RPC read-only) e sugere a data de entrega.
  const handleVerificarEta = async () => {
    if (!activeClinicId || telaLines.length === 0 || etaLoading) return;
    setEtaLoading(true);
    const { data, error } = await supabase.rpc('simulate_production_eta', {
      p_clinic_id: activeClinicId,
      p_lines: telaLines.map(l => ({ productId: l.productId, qty: l.qty, altura: l.altura ?? '' })),
    });
    setEtaLoading(false);
    if (error || !(data as any)?.success) { setEta({ error: true }); showToast('Não foi possível calcular a disponibilidade.', 'error'); return; }
    const res = data as any;
    setEta(res);
    if (res.resumo?.data_sugerida) setDataEntrega(res.resumo.data_sugerida);
  };
  const fmtDataBR = (iso?: string) => iso ? new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR') : '';

  // Etapa 1: registra o orçamento sem enviar (fluxo antigo — o WhatsApp é opcional).
  const handleRegisterOnly = async () => {
    if (!total || total <= 0 || saving) return;
    setSaving(true);
    const ok = await onConfirm(total, buildDescription().trim(), buildQuoteSnapshot(), 'rascunho');
    if (ok) { setDone(true); setTimeout(onClose, 900); }
    setSaving(false);
  };

  // Envia as fotos marcadas EM SEGUNDO PLANO (parte lenta: cada uma tem o delay nativo da
  // uazapi). Roda solto (não-awaited) e reporta por toast — sobrevive ao fechamento do modal,
  // então a tela não trava e o usuário pode continuar trabalhando. Espelha o envio sequencial.
  const sendPhotosInBackground = async (photoUrls: string[]) => {
    let fails = 0;
    for (const url of photoUrls) {
      try {
        const { data: pd, error: pe } = await callSendQuote({ clinic_id: activeClinicId, lead_id: lead.id, phone: lead.phone, media_url: url, media_type: 'image', delay: PHOTO_SEND_DELAY_MS });
        if (pe || (pd && pd.ok === false)) fails++;
      } catch (_e) { fails++; }
    }
    if (fails > 0) showToast(`Orçamento enviado, mas ${fails} foto(s) não foram. Reabra e reenvie.`, 'error');
    else showToast('Fotos do orçamento enviadas ✓', 'success');
  };

  // Fecha o modal e conclui TODO o envio em SEGUNDO PLANO. `primaryFn` envia o orçamento
  // principal (texto pronto, ou upload+envio do documento a partir do blob JÁ gerado) e devolve
  // o resultado; em seguida as fotos. Tudo por toast — sobrevive ao modal fechar, tela não trava.
  const handoffBackground = (
    primaryFn: () => Promise<{ data: any; error: any; status?: number; uploadFailed?: boolean }>,
    photoUrls: string[],
  ) => {
    setSending(false);
    setDone(true);
    showToast('Enviando orçamento em segundo plano…', 'info');
    setTimeout(onClose, 500);
    void (async () => {
      let res: { data: any; error: any; status?: number; uploadFailed?: boolean };
      try { res = await primaryFn(); }
      catch (_e) { showToast('Erro ao enviar o orçamento. Tente de novo.', 'error'); return; }
      if (res.uploadFailed) { showToast('Não foi possível subir o documento do orçamento.', 'error'); return; }
      if (res.status === 401) { showToast('Sessão expirada — recarregue a página (F5) e reenvie o orçamento.', 'error'); return; }
      const code = res.error ? 'send_failed' : (res.data && res.data.ok === false ? String(res.data.error || '') : null);
      if (code) { showToast(`Não foi possível enviar o orçamento: ${mapSendError(code)}`, 'error'); return; }
      if (photoUrls.length > 0) {
        showToast(`Orçamento enviado ✓ Enviando ${photoUrls.length} foto(s)…`, 'info');
        await sendPhotosInBackground(photoUrls);
      } else {
        showToast('Orçamento enviado ✓', 'success');
      }
    })();
  };

  // Etapa 2: registra o orçamento E envia pelo WhatsApp (texto, imagem ou PDF).
  const handleSend = async () => {
    if (sending || done) return;
    if (!activeClinicId || !lead.phone) { setSendError('Lead sem telefone cadastrado.'); return; }
    if (format === 'texto' && !messageText.trim()) { setSendError('Mensagem vazia.'); return; }
    setSending(true); setSendError(null);
    const ok = await onConfirm(total, buildDescription().trim(), buildQuoteSnapshot(), 'enviado');
    if (!ok) { setSending(false); setSendError('Falha ao registrar o orçamento.'); return; }

    const clinicId = activeClinicId;
    const leadId = lead.id;
    const phone = lead.phone;
    const photoUrls = selectedImages.map(i => i.url);

    try {
      if (format === 'texto') {
        // Sem DOM: manda tudo em segundo plano e fecha na hora.
        const text = messageText.trim();
        handoffBackground(() => callSendQuote({ clinic_id: clinicId, lead_id: leadId, phone, text }), photoUrls);
        return;
      }
      // imagem/PDF: a ÚNICA parte que precisa do DOM é gerar o blob do documento. Faz isso
      // in-modal e solta upload + envio + fotos pro segundo plano (o modal fecha logo depois).
      const node = docRef.current;
      if (!node) { setSending(false); setSendError('Falha ao gerar o documento.'); return; }
      const html2canvas = (await import('html2canvas-pro')).default;
      const canvas = await html2canvas(node, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false });
      const isPdf = format === 'pdf';
      let blob: Blob;
      let ext: string;
      let contentType: string;
      if (isPdf) {
        const { jsPDF } = await import('jspdf');
        const imgData = canvas.toDataURL('image/jpeg', 0.92);
        const pdf = new jsPDF({ orientation: 'portrait', unit: 'px', format: [canvas.width, canvas.height] });
        pdf.addImage(imgData, 'JPEG', 0, 0, canvas.width, canvas.height);
        blob = pdf.output('blob');
        ext = 'pdf'; contentType = 'application/pdf';
      } else {
        blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('blob')), 'image/jpeg', 0.92));
        ext = 'jpg'; contentType = 'image/jpeg';
      }
      const caption = [saudacao.trim(), rodape.trim()].filter(Boolean).join('\n\n');
      const filename = `Orcamento-${quoteMeta.number}.${ext}`;
      const mediaType: 'document' | 'image' = isPdf ? 'document' : 'image';
      // Blob pronto → o resto (subir no Storage, esperar propagar, enviar) vai pro background.
      handoffBackground(async () => {
        const path = `${clinicId}/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage.from('quotes').upload(path, blob, { contentType, upsert: false });
        if (upErr) return { data: null, error: null, uploadFailed: true };
        const { data: pub } = supabase.storage.from('quotes').getPublicUrl(path);
        await waitForPublicUrl(pub.publicUrl);
        return await callSendQuote({
          clinic_id: clinicId, lead_id: leadId, phone,
          text: caption, media_url: pub.publicUrl, media_type: mediaType,
          filename, delay: DOC_SEND_DELAY_MS,
        });
      }, photoUrls);
    } catch (_e) {
      setSending(false);
      setSendError('Erro ao gerar o documento. Tente enviar como texto.');
    }
  };

  const canWhatsapp = total > 0 && !!lead.phone;

  return (
    <>
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onCancel}>
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden max-h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="h-1.5 bg-blue-500 shrink-0" />
        <div className="p-6 space-y-4 overflow-y-auto">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-black text-slate-900">{step === 1 ? 'Registrar Orçamento' : 'Enviar por WhatsApp'}</h3>
              <p className="text-xs text-slate-500 font-medium mt-0.5">{lead.name}{step === 2 ? ' · Etapa 2 de 2' : ''}</p>
            </div>
            <button onClick={onCancel} className="p-1.5 hover:bg-slate-100 rounded-lg"><X className="w-4 h-4 text-slate-400" /></button>
          </div>

          {step === 1 && (<>
          {hasCatalog ? (
            <div className="space-y-2.5">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">{sectionLabel}</label>
              {lines.map((l, i) => {
                const p = itemById[l.productId];
                const base = lineBase(l);
                const pct = linePct(l);
                const fee = lineFeeValue(l);
                const isM2 = isAreaItem(p);
                // Seletor mostra só modelos; se a linha já tem um SKU de altura escolhido (orçamento
                // antigo), inclui ele para o nome não sumir.
                const selFull = activeProducts.find(pp => `p:${pp.id}` === l.productId);
                const pickerProducts = selFull && selFull.altura != null ? [...baseProducts, selFull] : baseProducts;
                const feeOpenFor = feeOpen[i] ?? (pct > 0 || fee > 0); // aberto se o vendedor mostrou ou já há desconto/frete
                return (
                  <div key={i} className="rounded-xl border border-slate-200 p-2.5 space-y-2">
                    <div className="flex items-center gap-2">
                      <ProductPicker
                        value={l.productId}
                        products={pickerProducts}
                        protocols={activeProtocols}
                        useProd={useProd}
                        useProt={useProt}
                        sourceNoun={sourceNoun}
                        onSelect={v => selectProduct(i, v)}
                      />
                      {lines.length > 1 && (
                        <button onClick={() => removeLine(i)} className="p-1.5 shrink-0 text-slate-300 hover:text-rose-500 transition-colors"><Trash2 className="w-4 h-4" /></button>
                      )}
                    </div>
                    {p && (
                      <>
                        {isM2 ? (
                          <div className="space-y-2">
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Quantidade (m)</label>
                                <input
                                  ref={el => { qtyRefs.current[i] = el; }}
                                  type="number" min="0" step="any" inputMode="decimal"
                                  value={l.qty}
                                  onChange={e => updateLine(i, 'qty', e.target.value)}
                                  className="w-full px-2.5 py-2 border border-slate-200 rounded-lg text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                                />
                              </div>
                              <div>
                                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Altura (m)</label>
                                <input
                                  type="number" min="0" step="any" inputMode="decimal"
                                  value={l.altura ?? ''}
                                  onChange={e => updateLine(i, 'altura', e.target.value)}
                                  placeholder="Ex: 1,5"
                                  className="w-full px-2.5 py-2 border border-slate-200 rounded-lg text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                                />
                                {p.altura != null && (
                                  <p className="text-[10px] text-slate-400 mt-0.5">medida do SKU</p>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-1 flex-1 min-w-0">
                                <span className="text-xs font-medium text-slate-400 shrink-0">m² ×</span>
                                <div className="relative flex-1 min-w-0">
                                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[11px] font-bold text-slate-400 pointer-events-none">R$</span>
                                  <input type="number" min="0" step="any" inputMode="decimal" value={l.price} onChange={e => updateLine(i, 'price', e.target.value)} className="w-full pl-7 pr-2 py-2 border border-slate-200 rounded-lg text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" />
                                </div>
                              </div>
                              <span className="text-sm font-black text-slate-800 shrink-0">{formatBRL(base)}</span>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <input
                              ref={el => { qtyRefs.current[i] = el; }}
                              type="number" min="0" step="any" inputMode="decimal"
                              placeholder="Qtd"
                              value={l.qty}
                              onChange={e => updateLine(i, 'qty', e.target.value)}
                              className="w-24 shrink-0 px-2.5 py-2 border border-slate-200 rounded-lg text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                            />
                            <div className="flex items-center gap-1 flex-1 min-w-0">
                              <span className="text-xs font-medium text-slate-400 shrink-0">{p.unit} ×</span>
                              <div className="relative flex-1 min-w-0">
                                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[11px] font-bold text-slate-400 pointer-events-none">R$</span>
                                <input type="number" min="0" step="any" inputMode="decimal" value={l.price} onChange={e => updateLine(i, 'price', e.target.value)} className="w-full pl-7 pr-2 py-2 border border-slate-200 rounded-lg text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" />
                              </div>
                            </div>
                            <span className="text-sm font-black text-slate-800 shrink-0">{formatBRL(base)}</span>
                          </div>
                        )}
                        {(p.description || (p.attributes?.length ?? 0) > 0) && (
                          <div className="flex flex-wrap gap-1.5 pt-0.5">
                            {p.description && (
                              <span className="w-full text-[11px] text-slate-400">{p.description}</span>
                            )}
                            {(p.attributes ?? []).map((a, idx) => (
                              <span key={idx} className="text-[10px] font-semibold bg-blue-50 border border-blue-100 text-blue-700 px-1.5 py-0.5 rounded">
                                {a.label}{a.value ? `: ${a.value}` : ''}
                              </span>
                            ))}
                          </div>
                        )}
                        {/* Desconto (%) e frete (R$) deste produto — ocultos por padrão, setinha p/ mostrar */}
                        <div className="pt-0.5">
                          <button
                            type="button"
                            onClick={() => setFeeOpen(prev => ({ ...prev, [i]: !feeOpenFor }))}
                            className={cn("flex items-center gap-1 text-[11px] font-bold transition-colors", feeOpenFor ? "text-blue-600 hover:text-blue-700" : "text-slate-400 hover:text-blue-600")}
                          >
                            <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", feeOpenFor && "rotate-180")} /> Desconto e frete
                          </button>
                          {feeOpenFor && (
                            <div className="grid grid-cols-2 gap-2 mt-1.5">
                              <div>
                                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Desconto</label>
                                <div className="relative">
                                  <input
                                    type="number"
                                    min="0"
                                    max="100"
                                    step="any"
                                    inputMode="decimal"
                                    placeholder="0"
                                    value={l.discount}
                                    onChange={e => updateLine(i, 'discount', e.target.value)}
                                    className="w-full pl-2.5 pr-6 py-1.5 border border-slate-200 rounded-lg text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                                  />
                                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400 pointer-events-none">%</span>
                                </div>
                              </div>
                              <div>
                                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Frete</label>
                                <div className="relative">
                                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[11px] font-bold text-slate-400 pointer-events-none">R$</span>
                                  <input
                                    type="number"
                                    min="0"
                                    step="any"
                                    inputMode="decimal"
                                    placeholder="0,00"
                                    value={l.fee}
                                    onChange={e => updateLine(i, 'fee', e.target.value)}
                                    className="w-full pl-7 pr-2 py-1.5 border border-slate-200 rounded-lg text-sm font-bold focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                                  />
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                        {(pct > 0 || fee > 0) && (
                          <div className="flex items-center justify-between pt-1 border-t border-slate-100">
                            <span className="text-[11px] font-medium text-slate-400">
                              {pct > 0 ? `−${formatQty(pct)}%` : ''}{pct > 0 && fee > 0 ? ' · ' : ''}{fee > 0 ? `+${formatBRL(fee)} frete` : ''}
                            </span>
                            <span className="text-sm font-black text-blue-600">{formatBRL(lineTotal(l))}</span>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
              <button onClick={addLine} className="text-xs font-bold text-blue-600 hover:text-blue-700 flex items-center gap-1">
                <Plus className="w-3.5 h-3.5" /> Adicionar {sourceNoun}
              </button>
            </div>
          ) : (
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Valor do Orçamento (R$)</label>
              <CurrencyInput autoFocus value={manualValue} onChange={setManualValue} className="focus:ring-blue-500/20 focus:border-blue-500" />
              <p className="text-[11px] text-slate-400">Cadastre produtos/protocolos e habilite-os em Configurações › Dados da Clínica › Configuração do Orçamento para calcular automaticamente.</p>
            </div>
          )}

          {/* Total geral: soma dos itens, cada um já com seu desconto e frete (oculto se a clínica desligar "Mostrar valor total") */}
          {showTotal && (
            <div className="flex items-center justify-between rounded-xl bg-slate-50 border border-slate-100 p-3">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Total</span>
              <span className="text-lg font-black text-blue-600">{formatBRL(total)}</span>
            </div>
          )}

          {/* Fábrica (category='outro'): verifica estoque + capacidade e SUGERE a data de entrega.
              Substitui o campo de data manual — a data vem da simulação (ajustável). */}
          {clinic?.category === 'outro' && (
            <div className="space-y-2">
              <button
                type="button"
                onClick={handleVerificarEta}
                disabled={etaLoading || telaLines.length === 0}
                className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border border-teal-200 bg-teal-50 text-teal-700 text-sm font-bold hover:bg-teal-100 disabled:opacity-50 transition-colors"
              >
                <Package className="w-4 h-4" />
                {etaLoading ? 'Calculando…' : eta ? 'Recalcular disponibilidade' : 'Verificar disponibilidade e sugerir entrega'}
              </button>

              {eta && !eta.error && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2">
                  <div className="space-y-1">
                    {eta.linhas.map((ln: any, idx: number) => (
                      <div key={idx} className="flex items-center justify-between text-xs gap-2">
                        <span className="text-slate-600 truncate">{ln.label}</span>
                        {ln.sem_estimativa ? (
                          <span className="text-amber-600 font-semibold shrink-0">sem estimativa</span>
                        ) : ln.em_estoque ? (
                          <span className="text-emerald-600 font-semibold shrink-0">✓ em estoque</span>
                        ) : (
                          <span className="text-blue-600 font-semibold shrink-0">⏳ produzir {formatQty(Number(ln.falta))} m</span>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="pt-2 border-t border-slate-200 flex items-center justify-between gap-2">
                    <span className="text-xs text-slate-500">
                      {eta.resumo.tudo_em_estoque
                        ? 'Tudo em estoque'
                        : `Produção ~${eta.resumo.dias_producao} dia(s)${eta.resumo.dias_expedicao ? ` + ${eta.resumo.dias_expedicao} expedição` : ''}`}
                    </span>
                    <span className="text-sm font-black text-slate-800 shrink-0">Entrega: {fmtDataBR(eta.resumo.data_sugerida)}</span>
                  </div>
                  {eta.resumo.sem_estimativa && (
                    <p className="text-[11px] text-amber-600">Alguma linha sem taxa de produção cadastrada — o prazo pode estar incompleto.</p>
                  )}
                  <div className="flex items-center gap-2 pt-1">
                    <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider shrink-0">Entrega prevista</label>
                    <input
                      type="date"
                      value={dataEntrega}
                      onChange={e => setDataEntrega(e.target.value)}
                      className="flex-1 px-2 py-1.5 border border-slate-200 rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
                    />
                  </div>
                  <p className="text-[10px] text-slate-400">Sugestão automática (ajustável). Considera saldo, reservas e capacidade; não considera a fila de outros pedidos.</p>
                </div>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Observações</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              placeholder="Detalhes adicionais do orçamento (opcional)…"
              className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 resize-none"
            />
          </div>
          </>)}

          {step === 2 && (
            <div className="space-y-3">
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-1.5">Enviar como</label>
                <div className="flex bg-slate-100 rounded-xl p-1">
                  {(['texto', 'imagem', 'pdf'] as const).map(f => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setFormat(f)}
                      className={cn(
                        "flex-1 py-1.5 rounded-lg text-xs font-bold transition-all",
                        format === f ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                      )}
                    >
                      {f === 'texto' ? 'Texto' : f === 'imagem' ? 'Imagem' : 'PDF'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Saudação</label>
                <input
                  type="text"
                  value={saudacao}
                  onChange={e => setSaudacao(e.target.value)}
                  placeholder="Olá! Segue seu orçamento:"
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Validade</label>
                  <input
                    type="text"
                    value={validade}
                    onChange={e => setValidade(e.target.value)}
                    placeholder="Ex: 7 dias"
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Pagamento</label>
                  <input
                    type="text"
                    value={pagamento}
                    onChange={e => setPagamento(e.target.value)}
                    placeholder="Ex: PIX, cartão…"
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Rodapé</label>
                <input
                  type="text"
                  value={rodape}
                  onChange={e => setRodape(e.target.value)}
                  placeholder="Qualquer dúvida, estou à disposição!"
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
              </div>
              <label className="flex items-center gap-2 text-sm font-medium text-slate-600 cursor-pointer select-none">
                <input type="checkbox" checked={includeSpecs} onChange={e => setIncludeSpecs(e.target.checked)} className="w-4 h-4 accent-blue-600" />
                Incluir especificações dos produtos (malha, fio…)
              </label>

              {quoteImages.length > 0 && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Fotos que vão junto</label>
                    <button type="button" onClick={toggleAllImages} className="text-[11px] font-bold text-blue-600 hover:text-blue-700">
                      {allImagesOn ? 'Desmarcar todas' : 'Marcar todas'}
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {quoteImages.map(img => {
                      const on = imgChecked[img.id] ?? img.send_by_default;
                      return (
                        <button key={img.id} type="button" onClick={() => { imgTouchedRef.current = true; setImgChecked(prev => ({ ...prev, [img.id]: !on })); }} className={cn("relative w-14 h-14 rounded-lg overflow-hidden border-2 transition-all", on ? "border-blue-500" : "border-slate-200 opacity-50")}>
                          <img src={img.url} className="w-full h-full object-cover" />
                          {on && <span className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-blue-600 text-white flex items-center justify-center"><Check className="w-2.5 h-2.5" /></span>}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[10px] text-slate-400">As marcadas são enviadas como imagem logo após o orçamento. As fotos padrão de cada produto são definidas na edição do produto.</p>
                </div>
              )}

              {format === 'texto' ? (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Mensagem</label>
                    {msgTouched && (
                      <button type="button" onClick={() => setMsgTouched(false)} className="text-[11px] font-bold text-blue-600 hover:text-blue-700 flex items-center gap-1">
                        <RotateCcw className="w-3 h-3" /> Regenerar
                      </button>
                    )}
                  </div>
                  <textarea
                    value={messageText}
                    onChange={e => { setMessageText(e.target.value); setMsgTouched(true); }}
                    rows={10}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-[13px] leading-relaxed font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 resize-none"
                  />
                  <p className="text-[10px] text-slate-400">
                    {lead.phone ? <>Será enviada ao WhatsApp <span className="font-semibold">{lead.phone}</span>. </> : 'Lead sem telefone cadastrado. '}
                    No WhatsApp, texto entre *asteriscos* fica em negrito.
                  </p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Prévia do documento</label>
                  {/* Cópia offscreen em tamanho real (SEM transform): é esta que o html2canvas captura.
                      Capturar a versão escalada faz o texto duplicar/sobrepor. */}
                  <div style={{ position: 'fixed', left: -99999, top: 0, width: 794, pointerEvents: 'none' }} aria-hidden>
                    <QuoteDocument docRef={docRef} {...quoteDocProps} />
                  </div>
                  {/* Prévia visual (escalada só para exibição) */}
                  <div
                    ref={previewWrapRef}
                    style={{ height: docHeight }}
                    className="relative w-full overflow-hidden border border-slate-200 rounded-xl bg-slate-100"
                  >
                    <div style={{ position: 'absolute', top: 0, left: 0, width: 794, transform: `scale(${previewScale})`, transformOrigin: 'top left' }}>
                      <QuoteDocument {...quoteDocProps} />
                    </div>
                  </div>
                  <p className="text-[10px] text-slate-400">
                    {lead.phone ? <>Será enviado ao WhatsApp <span className="font-semibold">{lead.phone}</span> como {format === 'pdf' ? 'PDF' : 'imagem'}. </> : 'Lead sem telefone cadastrado. '}
                    A saudação e o rodapé vão como legenda.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Rodapé por etapa */}
          {step === 1 ? (
            <div className="space-y-2 pt-1">
              <button
                onClick={() => { if (canWhatsapp) { setMsgTouched(false); setStep(2); } }}
                disabled={!canWhatsapp}
                title={!lead.phone ? 'Lead sem telefone cadastrado' : (total <= 0 ? 'Monte o orçamento primeiro' : '')}
                className={cn(
                  "w-full py-2.5 rounded-xl text-sm font-black transition-all flex items-center justify-center gap-2",
                  canWhatsapp ? "bg-blue-600 hover:bg-blue-700 text-white" : "bg-slate-100 text-slate-400"
                )}
              >
                <Send className="w-4 h-4" /> Enviar por WhatsApp →
              </button>
              <div className="flex gap-2">
                <button onClick={onCancel} className="flex-1 py-2.5 rounded-xl text-sm font-bold border border-slate-200 text-slate-500 hover:bg-slate-50 transition-all">
                  Cancelar
                </button>
                <button
                  onClick={handleRegisterOnly}
                  disabled={saving || !total || total <= 0}
                  className={cn(
                    "flex-1 py-2.5 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 border",
                    done ? "bg-emerald-500 border-emerald-500 text-white" :
                      (saving || !total || total <= 0) ? "bg-slate-50 border-slate-200 text-slate-400" :
                        "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
                  )}
                >
                  {done ? <><Check className="w-4 h-4" /> Registrado!</> :
                    saving ? <Loader2 className="w-4 h-4 animate-spin" /> :
                      'Só registrar'}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-2 pt-1">
              {sendError && (
                <div className="flex items-start gap-2 text-xs font-semibold text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">
                  <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {sendError}
                </div>
              )}
              <button
                onClick={handleSend}
                disabled={sending || done || (format === 'texto' && !messageText.trim())}
                className={cn(
                  "w-full py-2.5 rounded-xl text-sm font-black transition-all flex items-center justify-center gap-2",
                  done ? "bg-emerald-500 text-white" :
                    (sending || (format === 'texto' && !messageText.trim())) ? "bg-slate-100 text-slate-400" :
                      "bg-blue-600 hover:bg-blue-700 text-white"
                )}
              >
                {done ? <><Check className="w-4 h-4" /> Enviado!</> :
                  sending ? <><Loader2 className="w-4 h-4 animate-spin" /> {format === 'texto' ? 'Enviando…' : 'Gerando e enviando…'}</> :
                    <><Send className="w-4 h-4" /> {format === 'texto' ? 'Enviar pelo WhatsApp' : `Enviar ${format === 'pdf' ? 'PDF' : 'imagem'}`}</>}
              </button>
              <button onClick={() => setStep(1)} disabled={sending} className="w-full py-2.5 rounded-xl text-sm font-bold border border-slate-200 text-slate-500 hover:bg-slate-50 transition-all">
                ← Voltar
              </button>
            </div>
          )}
        </div>
      </motion.div>
    </div>

    {quickNewFor !== null && (
      <QuickProductModal
        create={createProduct}
        onClose={() => setQuickNewFor(null)}
        onCreated={handleProductCreated}
      />
    )}
    </>
  );
}

// Modal de Ordem de Produção: monta o documento a partir do orçamento salvo do lead
// (quoteData.lines resolvidas no catálogo atual), pré-preenche do modelo da clínica e
// gera imagem/PDF para download. Documento interno (não envia por WhatsApp).
function ProductionOrderModal({ lead, quoteData, ticketId, onClose }: {
  lead: { id: string; name: string; phone?: string | null };
  quoteData: any;
  ticketId?: string | null;
  onClose: () => void;
}) {
  const { clinic } = useSettings();
  const { data: products } = useProducts();
  const { data: protocols } = useProtocols();
  const { create: createOP } = useProductionOrders();
  const { data: inventoryItems } = useInventoryItems();
  const showToast = useToast();
  const [genBusy, setGenBusy] = useState(false);
  const logoDataUrl = useImageDataUrl(clinic?.logo_url);

  const itemById = useMemo(() => {
    const m: Record<string, { name: string; unit: string; unit_price: number; attributes: { label: string; value: string; unit?: string | null }[]; charge_by_area?: boolean }> = {};
    products.forEach(p => { m[`p:${p.id}`] = { name: p.name, unit: p.unit, unit_price: Number(p.unit_price), attributes: (p.attributes ?? []), charge_by_area: !!p.charge_by_area }; });
    protocols.forEach(t => { m[`t:${t.id}`] = { name: t.name, unit: 'serviço', unit_price: Number((t as any).price ?? 0), attributes: [], charge_by_area: false }; });
    return m;
  }, [products, protocols]);

  const tpl: any = clinic?.production_order_template ?? {};
  const [prazo, setPrazo] = useState(String(tpl.prazo ?? ''));
  const [vendedor, setVendedor] = useState(String(tpl.responsavel ?? ''));
  const [cidade, setCidade] = useState('');
  const [observacoes, setObservacoes] = useState(String(tpl.observacoes ?? ''));
  const [showPrices, setShowPrices] = useState<boolean>(tpl.show_prices ?? true);
  const [format, setFormat] = useState<'imagem' | 'pdf'>(tpl.format ?? 'pdf');
  const [busy, setBusy] = useState(false);

  // Aplica o modelo quando o clinic carregar (assíncrono), 1x antes de editar.
  const appliedRef = useRef(false);
  useEffect(() => {
    if (appliedRef.current) return;
    const t = clinic?.production_order_template;
    if (!t) return;
    appliedRef.current = true;
    if (t.prazo != null) setPrazo(String(t.prazo));
    if (t.responsavel != null) setVendedor(String(t.responsavel));
    if (t.observacoes != null) setObservacoes(String(t.observacoes));
    if (t.show_prices != null) setShowPrices(!!t.show_prices);
    if (t.format != null) setFormat(t.format);
  }, [clinic]);

  const lineValue = (l: any) => {
    const it = itemById[l.productId];
    if (!it) return 0;
    const q = Number(String(l.qty).replace(',', '.'));
    if (!q || q <= 0) return 0;
    const edited = Number(String(l.price).replace(',', '.'));
    const up = (l.price !== '' && !isNaN(edited) && edited >= 0) ? edited : it.unit_price;
    const base = q * lineAlturaFor(isAreaItem(it), it.attributes, l.altura) * up;
    const pct = Math.min(100, Math.max(0, Number(String(l.discount).replace(',', '.')) || 0));
    const fee = Number(l.fee || 0);
    return Math.max(0, base - base * (pct / 100)) + fee;
  };
  const prodItems = useMemo(() => {
    const lines = Array.isArray(quoteData?.lines) ? quoteData.lines : [];
    return lines.map((l: any) => {
      const it = itemById[l.productId];
      const q = Number(String(l.qty).replace(',', '.'));
      if (!it || !q || q <= 0) return null;
      const area = isAreaItem(it);
      const hasAlt = String(l.altura ?? '').trim() !== '' || alturaOf(it.attributes) > 0;
      return {
        name: it.name,
        attrs: (it.attributes ?? []).map((a: any) => {
          const isAlt = area && (a.label || '').toLowerCase().includes('altura') && String(l.altura ?? '').trim() !== '';
          return { label: a.label, value: isAlt ? String(l.altura) : a.value };
        }),
        // Comprimento e altura vêm do ORÇAMENTO (linha): comprimento = quantidade digitada; altura = a da linha.
        comprimento: area ? formatQty(q) : '',
        altura: area && hasAlt ? formatQty(lineAlturaFor(true, it.attributes, l.altura)) : '',
        qty: `${formatQty(q)} ${it.unit}`,
        value: lineValue(l),
        // Campos p/ gerar a OP rastreável (ignorados pelo documento).
        qtyNum: q,
        alturaNum: area ? lineAlturaFor(true, it.attributes, l.altura) : 0,
        productKey: String(l.productId),
      };
    }).filter(Boolean) as { name: string; attrs: { label: string; value: string }[]; comprimento: string; altura: string; qty: string; value: number; qtyNum: number; alturaNum: number; productKey: string }[];
  }, [quoteData, itemById]);

  // Seleção + edição por item antes de imprimir/baixar. Semeado 1x quando os itens carregam
  // (products vêm async). include = vai pra produção; comprimento/altura editáveis (pré do orçamento).
  type ItemSt = { include: boolean; comprimento: string; altura: string };
  const [itemState, setItemState] = useState<ItemSt[]>([]);
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current || prodItems.length === 0) return;
    seededRef.current = true;
    setItemState(prodItems.map(it => ({ include: true, comprimento: it.comprimento, altura: it.altura })));
  }, [prodItems]);
  const setItem = (i: number, patch: Partial<ItemSt>) =>
    setItemState(prev => prev.map((s, idx) => idx === i ? { ...s, ...patch } : s));

  // Só os itens INCLUÍDOS, com comprimento/altura editados, vão pro documento.
  const docItems = prodItems
    .map((it, i) => itemState[i] ? { ...it, comprimento: itemState[i].comprimento, altura: itemState[i].altura } : it)
    .filter((_, i) => itemState[i] ? itemState[i].include : true);
  const total = prodItems.reduce((s, it, i) => (itemState[i] && !itemState[i].include) ? s : s + it.value, 0);

  // Título/arquivo GENÉRICOS: serve tanto p/ produzir quanto p/ separar do estoque (nem sempre produz).
  const docTitle = 'ORDEM DE PRODUÇÃO / SEPARAÇÃO';
  const fileBase = 'Ordem-Producao-Separacao';

  const [meta] = useState(() => ({ number: String(Date.now() % 100000).padStart(5, '0'), date: new Date().toLocaleDateString('pt-BR') }));

  const docRef = useRef<HTMLDivElement>(null);
  const previewWrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.45);
  const [ph, setPh] = useState(520);
  useEffect(() => {
    const el = docRef.current, wrap = previewWrapRef.current;
    if (!el || !wrap) return;
    const s = wrap.clientWidth / 794;
    setScale(s);
    setPh(Math.round(el.offsetHeight * s));
  }, [prazo, vendedor, cidade, observacoes, showPrices, docItems.length, itemState]);

  const docProps = {
    title: docTitle,
    clinicName: clinic?.name ?? '',
    clinicLegalName: clinic?.legal_name ?? null,
    clinicPhone: clinic?.phone ?? null,
    clinicEmail: clinic?.email ?? null,
    clinicInstagram: clinic?.instagram ?? null,
    clinicAddress: clinic?.address ?? null,
    clinicCnpj: clinic?.cnpj ?? null,
    logoDataUrl,
    clientName: lead.name,
    clientPhone: lead.phone ?? null,
    cidade,
    vendedor,
    number: meta.number,
    dateStr: meta.date,
    prazo,
    items: docItems,
    total,
    showPrices,
    observacoes,
    accent: clinic?.primary_color || '#1d4ed8',
  };

  const handleDownload = async () => {
    if (busy) return;
    const node = docRef.current;
    if (!node) return;
    setBusy(true);
    try {
      const html2canvas = (await import('html2canvas-pro')).default;
      const canvas = await html2canvas(node, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false });
      const filename = `${fileBase}-${meta.number}`;
      if (format === 'pdf') {
        const { jsPDF } = await import('jspdf');
        const imgData = canvas.toDataURL('image/jpeg', 0.92);
        const pdf = new jsPDF({ orientation: 'portrait', unit: 'px', format: [canvas.width, canvas.height] });
        pdf.addImage(imgData, 'JPEG', 0, 0, canvas.width, canvas.height);
        pdf.save(`${filename}.pdf`);
      } else {
        const a = document.createElement('a');
        a.href = canvas.toDataURL('image/jpeg', 0.92);
        a.download = `${filename}.jpg`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
    } catch (_e) {
      // ignore
    }
    setBusy(false);
  };

  // Imprime o documento: renderiza p/ imagem e abre uma janela de impressão (A4 sem margem).
  const handlePrint = async () => {
    if (busy) return;
    const node = docRef.current;
    if (!node) return;
    setBusy(true);
    try {
      const html2canvas = (await import('html2canvas-pro')).default;
      const canvas = await html2canvas(node, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false });
      const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
      const w = window.open('', '_blank');
      if (w) {
        w.document.write(`<html><head><title>${docTitle} ${meta.number}</title><style>@page{size:A4;margin:0}html,body{margin:0;padding:0}img{width:100%;display:block}</style></head><body><img src="${dataUrl}" onload="window.focus();window.print();" /></body></html>`);
        w.document.close();
      }
    } catch (_e) {
      // ignore
    }
    setBusy(false);
  };

  // Gera Ordens de Produção rastreáveis (uma por item incluído), resolvendo o produto
  // do orçamento para o item de estoque (produto acabado) quando existe vínculo.
  const handleGenerateOP = async () => {
    if (genBusy) return;
    // Mapas: products.id / protocols.id -> inventory_item (produto acabado vinculado ao catálogo).
    const invByProductId = new Map(
      inventoryItems.filter(i => i.product_id).map(i => [i.product_id as string, i]),
    );
    const invByProtocolId = new Map(
      inventoryItems.filter(i => i.protocol_id).map(i => [i.protocol_id as string, i]),
    );
    const toGenerate = prodItems.filter((_, i) => itemState[i] ? itemState[i].include : true);
    if (toGenerate.length === 0) { showToast('Nenhum item selecionado para produção.', 'error'); return; }
    setGenBusy(true);
    const numbers: number[] = [];
    for (const it of toGenerate) {
      const invItem = it.productKey.startsWith('p:')
        ? invByProductId.get(it.productKey.slice(2))
        : it.productKey.startsWith('t:')
        ? invByProtocolId.get(it.productKey.slice(2))
        : undefined;
      const created = await createOP({
        product_item_id: invItem?.id ?? null,
        product_label: it.name,
        qty_planned: it.qtyNum,
        altura: it.alturaNum > 0 ? it.alturaNum : null,
        client_name: lead.name,
        ticket_id: ticketId ?? null,
        lead_id: lead.id,
        notes: observacoes.trim() || null,
      });
      if (created) numbers.push(created.number);
    }
    setGenBusy(false);
    if (numbers.length) {
      showToast(`${numbers.length === 1 ? 'OP gerada' : 'OPs geradas'}: ${numbers.map(n => `#${n}`).join(', ')}. Veja em Produção.`, 'success');
      onClose();
    } else {
      showToast('Não foi possível gerar as OPs.', 'error');
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="h-1.5 bg-teal-500 shrink-0" />
        <div className="p-6 space-y-4 overflow-y-auto">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-black text-slate-900">Ordem de Produção / Separação</h3>
              <p className="text-xs text-slate-500 font-medium mt-0.5">{lead.name}</p>
            </div>
            <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg"><X className="w-4 h-4 text-slate-400" /></button>
          </div>

          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-1.5">Baixar como</label>
            <div className="flex bg-slate-100 rounded-xl p-1">
              {(['imagem', 'pdf'] as const).map(f => (
                <button key={f} type="button" onClick={() => setFormat(f)} className={cn("flex-1 py-1.5 rounded-lg text-xs font-bold transition-all", format === f ? "bg-white text-teal-600 shadow-sm" : "text-slate-500 hover:text-slate-700")}>
                  {f === 'imagem' ? 'Imagem' : 'PDF'}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Vendedor</label>
              <input type="text" value={vendedor} onChange={e => setVendedor(e.target.value)} placeholder="Ex: João" className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Cidade</label>
              <input type="text" value={cidade} onChange={e => setCidade(e.target.value)} placeholder="Cidade do cliente" className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500" />
            </div>
            <div className="space-y-1.5 col-span-2">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Prazo de entrega</label>
              <input type="text" value={prazo} onChange={e => setPrazo(e.target.value)} placeholder="Ex: 15 dias" className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500" />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Observações de produção</label>
            <textarea value={observacoes} onChange={e => setObservacoes(e.target.value)} rows={2} placeholder="Instruções para a produção…" className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 resize-none" />
          </div>
          <label className="flex items-center gap-2 text-sm font-medium text-slate-600 cursor-pointer select-none">
            <input type="checkbox" checked={showPrices} onChange={e => setShowPrices(e.target.checked)} className="w-4 h-4 accent-teal-600" />
            Mostrar preços/valores
          </label>

          {prodItems.length > 0 && (
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block">Produtos a produzir</label>
              <p className="text-[11px] text-slate-400 -mt-1">Marque os que vão para a produção e ajuste as medidas, se precisar.</p>
              {prodItems.map((it, i) => {
                const st = itemState[i] ?? { include: true, comprimento: it.comprimento, altura: it.altura };
                return (
                  <div key={i} className={cn("rounded-xl border p-3 transition-all", st.include ? "border-slate-200 bg-white" : "border-slate-100 bg-slate-50")}>
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input type="checkbox" checked={st.include} onChange={e => setItem(i, { include: e.target.checked })} className="w-4 h-4 accent-teal-600 shrink-0" />
                      <span className={cn("text-sm font-bold flex-1 min-w-0 truncate", st.include ? "text-slate-800" : "text-slate-400")}>{it.name}</span>
                      <span className="text-[11px] font-semibold text-slate-400 shrink-0">{it.qty}</span>
                    </label>
                    {st.include && (
                      <div className="grid grid-cols-2 gap-2 mt-2 pl-6">
                        <div>
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide block mb-0.5">Comprimento (m)</label>
                          <input value={st.comprimento} onChange={e => setItem(i, { comprimento: e.target.value })} placeholder="—" className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500" />
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide block mb-0.5">Altura (m)</label>
                          <input value={st.altura} onChange={e => setItem(i, { altura: e.target.value })} placeholder="—" className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500" />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Cópia offscreen (tamanho real, sem transform) capturada pelo html2canvas */}
          <div style={{ position: 'fixed', left: -99999, top: 0, width: 794, pointerEvents: 'none' }} aria-hidden>
            <ProductionOrderDocument docRef={docRef} {...docProps} />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-1.5">Prévia</label>
            <div ref={previewWrapRef} style={{ height: ph }} className="relative w-full overflow-hidden border border-slate-200 rounded-xl bg-slate-100">
              <div style={{ position: 'absolute', top: 0, left: 0, width: 794, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
                <ProductionOrderDocument {...docProps} />
              </div>
            </div>
          </div>

          {/* OPs agora são geradas automaticamente na APROVAÇÃO do orçamento (provision_orcamento:
              reserva o disponível + gera OP do que falta pelo algoritmo de estoque mínimo/lote).
              O botão manual foi removido para não duplicar. Este modal segue servindo o documento
              imprimível de produção/separação. Criação avulsa de OP fica no módulo Produção. */}
          <div className="rounded-xl border border-amber-100 bg-amber-50/60 px-3 py-2 text-[11px] font-semibold text-amber-700 flex items-center gap-2">
            <Package className="w-3.5 h-3.5 shrink-0" /> A OP é gerada automaticamente ao aprovar o orçamento (reserva + produção do que faltar).
          </div>

          <div className="flex gap-2 pt-1">
            <button onClick={onClose} className="py-2.5 px-3 rounded-xl text-sm font-bold border border-slate-200 text-slate-500 hover:bg-slate-50 transition-all">Fechar</button>
            <button onClick={handlePrint} disabled={busy || docItems.length === 0} className={cn("flex-1 py-2.5 rounded-xl text-sm font-bold border transition-all flex items-center justify-center gap-2", (busy || docItems.length === 0) ? "border-slate-200 text-slate-400" : "border-teal-200 text-teal-700 hover:bg-teal-50")}>
              <Printer className="w-4 h-4" /> Imprimir
            </button>
            <button onClick={handleDownload} disabled={busy || docItems.length === 0} className={cn("flex-1 py-2.5 rounded-xl text-sm font-black transition-all flex items-center justify-center gap-2", (busy || docItems.length === 0) ? "bg-slate-100 text-slate-400" : "bg-teal-600 hover:bg-teal-700 text-white")}>
              {busy ? <><Loader2 className="w-4 h-4 animate-spin" /></> : <><Download className="w-4 h-4" /> Baixar</>}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

// Mini-modal de cadastro rápido de produto, acionado pela opção "Cadastrar novo produto…"
// do seletor no Orçamento. Cria o produto no catálogo (useProducts.create) e devolve o produto
// criado para ser selecionado na linha que abriu o cadastro.
function QuickProductModal({ create, onClose, onCreated }: {
  create: (product: ProductInput) => Promise<Product | null>;
  onClose: () => void;
  onCreated: (p: Product) => void;
}) {
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [attrs, setAttrs] = useState<{ label: string; value: string }[]>([]);
  const [saving, setSaving] = useState(false);

  const addAttr = () => setAttrs(a => [...a, { label: '', value: '' }]);
  const updateAttr = (i: number, field: 'label' | 'value', v: string) =>
    setAttrs(a => a.map((x, idx) => idx === i ? { ...x, [field]: v } : x));
  const removeAttr = (i: number) => setAttrs(a => a.filter((_, idx) => idx !== i));

  const handleSave = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    const p = await create({
      name: name.trim(),
      description: null,
      unit: 'm²',
      unit_price: Number(price || 0),
      attributes: attrs.filter(a => a.label.trim() || a.value.trim()),
      is_active: true,
      charge_by_area: true,
    });
    setSaving(false);
    if (p) onCreated(p);
  };

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-sm max-h-[90vh] overflow-y-auto p-6 space-y-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-base font-black text-slate-900">Novo Produto</h3>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg"><X className="w-4 h-4 text-slate-400" /></button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Nome *</label>
            <input
              type="text"
              autoFocus
              placeholder="Ex: Alambrado 14-1.80-3"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Valor por m²</label>
            <CurrencyInput value={price} onChange={setPrice} className="focus:ring-blue-500/20 focus:border-blue-500" />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">Campos personalizados</label>
              <button type="button" onClick={addAttr} className="text-[11px] font-bold text-blue-600 hover:text-blue-700 flex items-center gap-1">
                <Plus className="w-3 h-3" /> Adicionar campo
              </button>
            </div>
            {attrs.length === 0 ? (
              <p className="text-[11px] text-slate-400 bg-slate-50 border border-dashed border-slate-200 rounded-xl px-3 py-2.5 text-center">
                Opcional. Ex.: Malha, Fio, Altura…
              </p>
            ) : (
              <div className="space-y-2">
                {attrs.map((a, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      type="text"
                      placeholder="Rótulo (ex: Malha)"
                      value={a.label}
                      onChange={e => updateAttr(i, 'label', e.target.value)}
                      className="flex-1 min-w-0 border border-slate-200 rounded-lg px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                    />
                    <input
                      type="text"
                      placeholder="Valor (ex: 0,30 mm)"
                      value={a.value}
                      onChange={e => updateAttr(i, 'value', e.target.value)}
                      className="flex-1 min-w-0 border border-slate-200 rounded-lg px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                    />
                    <button type="button" onClick={() => removeAttr(i)} className="p-1.5 shrink-0 text-slate-300 hover:text-rose-500 transition-colors"><Trash2 className="w-4 h-4" /></button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-bold border border-slate-200 text-slate-500 hover:bg-slate-50 transition-all">
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !name.trim()}
            className={cn(
              "flex-1 py-2.5 rounded-xl text-sm font-black transition-all flex items-center justify-center gap-2",
              (saving || !name.trim()) ? "bg-slate-100 text-slate-400" : "bg-blue-600 hover:bg-blue-700 text-white"
            )}
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Plus className="w-4 h-4" /> Cadastrar</>}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

// Aviso ao arrastar um card já resolvido (venda/perda) para uma etapa ativa. Duas escolhas:
//  - Manter: preserva o desfecho (novo ciclo → card único no board, pois o ticket ganho antigo
//    fica "closed" e some do board com showResolved desligado) e move.
//  - Cancelar: reabre o MESMO ticket, desfazendo a venda/perda. Para venda, apaga a receita
//    lançada; se houver consulta ativa, pergunta antes se cancela a consulta junto.
function ReopenChoiceModal({ info, targetStageName, checkAppointment, onKeep, onCancelOutcome, onClose }: {
  info: { ticket: Ticket; outcome: 'ganho' | 'perdido'; targetStageId: string };
  targetStageName: string;
  checkAppointment: (ticketId: string) => Promise<{ id: string; date: string; time: string; status: string; doctorName?: string } | null>;
  onKeep: () => Promise<void> | void;
  onCancelOutcome: (cancelAppointment: boolean) => Promise<void> | void;
  onClose: () => void;
}) {
  const isGanho = info.outcome === 'ganho';
  const noun = isGanho ? 'venda' : 'perda';
  const leadName = info.ticket.lead?.name ?? '';
  const [phase, setPhase] = useState<'choice' | 'appt'>('choice');
  const [appt, setAppt] = useState<{ id: string; date: string; time: string; status: string; doctorName?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const STATUS_LABEL: Record<string, string> = { pendente: 'pendente', confirmado: 'confirmada', compareceu: 'realizada', realizado: 'realizada' };
  const fmtDate = (d: string) => { try { return format(parseISO(d), 'dd/MM/yyyy'); } catch { return d; } };

  const handleKeep = async () => { setBusy(true); await onKeep(); };
  const handleCancelClick = async () => {
    setBusy(true);
    if (isGanho) {
      const a = await checkAppointment(info.ticket.id);
      if (a) { setAppt(a); setPhase('appt'); setBusy(false); return; }
    }
    await onCancelOutcome(false);
  };

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={busy ? undefined : onClose}>
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="h-1.5 bg-amber-500" />
        <div className="p-6 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <AlertCircle className="w-5 h-5 text-amber-500 shrink-0" />
              <div className="min-w-0">
                <h3 className="text-base font-black text-slate-900 capitalize">Mover {noun}</h3>
                <p className="text-xs text-slate-500 font-medium mt-0.5 truncate">{leadName} → {targetStageName}</p>
              </div>
            </div>
            <button onClick={onClose} disabled={busy} className="p-1.5 hover:bg-slate-100 rounded-lg disabled:opacity-40 shrink-0"><X className="w-4 h-4 text-slate-400" /></button>
          </div>

          {phase === 'choice' ? (
            <>
              <p className="text-sm text-slate-600">
                Este card está marcado como <strong>{noun}</strong>. O que fazer ao movê-lo para <strong>{targetStageName}</strong>?
              </p>
              <div className="space-y-2">
                <button onClick={handleKeep} disabled={busy}
                  className="w-full text-left px-4 py-3 rounded-xl border border-slate-200 hover:border-emerald-300 hover:bg-emerald-50/60 transition-all disabled:opacity-50">
                  <div className="flex items-center gap-2 font-bold text-sm text-slate-800"><Check className="w-4 h-4 text-emerald-600 shrink-0" /> Manter {noun}</div>
                  <p className="text-xs text-slate-500 mt-1">Move o card para a nova etapa <strong>continuando como {noun}</strong> — o valor e o botão "Resolver" seguem com ele; continua contando nos relatórios.</p>
                </button>
                <button onClick={handleCancelClick} disabled={busy}
                  className="w-full text-left px-4 py-3 rounded-xl border border-slate-200 hover:border-rose-300 hover:bg-rose-50/60 transition-all disabled:opacity-50">
                  <div className="flex items-center gap-2 font-bold text-sm text-slate-800"><RotateCcw className="w-4 h-4 text-rose-500 shrink-0" /> Cancelar {noun}</div>
                  <p className="text-xs text-slate-500 mt-1">
                    {isGanho ? 'Desfaz a venda e remove a receita lançada. ' : 'Desfaz a perda. '}O lead volta ativo nesta etapa.
                  </p>
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800 leading-relaxed">
                Este lead tem uma consulta <strong>{STATUS_LABEL[appt!.status] ?? appt!.status}</strong>{appt!.doctorName ? ` com ${appt!.doctorName}` : ''} em <strong>{fmtDate(appt!.date)} {appt!.time?.slice(0, 5)}</strong>. O que fazer com ela ao cancelar a venda?
              </div>
              <div className="space-y-2">
                <button onClick={async () => { setBusy(true); await onCancelOutcome(false); }} disabled={busy}
                  className="w-full text-left px-4 py-3 rounded-xl border border-slate-200 hover:border-teal-300 hover:bg-teal-50/60 transition-all disabled:opacity-50">
                  <div className="font-bold text-sm text-slate-800">Reabrir mantendo a consulta</div>
                  <p className="text-xs text-slate-500 mt-1">A consulta continua agendada; só o desfecho de venda é desfeito.</p>
                </button>
                <button onClick={async () => { setBusy(true); await onCancelOutcome(true); }} disabled={busy}
                  className="w-full text-left px-4 py-3 rounded-xl border border-slate-200 hover:border-rose-300 hover:bg-rose-50/60 transition-all disabled:opacity-50">
                  <div className="font-bold text-sm text-rose-700">Cancelar a consulta também</div>
                  <p className="text-xs text-slate-500 mt-1">Marca a consulta como cancelada e desfaz a venda.</p>
                </button>
              </div>
            </>
          )}

          {busy && <div className="flex items-center justify-center pt-1"><Loader2 className="w-4 h-4 animate-spin text-slate-400" /></div>}
        </div>
      </motion.div>
    </div>
  );
}

// Status de agendamento que NÃO são terminais: enquanto o paciente estiver em um
// desses, o ticket não pode ser resolvido (precisa virar Realizado, Faltou ou Cancelado).
const NON_TERMINAL_APPT_STATUS = ['pendente', 'confirmado', 'compareceu'];
const APPT_STATUS_LABELS: Record<string, string> = {
  pendente: 'Pendente',
  confirmado: 'Confirmado',
  compareceu: 'Compareceu',
};

export function LeadKanban() {
  const { data: stages, loading: stagesLoading, reorder: reorderStages, update: updateStage, create: createStage, remove: removeStage } = useFunnelStages();
  const { data: leads, create, createWithTicket, update, remove, markNotLead } = useLeads({ pageSize: 150 });
  const { data: notLeads, restore: restoreNotLead } = useNotLeads();
  const { tickets, loading: ticketsLoading, refetch: refetchTickets, moveTicket, reopenTicket, moveTicketKeepOutcome, openTicket, closeTicket, finalizeTicket } = useTickets();
  const { byLead: conversionsByLead, create: createConversion, update: updateConversion } = useConversions();
  const { aiConfig, updateAI } = useSettings();
  const { data: orcamentos, save: saveOrcamento } = useOrcamentos();
  const [ganhoLead, setGanhoLead] = useState<{ id: string; name: string; phone: string | null; patientId: string | null; prevStageId: string | null; ticketId: string } | null>(null);
  const [lossLead, setLossLead] = useState<{ id: string; name: string; prevStageId: string | null; ticketId: string } | null>(null);
  const [orcamentoLead, setOrcamentoLead] = useState<{ id: string; name: string; phone: string | null; prevStageId: string | null; ticketId: string; initialQuote?: any; orcamentoId?: string | null } | null>(null);
  const [poLead, setPoLead] = useState<{ id: string; name: string; phone: string | null; quoteData: any; ticketId?: string | null } | null>(null);
  // Aviso ao arrastar um card já resolvido (venda/perda) para uma etapa ativa: manter (novo
  // ciclo, card único) ou cancelar (reabre o mesmo ticket). Guarda o ticket p/ o fluxo "Manter".
  const [reopenLead, setReopenLead] = useState<{ ticket: Ticket; outcome: 'ganho' | 'perdido'; targetStageId: string } | null>(null);
  const { data: transitionRules, create: createRule, remove: removeRule, update: updateRule, reorder: reorderRules, testRule, lookupActiveStageByPhone } = useTransitionRules();
  const [showModal, setShowModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [selectedLead, setSelectedLead] = useState<any>(null);
  const [formData, setFormData] = useState({ name: '', phone: '', source: 'sincronizacao', capture_channel: 'whatsapp', stage_id: '', estimated_value: '', loss_reason: '', avatar_url: '' });
  const [submitting, setSubmitting] = useState(false);
  const [chatLead, setChatLead] = useState<{ lead: any; ticketId: string } | null>(null);
  const [scheduleLead, setScheduleLead] = useState<{ lead: Lead; ticketId: string } | null>(null);
  const [scheduleForm, setScheduleForm] = useState({ doctor_id: '', date: '', time: '', notes: '', consultation_type_id: '' as string });
  const [scheduleSubmitting, setScheduleSubmitting] = useState(false);
  const [scheduleSlots, setScheduleSlots] = useState<string[] | null>(null);
  const [scheduleSlotsLoading, setScheduleSlotsLoading] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);

  const { data: scheduleTypes } = useConsultationTypes(scheduleForm.doctor_id || null);
  const scheduleActiveTypes = React.useMemo(() => scheduleTypes.filter(ct => ct.is_active), [scheduleTypes]);

  useEffect(() => {
    if (!scheduleForm.doctor_id) return;
    if (scheduleActiveTypes.length === 0) return;
    if (!scheduleActiveTypes.some(ct => ct.id === scheduleForm.consultation_type_id)) {
      setScheduleForm(p => ({ ...p, consultation_type_id: scheduleActiveTypes[0].id, time: '' }));
    }
  }, [scheduleForm.doctor_id, scheduleActiveTypes]);

  useEffect(() => {
    if (!scheduleForm.doctor_id || !scheduleForm.date || !scheduleForm.consultation_type_id) {
      setScheduleSlots(null);
      return;
    }
    let cancelled = false;
    setScheduleSlotsLoading(true);
    supabase.rpc('get_available_slots', {
      p_doctor_id: scheduleForm.doctor_id,
      p_date: scheduleForm.date,
      p_consultation_type_id: scheduleForm.consultation_type_id,
      // Agendamento manual pelo Kanban ignora o aviso mínimo (libera qualquer horário do expediente)
      p_ignore_min_notice: true,
    }).then(({ data, error }) => {
      if (cancelled) return;
      if (error) { console.error('get_available_slots:', error); setScheduleSlots([]); }
      else setScheduleSlots((data || []).map((s: any) => (s.slot_time || '').toString().substring(0, 5)));
      setScheduleSlotsLoading(false);
    });
    return () => { cancelled = true; };
  }, [scheduleForm.doctor_id, scheduleForm.date, scheduleForm.consultation_type_id]);
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
  const [channelFilter, setChannelFilter] = useState<'all' | 'forms' | 'whatsapp' | 'balcao'>('all');
  const [showResolved, setShowResolved] = useState(false);
  const [showNotLeadPanel, setShowNotLeadPanel] = useState(false);
  const [confirmingNotLeadId, setConfirmingNotLeadId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  // Filtro de UTM combinável: seleções por dimensão (E entre dimensões, OU dentro de cada).
  // `utmDimension` é só a dimensão em edição no popover. Vazio = sem filtro.
  const [utmDimension, setUtmDimension] = useState('utm_campaign');
  const [utmFilters, setUtmFilters] = useState<Record<string, string[]>>({});
  const { activeClinicId } = useAuth();
  const [searchTickets, setSearchTickets] = useState<Ticket[]>([]);
  const [columnPages, setColumnPages] = useState<Record<string, number>>({});
  const COLUMN_PAGE_SIZE = 20;
  const [entryDateFrom, setEntryDateFrom] = useState('');
  const [entryDateTo, setEntryDateTo] = useState('');
  const [convDateFrom, setConvDateFrom] = useState('');
  const [convDateTo, setConvDateTo] = useState('');
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [statusDropdownTicketId, setStatusDropdownTicketId] = useState<string | null>(null);
  const [confirmingResolveId, setConfirmingResolveId] = useState<string | null>(null);
  const [resolveBlocked, setResolveBlocked] = useState<{ name: string; status: string } | null>(null);
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

  // --- Teste de gatilho (regra de funil) ---
  const [testingRuleId, setTestingRuleId] = useState<string | null>(null);
  const [testPhone, setTestPhone] = useState('');
  const [testStatus, setTestStatus] = useState<'idle' | 'sending' | 'waiting' | 'moved' | 'timeout' | 'error'>('idle');
  const [testResultLeadId, setTestResultLeadId] = useState<string | null>(null);
  const [highlightLeadId, setHighlightLeadId] = useState<string | null>(null);
  const testPollRef = useRef<{ cancelled: boolean } | null>(null);

  const openTestPanel = (ruleId: string) => {
    if (testPollRef.current) testPollRef.current.cancelled = true;
    setTestingRuleId(ruleId);
    setTestPhone('');
    setTestStatus('idle');
    setTestResultLeadId(null);
  };
  const closeTestPanel = () => {
    if (testPollRef.current) testPollRef.current.cancelled = true;
    setTestingRuleId(null);
    setTestStatus('idle');
    setTestResultLeadId(null);
  };
  const runRuleTest = async (rule: TransitionRule) => {
    const phone = testPhone.replace(/\D/g, '');
    if (phone.length < 8) return;
    if (testPollRef.current) testPollRef.current.cancelled = true;
    setTestResultLeadId(null);
    setTestStatus('sending');
    const res = await testRule(rule, phone);
    if (!res.ok) { setTestStatus('error'); return; }
    setTestStatus('waiting');
    // Polling: aguarda o n8n detectar o gatilho e mover o card (ate ~60s).
    const token = { cancelled: false };
    testPollRef.current = token;
    const startedAt = Date.now();
    const TIMEOUT_MS = 60000;
    const INTERVAL_MS = 3000;
    const poll = async () => {
      if (token.cancelled) return;
      const found = await lookupActiveStageByPhone(phone);
      if (token.cancelled) return;
      if (found && found.stageId === rule.target_stage_id) {
        setTestResultLeadId(found.leadId);
        setTestStatus('moved');
        return;
      }
      if (Date.now() - startedAt >= TIMEOUT_MS) {
        if (found?.leadId) setTestResultLeadId(found.leadId);
        setTestStatus('timeout');
        return;
      }
      setTimeout(poll, INTERVAL_MS);
    };
    setTimeout(poll, INTERVAL_MS);
  };
  const viewCardInFunnel = (leadId: string) => {
    closeTestPanel();
    setShowAutomationModal(false);
    setEditingRuleId(null);
    setIsAddingRule(false);
    setHighlightLeadId(leadId);
  };

  // Cancela qualquer polling de teste em andamento ao desmontar.
  useEffect(() => () => { if (testPollRef.current) testPollRef.current.cancelled = true; }, []);

  // Ao destacar um card, rola ate ele no quadro e tira o realce depois de uns segundos.
  useEffect(() => {
    if (!highlightLeadId) return;
    let tries = 0;
    let clearTimer: ReturnType<typeof setTimeout> | undefined;
    const tryScroll = () => {
      const el = document.getElementById(`funnel-card-${highlightLeadId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        clearTimer = setTimeout(() => setHighlightLeadId(null), 4000);
        return;
      }
      if (tries++ < 12) { clearTimer = setTimeout(tryScroll, 300); }
      else { clearTimer = setTimeout(() => setHighlightLeadId(null), 4000); }
    };
    tryScroll();
    return () => { if (clearTimer) clearTimeout(clearTimer); };
  }, [highlightLeadId]);

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

  // Executa o drop "normal" (usado tanto no arraste comum quanto no botão "Manter" do aviso):
  // move o ticket e, conforme a etapa-alvo, abre o modal de registro. Num ticket resolvido, o
  // moveTicket dispara o "novo ciclo" (preserva a venda/perda e abre ticket novo na etapa-alvo).
  const performDrop = async (ticket: Ticket, targetStageId: string) => {
    const targetStage = stages.find(s => s.id === targetStageId);

    // "Agendado" exige um agendamento real: em vez de só mover a etapa, abre o modal
    // de agenda (mesmo do módulo Agendamentos). O ticket só vai para "Agendado" quando
    // o appointment é criado (trigger fn_auto_move_lead_to_agendado). Se cancelar, não move.
    if (targetStage?.slug === 'agendado') {
      if (ticket.lead) {
        setScheduleLead({ lead: ticket.lead, ticketId: ticket.id });
        setScheduleForm({ doctor_id: doctors[0]?.id || '', date: '', time: '', notes: '', consultation_type_id: '' });
        setScheduleError(null);
        setScheduleSlots(null);
      }
      return;
    }

    await moveTicket(ticket.id, targetStageId);

    if (targetStage?.slug === 'ganho') {
      setGanhoLead({ id: ticket.lead_id, name: ticket.lead?.name ?? '', phone: ticket.lead?.phone ?? null, patientId: ticket.lead?.converted_patient_id ?? null, prevStageId: ticket.stage_id, ticketId: ticket.id });
    } else if (targetStage?.slug === 'perdido') {
      setLossLead({ id: ticket.lead_id, name: ticket.lead?.name ?? '', prevStageId: ticket.stage_id, ticketId: ticket.id });
    } else if (targetStage?.slug === 'orcamento') {
      // Registra valor + produto/serviço (NÃO gera conversão; só metadados no lead/ticket).
      setOrcamentoLead({ id: ticket.lead_id, name: ticket.lead?.name ?? '', phone: ticket.lead?.phone ?? null, prevStageId: ticket.stage_id, ticketId: ticket.id });
    }
  };

  const handleDrop = async (e: React.DragEvent, targetStageId: string) => {
    e.preventDefault();
    setDragOverStage(null);

    const ticket = draggedLead;
    setDraggedLead(null);
    if (!ticket || ticket.stage_id === targetStageId) return;

    const targetStage = stages.find(s => s.id === targetStageId);
    const originStage = stages.find(s => s.id === ticket.stage_id);
    const resolvedKind: 'ganho' | 'perdido' | null =
      ticket.outcome ?? (originStage?.slug === 'ganho' ? 'ganho' : originStage?.slug === 'perdido' ? 'perdido' : null);
    // Origem já resolvida (venda/perda) indo para uma etapa ATIVA: pergunta Manter x Cancelar.
    // Alvos terminais/agendado seguem o fluxo normal (mudar de venda p/ perda, reagendar, etc.).
    const targetIsSpecial = !!targetStage && ['ganho', 'perdido', 'agendado'].includes(targetStage.slug || '');
    if (resolvedKind && !targetIsSpecial) {
      setReopenLead({ ticket, outcome: resolvedKind, targetStageId });
      return;
    }

    await performDrop(ticket, targetStageId);
  };

  const handleSubmit = async () => {
    if (!formData.name.trim()) return;
    setSubmitting(true);

    try {
      const targetStageId = formData.stage_id || (stages[0]?.id ?? '');
      const isPerdido = stages.find(s => s.id === targetStageId)?.slug === 'perdido';
      const isConversao = stages.find(s => s.id === targetStageId)?.slug === 'ganho';

      // Lead = só identidade. Stage vai pro TICKET via fluxos próprios (RPC ou moveTicket).
      const payload = {
        name: formData.name,
        phone: formData.phone || null,
        source: formData.source || null,
        capture_channel: formData.capture_channel || 'whatsapp',
        estimated_value: formData.estimated_value ? Number(formData.estimated_value) : 0,
        loss_reason: isPerdido ? (formData.loss_reason || null) : null,
        avatar_url: formData.avatar_url || null,
      };

      if (selectedLead) {
        const ok = await update(selectedLead.id, payload);
        if (!ok) return;
        // Se o lead já tem conversão (venda registrada), o card mostra o valor DA CONVERSÃO
        // (tem prioridade sobre estimated_value). Então editar o valor precisa atualizar a
        // conversão também — senão a edição não aparece no card.
        const convs = conversionsByLead[selectedLead.id];
        const lastConv = convs?.[convs.length - 1];
        if (lastConv && payload.estimated_value !== Number(lastConv.value)) {
          await updateConversion(lastConv.id, { value: payload.estimated_value });
        }
        if (targetStageId && selectedLead._ticketId) {
          const openT = tickets.find(t => t.id === selectedLead._ticketId);
          if (openT && targetStageId !== openT.stage_id) {
            if (isPerdido) {
              await closeTicket(openT.id, 'perdido');
            } else if (isConversao) {
              setGanhoLead({ id: selectedLead.id, name: selectedLead.name, phone: selectedLead.phone ?? null, patientId: selectedLead.converted_patient_id ?? null, prevStageId: openT.stage_id, ticketId: openT.id });
            } else {
              await moveTicket(openT.id, targetStageId);
            }
          }
        }
      } else {
        // Cria lead + ticket atomicamente via RPC
        await createWithTicket({ ...payload, stage_id: targetStageId || null });
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

  // Antes de resolver, garante que um agendamento vinculado ao ticket não ficou "em aberto".
  // Se houver consulta Pendente/Confirmada/Compareceu, avisa para atualizar o status do
  // paciente na agenda (Realizado, Faltou ou Cancelado) em vez de encerrar o atendimento.
  const attemptResolve = async (ticket: Ticket) => {
    const { data: pending, error } = await supabase
      .from('appointments')
      .select('status')
      .eq('ticket_id', ticket.id)
      .in('status', NON_TERMINAL_APPT_STATUS)
      .order('date', { ascending: false })
      .limit(1);
    // Em caso de erro na checagem, não trava o usuário: segue o fluxo normal de confirmação.
    if (!error && pending && pending.length > 0) {
      setResolveBlocked({ name: ticket.lead?.name ?? 'Este lead', status: pending[0].status });
      return;
    }
    setConfirmingResolveId(ticket.id);
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

  // Busca server-side: o useTickets só traz tickets abertos + fechados nos
  // últimos 90 dias, e o board oculta resolvidos quando showResolved=off. Logo a
  // busca client-side não acha um lead já ganho/perdido ou fechado há mais tempo.
  // Quando há termo, busca os tickets dos leads que casam (aberto OU fechado),
  // sem janela de tempo. Mesmo filtro das Conversas (leadSearchOrFilter).
  React.useEffect(() => {
    const orFilter = leadSearchOrFilter(searchQuery);
    if (!orFilter || !activeClinicId) { setSearchTickets([]); return; }
    let cancelled = false;
    const handle = setTimeout(async () => {
      const { data } = await supabase
        .from('tickets')
        .select('*, lead:leads!inner(*)')
        .eq('clinic_id', activeClinicId)
        .or(orFilter, { referencedTable: 'leads' })
        .order('opened_at', { ascending: false })
        .limit(500);
      if (!cancelled) setSearchTickets((data as Ticket[]) || []);
    }, 250);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [searchQuery, activeClinicId]);

  // Predicado de facetas (origem + canal + datas + UTM, podendo ignorar uma dimensão UTM).
  // Reaproveitado na filtragem do board e na CONTAGEM dos valores de UTM, p/ que os números
  // reflitam os filtros ativos (período, origem, canal e combinação de UTMs).
  const ticketFacets = React.useCallback((ticket: any, skipUtmDim?: string) => {
    const lead = ticket.lead;
    if (!lead) return false;
    if (sourceFilter !== 'all') {
      const isMeta = !!lead.fb_campaign_name || lead.source === 'meta_ads';
      const isGoogle = !!lead.g_campaign_name || lead.source === 'google_ads';
      if (sourceFilter === 'meta' && !isMeta) return false;
      if (sourceFilter === 'google' && !isGoogle) return false;
      if (sourceFilter === 'sem_origem' && (isMeta || isGoogle)) return false;
    }
    if (channelFilter !== 'all' && lead.capture_channel !== channelFilter) return false;
    if (entryDateFrom || entryDateTo) {
      const opened = (ticket.opened_at || '').slice(0, 10);
      if (entryDateFrom && opened < entryDateFrom) return false;
      if (entryDateTo && opened > entryDateTo) return false;
    }
    if (convDateFrom || convDateTo) {
      const convs = conversionsByLead[lead.id] || [];
      const inRange = convs.some((c: any) => {
        const d = (c.converted_at || '').slice(0, 10);
        if (convDateFrom && d < convDateFrom) return false;
        if (convDateTo && d > convDateTo) return false;
        return true;
      });
      if (!inRange) return false;
    }
    for (const d of Object.keys(utmFilters)) {
      if (d === skipUtmDim) continue;
      const vals = utmFilters[d] || [];
      if (vals.length && !vals.includes(leadUtmKey(lead, d))) return false;
    }
    return true;
  }, [sourceFilter, channelFilter, entryDateFrom, entryDateTo, convDateFrom, convDateTo, conversionsByLead, utmFilters]);

  // Valores da dimensão UTM ativa + contagem, refletindo os filtros ativos (período/origem/
  // canal/combinação). Faceta: ignora a própria dimensão em edição p/ mostrar o universo.
  const utmOptions = React.useMemo(() => {
    const baseForOpts = (showResolved ? tickets : tickets.filter(t => t.status !== 'closed'))
      .filter(t => t.lead && !t.lead.is_not_lead);
    const totals = new Map<string, number>();
    const seen = new Set<string>();
    baseForOpts.forEach((t: any) => {
      const lead = t.lead;
      if (!lead || seen.has(lead.id)) return;
      if (!ticketFacets(t, utmDimension)) return;
      seen.add(lead.id);
      const k = leadUtmKey(lead, utmDimension);
      totals.set(k, (totals.get(k) || 0) + 1);
    });
    return [...totals.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([key, count]) => ({ key, label: key === NO_UTM_KEY ? 'Sem UTM' : key, value: count }));
  }, [tickets, showResolved, ticketFacets, utmDimension]);

  const filteredTickets = React.useMemo(() => {
    const hasSourceFilter = sourceFilter !== 'all';
    const hasChannelFilter = channelFilter !== 'all';
    const hasEntryFilter = entryDateFrom || entryDateTo;
    const hasConvFilter = convDateFrom || convDateTo;
    const hasSearch = searchQuery.trim().length > 0;
    const utmDims = Object.keys(utmFilters).filter(d => (utmFilters[d] || []).length > 0);
    const hasUtm = utmDims.length > 0;
    // Ao buscar, une os tickets carregados com os do servidor (dedup por id),
    // cobrindo resolvidos e fechados fora da janela de 90d. A busca também
    // revela resolvidos mesmo com showResolved desligado.
    const source = hasSearch
      ? (() => {
          const seen = new Set(tickets.map(t => t.id));
          return [...tickets, ...searchTickets.filter(t => !seen.has(t.id))];
        })()
      : tickets;
    // Ignora tickets órfãos (lead deletado → lead_id virou NULL por SET NULL)
    // e os marcados como "Não Lead" (vivem só no painel de anexo, fora do funil).
    const base = ((showResolved || hasSearch) ? source : source.filter(t => t.status !== 'closed'))
      .filter(t => t.lead && !t.lead.is_not_lead);
    if (!hasSourceFilter && !hasChannelFilter && !hasEntryFilter && !hasConvFilter && !hasSearch && !hasUtm) return base;

    return base.filter(ticket => {
      const lead = ticket.lead;
      if (hasSearch && !matchesSearch(searchQuery, { name: lead.name, email: lead.email, phone: lead.phone }, ['phone'])) {
        return false;
      }
      return ticketFacets(ticket);
    });
  }, [tickets, searchTickets, ticketFacets, showResolved, searchQuery, sourceFilter, channelFilter, entryDateFrom, entryDateTo, convDateFrom, convDateTo, utmFilters]);

  const hasActiveFilters = sourceFilter !== 'all' || channelFilter !== 'all' || entryDateFrom || entryDateTo || convDateFrom || convDateTo || searchQuery.trim().length > 0 || Object.values(utmFilters).some(a => a.length > 0);

  React.useEffect(() => { setColumnPages({}); }, [sourceFilter, channelFilter, entryDateFrom, entryDateTo, convDateFrom, convDateTo, searchQuery, utmFilters]);

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
            <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
              <div className="grid gap-4 max-h-[calc(100vh-320px)] overflow-y-auto custom-scrollbar p-4">
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
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => (testingRuleId === rule.id ? closeTestPanel() : openTestPanel(rule.id))}
                          disabled={!rule.message_to_send || !rule.target_stage_id}
                          title={!rule.message_to_send ? 'Adicione uma Mensagem a Enviar para poder testar' : 'Disparar a mensagem e ver o card mudar de etapa'}
                          className={cn(
                            "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold border transition-all disabled:opacity-40 disabled:cursor-not-allowed",
                            testingRuleId === rule.id
                              ? "text-white bg-teal-600 border-teal-600 hover:bg-teal-700"
                              : "text-teal-700 bg-teal-50 border-teal-200 hover:bg-teal-100"
                          )}
                        >
                          <Send className="w-3.5 h-3.5" />
                          Realizar Teste
                        </button>
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

                    {/* Painel de teste do gatilho */}
                    {testingRuleId === rule.id && (
                      <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/60">
                        <div className="flex items-center justify-between mb-2.5">
                          <p className="text-xs font-bold text-slate-600 flex items-center gap-1.5">
                            <Send className="w-3.5 h-3.5 text-teal-600" />
                            Testar gatilho
                          </p>
                          <button onClick={closeTestPanel} className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                        <p className="text-[11px] text-slate-400 mb-3 leading-relaxed">
                          Informe o número que vai receber a <span className="font-semibold text-slate-500">Mensagem a Enviar</span>. Se ainda não for um lead, enviamos antes uma mensagem padrão para criá-lo. O card só muda de etapa quando o n8n detecta o gatilho.
                        </p>
                        <div className="flex items-center gap-2">
                          <input
                            type="tel"
                            value={testPhone}
                            onChange={e => setTestPhone(e.target.value)}
                            disabled={testStatus === 'sending' || testStatus === 'waiting'}
                            placeholder="Ex: 11 99999-9999"
                            className="flex-1 px-3 py-2.5 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-200 focus:border-teal-400 font-medium transition-all disabled:opacity-60"
                          />
                          <Button
                            onClick={() => runRuleTest(rule)}
                            disabled={testPhone.replace(/\D/g, '').length < 8 || testStatus === 'sending' || testStatus === 'waiting'}
                            className="bg-teal-600 hover:bg-teal-700 px-5 whitespace-nowrap"
                          >
                            {(testStatus === 'sending' || testStatus === 'waiting') ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : <Send className="w-4 h-4 mr-1.5" />}
                            Disparar teste
                          </Button>
                        </div>

                        {testStatus === 'sending' && (
                          <p className="mt-3 text-xs font-medium text-slate-500 flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Enviando mensagem…</p>
                        )}
                        {testStatus === 'waiting' && (
                          <p className="mt-3 text-xs font-medium text-amber-600 flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Mensagem enviada. Aguardando o n8n mover o card…</p>
                        )}
                        {testStatus === 'moved' && (
                          <div className="mt-3 flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl bg-emerald-50 border border-emerald-200">
                            <p className="text-xs font-bold text-emerald-700 flex items-center gap-1.5">
                              <Check className="w-4 h-4" />
                              Card movido para «{stages.find(s => s.id === rule.target_stage_id)?.name || '—'}»
                            </p>
                            {testResultLeadId && (
                              <button onClick={() => viewCardInFunnel(testResultLeadId)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 transition-all whitespace-nowrap">
                                <Eye className="w-3.5 h-3.5" />
                                Ver card no funil
                              </button>
                            )}
                          </div>
                        )}
                        {testStatus === 'timeout' && (
                          <div className="mt-3 px-3 py-2.5 rounded-xl bg-amber-50 border border-amber-200">
                            <p className="text-xs font-semibold text-amber-700 flex items-center gap-1.5">
                              <AlertCircle className="w-4 h-4" />
                              Mensagem enviada, mas o card ainda não mudou de etapa.
                            </p>
                            <p className="text-[11px] text-amber-600 mt-1">Verifique a configuração do gatilho no n8n.</p>
                            <div className="flex items-center gap-3 mt-2">
                              <button onClick={() => runRuleTest(rule)} className="text-xs font-bold text-amber-700 hover:underline">Tentar de novo</button>
                              {testResultLeadId && (
                                <button onClick={() => viewCardInFunnel(testResultLeadId)} className="flex items-center gap-1 text-xs font-bold text-amber-700 hover:underline"><Eye className="w-3.5 h-3.5" /> Ver card no funil</button>
                              )}
                            </div>
                          </div>
                        )}
                        {testStatus === 'error' && (
                          <p className="mt-3 text-xs font-bold text-rose-600 flex items-center gap-1.5"><AlertCircle className="w-4 h-4" /> Não foi possível disparar o teste. Tente novamente.</p>
                        )}
                      </div>
                    )}
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
              <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200">
                <p className="text-sm font-medium text-slate-400">
                  Mostrando {transitionRules.length} {transitionRules.length === 1 ? 'regra' : 'regras'}.
                </p>
              </div>
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
            { id: 'sem_origem', label: 'Orgânico', logo: SemOrigemLogo },
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

        {/* Filtro de canal (forms / whatsapp) */}
        <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-xl p-0.5 shadow-sm">
          {([
            { id: 'all', label: 'Todos', logo: null },
            { id: 'forms', label: 'Forms', logo: null },
            { id: 'whatsapp', label: 'WhatsApp', logo: WhatsAppLogo },
            { id: 'balcao', label: 'Balcão', logo: null },
          ] as const).map(opt => (
            <button
              key={opt.id}
              onClick={() => setChannelFilter(opt.id)}
              className={cn(
                "flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-bold transition-all",
                channelFilter === opt.id
                  ? "bg-slate-900 text-white shadow-sm"
                  : "text-slate-500 hover:text-slate-800 hover:bg-slate-50"
              )}
            >
              {opt.id === 'forms' && <FileText className="w-3 h-3" />}
              {opt.id === 'balcao' && <Store className="w-3 h-3" />}
              {opt.logo && <img src={opt.logo} className="w-3 h-3 rounded" />}
              {opt.label}
            </button>
          ))}
        </div>

        {/* Filtro de UTM (dimensão + valores), no formato do "Filtrar por motivo" */}
        <UtmLeadFilter
          dimension={utmDimension}
          onDimensionChange={setUtmDimension}
          options={utmOptions}
          filters={utmFilters}
          onChange={setUtmFilters}
        />

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
            onClick={() => { setSourceFilter('all'); setChannelFilter('all'); setEntryDateFrom(''); setEntryDateTo(''); setConvDateFrom(''); setConvDateTo(''); setSearchQuery(''); setUtmFilters({}); }}
            className="text-[10px] font-bold text-rose-500 hover:text-rose-700 uppercase tracking-wider flex items-center gap-1 shrink-0"
            title="Limpar Filtros"
          >
            <X className="w-3 h-3" />
          </button>
        )}

        <div className="flex items-center gap-1.5 ml-auto">
          <Button variant="outline" size="icon" title={`Não Leads${notLeads.length ? ` (${notLeads.length})` : ''}`} className="relative h-8 w-8 text-slate-400 hover:text-slate-700" onClick={() => setShowNotLeadPanel(true)}>
            <UserX className="w-3.5 h-3.5" />
            {notLeads.length > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[15px] h-[15px] px-0.5 flex items-center justify-center text-[9px] font-black text-white bg-slate-500 rounded-full">{notLeads.length}</span>
            )}
          </Button>
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
            const stageTickets = filteredTickets
              .filter(t => t.stage_id === stage.id)
              .sort((a, b) => {
                const av = a.lead?.last_activity_at ?? a.lead?.created_at ?? a.opened_at;
                const bv = b.lead?.last_activity_at ?? b.lead?.created_at ?? b.opened_at;
                return av < bv ? 1 : av > bv ? -1 : 0;
              });
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
                    const isGanho = stage.slug === 'ganho';
                    const semMotivo = isPerdido && !lead.loss_reason && !ticket.loss_reason && !isClosed;
                    const lastContact = lead.last_activity_at ?? lead.created_at;
                    const frozen = isClosed || !!lead.converted_patient_id || isPerdido;
                    // Cards na etapa "Ganho" (ticket fechado/convertido) podem ser arrastados p/ outra
                    // etapa: o move_lead_stage preserva o ganho e abre um ticket NOVO (novo ciclo) na
                    // etapa-alvo — ver migration 20260622000006.
                    const canDrag = isGanho || (!isClosed && !lead.converted_patient_id);
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
                        id={`funnel-card-${lead.id}`}
                        draggable={canDrag}
                        onDragStart={canDrag ? (e) => handleDragStart(e as unknown as React.DragEvent<Element>, ticket) : undefined}
                        whileHover={{ y: canDrag ? -1 : 0 }}
                        className={cn(
                          "px-3 py-2.5 rounded-lg border shadow-sm transition-all group",
                          highlightLeadId === lead.id && "ring-2 ring-teal-400 ring-offset-2 shadow-lg",
                          canDrag ? "cursor-pointer active:cursor-move hover:shadow-md" : "cursor-default",
                          isClosed && "opacity-50 grayscale-[0.5] hover:opacity-75",
                          draggedLead?.id === ticket.id && "opacity-50",
                          semMotivo && "animate-pulse",
                          isClosed ? "bg-slate-50/80 border-slate-200"
                            : ticket.outcome === 'ganho' ? "bg-emerald-50 border-emerald-200"
                              : ticket.outcome === 'perdido' ? "bg-rose-50 border-rose-200"
                                : isPerdido ? "bg-white border-rose-200"
                                  : (!!lead.fb_campaign_name || lead.source === 'meta_ads') ? "bg-blue-50/60 border-blue-200/80"
                                    : (!!lead.g_campaign_name || lead.source === 'google_ads') ? "bg-emerald-50/60 border-emerald-200/80"
                                    : (!lead.fb_campaign_name && !lead.g_campaign_name && lead.source === 'instagram') ? "bg-pink-50/60 border-pink-200/80"
                                      : lead.source === 'sincronizacao' ? "bg-violet-50/60 border-violet-200/80"
                                        : "bg-white border-slate-200"
                        )}
                      >
                        {/* Header: fonte + acoes */}
                        {(() => {
                          const isMeta = !!lead.fb_campaign_name || lead.source === 'meta_ads';
                          const isGoogle = !!lead.g_campaign_name || lead.source === 'google_ads';
                          const isInstagram = !isMeta && !isGoogle && lead.source === 'instagram';
                          const isSync = !isMeta && !isGoogle && !isInstagram && lead.source === 'sincronizacao';
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
                                  {isInstagram && (
                                    <Instagram className="w-3.5 h-3.5 shrink-0 text-pink-500" />
                                  )}
                                  {!isMeta && !isGoogle && !isInstagram && (
                                    <img src={SemOrigemLogo} alt="Orgânico" className="w-3.5 h-3.5 rounded shrink-0 opacity-40" />
                                  )}
                                  <span className={cn(
                                    "text-[9px] font-black uppercase tracking-[0.1em] truncate",
                                    isMeta ? "text-blue-500" : isGoogle ? "text-emerald-500" : isInstagram ? "text-pink-500" : isSync ? "text-violet-500" : "text-slate-400"
                                  )}>
                                    {isMeta ? 'Meta Ads' : isGoogle ? 'Google Ads' : isInstagram ? 'Instagram' : isSync ? 'Sincronização' : 'Orgânico'}
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

                                {/* Canal de captacao (forms / whatsapp) + data de entrada do lead */}
                                {(lead.capture_channel === 'forms' || lead.capture_channel === 'whatsapp') && (
                                  <div className="inline-flex items-center gap-1.5 w-max">
                                    {lead.capture_channel === 'forms' ? (
                                      <span title="Preencheu o formulário" className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 text-[8px] font-black uppercase tracking-[0.1em]">
                                        <FileText className="w-2.5 h-2.5 shrink-0" /> Forms
                                      </span>
                                    ) : (
                                      <span title="Veio pelo WhatsApp (chamou direto ou importado da sincronização)" className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-green-50 text-green-600 text-[8px] font-black uppercase tracking-[0.1em]">
                                        <img src={WhatsAppLogo} alt="WhatsApp" className="w-2.5 h-2.5 shrink-0" /> WhatsApp
                                      </span>
                                    )}
                                    {lead.created_at && (
                                      <span className="text-[9px] font-medium text-slate-400 whitespace-nowrap" title="Data de entrada do lead">
                                        {format(parseISO(lead.created_at), 'dd/MM/yyyy')}
                                      </span>
                                    )}
                                  </div>
                                )}

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
                                {confirmingNotLeadId === ticket.id ? (
                                  <div className="flex items-center gap-1 animate-in fade-in zoom-in duration-150" onClick={e => e.stopPropagation()}>
                                    <span className="text-[9px] font-bold text-slate-500">Não Lead?</span>
                                    <button
                                      onClick={async e => { e.stopPropagation(); setConfirmingNotLeadId(null); await markNotLead(lead.id); refetchTickets(true); }}
                                      className="px-1.5 py-1 bg-slate-700 text-white rounded text-[9px] font-black hover:bg-slate-800 transition-all shadow-sm"
                                    >
                                      Confirmar
                                    </button>
                                    <button
                                      onClick={e => { e.stopPropagation(); setConfirmingNotLeadId(null); }}
                                      className="px-1 flex items-center justify-center bg-white text-slate-600 py-1 rounded hover:bg-slate-100 border border-slate-200 transition-all shadow-sm shrink-0"
                                      title="Cancelar"
                                    >
                                      <X className="w-2.5 h-2.5" />
                                    </button>
                                  </div>
                                ) : (
                                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button title="Agendar consulta" onClick={() => { setScheduleLead({ lead, ticketId: ticket.id }); setScheduleForm({ doctor_id: doctors[0]?.id || '', date: '', time: '', notes: '', consultation_type_id: '' }); setScheduleError(null); setScheduleSlots(null); }} className="p-0.5 text-slate-400 hover:text-indigo-600 rounded transition-colors"><CalendarPlus className="w-3 h-3" /></button>
                                  <button title="Marcar como Não Lead" onClick={e => { e.stopPropagation(); setConfirmingNotLeadId(ticket.id); }} className="p-0.5 text-slate-400 hover:text-slate-700 rounded transition-colors"><UserX className="w-3 h-3" /></button>
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
                                            onClick={() => { setStatusDropdownTicketId(null); setGanhoLead({ id: lead.id, name: lead.name, phone: lead.phone ?? null, patientId: lead.converted_patient_id ?? null, prevStageId: ticket.stage_id, ticketId: ticket.id }); }}
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
                                )}

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
                                        onClick={e => { e.stopPropagation(); attemptResolve(ticket); }}
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
                        {(aguardando || precisaResponder || slaBreach > 0 || lead.whatsapp_invalid) && (
                          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                            {lead.whatsapp_invalid && (
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded border bg-rose-50 border-rose-200 text-rose-600 flex items-center gap-1" title="Número não está no WhatsApp — envio automático não é possível">
                                <PhoneOff className="w-2.5 h-2.5 shrink-0" />
                                Sem WhatsApp
                              </span>
                            )}
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
                              <span className={cn(
                                "text-[9px] font-medium truncate text-right flex-1",
                                ticket.outcome === 'ganho' ? "text-emerald-600 font-bold"
                                  : ticket.outcome === 'perdido' ? "text-rose-500 font-bold"
                                    : "text-slate-400"
                              )}>
                                {(() => {
                                  if (!ticket.outcome) return formatDistanceToNow(parseISO(lastContact), { addSuffix: true, locale: ptBR });
                                  // Data de ganho = data da venda (conversão) quando houver; senão, quando o desfecho foi marcado.
                                  const d = (ticket.outcome === 'ganho' ? lastConversion?.converted_at : null) ?? ticket.outcome_at;
                                  const label = ticket.outcome === 'ganho' ? 'Ganho' : 'Perdido';
                                  return d ? `${label} ${format(parseISO(d), 'dd/MM/yy')}` : label;
                                })()}
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
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/50 z-[80] flex items-center justify-center p-4" onClick={() => setShowModal(false)}>
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between p-6 border-b border-slate-100">
                <h3 className="text-lg font-bold text-slate-900">{selectedLead ? 'Editar Lead' : 'Novo Lead'}</h3>
                <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
              </div>
              <div className="p-6 space-y-4">
                {selectedLead?.ai_summary && selectedLead.ai_summary.trim() && (
                  <details className="group/aisum rounded-lg border border-teal-100 bg-teal-50/50 p-3">
                    <summary className="flex items-center gap-1.5 cursor-pointer list-none [&::-webkit-details-marker]:hidden text-teal-700 hover:text-teal-800">
                      <Sparkles className="w-3.5 h-3.5 shrink-0" />
                      <span className="text-[10px] font-bold uppercase tracking-wider">Resumo da IA</span>
                      <ChevronDown className="w-3 h-3 ml-auto transition-transform group-open/aisum:rotate-180" />
                    </summary>
                    <p className="mt-2 text-xs text-slate-600 leading-relaxed whitespace-pre-wrap max-h-60 overflow-y-auto pr-1">{selectedLead.ai_summary}</p>
                  </details>
                )}
                {/* O bloco "UTMs capturadas" foi removido: a jornada já mostra a mesma campanha, com
                    data e no contexto de cada contato. Manter os dois era repetir a mesma linha. */}
                {selectedLead?.id && (
                  <LeadJourney
                    leadId={selectedLead.id}
                    fallbackCampaign={selectedLead.fb_campaign_name || selectedLead.g_campaign_name}
                    fallbackAd={selectedLead.fb_ad_name || selectedLead.g_ad_name}
                  />
                )}
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
                      <option value="">Orgânico</option>
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
                {(() => {
                  const et = tickets.find(t => t.id === selectedLead?._ticketId);
                  if (!et?.quote_data) return null;
                  return (
                    <div className="space-y-2">
                      <button
                        type="button"
                        onClick={() => {
                          setShowModal(false);
                          const vig = getVigenteOrcamento(orcamentos, selectedLead.id, et.id);
                          setOrcamentoLead({ id: selectedLead.id, name: selectedLead.name, phone: selectedLead.phone ?? null, prevStageId: null, ticketId: et.id, initialQuote: et.quote_data, orcamentoId: vig?.id ?? null });
                        }}
                        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 font-bold text-sm hover:bg-blue-100 transition-colors"
                      >
                        <FileText className="w-4 h-4" /> Ver / editar orçamento criado
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowModal(false);
                          setPoLead({ id: selectedLead.id, name: selectedLead.name, phone: selectedLead.phone ?? null, quoteData: et.quote_data, ticketId: et.id });
                        }}
                        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border border-teal-200 bg-teal-50 text-teal-700 font-bold text-sm hover:bg-teal-100 transition-colors"
                      >
                        <Package className="w-4 h-4" /> Gerar ordem de produção / separação
                      </button>
                    </div>
                  );
                })()}
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
                      <option value="Fora do raio">Fora do raio</option>
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
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="bg-white rounded-xl shadow-xl w-full max-w-sm overflow-hidden" onClick={e => e.stopPropagation()}>
              <div className="p-6 text-center">
                <div className="w-12 h-12 bg-rose-50 rounded-full flex items-center justify-center mx-auto mb-4"><AlertCircle className="w-6 h-6 text-rose-600" /></div>
                <h3 className="text-xl font-bold text-slate-900 mb-2">Excluir Ticket</h3>
                <p className="text-slate-500">Tem certeza que deseja excluir este ticket? Esta ação não pode ser desfeita.</p>
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

        {/* Aviso: ticket com agendamento em aberto não pode ser resolvido */}
        {resolveBlocked && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4" onClick={() => setResolveBlocked(null)}>
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="bg-white rounded-xl shadow-xl w-full max-w-sm overflow-hidden" onClick={e => e.stopPropagation()}>
              <div className="p-6 text-center">
                <div className="w-12 h-12 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-4"><AlertCircle className="w-6 h-6 text-amber-600" /></div>
                <h3 className="text-xl font-bold text-slate-900 mb-2">Atualize o status do paciente</h3>
                <p className="text-slate-500">
                  <span className="font-semibold text-slate-700">{resolveBlocked.name}</span> tem um agendamento em aberto
                  {APPT_STATUS_LABELS[resolveBlocked.status] ? <> (status atual: <span className="font-semibold text-slate-700">{APPT_STATUS_LABELS[resolveBlocked.status]}</span>)</> : null}.
                </p>
                <p className="text-slate-500 mt-2">
                  Atualize o status do paciente na agenda para <span className="font-semibold text-emerald-700">Realizado</span>, <span className="font-semibold text-slate-700">Faltou</span> ou <span className="font-semibold text-rose-700">Cancelado</span> antes de resolver este atendimento.
                </p>
              </div>
              <div className="flex p-6 border-t border-slate-100 bg-slate-50">
                <Button className="flex-1" onClick={() => setResolveBlocked(null)}>Entendi</Button>
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
                          title={stage.is_conversion ? 'Etapa de conversão (usada nas métricas de Marketing)' : 'Marcar como etapa de conversão (Marketing)'}
                          onClick={async () => {
                            if (stage.is_conversion) return;
                            // Limpa o flag das outras ANTES de setar esta (índice único parcial por clínica)
                            await Promise.all(
                              localStages.filter(s => s.is_conversion && s.id !== stage.id)
                                .map(s => updateStage(s.id, { is_conversion: false } as any))
                            );
                            await updateStage(stage.id, { is_conversion: true } as any);
                            setLocalStages(p => p.map(s => ({ ...s, is_conversion: s.id === stage.id })));
                          }}
                          className={cn(
                            "px-2 py-1 rounded-md text-[9px] font-black uppercase tracking-tighter transition-all mr-1",
                            stage.is_conversion ? "bg-emerald-100 text-emerald-700" : "text-slate-300 hover:text-emerald-600 hover:bg-emerald-50"
                          )}
                        >
                          Conversão
                        </button>
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
                                  const ok = await removeStage(stage.id);
                                  if (ok) {
                                    setLocalStages(p => p.filter(s => s.id !== stage.id));
                                  } else {
                                    alert('Não foi possível excluir esta etapa. Provavelmente há leads/tickets parados nela — mova-os para outra etapa e tente novamente.');
                                  }
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

      {/* Caixa de anexo: Não Leads */}
      <NotLeadPanel
        open={showNotLeadPanel}
        onClose={() => setShowNotLeadPanel(false)}
        leads={notLeads}
        onRestore={async (id) => { await restoreNotLead(id); refetchTickets(true); }}
      />

      {/* Ganho Modal */}
      {ganhoLead && (
        <GanhoModal
          lead={ganhoLead}
          createPatient={createPatient}
          updateLead={update}
          onClose={() => setGanhoLead(null)}
          onCancel={() => {
            const { ticketId, prevStageId } = ganhoLead;
            setGanhoLead(null);
            if (prevStageId) moveTicket(ticketId, prevStageId);
          }}
          onCreate={async (data) => {
            // Grava ticket_id na conversão p/ o "Cancelar venda" apagá-la com precisão depois.
            const ok = await createConversion({ ...data, ticket_id: ganhoLead.ticketId });
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

      {/* Orçamento Modal (valor + produto/serviço; NÃO é conversão) */}
      {orcamentoLead && (
        <OrcamentoModal
          lead={orcamentoLead}
          initialQuote={orcamentoLead.initialQuote}
          onClose={() => setOrcamentoLead(null)}
          onCancel={() => {
            const { ticketId, prevStageId } = orcamentoLead;
            setOrcamentoLead(null);
            if (prevStageId) moveTicket(ticketId, prevStageId);
          }}
          onConfirm={async (value, description, quoteData, status) => {
            // Única escrita: a RPC grava o orçamento E espelha em tickets.quote_data/notes +
            // leads.estimated_value na mesma transação (substitui o dual-write solto no client).
            const res = await saveOrcamento({
              id: orcamentoLead.orcamentoId ?? null,
              leadId: orcamentoLead.id,
              ticketId: orcamentoLead.ticketId,
              status,
              clientName: orcamentoLead.name,
              total: value,
              notes: description || null,
              snapshot: quoteData ?? null,
            });
            if (!res.success) return false;
            await refetchTickets(true);
            return true;
          }}
        />
      )}

      {/* Modal: Gerar Ordem de Produção (documento p/ a fábrica, a partir do orçamento salvo) */}
      {poLead && (
        <ProductionOrderModal
          lead={poLead}
          quoteData={poLead.quoteData}
          ticketId={poLead.ticketId ?? null}
          onClose={() => setPoLead(null)}
        />
      )}

      {/* Aviso Manter x Cancelar ao arrastar um card já resolvido (venda/perda) p/ etapa ativa */}
      {reopenLead && (
        <ReopenChoiceModal
          info={reopenLead}
          targetStageName={stages.find(s => s.id === reopenLead.targetStageId)?.name ?? ''}
          onClose={() => setReopenLead(null)}
          onKeep={async () => {
            const { ticket, targetStageId } = reopenLead;
            setReopenLead(null);
            // Move o MESMO card mantendo o desfecho (ganho/perda): conversão, valor, botão
            // Resolver e demais propriedades seguem com ele para a nova coluna (pipeline).
            await moveTicketKeepOutcome(ticket.id, targetStageId);
            await refetchTickets(true);
          }}
          onCancelOutcome={async (cancelAppointment) => {
            const { ticket, targetStageId } = reopenLead;
            setReopenLead(null);
            await reopenTicket(ticket.id, targetStageId, cancelAppointment);
            await refetchTickets(true);
          }}
          checkAppointment={async (ticketId) => {
            const { data } = await supabase
              .from('appointments')
              .select('id, date, time, status, doctor:doctors(name)')
              .eq('ticket_id', ticketId)
              .order('date', { ascending: false });
            const a = (data || []).find((x: any) => x.status !== 'cancelado' && x.status !== 'faltou');
            return a ? { id: a.id, date: a.date, time: a.time, status: a.status, doctorName: (a as any).doctor?.name } : null;
          }}
        />
      )}

      {/* Lead Chat Drawer */}
      <AnimatePresence>
        {chatLead && (
          <LeadChat
            lead={chatLead.lead}
            ticketId={chatLead.ticketId}
            currentStageId={tickets.find(t => t.id === chatLead.ticketId)?.stage_id ?? null}
            onClose={() => setChatLead(null)}
            isDragging={draggedLead !== null}
            onEdit={() => { const ticket = tickets.find(t => t.id === chatLead.ticketId); if (ticket?.lead) openEditModal(ticket); }}
            onGanho={() => setGanhoLead({ id: chatLead.lead.id, name: chatLead.lead.name, phone: chatLead.lead.phone ?? null, patientId: chatLead.lead.converted_patient_id ?? null, prevStageId: null, ticketId: chatLead.ticketId })}
            onPerdido={() => setLossLead({ id: chatLead.lead.id, name: chatLead.lead.name, prevStageId: null, ticketId: chatLead.ticketId })}
            onStageChange={async (stageId) => {
              const targetStage = stages.find(s => s.id === stageId);
              const ticket = tickets.find(t => t.id === chatLead.ticketId);
              if (ticket && stageId !== ticket.stage_id) {
                if (targetStage?.slug === 'perdido') {
                  await closeTicket(ticket.id, 'perdido');
                } else if (targetStage?.slug === 'ganho') {
                  setGanhoLead({ id: chatLead.lead.id, name: chatLead.lead.name, phone: chatLead.lead.phone ?? null, patientId: chatLead.lead.converted_patient_id ?? null, prevStageId: ticket.stage_id, ticketId: ticket.id });
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
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Tipo de Consulta</label>
                  {!scheduleForm.doctor_id ? (
                    <div className="p-2 bg-slate-50 border border-slate-100 rounded-lg text-slate-400 text-xs font-bold">Selecione um médico primeiro.</div>
                  ) : scheduleActiveTypes.length === 0 ? (
                    <div className="p-2 bg-amber-50 border border-amber-100 rounded-lg text-amber-700 text-xs font-bold">Nenhum tipo cadastrado para esse médico.</div>
                  ) : (
                    <div className={`grid gap-2 ${scheduleActiveTypes.length === 1 ? 'grid-cols-1' : scheduleActiveTypes.length === 2 ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-3'}`}>
                      {scheduleActiveTypes.map(ct => (
                        <button
                          key={ct.id}
                          type="button"
                          onClick={() => setScheduleForm(p => ({ ...p, consultation_type_id: ct.id, time: '' }))}
                          className={`py-2 rounded-lg border text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                            scheduleForm.consultation_type_id === ct.id
                              ? (ct.modality === 'online' ? 'bg-sky-500 text-white border-sky-500' : 'bg-emerald-500 text-white border-emerald-500')
                              : (ct.modality === 'online' ? 'bg-white text-slate-600 border-slate-200 hover:border-sky-300' : 'bg-white text-slate-600 border-slate-200 hover:border-emerald-300')
                          }`}
                        >
                          {ct.name}
                        </button>
                      ))}
                    </div>
                  )}
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
                      p_consultation_type_id: scheduleForm.consultation_type_id || null,
                      p_notes: scheduleForm.notes || null,
                      p_ticket_id: scheduleLead.ticketId || null,
                      p_request_id: globalThis.crypto?.randomUUID?.() ?? null,
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
                        slot_unavailable: 'Horário fora da disponibilidade do médico. Escolha um horário válido.',
                        lead_not_found: 'Lead não encontrado.',
                        patient_not_found: 'Paciente não encontrado.',
                        doctor_not_found: 'Médico não encontrado.',
                        doctor_clinic_mismatch: 'Médico não pertence à clínica.',
                        doctor_inactive: 'Médico inativo.',
                        consultation_type_not_found: 'Tipo de consulta não configurado para este médico.',
                        consultation_type_inactive: 'Tipo de consulta inativo.',
                        ticket_has_active_appointment: 'Este paciente já tem um agendamento ativo nesta jornada.',
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
