import React, { useState } from "react";
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
} from "lucide-react";
import { cn } from "@/src/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { useFunnelStages, useLeads, useSettings } from "../hooks/useSupabase";

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

export function LeadKanban() {
  const { data: stages, loading: stagesLoading, reorder: reorderStages, update: updateStage, create: createStage, remove: removeStage } = useFunnelStages();
  const { data: leads, loading: leadsLoading, create, update, remove } = useLeads();
  const { aiConfig, updateAI } = useSettings();
  const [showModal, setShowModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [selectedLead, setSelectedLead] = useState<any>(null);
  const [formData, setFormData] = useState({ name: '', phone: '', source: 'manual', stage_id: '', estimated_value: '', loss_reason: '' });
  const [submitting, setSubmitting] = useState(false);
  const [chatLead, setChatLead] = useState<any>(null);
  const [localStages, setLocalStages] = useState<any[]>([]);
  const [isAddingStage, setIsAddingStage] = useState(false);
  const [newStageName, setNewStageName] = useState("");
  const [showAutomationModal, setShowAutomationModal] = useState(false);
  const [localRules, setLocalRules] = useState<any[]>([]);
  const [isAddingRule, setIsAddingRule] = useState(false);
  const [newRule, setNewRule] = useState({ keywords: '', target_stage_id: '' });

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
      source: formData.source as any,
      stage_id: formData.stage_id || (stages[0]?.id ?? null),
      estimated_value: formData.estimated_value ? Number(formData.estimated_value) : 0,
      loss_reason: isPerdido ? (formData.loss_reason || null) : null,
    };

    if (selectedLead) {
      await update(selectedLead.id, payload);
    } else {
      await create(payload);
    }

    setFormData({ name: '', phone: '', source: 'manual', stage_id: '', estimated_value: '', loss_reason: '' });
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
      source: lead.source || 'manual',
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
          <Button variant="outline" size="icon" className="h-10 w-10 text-slate-400 hover:text-teal-600" onClick={() => { setLocalRules(aiConfig?.transition_rules || []); setShowAutomationModal(true); }}>
            <Zap className="w-5 h-5" />
          </Button>
          <Button variant="outline" size="icon" className="h-10 w-10 text-slate-400 hover:text-teal-600" onClick={() => { setLocalStages([...stages]); setShowSettingsModal(true); }}>
            <Settings className="w-5 h-5" />
          </Button>
          <Button className="py-5 px-6 group" onClick={() => { setSelectedLead(null); setFormData({ name: '', phone: '', source: 'manual', stage_id: stages[0]?.id || '', estimated_value: String(aiConfig?.default_ticket_value ?? ''), loss_reason: '' }); setShowModal(true); }}>
            <Plus className="w-5 h-5 mr-2 group-hover:rotate-90 transition-transform" />
            Novo Lead
          </Button>
        </div>
      </div>

      <div className="flex gap-4 overflow-x-auto pb-4 h-full custom-scrollbar min-h-[600px]">
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
                <button className="text-slate-400 hover:text-slate-600 shrink-0" onClick={() => { setSelectedLead(null); setFormData({ name: '', phone: '', source: 'manual', stage_id: stage.id, estimated_value: String(aiConfig?.default_ticket_value ?? ''), loss_reason: '' }); setShowModal(true); }}>
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
                    // Só conta se o lead mandou msg depois da última resposta (ciclo aberto)
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
                      "bg-white px-3 py-2.5 rounded-lg border shadow-sm cursor-grab active:cursor-grabbing hover:shadow-md transition-all group",
                      draggedLead?.id === lead.id && "opacity-50",
                      isPerdido ? "border-rose-200" : "border-slate-200"
                    )}
                  >
                    {/* Header: fonte + ações */}
                    <div className="flex justify-between items-center mb-1.5">
                      <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{lead.source || 'Manual'}</span>
                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => openEditModal(lead)} className="p-0.5 text-slate-400 hover:text-teal-600 rounded transition-colors"><Edit2 className="w-3 h-3" /></button>
                        <button onClick={() => openDeleteConfirm(lead)} className="p-0.5 text-slate-400 hover:text-rose-600 rounded transition-colors"><Trash2 className="w-3 h-3" /></button>
                      </div>
                    </div>

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
                        {semMotivo ? "Motivo da perda não preenchido" : lead.loss_reason}
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
                            {slaBreach}× SLA
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
                  <input type="text" value={formData.phone} onChange={e => setFormData(p => ({ ...p, phone: e.target.value }))} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-200 font-medium text-sm" placeholder="(11) 99999-9999" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Origem</label>
                    <select value={formData.source} onChange={e => setFormData(p => ({ ...p, source: e.target.value }))} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-200 font-medium text-sm">
                      <option value="manual">Manual</option>
                      <option value="whatsapp">WhatsApp</option>
                      <option value="facebook_ads">Facebook Ads</option>
                      <option value="google">Google</option>
                      <option value="instagram">Instagram</option>
                      <option value="indicacao">Indicação</option>
                      <option value="site">Site</option>
                    </select>
                  </div>
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
                      <option value="Preço alto">Preço alto</option>
                      <option value="Escolheu concorrente">Escolheu concorrente</option>
                      <option value="Não respondeu">Não respondeu</option>
                      <option value="Sem interesse">Sem interesse</option>
                      <option value="Fora do perfil">Fora do perfil</option>
                      <option value="Agendou e não compareceu">Agendou e não compareceu</option>
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
                <p className="text-slate-500">Tem certeza que deseja excluir este lead? Esta ação não pode ser desfeita.</p>
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
                          {stage.is_fixed && <span className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter">Posição Fixa</span>}
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

      {/* Automation Rules Modal */}
      <AnimatePresence>
        {showAutomationModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4" onClick={() => setShowAutomationModal(false)}>
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between p-6 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <div className="p-2 bg-teal-50 rounded-lg">
                    <Zap className="w-5 h-5 text-teal-600" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-slate-900">Automação de Etapas</h3>
                    <p className="text-xs text-slate-500">Mude o lead de etapa automaticamente por palavras-chave.</p>
                  </div>
                </div>
                <button onClick={() => setShowAutomationModal(false)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
              </div>

              <div className="p-6 max-h-[400px] overflow-y-auto space-y-4 custom-scrollbar">
                <div className="space-y-3">
                  {localRules.map((rule, idx) => (
                    <div key={idx} className="p-4 bg-slate-50 rounded-xl border border-slate-200 relative group">
                      <button 
                        onClick={() => setLocalRules(p => p.filter((_, i) => i !== idx))}
                        className="absolute top-2 right-2 p-1 text-slate-400 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                      <div className="space-y-2">
                        <div>
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Palavras-chave</p>
                          <p className="text-sm font-medium text-slate-700">{rule.keywords}</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Mover para</p>
                          <div className="flex items-center gap-2">
                            <div className={cn("w-2 h-2 rounded-full", stages.find(s => s.id === rule.target_stage_id)?.color || 'bg-slate-400')} />
                            <p className="text-sm font-bold text-slate-900">
                              {stages.find(s => s.id === rule.target_stage_id)?.name || 'Etapa não encontrada'}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}

                  {isAddingRule ? (
                    <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="p-4 bg-teal-50/50 rounded-xl border border-teal-100 space-y-4">
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Palavras-chave (separadas por vírgula)</label>
                        <input 
                          autoFocus
                          type="text" 
                          value={newRule.keywords} 
                          onChange={e => setNewRule(p => ({ ...p, keywords: e.target.value }))}
                          placeholder="Ex: agendar, consulta, marcar"
                          className="w-full px-3 py-2 text-sm bg-white border border-teal-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-200 font-medium"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Etapa Destino</label>
                        <select 
                          value={newRule.target_stage_id}
                          onChange={e => setNewRule(p => ({ ...p, target_stage_id: e.target.value }))}
                          className="w-full px-3 py-2 text-sm bg-white border border-teal-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-200 font-medium"
                        >
                          <option value="">Selecione uma etapa...</option>
                          {stages.map(s => (
                            <option key={s.id} value={s.id}>{s.name}</option>
                          ))}
                        </select>
                      </div>
                      <div className="flex gap-2">
                        <Button 
                          size="sm" 
                          className="flex-1 bg-teal-600 hover:bg-teal-700"
                          disabled={!newRule.keywords.trim() || !newRule.target_stage_id}
                          onClick={() => {
                            setLocalRules(p => [...p, newRule]);
                            setNewRule({ keywords: '', target_stage_id: '' });
                            setIsAddingRule(false);
                          }}
                        >
                          Confirmar
                        </Button>
                        <Button size="sm" variant="ghost" className="flex-1" onClick={() => setIsAddingRule(false)}>Cancelar</Button>
                      </div>
                    </motion.div>
                  ) : (
                    <button 
                      onClick={() => setIsAddingRule(true)}
                      className="w-full py-3 border border-dashed border-slate-300 rounded-xl text-slate-400 text-sm font-bold hover:bg-slate-50 hover:border-slate-400 transition-all flex items-center justify-center gap-2"
                    >
                      <Plus className="w-4 h-4" />
                      Nova Regra
                    </button>
                  )}
                </div>
              </div>

              <div className="flex gap-3 p-6 border-t border-slate-100 bg-slate-50">
                <Button variant="outline" className="flex-1" onClick={() => setShowAutomationModal(false)}>Fechar</Button>
                <Button className="flex-1 bg-teal-600 hover:bg-teal-700" onClick={async () => {
                  setSubmitting(true);
                  await updateAI({ transition_rules: localRules });
                  setSubmitting(false);
                  setShowAutomationModal(false);
                }} disabled={submitting}>
                  {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  Salvar Automações
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
