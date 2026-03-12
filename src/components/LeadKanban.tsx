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
} from "lucide-react";
import { cn } from "@/src/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { useFunnelStages, useLeads } from "../hooks/useSupabase";
import { format, parseISO, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { LeadChat } from "./LeadChat";

export function LeadKanban() {
  const { data: stages, loading: stagesLoading, reorder: reorderStages, update: updateStage, create: createStage, remove: removeStage } = useFunnelStages();
  const { data: leads, loading: leadsLoading, create, update, remove } = useLeads();
  const [showModal, setShowModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [selectedLead, setSelectedLead] = useState<any>(null);
  const [formData, setFormData] = useState({ name: '', phone: '', source: 'manual', stage_id: '', estimated_value: '' });
  const [submitting, setSubmitting] = useState(false);
  const [chatLead, setChatLead] = useState<any>(null);
  const [localStages, setLocalStages] = useState<any[]>([]);
  const [isAddingStage, setIsAddingStage] = useState(false);
  const [newStageName, setNewStageName] = useState("");

  const handleSubmit = async () => {
    if (!formData.name.trim()) return;
    setSubmitting(true);
    
    const payload = {
      name: formData.name,
      phone: formData.phone || null,
      source: formData.source as any,
      stage_id: formData.stage_id || (stages[0]?.id ?? null),
      estimated_value: formData.estimated_value ? Number(formData.estimated_value) : 0,
    };

    if (selectedLead) {
      await update(selectedLead.id, payload);
    } else {
      await create(payload);
    }

    setFormData({ name: '', phone: '', source: 'manual', stage_id: '', estimated_value: '' });
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
      estimated_value: lead.estimated_value?.toString() || ''
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
          <Button variant="outline" size="icon" className="h-10 w-10 text-slate-400 hover:text-teal-600" onClick={() => { setLocalStages([...stages]); setShowSettingsModal(true); }}>
            <Settings className="w-5 h-5" />
          </Button>
          <Button className="py-5 px-6 group" onClick={() => { setSelectedLead(null); setFormData({ name: '', phone: '', source: 'manual', stage_id: stages[0]?.id || '', estimated_value: '' }); setShowModal(true); }}>
            <Plus className="w-5 h-5 mr-2 group-hover:rotate-90 transition-transform" />
            Novo Lead
          </Button>
        </div>
      </div>

      <div className="flex gap-4 overflow-x-auto pb-4 h-full custom-scrollbar min-h-[600px]">
        {stages.map((stage) => {
          const stageLeads = leads.filter(l => l.stage_id === stage.id);
          return (
            <div key={stage.id} className="w-[300px] shrink-0 flex flex-col gap-4">
              <div className="flex items-center justify-between px-2">
                <div className="flex items-center gap-2">
                  <div className={cn("w-2 h-2 rounded-full", stageColors[stage.color || 'bg-slate-500'] || 'bg-slate-500')} />
                  <h3 className="font-bold text-slate-700 text-sm uppercase tracking-wider">{stage.name}</h3>
                  <span className="bg-slate-200 text-slate-600 text-[10px] font-bold px-1.5 py-0.5 rounded-md">{stageLeads.length}</span>
                </div>
                <button className="text-slate-400 hover:text-slate-600" onClick={() => { setFormData(p => ({ ...p, stage_id: stage.id })); setShowModal(true); }}>
                  <Plus className="w-4 h-4" />
                </button>
              </div>

              <div className="flex-1 bg-slate-100/50 rounded-xl p-3 flex flex-col gap-3 min-h-[400px]">
                {stageLeads.map((lead) => (
                  <motion.div key={lead.id} whileHover={{ y: -2 }} className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm cursor-grab active:cursor-grabbing hover:shadow-md transition-all group">
                    <div className="flex justify-between items-start mb-3">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{lead.source || 'Manual'}</span>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => openEditModal(lead)} className="p-1 text-slate-400 hover:text-teal-600 rounded-md transition-colors"><Edit2 className="w-3.5 h-3.5" /></button>
                        <button onClick={() => openDeleteConfirm(lead)} className="p-1 text-slate-400 hover:text-rose-600 rounded-md transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    </div>
                    <h4 className="font-bold text-slate-900 text-sm mb-1">{lead.name}</h4>
                    {lead.phone && (
                      <p className="text-[10px] font-medium text-slate-400 mb-2">{lead.phone}</p>
                    )}
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2 text-slate-500">
                        <MessageSquare className="w-3 h-3" />
                        <span className="text-[10px] font-medium">Lead ativo</span>
                      </div>
                      <button 
                        onClick={() => setChatLead(lead)}
                        className="flex items-center gap-1.5 px-2 py-1 bg-teal-50 text-teal-700 rounded-md text-[10px] font-bold border border-teal-100 hover:bg-teal-100 transition-colors"
                      >
                        <MessageSquare className="w-3 h-3" />
                        Chat
                      </button>
                    </div>
                    <div className="flex items-center justify-between pt-3 border-t border-slate-50">
                      <div className="bg-teal-50 text-teal-700 text-[10px] font-bold px-2 py-0.5 rounded border border-teal-100">
                        R$ {Number(lead.estimated_value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </div>
                      <span className="text-[10px] font-medium text-slate-400">
                        {formatDistanceToNow(parseISO(lead.created_at), { addSuffix: true, locale: ptBR })}
                      </span>
                    </div>
                  </motion.div>
                ))}

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

      {/* Lead Chat Drawer */}
      <AnimatePresence>
        {chatLead && (
          <LeadChat lead={chatLead} onClose={() => setChatLead(null)} />
        )}
      </AnimatePresence>
    </div>
  );
}
