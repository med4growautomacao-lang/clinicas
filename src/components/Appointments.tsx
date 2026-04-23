import React, { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import {
  Calendar as CalendarIcon,
  Clock,
  User,
  Bot,
  Phone,
  Plus,
  Search,
  ChevronRight,
  ChevronLeft,
  Stethoscope,
  Loader2,
  X,
  Edit2,
  Trash2,
  AlertCircle,
  Settings,
  FileText
} from "lucide-react";
import { cn } from "@/src/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  addMonths,
  subMonths,
  isToday,
  parseISO
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { useAuth } from "../contexts/AuthContext";
import { useAppointments, useDoctors, usePatients } from "../hooks/useSupabase";
import { supabase } from "../lib/supabase";
import { DoctorScheduleSettings } from "./DoctorScheduleSettings";
import { PatientModal } from "./PatientModal";
import { PatientSearchSelector } from "./PatientSearchSelector";
import { CustomDropdown } from "./CustomDropdown";
import { CustomDatePicker } from "./CustomDatePicker";

function timeToMins(timeStr: string) {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(':').map(Number)
  return h * 60 + m
}

function minsToTime(mins: number) {
  const h = Math.floor(mins / 60).toString().padStart(2, '0')
  const m = (mins % 60).toString().padStart(2, '0')
  return `${h}:${m}`
}

const DOCTOR_COLORS = [
  { bg: "bg-teal-50", text: "text-teal-700", border: "border-teal-100", dot: "bg-teal-500", primary: "text-teal-600", badge: "bg-teal-100/50 text-teal-700" },
  { bg: "bg-indigo-50", text: "text-indigo-700", border: "border-indigo-100", dot: "bg-indigo-500", primary: "text-indigo-600", badge: "bg-indigo-100/50 text-indigo-700" },
  { bg: "bg-rose-50", text: "text-rose-700", border: "border-rose-100", dot: "bg-rose-500", primary: "text-rose-600", badge: "bg-rose-100/50 text-rose-700" },
  { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-100", dot: "bg-amber-500", primary: "text-amber-600", badge: "bg-amber-100/50 text-amber-700" },
  { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-100", dot: "bg-emerald-500", primary: "text-emerald-600", badge: "bg-emerald-100/50 text-emerald-700" },
  { bg: "bg-violet-50", text: "text-violet-700", border: "border-violet-100", dot: "bg-violet-500", primary: "text-violet-600", badge: "bg-violet-100/50 text-violet-700" },
  { bg: "bg-sky-50", text: "text-sky-700", border: "border-sky-100", dot: "bg-sky-500", primary: "text-sky-600", badge: "bg-sky-100/50 text-sky-700" },
];

function getDoctorColor(doctorId: string) {
  if (!doctorId) return DOCTOR_COLORS[0];
  // Simple deterministic hash based on ID sum
  const charSum = doctorId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return DOCTOR_COLORS[charSum % DOCTOR_COLORS.length];
}

export function Appointments() {
  const { userRole, profile } = useAuth();
  const { data: appointments, loading, create, update, remove } = useAppointments();
  const { data: doctors, refetch: refetchDoctors } = useDoctors();
  const { data: patients, refetch: refetchPatients } = usePatients();
  const [lastCreatedPatient, setLastCreatedPatient] = useState<any>(null);
  const [filter, setFilter] = useState("Todos");
  const [dateFilter, setDateFilter] = useState<"all" | "today">("all");
  const [viewMode, setViewMode] = useState<"list" | "calendar">("list");
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [searchTerm, setSearchTerm] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [selectedAppointment, setSelectedAppointment] = useState<any>(null);
  const [formData, setFormData] = useState({ patient_id: '', doctor_id: '', date: '', time: '', notes: '', status: 'pendente' as any });
  const [submitting, setSubmitting] = useState(false);
  const [showScheduleSettings, setShowScheduleSettings] = useState(false);
  const [doctorToConfigure, setDoctorToConfigure] = useState<any>(null);

  const [showPatientModal, setShowPatientModal] = useState(false);
  const [showDayModal, setShowDayModal] = useState(false);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const currentDoctor = useMemo(() => {
    return doctors.find(d => d.user_id === profile?.id);
  }, [doctors, profile?.id]);

  const availableSlots = useMemo(() => {
    if (!formData.doctor_id || !formData.date) return null;

    const doctor = doctors.find(d => d.id === formData.doctor_id);
    if (!doctor) return null;

    if (doctor.days_off && doctor.days_off.includes(formData.date)) {
      return []; // Dia de folga
    }

    const localDate = new Date(`${formData.date}T00:00:00`);
    const dayOfWeek = localDate.getDay().toString();

    const duration = doctor.consultation_duration || 30;
    const shifts = doctor.working_hours?.[dayOfWeek] || [];
    let doctorSlots: string[] = [];

    shifts.forEach((shift: any) => {
      let currentMins = timeToMins(shift.start);
      const endMins = timeToMins(shift.end);

      while (currentMins + duration <= endMins) {
        doctorSlots.push(minsToTime(currentMins));
        currentMins += duration;
      }
    });

    const bookedTimes = appointments
      .filter(a => a.doctor_id === doctor.id && a.date === formData.date && a.id !== selectedAppointment?.id && a.status !== 'cancelado' && a.status !== 'faltou')
      .map(a => a.time.toString().substring(0, 5));

    return doctorSlots.filter(slot => !bookedTimes.includes(slot));
  }, [formData.doctor_id, formData.date, doctors, appointments, selectedAppointment]);

  const filteredAppointments = useMemo(() => {
    return appointments.filter((apt) => {
      const patientName = apt.patient?.name || '';
      const patientCpf = apt.patient?.cpf || '';
      const patientPhone = apt.patient?.phone || '';
      const doctorName = apt.doctor?.name || '';

      const matchesSearch = !searchTerm || 
        patientName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        patientCpf.includes(searchTerm) ||
        patientPhone.includes(searchTerm);
        
      const matchesDoctor = filter === "Todos" || doctorName.includes(filter);
      const matchesDate = dateFilter === "today" ? apt.date === format(new Date(), 'yyyy-MM-dd') : true;
      return matchesSearch && matchesDoctor && matchesDate;
    });
  }, [appointments, filter, dateFilter, searchTerm]);

  const selectedDayAppointments = useMemo(() => {
    if (!selectedDay) return [];
    return appointments.filter(apt => apt.date === selectedDay);
  }, [appointments, selectedDay]);

  const handleDayClick = (date: string) => {
    setSelectedDay(date);
    setShowDayModal(true);
  };

  const handleSubmit = async () => {
    if (!formData.patient_id || !formData.doctor_id || !formData.date || !formData.time) return;
    setSubmitting(true);
    
    if (selectedAppointment) {
      await update(selectedAppointment.id, formData);
    } else {
      await create({
        patient_id: formData.patient_id,
        doctor_id: formData.doctor_id,
        date: formData.date,
        time: formData.time,
        notes: formData.notes || null,
        status: formData.status,
        source: 'manual',
      });
    }

    setFormData({ patient_id: '', doctor_id: '', date: '', time: '', notes: '', status: 'pendente' });
    setSelectedAppointment(null);
    setShowModal(false);
    setSubmitting(false);
  };

  const handlePatientSuccess = (patient: any) => {
    setLastCreatedPatient(patient);
    setFormData(prev => ({ ...prev, patient_id: patient.id }));
    refetchPatients();
    setShowPatientModal(false);
  };

  const handleDelete = async () => {
    if (!selectedAppointment) return;
    setSubmitting(true);
    await remove(selectedAppointment.id);
    setShowDeleteConfirm(false);
    setSelectedAppointment(null);
    setSubmitting(false);
  };

  const openEditModal = (apt: any) => {
    setSelectedAppointment(apt);
    setFormData({
      patient_id: apt.patient_id,
      doctor_id: apt.doctor_id,
      date: apt.date,
      time: apt.time,
      notes: apt.notes || '',
      status: apt.status
    });
    setShowModal(true);
  };

  const openDeleteConfirm = (apt: any) => {
    setSelectedAppointment(apt);
    setShowDeleteConfirm(true);
  };

  const statusLabel: Record<string, string> = {
    pendente: 'Pendente', confirmado: 'Confirmado', realizado: 'Realizado', cancelado: 'Cancelado', faltou: 'Faltou'
  };
  const statusColor: Record<string, string> = {
    confirmado: "bg-emerald-50 text-emerald-700 border-emerald-100",
    pendente: "bg-amber-50 text-amber-700 border-amber-100",
    realizado: "bg-teal-50 text-teal-700 border-teal-100",
    cancelado: "bg-rose-50 text-rose-600 border-rose-100",
    faltou: "bg-slate-50 text-slate-600 border-slate-100",
  };

  const uniqueDoctorNames = Array.from(new Set(appointments.map(a => a.doctor?.name).filter(Boolean)));

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 text-teal-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}>
          <h2 className="text-3xl font-bold tracking-tight text-slate-900">
            {userRole === 'medico' ? 'Minha ' : 'Agenda de '}<span className="text-teal-600">Consultas</span>
          </h2>
          <p className="text-slate-500 font-medium text-base">
            {dateFilter === "today" ? "Consultas agendadas para hoje." : "Acompanhe todos os agendamentos."}
          </p>
        </motion.div>
        <div className="flex items-center gap-3">
          {userRole === 'medico' && currentDoctor && (
             <Button variant="outline" className="py-5 px-6 font-bold" onClick={() => { setDoctorToConfigure(currentDoctor); setShowScheduleSettings(true); }}>
               <Settings className="w-5 h-5 mr-2 text-slate-500" /> Configurar Agenda
             </Button>
          )}
          <Button className="py-5 px-6 group" onClick={() => { setSelectedAppointment(null); setFormData({ patient_id: '', doctor_id: '', date: '', time: '', notes: '', status: 'pendente' }); setShowModal(true); }}>
            <Plus className="w-5 h-5 mr-2 group-hover:rotate-90 transition-transform" />
            Nova Consulta
          </Button>
        </div>
      </div>

      <Card className="border border-slate-200 shadow-sm overflow-hidden">
        <CardHeader className="border-b border-slate-200 pb-4 px-6 bg-slate-50/50">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-[200px]">
                <input
                  type="text"
                  placeholder="Buscar paciente..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-200 transition-all font-medium text-sm"
                />
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              </div>

              <div className="flex items-center gap-1 bg-white p-1 rounded-lg border border-slate-200">
                <button onClick={() => setDateFilter("all")} className={cn("px-3 py-1.5 text-xs font-semibold rounded-md transition-all", dateFilter === "all" ? "bg-teal-600 text-white" : "text-slate-500 hover:text-slate-900")}>Tudo</button>
                <button onClick={() => setDateFilter("today")} className={cn("px-3 py-1.5 text-xs font-semibold rounded-md transition-all", dateFilter === "today" ? "bg-teal-600 text-white" : "text-slate-500 hover:text-slate-900")}>Hoje</button>
              </div>

              {userRole !== 'medico' && uniqueDoctorNames.length > 0 && (
                <div className="flex flex-wrap items-center gap-1 bg-white p-1 rounded-lg border border-slate-200 max-w-2xl">
                  <button onClick={() => setFilter("Todos")} className={cn("px-2 py-1 text-[10px] font-semibold rounded-md transition-all whitespace-nowrap", filter === "Todos" ? "bg-teal-600 text-white" : "text-slate-500 hover:text-slate-900")}>Todos</button>
                  {uniqueDoctorNames.map(name => (
                    <button key={name} onClick={() => setFilter(name!)} className={cn("px-2 py-1 text-[10px] font-semibold rounded-md transition-all whitespace-nowrap", filter === name ? "bg-teal-600 text-white" : "text-slate-500 hover:text-slate-900")}>{name}</button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex bg-white p-1 rounded-lg border border-slate-200 w-fit">
              <button onClick={() => setViewMode("list")} className={cn("px-4 py-1.5 text-xs font-semibold rounded-md transition-all", viewMode === "list" ? "bg-teal-600 text-white" : "text-slate-500 hover:text-slate-900")}>Lista</button>
              <button onClick={() => setViewMode("calendar")} className={cn("px-4 py-1.5 text-xs font-semibold rounded-md transition-all", viewMode === "calendar" ? "bg-teal-600 text-white" : "text-slate-500 hover:text-slate-900")}>Calendário</button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <AnimatePresence mode="wait">
            {viewMode === "list" ? (
              <motion.div key="list" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="overflow-x-auto">
                {filteredAppointments.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                    <CalendarIcon className="w-12 h-12 mb-4 text-slate-300" />
                    <p className="font-semibold text-lg">Nenhum agendamento encontrado</p>
                    <p className="text-sm mt-1">Clique em "Nova Consulta" para agendar.</p>
                  </div>
                ) : (
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50">
                        <th className="px-6 py-3 font-semibold text-slate-600 uppercase tracking-wider text-[10px]">Paciente</th>
                        <th className="px-6 py-3 font-semibold text-slate-600 uppercase tracking-wider text-[10px]">Médico</th>
                        <th className="px-6 py-3 font-semibold text-slate-600 uppercase tracking-wider text-[10px]">Data</th>
                        <th className="px-6 py-3 font-semibold text-slate-600 uppercase tracking-wider text-[10px]">Origem</th>
                        <th className="px-6 py-3 font-semibold text-slate-600 uppercase tracking-wider text-[10px]">Status</th>
                        <th className="px-6 py-3 font-semibold text-slate-600 uppercase tracking-wider text-[10px] text-right">Ações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredAppointments.map((apt, i) => (
                        <motion.tr key={apt.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }} className="hover:bg-slate-50 group transition-all">
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-lg bg-slate-50 flex items-center justify-center"><User className="w-5 h-5 text-slate-600" /></div>
                              <span className="font-semibold text-slate-800">{apt.patient?.name || '—'}</span>
                            </div>
                          </td>
                          <td className="px-6 py-4 font-medium">
                            <div className={cn(
                              "inline-flex items-center gap-2 px-2.5 py-1 rounded-lg border text-xs font-bold",
                              getDoctorColor(apt.doctor_id).bg,
                              getDoctorColor(apt.doctor_id).text,
                              getDoctorColor(apt.doctor_id).border
                            )}>
                              <Stethoscope className="w-3.5 h-3.5" />
                              {apt.doctor?.name || '—'}
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex flex-col">
                              <span className="flex items-center text-slate-700 font-semibold text-sm">
                                <CalendarIcon className={cn("w-3.5 h-3.5 mr-2", getDoctorColor(apt.doctor_id).primary)} />
                                {format(parseISO(apt.date), 'dd/MM/yyyy')}
                              </span>
                              <span className="flex items-center text-slate-400 font-medium text-xs mt-0.5"><Clock className="w-3 h-3 mr-1.5" />{apt.time?.substring(0, 5)}</span>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            {apt.source === "ia" ? (
                              <span className="inline-flex items-center text-[10px] font-semibold tracking-wider uppercase text-teal-700 bg-teal-50 px-2 py-1 rounded-md border border-teal-100"><Bot className="w-3 h-3 mr-1" /> IA</span>
                            ) : (
                              <span className="inline-flex items-center text-[10px] font-semibold tracking-wider uppercase text-slate-500 bg-slate-50 px-2 py-1 rounded-md border border-slate-100"><Phone className="w-3 h-3 mr-1" /> Manual</span>
                            )}
                          </td>
                          <td className="px-6 py-4">
                            <span className={cn("inline-flex items-center rounded-md px-2.5 py-1 text-xs font-semibold border", statusColor[apt.status] || statusColor.pendente)}>
                              {statusLabel[apt.status] || apt.status}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button onClick={() => openEditModal(apt)} className="p-1.5 text-slate-400 hover:text-teal-600 hover:bg-teal-50 rounded-md transition-colors"><Edit2 className="w-4 h-4" /></button>
                              <button onClick={() => openDeleteConfirm(apt)} className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-md transition-colors"><Trash2 className="w-4 h-4" /></button>
                            </div>
                          </td>
                        </motion.tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </motion.div>
            ) : (
              <motion.div key="calendar" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="p-6">
                <CalendarView 
                  currentMonth={currentMonth} 
                  setCurrentMonth={setCurrentMonth} 
                  appointments={filteredAppointments}
                  onDayClick={handleDayClick}
                />
              </motion.div>
            )}
          </AnimatePresence>

          <div className="p-4 bg-slate-50 flex items-center justify-between border-t border-slate-200">
            <p className="text-sm font-medium text-slate-400">Mostrando {filteredAppointments.length} agendamentos.</p>
          </div>
        </CardContent>
      </Card>

      {/* Create Appointment Modal */}
      <AnimatePresence>
        {showModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowModal(false)}>
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="bg-white rounded-2xl shadow-2xl w-full max-w-md relative" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between p-6 border-b border-slate-100">
                <h3 className="text-lg font-bold text-slate-900">{selectedAppointment ? 'Editar Consulta' : 'Nova Consulta'}</h3>
                <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
              </div>

              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Paciente *</label>
                  <PatientSearchSelector
                    patients={patients}
                    selectedId={formData.patient_id}
                    onSelect={(p) => setFormData(prev => ({ ...prev, patient_id: p.id }))}
                    onNewPatient={() => setShowPatientModal(true)}
                    lastCreatedPatient={lastCreatedPatient}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <CustomDropdown
                    label="Médico *"
                    icon={Stethoscope}
                    value={formData.doctor_id}
                    onChange={val => setFormData(p => ({ ...p, doctor_id: val }))}
                    options={doctors.map(d => ({ value: d.id, label: d.name }))}
                    placeholder="Selecione..."
                  />
                  <CustomDatePicker
                    label="Data *"
                    value={formData.date}
                    onChange={val => setFormData(p => ({ ...p, date: val, time: '' }))}
                  />
                </div>

                <CustomDropdown
                  label="Status"
                  icon={Settings}
                  value={formData.status}
                  onChange={val => setFormData(p => ({ ...p, status: val as any }))}
                  options={Object.entries(statusLabel).map(([value, label]) => ({ value, label }))}
                />

                {formData.doctor_id && formData.date && (
                  <div className="animate-in fade-in slide-in-from-top-2 duration-300">
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Horário *</label>
                    {availableSlots === null ? (
                       <p className="text-sm text-slate-400 ml-1 font-medium italic">Selecione médico e data para ver horários.</p>
                     ) : availableSlots.length === 0 ? (
                       <div className="p-4 bg-rose-50 border border-rose-100 rounded-xl text-rose-600 text-sm font-bold flex items-center">
                          <AlertCircle className="w-4 h-4 mr-2" />
                          Esse médico não atende nesta data.
                       </div>
                     ) : (
                       <div className="grid grid-cols-4 sm:grid-cols-5 gap-2 mt-1">
                         {availableSlots.map(slot => (
                           <button
                             key={slot}
                             type="button"
                             onClick={() => setFormData(p => ({ ...p, time: slot }))}
                             className={cn(
                               "py-2.5 text-xs font-bold rounded-lg transition-all border",
                               formData.time === slot
                                 ? "bg-teal-600 text-white border-teal-600 shadow-lg shadow-teal-200"
                                 : "bg-white text-slate-600 border-slate-200 hover:border-teal-400 hover:text-teal-700 hover:bg-teal-50 active:scale-95"
                             )}
                           >
                             {slot}
                           </button>
                         ))}
                       </div>
                     )}
                  </div>
                )}

                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Observações</label>
                  <div className="group/field flex items-start gap-3 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus-within:border-teal-400 focus-within:ring-4 focus-within:ring-teal-100/30 focus-within:bg-white transition-all duration-300">
                    <FileText className="w-4 h-4 text-slate-400 mt-1 group-focus-within/field:text-teal-500 transition-colors" />
                    <textarea value={formData.notes} onChange={e => setFormData(p => ({ ...p, notes: e.target.value }))} rows={2} className="flex-1 bg-transparent border-none outline-none text-sm font-bold text-slate-700 resize-none placeholder:text-slate-300" placeholder="Observações opcionais..." />
                  </div>
                </div>

                {error && (
                  <div className="p-3 bg-rose-50 border border-rose-100 rounded-lg text-rose-600 text-xs font-medium flex items-center">
                    <AlertCircle className="w-3.5 h-3.5 mr-2" />
                    {error}
                  </div>
                )}
              </div>

              <div className="flex gap-3 p-6 border-t border-slate-100 bg-slate-50">
                <Button variant="outline" className="flex-1" onClick={() => setShowModal(false)}>Cancelar</Button>
                <Button className="flex-1" onClick={handleSubmit} disabled={!formData.patient_id || !formData.doctor_id || !formData.date || !formData.time || submitting}>
                  {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : selectedAppointment ? <Edit2 className="w-4 h-4 mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
                  {selectedAppointment ? 'Atualizar' : 'Agendar'}
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
                <h3 className="text-xl font-bold text-slate-900 mb-2">Excluir Agendamento</h3>
                <p className="text-slate-500">Tem certeza que deseja excluir esta consulta? Esta ação não pode ser desfeita.</p>
                {selectedAppointment && (
                  <div className="mt-4 p-3 bg-slate-50 rounded-lg text-sm text-left border border-slate-100">
                    <p className="font-semibold text-slate-700">{selectedAppointment.patient?.name}</p>
                    <p className="text-slate-500 text-xs">{format(parseISO(selectedAppointment.date), 'dd/MM/yyyy')} às {selectedAppointment.time?.substring(0, 5)}</p>
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

      <AnimatePresence>
        {showScheduleSettings && doctorToConfigure && (
          <DoctorScheduleSettings
            doctor={doctorToConfigure}
            onSaved={() => refetchDoctors(true)}
            onClose={() => {
              setShowScheduleSettings(false);
              setDoctorToConfigure(null);
            }}
          />
        )}
      </AnimatePresence>
      <PatientModal
        isOpen={showPatientModal}
        onClose={() => setShowPatientModal(false)}
        onSuccess={handlePatientSuccess}
      />

      {/* Day Appointments Modal */}
      <AnimatePresence>
        {showDayModal && selectedDay && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4" onClick={() => setShowDayModal(false)}>
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[85vh]" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between p-6 border-b border-slate-100 bg-white">
                <div>
                  <h3 className="text-xl font-bold text-slate-900 capitalize">
                    {format(parseISO(selectedDay), "EEEE, d 'de' MMMM", { locale: ptBR })}
                  </h3>
                  <p className="text-sm text-slate-500 font-medium">{selectedDayAppointments.length} agendamentos para este dia</p>
                </div>
                <button onClick={() => setShowDayModal(false)} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-full transition-all"><X className="w-5 h-5" /></button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-3 custom-scrollbar">
                {selectedDayAppointments.length === 0 ? (
                  <div className="text-center py-10 opacity-50">
                    <CalendarIcon className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                    <p className="font-semibold">Nenhuma consulta agendada.</p>
                  </div>
                ) : (
                  selectedDayAppointments.map((apt) => {
                    const docColor = getDoctorColor(apt.doctor_id);
                    return (
                      <div key={apt.id} className={cn(
                        "p-4 border rounded-xl flex items-center justify-between group hover:shadow-md transition-all",
                        docColor.bg,
                        docColor.border,
                        "hover:bg-white"
                      )}>
                        <div className="flex items-center gap-4">
                          <div className={cn("w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm", docColor.bg, docColor.text, "border", docColor.border)}>
                            {apt.time?.substring(0, 5)}
                          </div>
                          <div>
                            <p className="text-sm font-bold text-slate-900">{apt.patient?.name}</p>
                            <p className={cn("text-[10px] font-bold flex items-center gap-1.5 uppercase tracking-wider", docColor.text)}>
                              <Stethoscope className="w-3 h-3" /> {apt.doctor?.name}
                            </p>
                          </div>
                        </div>
                      <div className="flex items-center gap-2">
                        <span className={cn("px-2 py-0.5 rounded text-[10px] font-bold border uppercase", statusColor[apt.status] || statusColor.pendente)}>
                          {statusLabel[apt.status] || apt.status}
                        </span>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => { setShowDayModal(false); openEditModal(apt); }} className="p-1.5 text-slate-400 hover:text-teal-600 hover:bg-teal-50 rounded-lg transition-all"><Edit2 className="w-4 h-4" /></button>
                          <button onClick={() => { setShowDayModal(false); openDeleteConfirm(apt); }} className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all"><Trash2 className="w-4 h-4" /></button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
              </div>

              <div className="p-6 border-t border-slate-100 bg-slate-50">
                <Button className="w-full py-6 font-bold" onClick={() => { setShowDayModal(false); setFormData({ patient_id: '', doctor_id: '', date: selectedDay!, time: '', notes: '', status: 'pendente' }); setShowModal(true); }}>
                  <Plus className="w-5 h-5 mr-2" /> Agendar Nova Consulta
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function CalendarView({ currentMonth, setCurrentMonth, appointments, onDayClick }: {
  currentMonth: Date, setCurrentMonth: (d: Date) => void, appointments: any[], onDayClick: (date: string) => void
}) {
  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(monthStart);
  const startDate = startOfWeek(monthStart, { weekStartsOn: 0 });
  const endDate = endOfWeek(monthEnd, { weekStartsOn: 0 });
  const calendarDays = eachDayOfInterval({ start: startDate, end: endDate });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between bg-slate-50 p-3 rounded-lg border border-slate-200">
        <Button variant="ghost" size="icon" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))} className="rounded-lg hover:bg-white"><ChevronLeft className="w-5 h-5 text-slate-600" /></Button>
        <h3 className="text-xl font-bold text-slate-900 capitalize">{format(currentMonth, 'MMMM yyyy', { locale: ptBR })}</h3>
        <Button variant="ghost" size="icon" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))} className="rounded-lg hover:bg-white"><ChevronRight className="w-5 h-5 text-slate-600" /></Button>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map(day => (
          <div key={day} className="text-center py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{day}</div>
        ))}
        {calendarDays.map((date, i) => {
          const formattedDate = format(date, 'yyyy-MM-dd');
          const dayApts = appointments.filter(apt => apt.date === formattedDate);
          const isCurrentMonth = isSameMonth(date, monthStart);
          const isTodayDate = isToday(date);
          return (
            <div 
              key={date.toString()} 
              onClick={() => isCurrentMonth && onDayClick(formattedDate)}
              className={cn(
                "min-h-[90px] p-2 rounded-lg border transition-all cursor-pointer", 
                isCurrentMonth ? "bg-white border-slate-100 hover:border-teal-300 hover:shadow-md" : "bg-slate-50/50 border-transparent opacity-40 cursor-default", 
                isTodayDate && "ring-2 ring-teal-500/30 border-teal-500 shadow-sm"
              )}
            >
              <div className="flex justify-between items-start mb-1">
                <span className={cn("w-7 h-7 flex items-center justify-center rounded-md text-sm font-bold", isTodayDate ? "bg-teal-600 text-white" : "text-slate-400")}>{format(date, 'd')}</span>
                <div className="flex gap-0.5">
                  {Array.from(new Set(dayApts.map(a => a.doctor_id))).map(docId => (
                    <span key={docId} className={cn("w-2 h-2 rounded-full", getDoctorColor(docId).dot)} />
                  ))}
                </div>
              </div>
              <div className="space-y-1 mt-1">
                {dayApts.slice(0, 3).map(apt => {
                  const docColor = getDoctorColor(apt.doctor_id);
                  return (
                    <div key={apt.id} className={cn(
                      "text-[10px] font-bold px-1.5 py-0.5 rounded truncate border", 
                      docColor.bg,
                      docColor.text,
                      docColor.border
                    )}>
                      {apt.time?.substring(0, 5)} - {apt.patient?.name?.split(' ')[0] || '?'}
                    </div>
                  );
                })}
                {dayApts.length > 3 && <div className="text-[10px] font-bold text-slate-400">+{dayApts.length - 3} mais</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
