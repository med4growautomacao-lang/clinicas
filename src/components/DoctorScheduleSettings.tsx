import React, { useState } from "react";
import { X, Save, Clock, CalendarDays, Plus, Trash2, Loader2, AlertCircle } from "lucide-react";
import { Button } from "./ui/button";
import { motion } from "framer-motion";
import { Doctor } from "../hooks/useSupabase";
import { supabase } from "../lib/supabase";
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

export function DoctorScheduleSettings({ doctor, onClose, onSaved }: DoctorScheduleSettingsProps) {
  const [activeTab, setActiveTab] = useState<'hours' | 'days_off'>('hours');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const [duration, setDuration] = useState<number>(doctor.consultation_duration || 30);
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
          consultation_duration: duration,
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
        className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col"
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
            onClick={() => setActiveTab('hours')}
            className={cn(
              "pb-4 font-semibold text-sm border-b-2 transition-colors flex items-center gap-2",
              activeTab === 'hours' ? "border-teal-600 text-teal-800" : "border-transparent text-slate-500 hover:text-slate-700"
            )}
          >
            <Clock className="w-4 h-4" /> Horários e Turnos
          </button>
          <button
            onClick={() => setActiveTab('days_off')}
            className={cn(
              "pb-4 font-semibold text-sm border-b-2 transition-colors flex items-center gap-2",
              activeTab === 'days_off' ? "border-teal-600 text-teal-800" : "border-transparent text-slate-500 hover:text-slate-700"
            )}
          >
            <CalendarDays className="w-4 h-4" /> Dias de Folga/Exceções
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

          {/* ── Horários e Turnos ── */}
          {activeTab === 'hours' && (
            <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}>
              <div className="mb-8 p-5 bg-white rounded-xl border border-slate-200 shadow-sm">
                <label className="block text-sm font-bold text-slate-700 mb-3">Duração Padrão da Consulta</label>
                <div className="flex flex-wrap gap-3">
                  {[15, 20, 30, 45, 60].map(min => (
                    <button
                      key={min}
                      onClick={() => setDuration(min)}
                      className={cn(
                        "px-4 py-2 rounded-lg font-semibold text-sm border transition-all",
                        duration === min
                          ? "bg-teal-600 border-teal-600 text-white shadow-md shadow-teal-100"
                          : "bg-white border-slate-200 text-slate-600 hover:border-teal-300 hover:bg-teal-50"
                      )}
                    >
                      {min} minutos
                    </button>
                  ))}
                </div>
                <p className="text-xs text-slate-400 font-medium mt-3">Essa duração será usada para dividir a agenda em blocos na hora de visualizar vagas.</p>
              </div>

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

          {/* ── Dias de Folga / Exceções ── */}
          {activeTab === 'days_off' && (
            <motion.div initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} className="space-y-8">

              {/* Bloquear dia inteiro */}
              <div>
                <div className="p-5 bg-white rounded-xl border border-slate-200 shadow-sm mb-4">
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
              </div>

              {/* Bloquear horário específico */}
              <div>
                <div className="p-5 bg-white rounded-xl border border-slate-200 shadow-sm mb-4">
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
              </div>

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
    </motion.div>
  );
}
