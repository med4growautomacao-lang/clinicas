import React, { useState } from "react";
import { X, Save, Clock, CalendarDays, Plus, Trash2, Loader2, AlertCircle, SlidersHorizontal, Tag, Video, MapPin } from "lucide-react";
import { Button } from "./ui/button";
import { motion } from "framer-motion";
import { Doctor, ConsultationType, useConsultationTypes } from "../hooks/useSupabase";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import { cn } from "@/src/lib/utils";

interface DoctorScheduleSettingsProps {
  doctor: Doctor;
  onClose: () => void;
  onSaved?: () => void;
}

type BlockedTime = { date: string; start: string; end: string; name?: string };

const WEEKDAYS = [
  { id: '0', label: 'Domingo' },
  { id: '1', label: 'Segunda-feira' },
  { id: '2', label: 'Terça-feira' },
  { id: '3', label: 'Quarta-feira' },
  { id: '4', label: 'Quinta-feira' },
  { id: '5', label: 'Sexta-feira' },
  { id: '6', label: 'Sábado' },
];

type Nature = NonNullable<ConsultationType['nature']>;

// A natureza do modelo. Antes disso, a distinção vivia no TÍTULO ("Primeira Online",
// "Seguimento Online") — e título é texto livre: metade das clínicas nomeia os modelos só pela
// modalidade ("Presencial"), e nelas a natureza era indeterminável. Agora é campo.
//
// 'retorno' NÃO é sinônimo de 'seguimento': retorno é a cortesia gratuita com prazo, seguimento é
// consulta nova paga de quem já se consultou.
const NATURE_OPTIONS: { value: Nature; label: string; labelOutro: string; hint: string }[] = [
  { value: 'primeira',   label: 'Primeira consulta', labelOutro: 'Primeiro atendimento',
    hint: 'Quem nunca foi atendido aqui.' },
  { value: 'retorno',    label: 'Retorno (cortesia)', labelOutro: 'Retorno (cortesia)',
    hint: 'Gratuito, dentro de um prazo após a consulta anterior.' },
  { value: 'seguimento', label: 'Seguimento', labelOutro: 'Novo atendimento',
    hint: 'Consulta nova paga de quem já se consultou.' },
];

// ~40% dos tenants não são clínica (category = 'outro'): ali "paciente" é cliente e "consulta" é
// atendimento. Sidebar e Comercial já viram os rótulos pela categoria; aqui segue o mesmo padrão.
function useModelLabels() {
  const { activeClinicCategory } = useAuth();
  const isOutro = activeClinicCategory === 'outro';
  return {
    isOutro,
    plural: isOutro ? 'Modelos de Atendimento' : 'Modelos de Consultas',
    novo: isOutro ? 'Novo Modelo' : 'Novo Modelo',
    vazio: isOutro ? 'Nenhum modelo de atendimento cadastrado.' : 'Nenhum modelo de consulta cadastrado.',
    natureLabel: (n: Nature) => {
      const o = NATURE_OPTIONS.find(x => x.value === n);
      return o ? (isOutro ? o.labelOutro : o.label) : n;
    },
  };
}

