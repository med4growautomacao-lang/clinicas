import React, { useState, useRef, useCallback, useEffect } from "react";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
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
} from "lucide-react";
import { cn } from "@/src/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { useFunnelStages, useLeads, useSettings, useTransitionRules } from "../hooks/useSupabase";
import GoogleLogo from "../assets/logos/Logo Googleads.png";
import MetaLogo from "../assets/logos/Logo Metaads.png";
import WhatsAppLogo from "../assets/logos/Logo Whatsapp.png";
import SemOrigemLogo from "../assets/logos/Logo Sem origem.png";
import { Share2, Globe, Layout, Smartphone } from "lucide-react";

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
import { format, parseISO, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { LeadChat } from "./LeadChat";

function KanbanScrollContainer({ children }: { children: React.ReactNode }) {
  const mainRef = useRef<HTMLDivElement>(null);
  const topScrollRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const isPanning = useRef(false);
  const pendingPan = useRef(false);
  const isCardDragging = useRef(false);
  const startX = useRef(0);
  const scrollLeft = useRef(0);
  const syncingFrom = useRef<'main' | 'top' | null>(null);

  const onMainScroll = useCallback(() => {
    if (syncingFrom.current === 'top') return;
    syncingFrom.current = 'main';
    if (topScrollRef.current && mainRef.current)
      topScrollRef.current.scrollLeft = mainRef.current.scrollLeft;
    syncingFrom.current = null;
  }, []);

  const onTopScroll = useCallback(() => {
    if (syncingFrom.current === 'main') return;
    syncingFrom.current = 'top';
    if (mainRef.current && topScrollRef.current)
      mainRef.current.scrollLeft = topScrollRef.current.scrollLeft;
    syncingFrom.current = null;
  }, []);

  useEffect(() => {
    const update = () => {
      if (mainRef.current && innerRef.current)
        innerRef.current.style.width = mainRef.current.scrollWidth + 'px';
    };
    update();
    const obs = new ResizeObserver(update);
    if (mainRef.current) obs.observe(mainRef.current);
    return () => obs.disconnect();
  }, []);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('input') || target.closest('textarea')) return;
    pendingPan.current = true;
    startX.current = e.pageX;
    scrollLeft.current = mainRef.current?.scrollLeft ?? 0;
  }, []);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (pendingPan.current && !isCardDragging.current && !isPanning.current) {
      if (Math.abs(e.pageX - startX.current) > 5) {
        isPanning.current = true;
        startX.current = e.pageX;
        scrollLeft.current = mainRef.current?.scrollLeft ?? 0;
        if (mainRef.current) mainRef.current.style.cursor = 'grabbing';
      }
      return;
    }
    if (!isPanning.current || !mainRef.current) return;
    mainRef.current.scrollLeft = scrollLeft.current - (e.pageX - startX.current);
  }, []);

  const stopPan = useCallback(() => {
    pendingPan.current = false;
    isPanning.current = false;
    if (mainRef.current) mainRef.current.style.cursor = '';
  }, []);

  const onDragStart = useCallback(() => {
    isCardDragging.current = true;
    pendingPan.current = false;
    isPanning.current = false;
    if (mainRef.current) mainRef.current.style.cursor = '';
  }, []);

  const onDragEnd = useCallback(() => {
    isCardDragging.current = false;
    isPanning.current = false;
    if (mainRef.current) mainRef.current.style.cursor = '';
  }, []);

  return (
    <div className="flex flex-col h-full">
      {/* Barra de scroll superior */}
      <div
        ref={topScrollRef}
        className="overflow-x-scroll custom-scrollbar mb-4"
        style={{ height: 12 }}
        onScroll={onTopScroll}
      >
        <div ref={innerRef} style={{ height: 1 }} />
      </div>

      {/* Container principal */}
      <div
        ref={mainRef}
        className="flex gap-4 overflow-x-scroll pb-2 h-full custom-scrollbar min-h-[600px]"
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onScroll={onMainScroll}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={stopPan}
        onMouseLeave={stopPan}
      >
        {children}
      </div>
    </div>
  );
}