export function DoctorScheduleSettings({ doctor, onClose, onSaved }: DoctorScheduleSettingsProps) {
  const [activeTab, setActiveTab] = useState<'availability' | 'limits' | 'days' | 'blocked_times'>('availability');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const labels = useModelLabels();

  const defaultHours = {
    "0": [],
    "1": [{ start: "08:00", end: "12:00" }, { start: "14:00", end: "18:00" }],
    "2": [{ start: "08:00", end: "12:00" }, { start: "14:00", end: "18:00" }],
    "3": [{ start: "08:00", end: "12:00" }, { start: "14:00", end: "18:00" }],
    "4": [{ start: "08:00", end: "12:00" }, { start: "14:00", end: "18:00" }],
    "5": [{ start: "08:00", end: "12:00" }, { start: "14:00", end: "18:00" }],
    "6": []
  };

  const [workingHours, setWorkingHours] = useState<Record<string, { start: string, end: string }[]>>(
    (doctor.working_hours && Object.keys(doctor.working_hours).length > 0)
      ? doctor.working_hours
      : defaultHours
  );

  const { data: consultationTypes, refetch: refetchTypes, create: createType, update: updateType, remove: removeType } = useConsultationTypes(doctor.id);
  const [editingType, setEditingType] = useState<ConsultationType | 'new' | null>(null);
  const [daysOff, setDaysOff] = useState<string[]>(doctor.days_off || []);
  const [newDayOff, setNewDayOff] = useState('');

  const [blockedTimes, setBlockedTimes] = useState<BlockedTime[]>(doctor.blocked_times || []);
  const [newBlockedTime, setNewBlockedTime] = useState<BlockedTime>({ date: '', start: '08:00', end: '09:00' });

  const handleAddShift = (dayId: string) => {
    setWorkingHours(prev => ({
      ...prev,
      [dayId]: [...(prev[dayId] || []), { start: "08:00", end: "12:00" }]
    }));
  };

  const handleRemoveShift = (dayId: string, index: number) => {
    setWorkingHours(prev => ({
      ...prev,
      [dayId]: prev[dayId].filter((_, i) => i !== index)
    }));
  };

  const handleUpdateShift = (dayId: string, index: number, field: 'start' | 'end', value: string) => {
    setWorkingHours(prev => {
      const newShifts = [...prev[dayId]];
      newShifts[index] = { ...newShifts[index], [field]: value };
      return { ...prev, [dayId]: newShifts };
    });
  };

  const handleAddDayOff = () => {
    if (newDayOff && !daysOff.includes(newDayOff)) {
      setDaysOff(prev => [...prev, newDayOff].sort());
      setNewDayOff('');
    }
  };

  const handleAddBlockedTime = () => {
    const { date, start, end, name } = newBlockedTime;
    if (!date || !start || !end || !name) return;
    setBlockedTimes(prev =>
      [...prev, { date, start, end, ...(name ? { name } : {}) }].sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start))
    );
    setNewBlockedTime({ date: '', start: '08:00', end: '09:00', name: '' });
  };

  const handleRemoveBlockedTime = (index: number) => {
    setBlockedTimes(prev => prev.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const { error: dbError } = await supabase
        .from('doctors')
        .update({
          working_hours: workingHours,
          days_off: daysOff,
          blocked_times: blockedTimes,
        })
        .eq('id', doctor.id);
      if (dbError) setError(dbError.message);
      else { onSaved?.(); onClose(); }
    } catch (err: any) {
      setError(err?.message || "Erro desconhecido");
    } finally {
      setSubmitting(false);
    }
  };

  const formatDate = (iso: string) => {
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="bg-white rounded-xl shadow-xl w-full max-w-2xl h-[90vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-100 bg-slate-50/50">
          <div>
            <h3 className="text-xl font-bold text-slate-900">Configurar Agenda</h3>
            <p className="text-sm font-medium text-slate-500 mt-1">Dr(a). {doctor.name}</p>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex bg-white border-b border-slate-100 px-6 pt-4 gap-6">
          <button
            onClick={() => setActiveTab('availability')}
            className={cn(
              "pb-4 font-semibold text-sm border-b-2 transition-colors flex items-center gap-2",
              activeTab === 'availability' ? "border-teal-600 text-teal-800" : "border-transparent text-slate-500 hover:text-slate-700"
            )}
          >
            <Clock className="w-4 h-4" /> Disponibilidade
          </button>
          <button
            onClick={() => setActiveTab('limits')}
            className={cn(
              "pb-4 font-semibold text-sm border-b-2 transition-colors flex items-center gap-2",
              activeTab === 'limits' ? "border-teal-600 text-teal-800" : "border-transparent text-slate-500 hover:text-slate-700"
            )}
          >
            <SlidersHorizontal className="w-4 h-4" /> {labels.plural}
          </button>
          <button
            onClick={() => setActiveTab('days')}
            className={cn(
              "pb-4 font-semibold text-sm border-b-2 transition-colors flex items-center gap-2",
              activeTab === 'days' ? "border-teal-600 text-teal-800" : "border-transparent text-slate-500 hover:text-slate-700"
            )}
          >
            <CalendarDays className="w-4 h-4" /> Bloquear Dias
          </button>
          <button
            onClick={() => setActiveTab('blocked_times')}
            className={cn(
              "pb-4 font-semibold text-sm border-b-2 transition-colors flex items-center gap-2",
              activeTab === 'blocked_times' ? "border-teal-600 text-teal-800" : "border-transparent text-slate-500 hover:text-slate-700"
            )}
          >
            <Clock className="w-4 h-4" /> Bloquear Horários
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto custom-scrollbar flex-1 bg-slate-50">
          {error && (
            <div className="mb-6 p-4 bg-rose-50 text-rose-700 rounded-lg flex items-center gap-3 border border-rose-100">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <span className="text-sm font-medium">{error}</span>
            </div>
          )}

          {/* ── Disponibilidade (turnos semanais) ── */}
          {activeTab === 'availability' && (
            <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}>
              <div className="space-y-4">
                <h4 className="font-bold text-slate-800 text-sm pl-1 uppercase tracking-wider">Turnos Semanais</h4>
                {WEEKDAYS.map(day => {
                  const shifts = workingHours[day.id] || [];
                  const isActive = shifts.length > 0;
                  return (
                    <div key={day.id} className="p-4 bg-white rounded-xl border border-slate-200 shadow-sm transition-all hover:border-slate-300">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <label className="relative inline-flex items-center cursor-pointer">
                            <input
                              type="checkbox"
                              className="sr-only peer"
                              checked={isActive}
                              onChange={(e) => {
                                if (e.target.checked) handleAddShift(day.id);
                                else setWorkingHours(prev => ({ ...prev, [day.id]: [] }));
                              }}
                            />
                            <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-teal-500"></div>
                          </label>
                          <span className={cn("font-bold text-sm", isActive ? "text-slate-900" : "text-slate-400")}>{day.label}</span>
                        </div>
                        {isActive && (
                          <button
                            onClick={() => handleAddShift(day.id)}
                            className="text-xs font-bold text-teal-600 bg-teal-50 px-3 py-1.5 rounded-md hover:bg-teal-100 transition-colors flex items-center gap-1.5"
                          >
                            <Plus className="w-3.5 h-3.5" /> Adicionar Turno
                          </button>
                        )}
                      </div>
                      {isActive && shifts.length > 0 && (
                        <div className="space-y-3 mt-3 pl-14">
                          {shifts.map((shift, idx) => (
                            <div key={idx} className="flex items-center gap-3">
                              <input
                                type="time"
                                value={shift.start}
                                onChange={(e) => handleUpdateShift(day.id, idx, 'start', e.target.value)}
                                className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium focus:ring-2 focus:ring-teal-200 focus:outline-none"
                              />
                              <span className="text-slate-400 font-medium text-xs">até</span>
                              <input
                                type="time"
                                value={shift.end}
                                onChange={(e) => handleUpdateShift(day.id, idx, 'end', e.target.value)}
                                className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium focus:ring-2 focus:ring-teal-200 focus:outline-none"
                              />
                              <button
                                onClick={() => handleRemoveShift(day.id, idx)}
                                className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors ml-2"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </motion.div>
          )}

          {/* ── Modelos de Consultas: galeria de modelos ── */}
          {activeTab === 'limits' && (
            <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}>
              <div className="flex items-center justify-between mb-4">
                <h4 className="font-bold text-slate-800 text-sm uppercase tracking-wider">{labels.plural}</h4>
                <button
                  onClick={() => setEditingType('new')}
                  className="text-xs font-bold text-teal-600 bg-teal-50 px-3 py-1.5 rounded-md hover:bg-teal-100 transition-colors flex items-center gap-1.5"
                >
                  <Plus className="w-3.5 h-3.5" /> {labels.novo}
                </button>
              </div>
              {consultationTypes.length === 0 ? (
                <div className="text-center py-12 bg-white border border-dashed border-slate-200 rounded-xl">
                  <Tag className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                  <p className="text-sm font-medium text-slate-400">{labels.vazio}</p>
                  <p className="text-xs text-slate-400 mt-1">Clique em "{labels.novo}" para criar.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {consultationTypes.map(ct => (
                    <div
                      key={ct.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setEditingType(ct)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setEditingType(ct); } }}
                      className={cn(
                        "text-left p-4 rounded-xl border bg-white hover:border-teal-300 hover:shadow-sm transition-all cursor-pointer",
                        ct.is_active ? "border-slate-200" : "border-slate-200 opacity-60"
                      )}
                    >
                      <div className="flex items-center justify-between mb-2 gap-2">
                        <span className="font-bold text-slate-800 text-sm truncate">{ct.name}</span>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className={cn(
                            "text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full flex items-center gap-1",
                            ct.modality === 'online' ? "bg-sky-100 text-sky-700" : "bg-emerald-100 text-emerald-700"
                          )}>
                            {ct.modality === 'online' ? <Video className="w-2.5 h-2.5" /> : <MapPin className="w-2.5 h-2.5" />}
                            {ct.modality}
                          </span>
                          <label
                            className="relative inline-flex items-center cursor-pointer"
                            onClick={(e) => e.stopPropagation()}
                            title={ct.is_active ? 'Ativo — clique para desativar' : 'Inativo — clique para ativar'}
                          >
                            <input
                              type="checkbox"
                              className="sr-only peer"
                              checked={ct.is_active}
                              onChange={(e) => { e.stopPropagation(); updateType(ct.id, { is_active: e.target.checked }); }}
                            />
                            <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-teal-500"></div>
                          </label>
                        </div>
                      </div>
                      <ul className="text-xs text-slate-500 font-medium space-y-1 list-disc list-inside marker:text-slate-300">
                        <li>
                          <span className="font-semibold text-slate-600">Natureza:</span>{' '}
                          {ct.nature ? (
                            <>
                              {labels.natureLabel(ct.nature)}
                              {ct.nature === 'retorno' && ct.return_window_days != null && ` (até ${ct.return_window_days} dias)`}
                            </>
                          ) : (
                            /* Sem natureza, a IA volta a adivinhar pela descrição. Sinalizado em âmbar
                               porque é ação pendente da clínica, não um estado normal. */
                            <span className="text-amber-600 font-semibold">não classificada</span>
                          )}
                        </li>
                        <li><span className="font-semibold text-slate-600">Duração:</span> {ct.consultation_duration} min</li>
                        {ct.slot_step != null && ct.slot_step !== ct.consultation_duration && (
                          <li><span className="font-semibold text-slate-600">Vagas:</span> a cada {ct.slot_step} min</li>
                        )}
                        {ct.buffer_before_minutes > 0 && (
                          <li><span className="font-semibold text-slate-600">Buffer antes:</span> {ct.buffer_before_minutes} min</li>
                        )}
                        {ct.buffer_after_minutes > 0 && (
                          <li><span className="font-semibold text-slate-600">Buffer depois:</span> {ct.buffer_after_minutes} min</li>
                        )}
                        {ct.min_notice_minutes > 0 && (
                          <li><span className="font-semibold text-slate-600">Aviso mínimo:</span> {ct.min_notice_minutes >= 1440 ? Math.floor(ct.min_notice_minutes / 1440) + ' dia(s)' : ct.min_notice_minutes >= 60 ? Math.floor(ct.min_notice_minutes / 60) + ' h' : ct.min_notice_minutes + ' min'}</li>
                        )}
                      </ul>
                      {ct.working_hours_override != null && (
                        <div className="flex items-center gap-1.5 mt-2">
                          <span className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 flex items-center gap-1">
                            <Clock className="w-2.5 h-2.5" /> Horários próprios
                          </span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          )}

          {/* ── Bloquear Dias ── */}
          {activeTab === 'days' && (
            <motion.div initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} className="space-y-4">
              <div className="p-5 bg-white rounded-xl border border-slate-200 shadow-sm">
                <h4 className="font-bold text-slate-800 text-sm mb-4">Bloquear dia inteiro</h4>
                <div className="flex items-end gap-4">
                  <div className="flex-1">
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Data da Ausência</label>
                    <input
                      type="date"
                      value={newDayOff}
                      onChange={e => setNewDayOff(e.target.value)}
                      className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium focus:ring-2 focus:ring-teal-200 focus:outline-none"
                    />
                  </div>
                  <Button onClick={handleAddDayOff} disabled={!newDayOff} className="flex shrink-0 h-[42px]">
                    <Plus className="w-4 h-4 mr-2" /> Bloquear Dia
                  </Button>
                </div>
              </div>

              <h5 className="font-bold text-slate-700 text-xs mb-3 uppercase tracking-wider pl-1">Dias Bloqueados na Agenda</h5>
              {daysOff.length === 0 ? (
                <div className="text-center py-8 bg-white border border-dashed border-slate-200 rounded-xl">
                  <CalendarDays className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                  <p className="text-sm font-semibold text-slate-400">Nenhum dia bloqueado.</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {daysOff.map(date => (
                    <div key={date} className="flex items-center justify-between p-3 bg-white border border-rose-100 rounded-lg shadow-sm">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-rose-400 shrink-0" />
                        <span className="font-bold text-sm text-slate-700">{formatDate(date)}</span>
                      </div>
                      <button onClick={() => setDaysOff(prev => prev.filter(d => d !== date))} className="text-slate-300 hover:text-rose-500 transition-colors">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          )}

          {/* ── Bloquear Horários ── */}
          {activeTab === 'blocked_times' && (
            <motion.div initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} className="space-y-4">
              <div className="p-5 bg-white rounded-xl border border-slate-200 shadow-sm">
                <h4 className="font-bold text-slate-800 text-sm mb-4">Bloquear horário específico</h4>
                <div className="grid grid-cols-[1fr_auto_auto] gap-3 items-end mb-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Data</label>
                    <input
                      type="date"
                      value={newBlockedTime.date}
                      onChange={e => setNewBlockedTime(p => ({ ...p, date: e.target.value }))}
                      className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium focus:ring-2 focus:ring-teal-200 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Das</label>
                    <input
                      type="time"
                      value={newBlockedTime.start}
                      onChange={e => setNewBlockedTime(p => ({ ...p, start: e.target.value }))}
                      className="px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium focus:ring-2 focus:ring-teal-200 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Às</label>
                    <input
                      type="time"
                      value={newBlockedTime.end}
                      onChange={e => setNewBlockedTime(p => ({ ...p, end: e.target.value }))}
                      className="px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium focus:ring-2 focus:ring-teal-200 focus:outline-none"
                    />
                  </div>
                </div>
                <div className="flex gap-3 items-end">
                  <div className="flex-1">
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Nome / Motivo *</label>
                    <input
                      type="text"
                      placeholder="Ex: Almoço, Reunião, Procedimento..."
                      value={newBlockedTime.name || ''}
                      onChange={e => setNewBlockedTime(p => ({ ...p, name: e.target.value }))}
                      className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium focus:ring-2 focus:ring-teal-200 focus:outline-none"
                    />
                  </div>
                  <Button
                    onClick={handleAddBlockedTime}
                    disabled={!newBlockedTime.date || !newBlockedTime.start || !newBlockedTime.end || !newBlockedTime.name}
                    className="h-[42px] shrink-0"
                  >
                    <Plus className="w-4 h-4 mr-2" /> Bloquear
                  </Button>
                </div>
              </div>

              <h5 className="font-bold text-slate-700 text-xs mb-3 uppercase tracking-wider pl-1">Horários Bloqueados</h5>
              {blockedTimes.length === 0 ? (
                <div className="text-center py-8 bg-white border border-dashed border-slate-200 rounded-xl">
                  <Clock className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                  <p className="text-sm font-semibold text-slate-400">Nenhum horário bloqueado.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {blockedTimes.map((bt, i) => (
                    <div key={i} className="flex items-center justify-between px-4 py-3 bg-white border border-amber-100 rounded-lg shadow-sm">
                      <div className="flex items-center gap-3">
                        <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
                        <span className="font-bold text-sm text-slate-700">{formatDate(bt.date)}</span>
                        <span className="text-xs text-slate-400">—</span>
                        <span className="text-sm font-semibold text-slate-600">{bt.start} às {bt.end}</span>
                        {bt.name && <span className="text-xs text-amber-600 font-semibold bg-amber-50 px-2 py-0.5 rounded-full">{bt.name}</span>}
                      </div>
                      <button onClick={() => handleRemoveBlockedTime(i)} className="text-slate-300 hover:text-rose-500 transition-colors">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 bg-white border-t border-slate-100 flex items-center justify-end gap-3 z-10 shadow-[0_-10px_30px_rgba(0,0,0,0.02)]">
          <Button variant="outline" onClick={onClose} className="font-bold">
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={submitting} className="font-bold text-white shadow-md">
            {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
            Salvar Configurações
          </Button>
        </div>
      </motion.div>

      {editingType && (
        <ConsultationTypeEditor
          doctorId={doctor.id}
          clinicId={doctor.clinic_id}
          existing={editingType === 'new' ? null : editingType}
          hasFutureAppointments={false /* checked async dentro do modal antes de excluir */}
          doctorWorkingHours={workingHours}
          onClose={() => setEditingType(null)}
          onSaved={async (input) => {
            if (editingType === 'new') {
              await createType(input as any);
            } else {
              await updateType(editingType.id, input);
            }
            setEditingType(null);
            refetchTypes();
          }}
          onDeleted={async () => {
            if (editingType !== 'new' && editingType) {
              await removeType(editingType.id);
            }
            setEditingType(null);
            refetchTypes();
          }}
        />
      )}
    </motion.div>
  );
}

// ─── Sub-modal: editor de tipo de consulta ───────────────────────────────────
type CTEditorProps = {
  doctorId: string;
  clinicId: string;
  existing: ConsultationType | null;
  hasFutureAppointments: boolean;
  doctorWorkingHours: Record<string, { start: string; end: string }[]>;
  onClose: () => void;
  onSaved: (input: Omit<ConsultationType, 'id' | 'created_at'>) => Promise<void> | void;
  onDeleted: () => Promise<void> | void;
};

function slugify(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function ConsultationTypeEditor({ doctorId, clinicId, existing, doctorWorkingHours, onClose, onSaved, onDeleted }: CTEditorProps) {
  const [name, setName] = useState(existing?.name ?? '');
  const [slug, setSlug] = useState(existing?.slug ?? '');
  const [slugTouched, setSlugTouched] = useState(!!existing);
  const [modality, setModality] = useState<'presencial' | 'online'>(existing?.modality ?? 'presencial');
  const [nature, setNature] = useState<Nature | null>(existing?.nature ?? null);
  const [returnWindowDays, setReturnWindowDays] = useState<number | null>(existing?.return_window_days ?? null);
  const [description, setDescription] = useState<string>(existing?.description ?? '');
  const [duration, setDuration] = useState<number>(existing?.consultation_duration ?? 30);
  const [slotStep, setSlotStep] = useState<number | null>(existing?.slot_step ?? null);
  const [bufferBefore, setBufferBefore] = useState<number>(existing?.buffer_before_minutes ?? 0);
  const [bufferAfter, setBufferAfter] = useState<number>(existing?.buffer_after_minutes ?? 0);
  const [minNoticeMinutes, setMinNoticeMinutes] = useState<number>(existing?.min_notice_minutes ?? 0);
  const [minNoticeUnit, setMinNoticeUnit] = useState<'minutos' | 'horas' | 'dias'>(() => {
    const m = existing?.min_notice_minutes ?? 0;
    if (m === 0) return 'horas';
    if (m % 1440 === 0) return 'dias';
    if (m % 60 === 0) return 'horas';
    return 'minutos';
  });
  const [isActive, setIsActive] = useState<boolean>(existing?.is_active ?? true);
  const [requiresPrepayment, setRequiresPrepayment] = useState<boolean>((existing as any)?.requires_prepayment ?? false);
  const [prepaymentAmount, setPrepaymentAmount] = useState<number | null>((existing as any)?.prepayment_amount ?? null);
  const [useCustomHours, setUseCustomHours] = useState<boolean>(!!existing?.working_hours_override);
  const [customHours, setCustomHours] = useState<Record<string, { start: string; end: string }[]>>(() => {
    if (existing?.working_hours_override) return existing.working_hours_override;
    // pré-popula com os horários do médico para servir de ponto de partida
    return JSON.parse(JSON.stringify(doctorWorkingHours || {}));
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSlug, setShowSlug] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const labels = useModelLabels();

  const handleAddCustomShift = (dayId: string) => {
    setCustomHours(prev => ({ ...prev, [dayId]: [...(prev[dayId] || []), { start: '08:00', end: '12:00' }] }));
  };
  const handleRemoveCustomShift = (dayId: string, idx: number) => {
    setCustomHours(prev => ({ ...prev, [dayId]: (prev[dayId] || []).filter((_, i) => i !== idx) }));
  };
  const handleUpdateCustomShift = (dayId: string, idx: number, field: 'start' | 'end', value: string) => {
    setCustomHours(prev => {
      const shifts = [...(prev[dayId] || [])];
      shifts[idx] = { ...shifts[idx], [field]: value };
      return { ...prev, [dayId]: shifts };
    });
  };

  const minNoticeValue = (() => {
    if (minNoticeUnit === 'dias') return Math.floor(minNoticeMinutes / 1440);
    if (minNoticeUnit === 'horas') return Math.floor(minNoticeMinutes / 60);
    return minNoticeMinutes;
  })();
  const setMinNoticeFromUnit = (val: number, unit: 'minutos' | 'horas' | 'dias') => {
    const mult = unit === 'dias' ? 1440 : unit === 'horas' ? 60 : 1;
    setMinNoticeMinutes(Math.max(0, val) * mult);
  };

  const handleNameChange = (v: string) => {
    setName(v);
    if (!slugTouched) setSlug(slugify(v));
  };

  const handleSave = async () => {
    setError(null);
    if (!name.trim()) { setError('Informe o nome do tipo.'); return; }
    const finalSlug = (slug.trim() || slugify(name)).toLowerCase();
    if (!finalSlug) { setError('Slug inválido.'); return; }

    // "presencial" e "online" são as palavras que o motor de agendamento usa como MODALIDADE. Um
    // tipo pode se chamar assim (é o caso de 14 dos 19 tipos hoje, e funciona), mas o identificador
    // não pode MENTIR: um tipo presencial identificado como "online" seria devolvido a quem pede
    // consulta online. O banco também barra (consultation_types_slug_nao_mente) — aqui só evitamos
    // que a clínica veja um erro técnico de constraint.
    if ((finalSlug === 'presencial' || finalSlug === 'online') && finalSlug !== modality) {
      setError(
        `O identificador "${finalSlug}" é reservado para a modalidade ${finalSlug}, mas este tipo é ` +
        `${modality}. Use outro identificador (ex.: "${slugify(name)}-${modality}").`
      );
      return;
    }

    setSaving(true);
    try {
      await onSaved({
        clinic_id: clinicId,
        doctor_id: doctorId,
        slug: finalSlug,
        name: name.trim(),
        modality,
        nature,
        // O banco barra prazo fora de 'retorno' (consultation_types_return_window_so_em_retorno).
        // Zerar aqui evita que trocar a natureza deixe um prazo órfão e estoure a constraint.
        return_window_days: nature === 'retorno' ? returnWindowDays : null,
        description: description.trim() || null,
        is_active: isActive,
        consultation_duration: duration,
        slot_step: slotStep,
        buffer_before_minutes: bufferBefore,
        buffer_after_minutes: bufferAfter,
        min_notice_minutes: minNoticeMinutes,
        requires_prepayment: requiresPrepayment,
        prepayment_amount: requiresPrepayment ? prepaymentAmount : null,
        working_hours_override: useCustomHours ? customHours : null,
      });
    } catch (e: any) {
      setError(e?.message || 'Erro ao salvar.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!existing) return;
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setSaving(true);
    try {
      // Conta pelo ID do tipo, não pelo slug.
      //
      // Antes comparava `appointments.modality` com o SLUG — e slug não é modalidade. Nos tipos que
      // fugiram do padrão (Lorena: "primeira-consulta", "seguimento") a conta dava ZERO e a trava
      // LIBERAVA a exclusão de um tipo com consultas futuras marcadas. Medido: 6 consultas no
      // Seguimento Presencial, 1 na Primeira Presencial, 1 na Primeira Online, 1 no Retorno do Tyago.
      //
      // O estrago não seria visível: a FK é ON DELETE SET NULL, então as consultas NÃO somem — elas
      // ficam órfãs do tipo. E como o motor de horários descobre o buffer da consulta existente pelo
      // tipo dela, o buffer dessas consultas viraria ZERO e o sistema passaria a marcar em cima delas.
      const { count } = await supabase
        .from('appointments')
        .select('id', { count: 'exact', head: true })
        .eq('doctor_id', doctorId)
        .eq('consultation_type_id', existing.id)
        .in('status', ['pendente', 'confirmado']);
      if ((count ?? 0) > 0) {
        setError(`Existem ${count} agendamento(s) futuros desse tipo. Desative em vez de excluir.`);
        setConfirmDelete(false);
        setSaving(false);
        return;
      }
      await onDeleted();
    } catch (e: any) {
      setError(e?.message || 'Erro ao excluir.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/60 z-[70] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="bg-white rounded-xl shadow-xl w-full max-w-xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-6 border-b border-slate-100 bg-slate-50/50">
          <h3 className="text-lg font-bold text-slate-900">{existing ? 'Editar tipo de consulta' : 'Novo tipo de consulta'}</h3>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto custom-scrollbar flex-1 bg-slate-50 space-y-5">
          {error && (
            <div className="p-3 bg-rose-50 text-rose-700 rounded-lg flex items-center gap-3 border border-rose-100">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <span className="text-sm font-medium">{error}</span>
            </div>
          )}

          <div className="p-4 bg-white rounded-xl border border-slate-200">
            <label className="block text-sm font-bold text-slate-700 mb-2">Nome</label>
            <input
              type="text"
              value={name}
              onChange={e => handleNameChange(e.target.value)}
              placeholder="Ex: Presencial, Retorno, Urgência..."
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium focus:ring-2 focus:ring-teal-200 focus:outline-none"
            />
            <button onClick={() => setShowSlug(s => !s)} className="text-[10px] font-bold text-slate-400 hover:text-slate-600 mt-1.5 uppercase tracking-widest">
              {showSlug ? 'ocultar identificador' : 'identificador técnico'}
            </button>
            {showSlug && (
              <input
                type="text"
                value={slug}
                onChange={e => { setSlug(slugify(e.target.value)); setSlugTouched(true); }}
                className="mt-2 w-full px-3 py-1.5 bg-slate-100 border border-slate-200 rounded-md text-xs font-mono text-slate-600 focus:ring-2 focus:ring-teal-200 focus:outline-none"
              />
            )}
          </div>

          <div className="p-4 bg-white rounded-xl border border-slate-200">
            <label className="block text-sm font-bold text-slate-700 mb-3">Modalidade</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setModality('presencial')}
                className={cn(
                  "py-2.5 rounded-lg font-semibold text-sm border transition-all flex items-center justify-center gap-2",
                  modality === 'presencial'
                    ? "bg-emerald-600 border-emerald-600 text-white shadow-md"
                    : "bg-white border-slate-200 text-slate-600 hover:border-emerald-300"
                )}
              >
                <MapPin className="w-4 h-4" /> Presencial
              </button>
              <button
                onClick={() => setModality('online')}
                className={cn(
                  "py-2.5 rounded-lg font-semibold text-sm border transition-all flex items-center justify-center gap-2",
                  modality === 'online'
                    ? "bg-sky-600 border-sky-600 text-white shadow-md"
                    : "bg-white border-slate-200 text-slate-600 hover:border-sky-300"
                )}
              >
                <Video className="w-4 h-4" /> Online
              </button>
            </div>
          </div>

          <div className="p-4 bg-white rounded-xl border border-slate-200">
            <label className="block text-sm font-bold text-slate-700 mb-1">Natureza</label>
            <p className="text-xs text-slate-400 font-medium mb-3">
              É por aqui que a IA sabe se o modelo serve para quem nunca veio ou para quem já se consultou.
              Sem isso, ela precisa adivinhar pela descrição.
            </p>
            <div className="space-y-2">
              {NATURE_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setNature(nature === opt.value ? null : opt.value)}
                  className={cn(
                    "w-full text-left px-3 py-2.5 rounded-lg border transition-all",
                    nature === opt.value
                      ? "bg-teal-50 border-teal-500 ring-1 ring-teal-200"
                      : "bg-white border-slate-200 hover:border-teal-300"
                  )}
                >
                  <span className={cn("block font-semibold text-sm", nature === opt.value ? "text-teal-800" : "text-slate-700")}>
                    {labels.isOutro ? opt.labelOutro : opt.label}
                  </span>
                  <span className="block text-xs text-slate-500 font-medium mt-0.5">{opt.hint}</span>
                </button>
              ))}
            </div>
            {nature == null && (
              <p className="text-xs text-amber-600 font-medium mt-2.5">
                Não classificado: este modelo pode ser oferecido em qualquer situação.
              </p>
            )}

            {/* O prazo só existe no retorno de cortesia. Hoje esse número vive em texto solto
                (Lorena: 15 dias no prompt; Tyago: "menos de um mês" na descrição). */}
            {nature === 'retorno' && (
              <div className="mt-3 pt-3 border-t border-slate-100">
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                  Prazo do retorno
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={returnWindowDays ?? ''}
                    onChange={e => {
                      const v = e.target.value.trim();
                      setReturnWindowDays(v === '' ? null : Math.max(1, Math.min(365, Number(v))));
                    }}
                    placeholder="15"
                    className="w-24 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium focus:ring-2 focus:ring-teal-200 focus:outline-none"
                  />
                  <span className="text-sm text-slate-500 font-medium">dias após a consulta anterior</span>
                </div>
                <p className="text-xs text-slate-400 font-medium mt-1.5">
                  Deixe vazio se não houver prazo definido.
                </p>
              </div>
            )}
          </div>

          <div className="p-4 bg-white rounded-xl border border-slate-200">
            <label className="block text-sm font-bold text-slate-700 mb-2">Descrição (contexto para a IA)</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={3}
              placeholder="Ex: Para pacientes que nunca foram atendidos aqui. Use quando o lead disser 'primeira vez', 'queria conhecer o trabalho'..."
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium focus:ring-2 focus:ring-teal-200 focus:outline-none resize-none"
            />
            <p className="text-xs text-slate-400 font-medium mt-1.5">
              A IA usa esse texto para decidir quando aplicar esse tipo de consulta. Quanto mais claro, melhor a escolha automática.
            </p>
          </div>

          <div className="p-4 bg-white rounded-xl border border-slate-200 space-y-5">
            <h4 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Limites</h4>

            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Duração</label>
              <div className="flex flex-wrap gap-2">
                {[15, 20, 30, 45, 60].map(min => (
                  <button key={min} onClick={() => setDuration(min)} className={cn(
                    "px-3 py-1.5 rounded-md font-semibold text-xs border transition-all",
                    duration === min ? "bg-teal-600 border-teal-600 text-white" : "bg-white border-slate-200 text-slate-600 hover:border-teal-300"
                  )}>{min} min</button>
                ))}
              </div>
            </div>

            <div className="border-t border-slate-100 pt-4">
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Intervalo entre vagas</label>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => setSlotStep(null)} className={cn(
                  "px-3 py-1.5 rounded-md font-semibold text-xs border transition-all",
                  slotStep === null ? "bg-teal-600 border-teal-600 text-white" : "bg-white border-slate-200 text-slate-600 hover:border-teal-300"
                )}>Igual à duração</button>
                {[15, 20, 30, 45, 60, 75, 90].map(min => (
                  <button key={min} onClick={() => setSlotStep(min)} className={cn(
                    "px-3 py-1.5 rounded-md font-semibold text-xs border transition-all",
                    slotStep === min ? "bg-teal-600 border-teal-600 text-white" : "bg-white border-slate-200 text-slate-600 hover:border-teal-300"
                  )}>{min} min</button>
                ))}
              </div>
            </div>

            <div className="border-t border-slate-100 pt-4">
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Buffer antes</label>
              <div className="flex flex-wrap gap-2">
                {[0, 5, 10, 15, 30].map(min => (
                  <button key={min} onClick={() => setBufferBefore(min)} className={cn(
                    "px-3 py-1.5 rounded-md font-semibold text-xs border transition-all",
                    bufferBefore === min ? "bg-teal-600 border-teal-600 text-white" : "bg-white border-slate-200 text-slate-600 hover:border-teal-300"
                  )}>{min === 0 ? 'Sem buffer' : `${min} min`}</button>
                ))}
              </div>
            </div>

            <div className="border-t border-slate-100 pt-4">
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Buffer depois</label>
              <div className="flex flex-wrap gap-2">
                {[0, 5, 10, 15, 30].map(min => (
                  <button key={min} onClick={() => setBufferAfter(min)} className={cn(
                    "px-3 py-1.5 rounded-md font-semibold text-xs border transition-all",
                    bufferAfter === min ? "bg-teal-600 border-teal-600 text-white" : "bg-white border-slate-200 text-slate-600 hover:border-teal-300"
                  )}>{min === 0 ? 'Sem buffer' : `${min} min`}</button>
                ))}
              </div>
            </div>

            <div className="border-t border-slate-100 pt-4">
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Aviso mínimo</label>
              <div className="flex items-center gap-2">
                <input
                  type="number" min={0}
                  value={minNoticeValue}
                  onChange={e => setMinNoticeFromUnit(parseInt(e.target.value || '0', 10), minNoticeUnit)}
                  className="w-24 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium focus:ring-2 focus:ring-teal-200 focus:outline-none"
                />
                <select
                  value={minNoticeUnit}
                  onChange={e => { const u = e.target.value as any; setMinNoticeUnit(u); setMinNoticeFromUnit(minNoticeValue, u); }}
                  className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium focus:ring-2 focus:ring-teal-200 focus:outline-none"
                >
                  <option value="minutos">Minutos</option>
                  <option value="horas">Horas</option>
                  <option value="dias">Dias</option>
                </select>
              </div>
            </div>
          </div>

          <div className="p-4 bg-white rounded-xl border border-slate-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-slate-700">Exigir pagamento antecipado</p>
                <p className="text-xs text-slate-400 font-medium mt-0.5">A IA envia os dados de pagamento e só confirma após o comprovante.</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" className="sr-only peer" checked={requiresPrepayment} onChange={e => setRequiresPrepayment(e.target.checked)} />
                <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-teal-500"></div>
              </label>
            </div>
            {requiresPrepayment && (
              <div className="mt-4 border-t border-slate-100 pt-4">
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Valor do pré-pagamento</label>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-bold text-slate-500">R$</span>
                  <input
                    type="number" min={0} step="0.01"
                    value={prepaymentAmount ?? ''}
                    onChange={e => setPrepaymentAmount(e.target.value === '' ? null : parseFloat(e.target.value))}
                    placeholder="150,00"
                    className="w-32 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium focus:ring-2 focus:ring-teal-200 focus:outline-none"
                  />
                  <span className="text-[11px] text-slate-400 font-medium">Em branco = informar manualmente.</span>
                </div>
              </div>
            )}
          </div>

          <div className="p-4 bg-white rounded-xl border border-slate-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-slate-700">Disponibilidade</p>
                <p className="text-xs text-slate-400 font-medium mt-0.5">
                  {useCustomHours ? 'Este tipo usa horários próprios.' : 'Quando inativo utiliza os horários padrão.'}
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" className="sr-only peer" checked={useCustomHours} onChange={e => setUseCustomHours(e.target.checked)} />
                <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-teal-500"></div>
              </label>
            </div>
            {useCustomHours && (
              <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
                {WEEKDAYS.map(day => {
                  const shifts = customHours[day.id] || [];
                  const isActiveDay = shifts.length > 0;
                  return (
                    <div key={day.id} className="rounded-lg border border-slate-100 p-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <label className="relative inline-flex items-center cursor-pointer">
                            <input
                              type="checkbox"
                              className="sr-only peer"
                              checked={isActiveDay}
                              onChange={e => {
                                if (e.target.checked) handleAddCustomShift(day.id);
                                else setCustomHours(prev => ({ ...prev, [day.id]: [] }));
                              }}
                            />
                            <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-teal-500"></div>
                          </label>
                          <span className={cn("font-semibold text-xs", isActiveDay ? "text-slate-700" : "text-slate-400")}>{day.label}</span>
                        </div>
                        {isActiveDay && (
                          <button onClick={() => handleAddCustomShift(day.id)} className="text-[10px] font-bold text-teal-600 bg-teal-50 px-2 py-1 rounded hover:bg-teal-100 transition-colors flex items-center gap-1">
                            <Plus className="w-3 h-3" /> Turno
                          </button>
                        )}
                      </div>
                      {isActiveDay && shifts.length > 0 && (
                        <div className="space-y-2 mt-2 pl-12">
                          {shifts.map((shift, idx) => (
                            <div key={idx} className="flex items-center gap-2">
                              <input type="time" value={shift.start} onChange={e => handleUpdateCustomShift(day.id, idx, 'start', e.target.value)} className="px-2 py-1 bg-slate-50 border border-slate-200 rounded text-xs font-medium focus:ring-2 focus:ring-teal-200 focus:outline-none" />
                              <span className="text-slate-400 text-[10px]">até</span>
                              <input type="time" value={shift.end} onChange={e => handleUpdateCustomShift(day.id, idx, 'end', e.target.value)} className="px-2 py-1 bg-slate-50 border border-slate-200 rounded text-xs font-medium focus:ring-2 focus:ring-teal-200 focus:outline-none" />
                              <button onClick={() => handleRemoveCustomShift(day.id, idx)} className="p-1 text-slate-300 hover:text-rose-500 transition-colors">
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

        </div>

        <div className="p-5 bg-white border-t border-slate-100 flex items-center justify-between gap-3">
          {existing ? (
            <button
              onClick={handleDelete}
              disabled={saving}
              className={cn(
                "text-xs font-bold px-3 py-2 rounded-md border transition-colors",
                confirmDelete ? "bg-rose-600 border-rose-600 text-white" : "border-rose-200 text-rose-600 hover:bg-rose-50"
              )}
            >
              {confirmDelete ? 'Confirmar exclusão' : 'Excluir'}
            </button>
          ) : <span />}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} className="font-bold">Cancelar</Button>
            <Button onClick={handleSave} disabled={saving} className="font-bold text-white shadow-md">
              {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
              Salvar
            </Button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