export function LeadKanban() {
  const { data: stages, loading: stagesLoading, reorder: reorderStages, update: updateStage, create: createStage, remove: removeStage } = useFunnelStages();
  const { data: leads, loading: leadsLoading, create, update, remove } = useLeads();
  const { aiConfig, updateAI } = useSettings();
  const { data: transitionRules, create: createRule, remove: removeRule, update: updateRule } = useTransitionRules();
  const [showModal, setShowModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [selectedLead, setSelectedLead] = useState<any>(null);
  const [formData, setFormData] = useState({ name: '', phone: '', source: 'sincronizacao', capture_channel: 'whatsapp', stage_id: '', estimated_value: '', loss_reason: '' });
  const [submitting, setSubmitting] = useState(false);
  const [chatLead, setChatLead] = useState<any>(null);
  const [localStages, setLocalStages] = useState<any[]>([]);
  const [isAddingStage, setIsAddingStage] = useState(false);
  const [newStageName, setNewStageName] = useState("");
  const [showAutomationModal, setShowAutomationModal] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [isAddingRule, setIsAddingRule] = useState(false);
  const [newRule, setNewRule] = useState({ keywords: '', target_stage_id: '', context: '', lead_response: '', message_to_send: '' });

  const [draggedLead, setDraggedLead] = useState<any>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);

  const handleDragStart = (e: React.DragEvent, lead: any) => {
    setDraggedLead(lead);
    e.dataTransfer.setData("leadId", lead.id);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent, stageId: string) => {
    e.preventDefault();
    setDragOverStage(stageId);
  };

  const handleDrop = async (e: React.DragEvent, targetStageId: string) => {
    e.preventDefault();
    setDragOverStage(null);
    const leadId = e.dataTransfer.getData("leadId");
    
    if (draggedLead && draggedLead.stage_id !== targetStageId) {
      await update(draggedLead.id, { stage_id: targetStageId });
    }
    setDraggedLead(null);
  };

  const handleSubmit = async () => {
    if (!formData.name.trim()) return;
    setSubmitting(true);
    
    const isPerdido = stages.find(s => s.id === formData.stage_id)?.name === 'Perdido';

    const payload = {
      name: formData.name,
      phone: formData.phone || null,
      source: formData.source || null,
      capture_channel: formData.capture_channel || 'whatsapp',
      stage_id: formData.stage_id || (stages[0]?.id ?? null),
      estimated_value: formData.estimated_value ? Number(formData.estimated_value) : 0,
      loss_reason: isPerdido ? (formData.loss_reason || null) : null,
    };

    if (selectedLead) {
      await update(selectedLead.id, payload);
    } else {
      await create(payload);
    }

    setFormData({ name: '', phone: '', source: 'sincronizacao', capture_channel: 'whatsapp', stage_id: '', estimated_value: '', loss_reason: '' });
    setSelectedLead(null);
    setShowModal(false);
    setSubmitting(false);
  };

  const handleDelete = async () => {
    if (!selectedLead) return;
    setSubmitting(true);
    await remove(selectedLead.id);
    setShowDeleteConfirm(false);
    setSelectedLead(null);
    setSubmitting(false);
  };

  const openEditModal = (lead: any) => {
    setSelectedLead(lead);
    setFormData({
      name: lead.name,
      phone: lead.phone || '',
      source: lead.source || '',
      capture_channel: lead.capture_channel || 'whatsapp',
      stage_id: lead.stage_id || '',
      estimated_value: lead.estimated_value?.toString() || '',
      loss_reason: lead.loss_reason || ''
    });
    setShowModal(true);
  };

  const openDeleteConfirm = (lead: any) => {
    setSelectedLead(lead);
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
  };

  if (stagesLoading || leadsLoading) {
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-slate-900">
            Funil de <span className="text-teal-600">Leads</span>
          </h2>
          <p className="text-slate-500 font-medium text-base">Gerencie a jornada dos seus leads.</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" className="h-10 w-10 text-slate-400 hover:text-teal-600" onClick={() => { setShowAutomationModal(true); }}>
            <Zap className="w-5 h-5" />
          </Button>
          <Button variant="outline" size="icon" className="h-10 w-10 text-slate-400 hover:text-teal-600" onClick={() => { setLocalStages([...stages]); setShowSettingsModal(true); }}>
            <Settings className="w-5 h-5" />
          </Button>
          <Button className="py-5 px-6 group" onClick={() => { setSelectedLead(null); setFormData({ name: '', phone: '', source: 'sincronizacao', capture_channel: 'whatsapp', stage_id: stages[0]?.id || '', estimated_value: String(aiConfig?.default_ticket_value ?? ''), loss_reason: '' }); setShowModal(true); }}>
            <Plus className="w-5 h-5 mr-2 group-hover:rotate-90 transition-transform" />
            Novo Lead
          </Button>
        </div>
      </div>

      <KanbanScrollContainer>
        {stages.map((stage) => {
          const stageLeads = leads.filter(l => l.stage_id === stage.id);
          const stageTotal = stageLeads.reduce((sum, l) => sum + (Number(l.estimated_value) || 0), 0);
          return (
            <div key={stage.id} className="w-[300px] shrink-0 flex flex-col gap-4">
              <div className="flex items-center gap-2 px-2">
                <div className={cn("w-2 h-2 shrink-0 rounded-full", stageColors[stage.color || 'bg-slate-500'] || 'bg-slate-500')} />
                <h3 className="font-bold text-slate-700 text-xs uppercase tracking-wider truncate flex-1">{stage.name}</h3>
                <span className="bg-slate-200 text-slate-600 text-[10px] font-bold px-1.5 py-0.5 rounded-md shrink-0">{stageLeads.length}</span>
                <span className="text-[10px] font-bold text-slate-400 shrink-0">
                  R$ {stageTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </span>
                <button className="text-slate-400 hover:text-slate-600 shrink-0" onClick={() => { setSelectedLead(null); setFormData({ name: '', phone: '', source: 'sincronizacao', capture_channel: 'whatsapp', stage_id: stage.id, estimated_value: String(aiConfig?.default_ticket_value ?? ''), loss_reason: '' }); setShowModal(true); }}>
                  <Plus className="w-4 h-4" />
                </button>
              </div>

              <div 
                className={cn(
                  "flex-1 bg-slate-100/50 rounded-xl p-3 flex flex-col gap-3 min-h-[400px] transition-colors border-2 border-transparent",
                  dragOverStage === stage.id && "bg-teal-50 border-teal-200"
                )}
                onDragOver={(e) => handleDragOver(e, stage.id)}
                onDragLeave={() => setDragOverStage(null)}
                onDrop={(e) => handleDrop(e, stage.id)}
              >
                {stageLeads.map((lead) => {
                  const isPerdido = stage.name === 'Perdido';
                  const semMotivo = isPerdido && !lead.loss_reason;
                  const lastContact = lead.last_message_at ?? lead.created_at;
                  const frozen = !!lead.converted_patient_id || isPerdido;
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
                  const aguardando = !isPerdido && !!lead.last_outbound_at && (
                    !lead.last_message_at || parseISO(lead.last_outbound_at) > parseISO(lead.last_message_at)
                  );
                  const precisaResponder = !isPerdido && !!lead.last_message_at && (
                    !lead.last_outbound_at || parseISO(lead.last_message_at) > parseISO(lead.last_outbound_at)
                  );
                  return (
                  <motion.div
                    key={lead.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, lead)}
                    whileHover={{ y: -1 }}
                    className={cn(
                      "px-3 py-2.5 rounded-lg border shadow-sm cursor-grab active:cursor-grabbing hover:shadow-md transition-all group",
                      draggedLead?.id === lead.id && "opacity-50",
                      isPerdido ? "bg-white border-rose-200"
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
                      
                      const hasUtms = isMeta 
                        ? (lead.fb_campaign_name || lead.fb_adset_name || lead.fb_ad_name)
                        : (lead.g_campaign_name || lead.g_term_name || lead.g_source_name);

                      return (
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
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
                        </div>
                        
                        {hasUtms && (
                          <div className="mt-1 space-y-0.5">
                            {campaignName && (
                              <p className={cn(
                                "text-[9px] leading-tight truncate max-w-full font-medium",
                                isMeta ? "text-blue-600/80" : isGoogle ? "text-emerald-600/80" : "text-slate-500"
                              )}>
                                <span className="font-bold opacity-70">Campanha:</span> {campaignName}
                              </p>
                            )}
                            {(lead.g_term_name || lead.fb_adset_name) && (
                              <p className={cn(
                                "text-[9px] leading-tight truncate max-w-full font-medium",
                                isMeta ? "text-blue-500/70" : isGoogle ? "text-emerald-500/70" : "text-slate-400"
                              )}>
                                <span className="font-bold opacity-70">Termo:</span> {lead.g_term_name || lead.fb_adset_name}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 ml-2">
                        <button onClick={() => openEditModal(lead)} className="p-0.5 text-slate-400 hover:text-teal-600 rounded transition-colors"><Edit2 className="w-3 h-3" /></button>
                        <button onClick={() => openDeleteConfirm(lead)} className="p-0.5 text-slate-400 hover:text-rose-600 rounded transition-colors"><Trash2 className="w-3 h-3" /></button>
                      </div>
                    </div>
                      );
                    })()}

                    {/* Nome + telefone */}
                    <h4 className="font-bold text-slate-900 text-sm leading-tight">{lead.name}</h4>
                    {lead.phone && (
                      <p className="text-[10px] font-medium text-slate-400 mt-0.5">{lead.phone}</p>
                    )}

                    {/* Motivo da perda */}
                    {isPerdido && (
                      <div className={cn(
                        "mt-2 px-2 py-1 rounded text-[9px] font-bold flex items-center gap-1.5",
                        semMotivo
                          ? "bg-amber-50 border border-amber-200 text-amber-700"
                          : "bg-rose-50 border border-rose-100 text-rose-700"
                      )}>
                        <AlertCircle className="w-2.5 h-2.5 shrink-0" />
                        {semMotivo ? "Motivo da perda nao preenchido" : lead.loss_reason}
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
                    <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-100">
                      <div className="bg-teal-50 text-teal-700 text-[9px] font-bold px-1.5 py-0.5 rounded border border-teal-100">
                        R$ {Number(lead.estimated_value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[9px] font-medium text-slate-400">
                          {formatDistanceToNow(parseISO(lastContact), { addSuffix: true, locale: ptBR })}
                        </span>
                        <button
                          onClick={() => setChatLead(lead)}
                          className="flex items-center gap-1 px-1.5 py-0.5 bg-teal-50 text-teal-700 rounded text-[9px] font-bold border border-teal-100 hover:bg-teal-100 transition-colors"
                        >
                          <MessageSquare className="w-2.5 h-2.5" />
                          Chat
                        </button>
                      </div>
                    </div>
                  </motion.div>
                  );
                })}

                <button onClick={() => { setFormData(p => ({ ...p, stage_id: stage.id })); setShowModal(true); }} className="w-full py-2 border border-dashed border-slate-300 rounded-lg text-slate-400 text-xs font-semibold hover:bg-white hover:border-slate-400 transition-all flex items-center justify-center gap-2 mt-auto">
                  <Plus className="w-3 h-3" />
                  Adicionar Lead
                </button>
              </div>
            </div>
          );
        })}
      </KanbanScrollContainer>

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
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Valor estimado</label>
                    <input type="number" value={formData.estimated_value} onChange={e => setFormData(p => ({ ...p, estimated_value: e.target.value }))} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-200 font-medium text-sm" placeholder="0.00" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Etapa do Funil</label>
                  <select value={formData.stage_id} onChange={e => setFormData(p => ({ ...p, stage_id: e.target.value }))} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-200 font-medium text-sm">
                    {stages.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                {stages.find(s => s.id === formData.stage_id)?.name === 'Perdido' && (
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
                    <p className="text-slate-500 text-xs">Valor estimado: R$ {Number(selectedLead.estimated_value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
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
                        stage.is_fixed ? "bg-slate-50 border-slate-200 opacity-80" : "bg-white border-slate-200 hover:border-teal-300 hover:shadow-sm"
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <div className={cn("w-3 h-3 rounded-full", stageColors[stage.color] || 'bg-slate-500')} />
                        <div>
                          <p className="text-sm font-bold text-slate-700">{stage.name}</p>
                          {stage.is_fixed && <span className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter">Posicao Fixa</span>}
                        </div>
                      </div>

                      <div className="flex items-center gap-1">
                        {!stage.is_fixed ? (
                          <>
                            <button 
                              disabled={idx <= 1} // Can't move above Fixed stages index
                              onClick={() => {
                                const newStages = [...localStages];
                                [newStages[idx], newStages[idx-1]] = [newStages[idx-1], newStages[idx]];
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
                                [newStages[idx], newStages[idx+1]] = [newStages[idx+1], newStages[idx]];
                                setLocalStages(newStages);
                              }}
                              className="p-1.5 text-slate-400 hover:text-teal-600 hover:bg-teal-50 rounded-md disabled:opacity-30"
                            >
                              <ChevronDown className="w-4 h-4" />
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
                        ) : (
                          <GripVertical className="w-4 h-4 text-slate-300" />
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



      {/* Lead Chat Drawer */}
      <AnimatePresence>
        {chatLead && (
          <LeadChat lead={chatLead} onClose={() => setChatLead(null)} />
        )}
      </AnimatePresence>
    </div>
  );
}
