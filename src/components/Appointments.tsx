import React, { useState, useMemo, useEffect, useRef } from "react";
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
  ChevronDown,
  Stethoscope,
  Loader2,
  X,
  Edit2,
  Trash2,
  AlertCircle,
  Settings,
  FileText,
  Check,
  Info,
  Eye,
  EyeOff,
  Video,
  MapPin,
} from "lucide-react";
import { cn } from "@/src/lib/utils";
import { matchesSearch } from "../lib/search";
import { MoneyInput } from "./ui/money-input";
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
import { useAppointments, useDoctors, usePatients, useLeads, useConversions, useFinancial, useProtocols, Lead } from "../hooks/useSupabase";
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
  const { userRole, profile, activeClinicId } = useAuth();
  const { data: appointments, loading, create, update, remove } = useAppointments();
  const { data: doctors, refetch: refetchDoctors } = useDoctors();
  const { data: patients, refetch: refetchPatients, create: createPatient } = usePatients();
  const { data: leads } = useLeads();
  const { create: createConversion } = useConversions();
  const { create: createTransaction } = useFinancial();
  const { data: protocols } = useProtocols();
  const [lastCreatedPatient, setLastCreatedPatient] = useState<any>(null);
  const [filter, setFilter] = useState("Todos");
  const [dateFilter, setDateFilter] = useState<"all" | "today">("all");
  const [viewMode, setViewMode] = useState<"list" | "calendar">(() => (localStorage.getItem('appointmentsViewMode') as any) || "list");
  const [showBlocked, setShowBlocked] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [searchTerm, setSearchTerm] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [selectedAppointment, setSelectedAppointment] = useState<any>(null);
  const [formData, setFormData] = useState({ patient_id: '', doctor_id: '', date: '', time: '', notes: '', status: 'pendente' as any, modality: 'presencial' as 'presencial' | 'online' });
  const [submitting, setSubmitting] = useState(false);
  const [showScheduleSettings, setShowScheduleSettings] = useState(false);
  const [doctorToConfigure, setDoctorToConfigure] = useState<any>(null);
  const [showDoctorSchedulePicker, setShowDoctorSchedulePicker] = useState(false);
  const doctorPickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showDoctorSchedulePicker) return;
    const handler = (e: MouseEvent) => {
      if (doctorPickerRef.current && !doctorPickerRef.current.contains(e.target as Node)) {
        setShowDoctorSchedulePicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showDoctorSchedulePicker]);

  const [showPatientModal, setShowPatientModal] = useState(false);
  const [showDayModal, setShowDayModal] = useState(false);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showBlockModal, setShowBlockModal] = useState(false);
  const [submittingBlock, setSubmittingBlock] = useState(false);
  const [blockForm, setBlockForm] = useState<{
    doctor_id: string;
    type: 'day' | 'time';
    start: string;
    end: string;
    name: string;
    repeat: 'none' | 'weekly' | 'monthly';
    interval: number;
    weekdays: number[]; // 0=dom..6=sab
    monthlyMode: 'day_of_month' | 'nth_weekday';
    until: string; // YYYY-MM-DD
  }>({
    doctor_id: '', type: 'day', start: '08:00', end: '12:00', name: '',
    repeat: 'none', interval: 1, weekdays: [], monthlyMode: 'day_of_month', until: ''
  });
  const [openStatusApt, setOpenStatusApt] = useState<{ id: string; top: number; left: number } | null>(null);
  const [realizadoDialog, setRealizadoDialog] = useState<{
    apt: any;
    value: string;
    paymentMethod: string;
    status: 'pago' | 'pendente';
    description: string;
    protocolIds: string[];
  } | null>(null);

  const currentDoctor = useMemo(() => {
    return doctors.find(d => d.user_id === profile?.id);
  }, [doctors, profile?.id]);

  const [availableSlots, setAvailableSlots] = useState<string[] | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(false);

  useEffect(() => {
    if (!formData.doctor_id || !formData.date) {
      setAvailableSlots(null);
      return;
    }
    let cancelled = false;
    setLoadingSlots(true);
    supabase.rpc('get_available_slots', {
      p_doctor_id: formData.doctor_id,
      p_date: formData.date,
      p_exclude_appointment_id: selectedAppointment?.id ?? null,
    }).then(({ data, error }) => {
      if (cancelled) return;
      if (error) { console.error('get_available_slots:', error); setAvailableSlots([]); }
      else {
        const slots = (data || []).map((s: any) => (s.slot_time || '').toString().substring(0, 5));
        setAvailableSlots(slots);
      }
      setLoadingSlots(false);
    });
    return () => { cancelled = true; };
  }, [formData.doctor_id, formData.date, selectedAppointment, appointments]);

  const filteredAppointments = useMemo(() => {
    const list = appointments.filter((apt) => {
      const doctorName = apt.doctor?.name || '';

      const okSearch = matchesSearch(searchTerm, {
        name: apt.patient?.name,
        cpf: apt.patient?.cpf,
        phone: apt.patient?.phone,
      }, ['cpf', 'phone']);

      const matchesDoctor = filter === "Todos" || doctorName.includes(filter);
      const matchesDate = dateFilter === "today" ? apt.date === format(new Date(), 'yyyy-MM-dd') : true;
      return okSearch && matchesDoctor && matchesDate;
    });
    // Ordena por data asc, hora asc — dias mais próximos no topo, dentro do mesmo dia mais cedo primeiro
    return list.sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return (a.time || '').localeCompare(b.time || '');
    });
  }, [appointments, filter, dateFilter, searchTerm]);

  const selectedDayAppointments = useMemo(() => {
    if (!selectedDay) return [];
    return appointments.filter(apt =>
      apt.date === selectedDay &&
      (filter === 'Todos' || (apt.doctor?.name || '').includes(filter))
    );
  }, [appointments, selectedDay, filter]);

  const blockedListItems = useMemo(() => {
    const relevantDoctors = filter === "Todos" ? doctors : doctors.filter(d => d.name.includes(filter));
    const today = format(new Date(), 'yyyy-MM-dd');
    const items: { date: string; start?: string; end?: string; name?: string; doctorId: string; doctorName: string; type: 'day' | 'time' }[] = [];
    relevantDoctors.forEach(d => {
      (d.days_off || []).forEach((date: string) => {
        if (dateFilter === 'today' && date !== today) return;
        items.push({ date, doctorId: d.id, doctorName: d.name, type: 'day' });
      });
      (d.blocked_times || []).forEach((bt: any) => {
        if (dateFilter === 'today' && bt.date !== today) return;
        items.push({ date: bt.date, start: bt.start, end: bt.end, name: bt.name, doctorId: d.id, doctorName: d.name, type: 'time' });
      });
    });
    return items.sort((a, b) => a.date.localeCompare(b.date) || (a.start || '').localeCompare(b.start || ''));
  }, [doctors, filter, dateFilter]);

  // Linha do tempo combinada: agendamentos + bloqueios, ordenados por data+hora
  type TimelineItem =
    | { kind: 'apt'; date: string; time: string; sortTime: string; apt: any }
    | { kind: 'blocked'; date: string; time: string; sortTime: string; bl: any };

  const timelineItems = useMemo<TimelineItem[]>(() => {
    const items: TimelineItem[] = filteredAppointments.map(apt => ({
      kind: 'apt',
      date: apt.date,
      time: apt.time || '',
      sortTime: apt.time || '00:00',
      apt,
    }));
    if (showBlocked) {
      blockedListItems.forEach(bl => {
        items.push({
          kind: 'blocked',
          date: bl.date,
          time: bl.start || '',
          sortTime: bl.type === 'day' ? '00:00' : (bl.start || '00:00'),
          bl,
        });
      });
    }
    return items.sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return a.sortTime.localeCompare(b.sortTime);
    });
  }, [filteredAppointments, blockedListItems, showBlocked]);

  const selectedDayBlockedDoctors = useMemo(() => {
    if (!selectedDay) return [];
    return doctors.filter(d =>
      d.days_off?.includes(selectedDay) &&
      (filter === 'Todos' || d.name.includes(filter))
    );
  }, [doctors, selectedDay, filter]);

  const selectedDayBlockedTimes = useMemo(() => {
    if (!selectedDay) return [];
    return doctors
      .filter(d => filter === 'Todos' || d.name.includes(filter))
      .flatMap(d =>
        (d.blocked_times || [])
          .filter((bt: any) => bt.date === selectedDay)
          .map((bt: any) => ({ ...bt, doctorId: d.id, doctorName: d.name }))
      ).sort((a: any, b: any) => a.start.localeCompare(b.start));
  }, [doctors, selectedDay, filter]);

  const handleDayClick = (date: string) => {
    setSelectedDay(date);
    setShowDayModal(true);
  };

  const onAppointmentRealizado = async (
    _patientId: string,
    appointmentId: string,
    _date: string,
    _time: string,
    value: number,
    paymentMethod: string | null,
    txStatus: 'pago' | 'pendente' = 'pago',
    description: string = '',
    protocolIds: string[] = [],
    ticketId?: string | null
  ) => {
    // RPC atômica: muda status, cria transação, cria conversão, move ticket — tudo em uma transação no banco
    const { error } = await supabase.rpc('finalize_appointment', {
      p_appointment_id: appointmentId,
      p_value: value,
      p_payment_method: paymentMethod,
      p_payment_status: txStatus,
      p_description: description || null,
      p_protocol_ids: protocolIds,
      p_ticket_id: ticketId || null,
    });
    if (error) {
      setError('Erro ao finalizar a consulta: ' + error.message);
    }
  };

  const handleInlineStatus = async (apt: any, newStatus: string) => {
    setOpenStatusApt(null);
    if (newStatus === apt.status) return;
    if (newStatus === 'realizado') {
      setRealizadoDialog({ apt, value: '', paymentMethod: '', status: 'pago', description: '', protocolIds: [] });
      return;
    }
    if (newStatus === 'cancelado') {
      // RPC atômica: cancela + reverte transação financeira (se houver)
      const { error: cancelErr } = await supabase.rpc('cancel_appointment', {
        p_appointment_id: apt.id,
        p_reason: null,
        p_revert_transaction: true,
      });
      if (cancelErr) setError('Erro ao cancelar: ' + cancelErr.message);
      return;
    }
    await update(apt.id, { status: newStatus as any });

    // Status compareceu → cria registro no prontuário (movimentação de lead/ticket é feita pelo trigger no banco)
    if (newStatus === 'compareceu' && apt.status !== 'compareceu') {
      const { data: existing } = await supabase
        .from('medical_records')
        .select('id')
        .eq('appointment_id', apt.id)
        .maybeSingle();
      if (!existing) {
        await supabase.from('medical_records').insert({
          clinic_id: activeClinicId,
          patient_id: apt.patient_id,
          doctor_id: apt.doctor_id,
          appointment_id: apt.id,
          type: 'consulta',
          description: null,
          diagnosis: null,
          prescription: null,
        });
      }
    }
  };

  const handleConfirmRealizado = async () => {
    if (!realizadoDialog) return;
    const { apt, value, paymentMethod, status, description, protocolIds } = realizadoDialog;
    setRealizadoDialog(null);
    await update(apt.id, { status: 'realizado' });
    await onAppointmentRealizado(
      apt.patient_id, apt.id, apt.date, apt.time,
      parseFloat(value.replace(',', '.')) || 0,
      paymentMethod || null,
      status,
      description,
      protocolIds,
      apt.ticket_id
    );
  };

  const expandRecurrence = (startDateStr: string): string[] => {
    const dates: string[] = [startDateStr];
    if (blockForm.repeat === 'none' || !blockForm.until) return dates;
    const start = new Date(`${startDateStr}T00:00:00`);
    const end = new Date(`${blockForm.until}T00:00:00`);
    if (end <= start) return dates;
    const limit = 365 * 2; // safety cap
    if (blockForm.repeat === 'weekly') {
      const wd = blockForm.weekdays.length > 0 ? [...blockForm.weekdays].sort() : [start.getDay()];
      // Para cada semana (a cada interval), pega cada dia da semana selecionado
      let weekStart = new Date(start);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay()); // domingo da semana
      let safety = 0;
      while (weekStart <= end && safety < limit) {
        for (const d of wd) {
          const candidate = new Date(weekStart);
          candidate.setDate(candidate.getDate() + d);
          if (candidate > start && candidate <= end) {
            dates.push(candidate.toISOString().split('T')[0]);
          }
        }
        weekStart.setDate(weekStart.getDate() + 7 * blockForm.interval);
        safety++;
      }
    } else if (blockForm.repeat === 'monthly') {
      if (blockForm.monthlyMode === 'nth_weekday') {
        // Repete na Nª <dia-da-semana> do mês
        const weekday = start.getDay();
        const nth = Math.ceil(start.getDate() / 7); // 1..5
        const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
        let safety = 0;
        while (safety < limit) {
          cursor.setMonth(cursor.getMonth() + blockForm.interval);
          // Acha a Nª ocorrência de `weekday` no mês `cursor`
          const firstOfMonth = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
          const offset = (weekday - firstOfMonth.getDay() + 7) % 7;
          const target = new Date(firstOfMonth);
          target.setDate(1 + offset + (nth - 1) * 7);
          if (target.getMonth() !== cursor.getMonth()) { safety++; continue; }
          if (target > end) break;
          if (target > start) dates.push(target.toISOString().split('T')[0]);
          safety++;
        }
      } else {
        // Modo "mesmo dia do mês"
        const dayOfMonth = start.getDate();
        const candidate = new Date(start);
        let safety = 0;
        while (safety < limit) {
          candidate.setMonth(candidate.getMonth() + blockForm.interval);
          candidate.setDate(dayOfMonth);
          if (candidate.getDate() !== dayOfMonth) { safety++; continue; }
          if (candidate > end) break;
          dates.push(candidate.toISOString().split('T')[0]);
          safety++;
        }
      }
    }
    return Array.from(new Set(dates)).sort();
  };

  const handleSubmitBlock = async () => {
    if (!selectedDay || !blockForm.doctor_id) return;
    const doctor = doctors.find(d => d.id === blockForm.doctor_id);
    if (!doctor) return;
    if (blockForm.type === 'time' && blockForm.start >= blockForm.end) {
      setError('Horário de início deve ser menor que o fim.');
      return;
    }
    setSubmittingBlock(true);
    try {
      const allDates = expandRecurrence(selectedDay);
      if (blockForm.type === 'day') {
        const newDaysOff = Array.from(new Set([...(doctor.days_off || []), ...allDates]));
        const { error } = await supabase.from('doctors').update({ days_off: newDaysOff }).eq('id', doctor.id);
        if (error) throw error;
      } else {
        const newBlocks = allDates.map(d => ({
          date: d, start: blockForm.start, end: blockForm.end,
          name: blockForm.name || 'Bloqueio'
        }));
        const newBlockedTimes = [...(doctor.blocked_times || []), ...newBlocks];
        const { error } = await supabase.from('doctors').update({ blocked_times: newBlockedTimes }).eq('id', doctor.id);
        if (error) throw error;
      }
      await refetchDoctors(true, true);
      setShowBlockModal(false);
    } catch (e: any) {
      setError(e.message || 'Erro ao bloquear horário.');
    } finally {
      setSubmittingBlock(false);
    }
  };

  const handleDeleteBlock = async (doctorId: string, type: 'day' | 'time', date: string, start?: string, end?: string) => {
    const doctor = doctors.find(d => d.id === doctorId);
    if (!doctor) return;
    try {
      if (type === 'day') {
        const newDaysOff = (doctor.days_off || []).filter((d: string) => d !== date);
        const { error } = await supabase.from('doctors').update({ days_off: newDaysOff }).eq('id', doctor.id);
        if (error) throw error;
      } else {
        const newBlockedTimes = (doctor.blocked_times || []).filter((bt: any) =>
          !(bt.date === date && bt.start === start && bt.end === end)
        );
        const { error } = await supabase.from('doctors').update({ blocked_times: newBlockedTimes }).eq('id', doctor.id);
        if (error) throw error;
      }
      await refetchDoctors(true, true);
    } catch (e: any) {
      setError(e.message || 'Erro ao remover bloqueio.');
    }
  };

  const handleSubmit = async () => {
    if (!formData.patient_id || !formData.doctor_id || !formData.date || !formData.time) return;
    setSubmitting(true);
    setError(null);

    if (selectedAppointment) {
      const becomingRealizado = selectedAppointment.status !== 'realizado' && formData.status === 'realizado';
      const ok = await update(selectedAppointment.id, formData);

      if (!ok) {
        setError('Erro ao atualizar agendamento. Tente novamente.');
        setSubmitting(false);
        return;
      }

      if (becomingRealizado) {
        await onAppointmentRealizado(formData.patient_id, selectedAppointment.id, formData.date, formData.time, 0, null, 'pago', '', [], selectedAppointment.ticket_id);
      }
    } else {
      const result = await create({
        patient_id: formData.patient_id,
        doctor_id: formData.doctor_id,
        date: formData.date,
        time: formData.time,
        notes: formData.notes || null,
        status: formData.status,
        modality: formData.modality,
        source: 'manual',
      });

      if (!result) {
        setError('Erro ao criar agendamento. Verifique se há um ticket/consulta em aberto não resolvido para este paciente no funil.');
        setSubmitting(false);
        return;
      }
    }

    setFormData({ patient_id: '', doctor_id: '', date: '', time: '', notes: '', status: 'pendente', modality: 'presencial' });
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

  const handleSelectLead = async (lead: Lead) => {
    // If lead is already linked to a patient, just use that patient
    if (lead.converted_patient_id) {
      setFormData(prev => ({ ...prev, patient_id: lead.converted_patient_id! }));
      return;
    }
    // Create patient from lead data and link them
    const newPatient = await createPatient({
      name: lead.name,
      phone: lead.phone || null,
      email: lead.email || null,
    });
    if (!newPatient) return;
    supabase.from('leads').update({ converted_patient_id: newPatient.id }).eq('id', lead.id);
    setLastCreatedPatient(newPatient);
    setFormData(prev => ({ ...prev, patient_id: newPatient.id }));
    refetchPatients();
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
      status: apt.status,
      modality: (apt.modality as 'presencial' | 'online') || 'presencial'
    });
    setShowModal(true);
  };

  const openDeleteConfirm = (apt: any) => {
    setSelectedAppointment(apt);
    setShowDeleteConfirm(true);
  };

  const statusLabel: Record<string, string> = {
    pendente: 'Pendente', confirmado: 'Confirmado', compareceu: 'Compareceu', realizado: 'Realizado', cancelado: 'Cancelado', faltou: 'Faltou'
  };
  const statusColor: Record<string, string> = {
    confirmado: "bg-emerald-50 text-emerald-700 border-emerald-100",
    pendente: "bg-amber-50 text-amber-700 border-amber-100",
    compareceu: "bg-blue-50 text-blue-700 border-blue-100",
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
            {(userRole === 'medico' || userRole === 'medico_gestor') ? 'Minha ' : 'Agenda de '}<span className="text-teal-600">Consultas</span>
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
          {(userRole === 'gestor' || userRole === 'secretaria' || userRole === 'medico_gestor') && doctors.length > 0 && (
            <div className="relative" ref={doctorPickerRef}>
              <Button variant="outline" className="py-5 px-6 font-bold" onClick={() => setShowDoctorSchedulePicker(v => !v)}>
                <Settings className="w-5 h-5 mr-2 text-slate-500" /> Configurar Agenda
              </Button>
              <AnimatePresence>
                {showDoctorSchedulePicker && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.12 }}
                    className="absolute right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-50 min-w-[200px]"
                  >
                    <p className="px-3 pt-2.5 pb-1 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Selecionar médico</p>
                    {doctors.map(doc => (
                      <button
                        key={doc.id}
                        onClick={() => { setDoctorToConfigure(doc); setShowScheduleSettings(true); setShowDoctorSchedulePicker(false); }}
                        className="w-full text-left px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors truncate"
                      >
                        {doc.name}
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
          <Button className="py-5 px-6 group" onClick={() => { setSelectedAppointment(null); setFormData({ patient_id: '', doctor_id: '', date: '', time: '', notes: '', status: 'pendente', modality: 'presencial' }); setShowModal(true); }}>
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

              {userRole !== 'medico' && userRole !== 'medico_gestor' && uniqueDoctorNames.length > 0 && (
                <div className="flex flex-wrap items-center gap-1 bg-white p-1 rounded-lg border border-slate-200 max-w-2xl">
                  <button onClick={() => setFilter("Todos")} className={cn("px-2 py-1 text-[10px] font-semibold rounded-md transition-all whitespace-nowrap", filter === "Todos" ? "bg-teal-600 text-white" : "text-slate-500 hover:text-slate-900")}>Todos</button>
                  {uniqueDoctorNames.map(name => (
                    <button key={name} onClick={() => setFilter(name!)} className={cn("px-2 py-1 text-[10px] font-semibold rounded-md transition-all whitespace-nowrap", filter === name ? "bg-teal-600 text-white" : "text-slate-500 hover:text-slate-900")}>{name}</button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => setShowBlocked(v => !v)}
                className={cn("h-8 gap-1.5 text-xs font-semibold", showBlocked ? "text-rose-600 border-rose-300 bg-rose-50 hover:bg-rose-100" : "text-slate-500 hover:text-rose-500")}
              >
                {showBlocked ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                {showBlocked ? 'Esconder bloqueados' : 'Mostrar bloqueados'}
              </Button>
              <div className="flex bg-white p-1 rounded-lg border border-slate-200 w-fit">
                <button onClick={() => { setViewMode("list"); localStorage.setItem('appointmentsViewMode', 'list'); }} className={cn("px-4 py-1.5 text-xs font-semibold rounded-md transition-all", viewMode === "list" ? "bg-teal-600 text-white" : "text-slate-500 hover:text-slate-900")}>Lista</button>
                <button onClick={() => { setViewMode("calendar"); localStorage.setItem('appointmentsViewMode', 'calendar'); }} className={cn("px-4 py-1.5 text-xs font-semibold rounded-md transition-all", viewMode === "calendar" ? "bg-teal-600 text-white" : "text-slate-500 hover:text-slate-900")}>Calendário</button>
              </div>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <AnimatePresence mode="wait">
            {viewMode === "list" ? (
              <motion.div key="list" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="overflow-auto max-h-[calc(100vh-320px)]">
                {filteredAppointments.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                    <CalendarIcon className="w-12 h-12 mb-4 text-slate-300" />
                    <p className="font-semibold text-lg">Nenhum agendamento encontrado</p>
                    <p className="text-sm mt-1">Clique em "Nova Consulta" para agendar.</p>
                  </div>
                ) : (
                  <table className="w-full text-left border-collapse">
                    <thead className="sticky top-0 z-10 bg-slate-50">
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
                      {timelineItems.map((item, i) => {
                        const prevDate = i > 0 ? timelineItems[i - 1].date : null;
                        const showDayHeader = item.date !== prevDate;
                        const today = format(new Date(), 'yyyy-MM-dd');
                        const isToday = item.date === today;
                        const dayLabel = format(parseISO(item.date), "EEEE, dd 'de' MMMM", { locale: ptBR });
                        const dayItems = timelineItems.filter(t => t.date === item.date);
                        const dayAppts = dayItems.filter(t => t.kind === 'apt').length;
                        const dayBlocks = dayItems.filter(t => t.kind === 'blocked').length;
                        const dayHeader = showDayHeader ? (
                          <tr className="bg-slate-50/80">
                            <td colSpan={6} className="px-6 py-2">
                              <div className="flex items-center gap-3">
                                <span className={cn(
                                  "text-[11px] font-bold uppercase tracking-widest capitalize",
                                  isToday ? "text-teal-700" : "text-slate-500"
                                )}>
                                  {isToday ? `Hoje · ${dayLabel}` : dayLabel}
                                </span>
                                <span className="text-[10px] font-bold text-slate-400 bg-white border border-slate-200 px-1.5 py-0.5 rounded-md">
                                  {dayAppts} {dayAppts === 1 ? 'consulta' : 'consultas'}
                                </span>
                                {dayBlocks > 0 && (
                                  <span className="text-[10px] font-bold text-rose-500 bg-rose-50 border border-rose-100 px-1.5 py-0.5 rounded-md">
                                    {dayBlocks} {dayBlocks === 1 ? 'bloqueio' : 'bloqueios'}
                                  </span>
                                )}
                              </div>
                            </td>
                          </tr>
                        ) : null;

                        if (item.kind === 'blocked') {
                          const bl = item.bl;
                          return (
                            <React.Fragment key={`bl-${i}-${bl.date}-${bl.doctorId}`}>
                              {dayHeader}
                              <motion.tr initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 15) * 0.02 }} className="bg-rose-50/40 group hover:bg-rose-100/30 transition-all">
                                <td className="px-6 py-4">
                                  <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-lg bg-rose-100 flex items-center justify-center text-rose-400 text-lg">⊘</div>
                                    <span className="font-semibold text-rose-700 text-sm">{bl.type === 'day' ? 'Dia Bloqueado' : bl.name}</span>
                                  </div>
                                </td>
                                <td className="px-6 py-4">
                                  <div className={cn("inline-flex items-center gap-2 px-2.5 py-1 rounded-lg border text-xs font-bold", getDoctorColor(bl.doctorId).bg, getDoctorColor(bl.doctorId).text, getDoctorColor(bl.doctorId).border)}>
                                    <Stethoscope className="w-3.5 h-3.5" />
                                    {bl.doctorName}
                                  </div>
                                </td>
                                <td className="px-6 py-4">
                                  <div className="flex flex-col">
                                    <span className="flex items-center text-slate-700 font-semibold text-sm">
                                      <CalendarIcon className="w-3.5 h-3.5 mr-2 text-rose-400" />
                                      {format(parseISO(bl.date), 'dd/MM/yyyy')}
                                    </span>
                                    {bl.type === 'time' && (
                                      <span className="flex items-center text-slate-400 font-medium text-xs mt-0.5"><Clock className="w-3 h-3 mr-1.5" />{bl.start} – {bl.end}</span>
                                    )}
                                    {bl.type === 'day' && (
                                      <span className="flex items-center text-rose-300 font-medium text-xs mt-0.5">Dia todo</span>
                                    )}
                                  </div>
                                </td>
                                <td className="px-6 py-4" />
                                <td className="px-6 py-4">
                                  <span className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold border bg-rose-100 text-rose-600 border-rose-200">
                                    Bloqueado
                                  </span>
                                </td>
                                <td className="px-6 py-4 text-right">
                                  <button
                                    onClick={() => handleDeleteBlock(bl.doctorId, bl.type, bl.date, bl.start, bl.end)}
                                    className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-md transition-colors opacity-0 group-hover:opacity-100"
                                    title="Remover bloqueio"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </td>
                              </motion.tr>
                            </React.Fragment>
                          );
                        }

                        const apt = item.apt;
                        return (
                          <React.Fragment key={apt.id}>
                            {dayHeader}
                            <motion.tr initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 15) * 0.02 }} className="hover:bg-slate-50 group transition-all">
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-lg bg-slate-50 flex items-center justify-center"><User className="w-5 h-5 text-slate-600" /></div>
                              <span className="font-semibold text-slate-800">{apt.patient?.name || '—'}</span>
                              {apt.patient?.phone && (
                                <div className="relative group/phone">
                                  <button className="text-slate-300 hover:text-slate-500 transition-colors">
                                    <Info className="w-3.5 h-3.5" />
                                  </button>
                                  <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-1.5 hidden group-hover/phone:flex items-center gap-1.5 bg-slate-800 text-white text-xs rounded-lg px-2.5 py-1.5 whitespace-nowrap shadow-lg z-50 pointer-events-none">
                                    <Phone className="w-3 h-3 text-slate-300" />
                                    {apt.patient.phone}
                                    <div className="absolute left-1/2 -translate-x-1/2 top-full w-0 h-0 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent border-t-slate-800" />
                                  </div>
                                </div>
                              )}
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
                              <span className={cn(
                                "inline-flex items-center gap-1 mt-1 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border self-start",
                                apt.modality === 'online'
                                  ? "text-sky-500 bg-sky-50/70 border-sky-100/70"
                                  : "text-emerald-500 bg-emerald-50/70 border-emerald-100/70"
                              )}>
                                {apt.modality === 'online' ? <Video className="w-2.5 h-2.5" /> : <MapPin className="w-2.5 h-2.5" />}
                                {apt.modality === 'online' ? 'Online' : 'Presencial'}
                              </span>
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
                            <div>
                              <button
                                onClick={(e) => {
                                  if (openStatusApt?.id === apt.id) { setOpenStatusApt(null); return; }
                                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                  setOpenStatusApt({ id: apt.id, top: rect.bottom + 4, left: rect.left });
                                }}
                                className={cn("inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold border cursor-pointer hover:opacity-75 transition-opacity", statusColor[apt.status] || statusColor.pendente)}
                              >
                                {statusLabel[apt.status] || apt.status}
                                <ChevronDown className="w-3 h-3" />
                              </button>
                            </div>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button onClick={() => openEditModal(apt)} className="p-1.5 text-slate-400 hover:text-teal-600 hover:bg-teal-50 rounded-md transition-colors"><Edit2 className="w-4 h-4" /></button>
                              <button onClick={() => openDeleteConfirm(apt)} className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-md transition-colors"><Trash2 className="w-4 h-4" /></button>
                            </div>
                          </td>
                            </motion.tr>
                          </React.Fragment>
                        );
                      })}
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
                  doctors={filter === "Todos" ? doctors : doctors.filter(d => d.name.includes(filter))}
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
                    leads={leads}
                    onSelectLead={handleSelectLead}
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

                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Modalidade</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setFormData(p => ({ ...p, modality: 'presencial' }))}
                      className={cn(
                        "flex items-center justify-center gap-2 py-3 rounded-xl border text-xs font-bold transition-all",
                        formData.modality === 'presencial'
                          ? "bg-teal-600 text-white border-teal-600 shadow-lg shadow-teal-200"
                          : "bg-white text-slate-600 border-slate-200 hover:border-teal-400 hover:text-teal-700 hover:bg-teal-50"
                      )}
                    >
                      <MapPin className="w-4 h-4" />
                      Presencial
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormData(p => ({ ...p, modality: 'online' }))}
                      className={cn(
                        "flex items-center justify-center gap-2 py-3 rounded-xl border text-xs font-bold transition-all",
                        formData.modality === 'online'
                          ? "bg-teal-600 text-white border-teal-600 shadow-lg shadow-teal-200"
                          : "bg-white text-slate-600 border-slate-200 hover:border-teal-400 hover:text-teal-700 hover:bg-teal-50"
                      )}
                    >
                      <Video className="w-4 h-4" />
                      Online
                    </button>
                  </div>
                </div>

                {formData.doctor_id && formData.date && (
                  <div className="animate-in fade-in slide-in-from-top-2 duration-300">
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Horário *</label>
                    {loadingSlots ? (
                      <div className="p-4 bg-slate-50 border border-slate-100 rounded-xl text-slate-400 text-sm font-bold flex items-center">
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Carregando horários disponíveis...
                      </div>
                    ) : !availableSlots || availableSlots.length === 0 ? (
                      <div className="p-4 bg-rose-50 border border-rose-100 rounded-xl text-rose-600 text-sm font-bold flex items-center">
                        <AlertCircle className="w-4 h-4 mr-2" />
                        Sem horários disponíveis nesta data.
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
            onSaved={() => refetchDoctors(true, true)}
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
                {/* Bloqueios do dia */}
                {(selectedDayBlockedDoctors.length > 0 || selectedDayBlockedTimes.length > 0) && (
                  <div className="space-y-2 pb-1">
                    {selectedDayBlockedDoctors.map(d => (
                      <div key={d.id} className="flex items-center gap-3 px-4 py-3 bg-rose-50 border border-rose-200 rounded-xl group">
                        <div className="w-8 h-8 flex items-center justify-center rounded-full bg-rose-100 text-rose-500 font-black text-sm shrink-0">⊘</div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-rose-700">Dia todo — {d.name}</p>
                        </div>
                        <button
                          onClick={() => handleDeleteBlock(d.id, 'day', selectedDay!)}
                          className="p-1.5 text-rose-300 hover:text-rose-600 hover:bg-rose-100 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                          title="Remover bloqueio"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                    {selectedDayBlockedTimes.map((bt: any, i: number) => (
                      <div key={i} className="flex items-center gap-3 px-4 py-3 bg-rose-50 border border-rose-200 rounded-xl group">
                        <div className="w-8 h-8 flex items-center justify-center rounded-full bg-rose-100 text-rose-500 font-black text-sm shrink-0">⊘</div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-rose-700">{bt.name}</p>
                          <p className="text-xs text-rose-400 font-medium">{bt.start} – {bt.end}</p>
                        </div>
                        <button
                          onClick={() => handleDeleteBlock(bt.doctorId, 'time', bt.date, bt.start, bt.end)}
                          className="p-1.5 text-rose-300 hover:text-rose-600 hover:bg-rose-100 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                          title="Remover bloqueio"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                    {selectedDayAppointments.length > 0 && (
                      <div className="border-t border-slate-100 pt-1" />
                    )}
                  </div>
                )}

                {selectedDayAppointments.length === 0 && selectedDayBlockedDoctors.length === 0 && selectedDayBlockedTimes.length === 0 ? (
                  <div className="text-center py-10 opacity-50">
                    <CalendarIcon className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                    <p className="font-semibold">Nenhuma consulta agendada.</p>
                  </div>
                ) : selectedDayAppointments.length === 0 && (selectedDayBlockedDoctors.length > 0 || selectedDayBlockedTimes.length > 0) ? null : (
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
                        <span className={cn(
                          "inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold border uppercase",
                          apt.modality === 'online'
                            ? "text-sky-500 bg-sky-50/70 border-sky-100/70"
                            : "text-emerald-500 bg-emerald-50/70 border-emerald-100/70"
                        )}>
                          {apt.modality === 'online' ? <Video className="w-3 h-3" /> : <MapPin className="w-3 h-3" />}
                          {apt.modality === 'online' ? 'Online' : 'Presencial'}
                        </span>
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

              <div className="p-6 border-t border-slate-100 bg-slate-50 grid grid-cols-3 gap-2">
                <Button variant="destructive" className="col-span-1 py-5 font-bold" onClick={() => {
                  // Médico só pode bloquear o próprio horário; outros podem escolher qualquer médico da clínica
                  const defaultDoctorId = (userRole === 'medico' || userRole === 'medico_gestor')
                    ? (currentDoctor?.id || doctors[0]?.id || '')
                    : (doctors[0]?.id || '');
                  setBlockForm({ doctor_id: defaultDoctorId, type: 'day', start: '08:00', end: '12:00', name: '', repeat: 'none', interval: 1, weekdays: [], monthlyMode: 'day_of_month', until: '' });
                  setShowBlockModal(true);
                }}>
                  <Trash2 className="w-4 h-4 mr-2" /> Bloquear
                </Button>
                <Button className="col-span-2 py-5 font-bold" onClick={() => { setShowDayModal(false); setSelectedAppointment(null); setFormData({ patient_id: '', doctor_id: '', date: selectedDay!, time: '', notes: '', status: 'pendente', modality: 'presencial' }); setShowModal(true); }}>
                  <Plus className="w-5 h-5 mr-2" /> Nova Consulta
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modal de Bloqueio */}
      <AnimatePresence>
        {showBlockModal && selectedDay && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/50 z-[70] flex items-center justify-center p-4" onClick={() => setShowBlockModal(false)}>
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between p-6 border-b border-slate-100">
                <div>
                  <h3 className="text-lg font-bold text-slate-900">Bloquear Horário</h3>
                  <p className="text-xs text-slate-500 font-medium capitalize">{format(parseISO(selectedDay), "EEEE, d 'de' MMMM", { locale: ptBR })}</p>
                </div>
                <button onClick={() => setShowBlockModal(false)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
              </div>

              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Médico *</label>
                  <CustomDropdown
                    label=""
                    icon={Stethoscope}
                    value={blockForm.doctor_id}
                    onChange={val => setBlockForm(p => ({ ...p, doctor_id: val }))}
                    options={(userRole === 'medico' && currentDoctor
                      ? [currentDoctor]
                      : doctors
                    ).map(d => ({ value: d.id, label: d.name }))}
                    placeholder="Selecione..."
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Tipo de Bloqueio</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => setBlockForm(p => ({ ...p, type: 'day' }))} className={cn(
                      "flex items-center justify-center gap-2 py-3 rounded-xl border text-xs font-bold transition-all",
                      blockForm.type === 'day'
                        ? "bg-rose-500 text-white border-rose-500 shadow-md shadow-rose-200"
                        : "bg-white text-slate-600 border-slate-200 hover:border-rose-300"
                    )}>
                      <CalendarIcon className="w-4 h-4" /> Dia todo
                    </button>
                    <button type="button" onClick={() => setBlockForm(p => ({ ...p, type: 'time' }))} className={cn(
                      "flex items-center justify-center gap-2 py-3 rounded-xl border text-xs font-bold transition-all",
                      blockForm.type === 'time'
                        ? "bg-rose-500 text-white border-rose-500 shadow-md shadow-rose-200"
                        : "bg-white text-slate-600 border-slate-200 hover:border-rose-300"
                    )}>
                      <Clock className="w-4 h-4" /> Horário específico
                    </button>
                  </div>
                </div>

                {blockForm.type === 'time' && (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Início</label>
                        <input type="time" value={blockForm.start} onChange={e => setBlockForm(p => ({ ...p, start: e.target.value }))} className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-700 focus:outline-none focus:border-teal-400" />
                      </div>
                      <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Fim</label>
                        <input type="time" value={blockForm.end} onChange={e => setBlockForm(p => ({ ...p, end: e.target.value }))} className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-700 focus:outline-none focus:border-teal-400" />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Motivo (opcional)</label>
                      <input type="text" value={blockForm.name} onChange={e => setBlockForm(p => ({ ...p, name: e.target.value }))} placeholder="Ex: Almoço, Reunião..." className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-700 focus:outline-none focus:border-teal-400 placeholder:text-slate-300" />
                    </div>
                  </>
                )}

                {/* Recorrência */}
                <div className="pt-2 border-t border-slate-100">
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Recorrência</label>
                  <div className="grid grid-cols-3 gap-2">
                    {([
                      { v: 'none' as const, label: 'Não repetir' },
                      { v: 'weekly' as const, label: 'Semanal' },
                      { v: 'monthly' as const, label: 'Mensal' },
                    ]).map(opt => (
                      <button
                        key={opt.v}
                        type="button"
                        onClick={() => setBlockForm(p => {
                          const next = { ...p, repeat: opt.v };
                          if (opt.v === 'weekly' && selectedDay && next.weekdays.length === 0) {
                            next.weekdays = [new Date(`${selectedDay}T00:00:00`).getDay()];
                          }
                          if (opt.v !== 'none' && !next.until) {
                            const d = new Date(`${selectedDay || new Date().toISOString().split('T')[0]}T00:00:00`);
                            d.setMonth(d.getMonth() + 3);
                            next.until = d.toISOString().split('T')[0];
                          }
                          return next;
                        })}
                        className={cn(
                          "py-2 rounded-xl border text-xs font-bold transition-all",
                          blockForm.repeat === opt.v
                            ? "bg-teal-600 text-white border-teal-600 shadow-md shadow-teal-100"
                            : "bg-white text-slate-600 border-slate-200 hover:border-teal-300"
                        )}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>

                  {blockForm.repeat !== 'none' && (
                    <div className="mt-3 space-y-3 p-3 bg-slate-50 border border-slate-100 rounded-xl">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-500">Repetir a cada</span>
                        <input
                          type="number"
                          min={1}
                          max={12}
                          value={blockForm.interval}
                          onChange={e => setBlockForm(p => ({ ...p, interval: Math.max(1, Number(e.target.value) || 1) }))}
                          className="w-14 px-2 py-1 bg-white border border-slate-200 rounded-lg text-sm font-bold text-center"
                        />
                        <span className="text-xs font-bold text-slate-500">{blockForm.repeat === 'weekly' ? (blockForm.interval > 1 ? 'semanas' : 'semana') : (blockForm.interval > 1 ? 'meses' : 'mês')}</span>
                      </div>

                      {blockForm.repeat === 'weekly' && (
                        <div>
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Dias da semana</p>
                          <div className="flex gap-1.5">
                            {['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((letter, idx) => (
                              <button
                                key={idx}
                                type="button"
                                onClick={() => setBlockForm(p => ({
                                  ...p,
                                  weekdays: p.weekdays.includes(idx)
                                    ? p.weekdays.filter(d => d !== idx)
                                    : [...p.weekdays, idx].sort()
                                }))}
                                className={cn(
                                  "w-8 h-8 rounded-full text-xs font-bold border transition-all",
                                  blockForm.weekdays.includes(idx)
                                    ? "bg-teal-600 text-white border-teal-600"
                                    : "bg-white text-slate-500 border-slate-200 hover:border-teal-300"
                                )}
                              >
                                {letter}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {blockForm.repeat === 'monthly' && selectedDay && (() => {
                        const d = new Date(`${selectedDay}T00:00:00`);
                        const dayOfMonth = d.getDate();
                        const weekday = d.getDay();
                        const nth = Math.ceil(dayOfMonth / 7); // 1..5
                        const NTH_LABELS = ['1ª', '2ª', '3ª', '4ª', '5ª'];
                        const WEEKDAY_FULL = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
                        return (
                          <div className="space-y-1.5">
                            <button
                              type="button"
                              onClick={() => setBlockForm(p => ({ ...p, monthlyMode: 'day_of_month' }))}
                              className={cn(
                                "w-full px-3 py-2 rounded-lg border text-xs font-bold text-left transition-all",
                                blockForm.monthlyMode === 'day_of_month'
                                  ? "bg-teal-600 text-white border-teal-600"
                                  : "bg-white text-slate-600 border-slate-200 hover:border-teal-300"
                              )}
                            >
                              Mensal no dia {dayOfMonth}
                            </button>
                            <button
                              type="button"
                              onClick={() => setBlockForm(p => ({ ...p, monthlyMode: 'nth_weekday' }))}
                              className={cn(
                                "w-full px-3 py-2 rounded-lg border text-xs font-bold text-left transition-all",
                                blockForm.monthlyMode === 'nth_weekday'
                                  ? "bg-teal-600 text-white border-teal-600"
                                  : "bg-white text-slate-600 border-slate-200 hover:border-teal-300"
                              )}
                            >
                              Mensal na {NTH_LABELS[nth - 1]} {WEEKDAY_FULL[weekday]}
                            </button>
                          </div>
                        );
                      })()}

                      <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Repetir até</label>
                        <input
                          type="date"
                          value={blockForm.until}
                          min={selectedDay || undefined}
                          onChange={e => setBlockForm(p => ({ ...p, until: e.target.value }))}
                          className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm font-bold text-slate-700"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex gap-3 p-6 border-t border-slate-100 bg-slate-50">
                <Button variant="outline" className="flex-1" onClick={() => setShowBlockModal(false)}>Cancelar</Button>
                <Button variant="destructive" className="flex-1" onClick={handleSubmitBlock} disabled={!blockForm.doctor_id || submittingBlock}>
                  {submittingBlock ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Trash2 className="w-4 h-4 mr-2" />}
                  Bloquear
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Status dropdown — rendered outside card to escape overflow-hidden */}
      {openStatusApt && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpenStatusApt(null)} />
          <div
            className="fixed z-50 bg-white border border-slate-200 rounded-xl shadow-lg py-1 min-w-[150px]"
            style={{ top: openStatusApt.top, left: openStatusApt.left }}
          >
            {Object.entries(statusLabel).map(([val, lbl]) => {
              const apt = filteredAppointments.find(a => a.id === openStatusApt.id);
              if (!apt) return null;
              return (
                <button
                  key={val}
                  onClick={() => handleInlineStatus(apt, val)}
                  className={cn(
                    "w-full text-left flex items-center gap-2 px-3 py-1.5 text-xs font-semibold hover:bg-slate-50 transition-colors",
                    val === apt.status ? "text-teal-600" : "text-slate-700"
                  )}
                >
                  {val === apt.status && <Check className="w-3 h-3" />}
                  {val !== apt.status && <span className="w-3" />}
                  {lbl}
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* Realizado value dialog */}
      <AnimatePresence>
        {realizadoDialog && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-base font-bold text-slate-900">Registrar Consulta Realizada</h3>
                  <p className="text-slate-500 text-sm">{realizadoDialog.apt.patient?.name}</p>
                </div>
                <button onClick={() => setRealizadoDialog(null)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
              </div>

              <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
                {/* Valor */}
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">Valor</label>
                  <MoneyInput
                    value={Number(realizadoDialog.value) || 0}
                    onChange={v => setRealizadoDialog(prev => prev ? { ...prev, value: String(v) } : null)}
                    autoFocus
                  />
                </div>

                {/* Status */}
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">Status do pagamento</label>
                  <div className="flex gap-2">
                    {([{ value: 'pago', label: 'Pago' }, { value: 'pendente', label: 'Pendente' }] as const).map(s => (
                      <button key={s.value} type="button"
                        onClick={() => setRealizadoDialog(prev => prev ? { ...prev, status: s.value } : null)}
                        className={cn("px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all",
                          realizadoDialog.status === s.value ? "bg-teal-600 text-white border-teal-600" : "bg-white text-slate-600 border-slate-200 hover:border-teal-300"
                        )}>{s.label}</button>
                    ))}
                  </div>
                </div>

                {/* Forma de pagamento */}
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">Forma de pagamento</label>
                  <div className="flex flex-wrap gap-2">
                    {[{ value: 'pix', label: 'Pix' }, { value: 'cartao', label: 'Cartão' }, { value: 'dinheiro', label: 'Dinheiro' }, { value: 'plano', label: 'Plano' }].map(m => (
                      <button key={m.value} type="button"
                        onClick={() => setRealizadoDialog(prev => prev ? { ...prev, paymentMethod: prev.paymentMethod === m.value ? '' : m.value } : null)}
                        className={cn("px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all",
                          realizadoDialog.paymentMethod === m.value ? "bg-teal-600 text-white border-teal-600" : "bg-white text-slate-600 border-slate-200 hover:border-teal-300"
                        )}>{m.label}</button>
                    ))}
                  </div>
                </div>

                {/* Protocolos */}
                {protocols.filter(p => p.is_active).length > 0 && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">Protocolos</label>
                    <div className="flex flex-wrap gap-2">
                      {protocols.filter(p => p.is_active).map(p => {
                        const selected = realizadoDialog.protocolIds.includes(p.id);
                        return (
                          <button key={p.id} type="button"
                            onClick={() => setRealizadoDialog(prev => prev ? {
                              ...prev,
                              protocolIds: selected ? prev.protocolIds.filter(id => id !== p.id) : [...prev.protocolIds, p.id]
                            } : null)}
                            className={cn("px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all",
                              selected ? "bg-violet-600 text-white border-violet-600" : "bg-white text-slate-600 border-slate-200 hover:border-violet-300"
                            )}>
                            {p.name}{p.price ? ` · R$${Number(p.price).toLocaleString('pt-BR', { minimumFractionDigits: 0 })}` : ''}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Descrição */}
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">Descrição</label>
                  <textarea
                    placeholder="Observações sobre a consulta..."
                    value={realizadoDialog.description}
                    onChange={e => setRealizadoDialog(prev => prev ? { ...prev, description: e.target.value } : null)}
                    rows={2}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none"
                  />
                </div>
              </div>

              <div className="flex gap-2 mt-5">
                <Button variant="outline" className="flex-1" onClick={() => setRealizadoDialog(null)}>Cancelar</Button>
                <Button className="flex-1" onClick={handleConfirmRealizado}>
                  <Check className="w-4 h-4 mr-1.5" /> Confirmar
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function CalendarView({ currentMonth, setCurrentMonth, appointments, onDayClick, doctors = [] }: {
  currentMonth: Date;
  setCurrentMonth: (d: Date) => void;
  appointments: any[];
  onDayClick: (date: string) => void;
  doctors?: any[];
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
        {calendarDays.map((date) => {
          const formattedDate = format(date, 'yyyy-MM-dd');
          const dayApts = appointments.filter(apt => apt.date === formattedDate);
          const isCurrentMonth = isSameMonth(date, monthStart);
          const isTodayDate = isToday(date);

          // Médicos com dia inteiro bloqueado
          const blockedDayDoctors = doctors.filter(d => d.days_off?.includes(formattedDate));
          const isFullyBlocked = blockedDayDoctors.length > 0 && blockedDayDoctors.length === doctors.length;

          // Horários bloqueados de qualquer médico nesse dia
          const blockedTimesForDay = doctors.flatMap(d =>
            (d.blocked_times || [])
              .filter((bt: any) => bt.date === formattedDate)
              .map((bt: any) => ({ ...bt, doctorId: d.id, doctorName: d.name }))
          ).sort((a: any, b: any) => a.start.localeCompare(b.start));

          return (
            <div
              key={date.toString()}
              onClick={() => isCurrentMonth && onDayClick(formattedDate)}
              className={cn(
                "min-h-[90px] p-2 rounded-lg border transition-all cursor-pointer",
                !isCurrentMonth && "bg-slate-50/50 border-transparent opacity-40 cursor-default",
                isCurrentMonth && !isFullyBlocked && "bg-white border-slate-100 hover:border-teal-300 hover:shadow-md",
                isCurrentMonth && isFullyBlocked && "bg-rose-50 border-slate-100 hover:border-slate-200",
                isTodayDate && "ring-2 ring-teal-500/30 border-teal-500 shadow-sm"
              )}
            >
              {isFullyBlocked ? (
                <div className="relative w-full h-full min-h-[74px]">
                  <span className={cn("w-7 h-7 flex items-center justify-center rounded-md text-sm font-bold absolute top-0 left-0", isTodayDate ? "bg-teal-600 text-white" : "text-rose-300")}>
                    {format(date, 'd')}
                  </span>
                  <span className="absolute inset-0 flex items-center justify-center text-rose-300 text-2xl leading-none">⊘</span>
                </div>
              ) : (
                <>
                  <div className="flex justify-between items-start mb-1">
                    <span className={cn(
                      "w-7 h-7 flex items-center justify-center rounded-md text-sm font-bold",
                      isTodayDate ? "bg-teal-600 text-white" : "text-slate-400"
                    )}>
                      {format(date, 'd')}
                    </span>
                    <div className="flex gap-0.5 flex-wrap justify-end">
                      {Array.from(new Set(dayApts.map((a: any) => a.doctor_id))).map(docId => (
                        <span key={String(docId)} className={cn("w-2 h-2 rounded-full", getDoctorColor(String(docId)).dot)} />
                      ))}
                    </div>
                  </div>

                  <div className="space-y-1 mt-1">
                    {/* Dia parcialmente bloqueado (só alguns médicos) */}
                    {blockedDayDoctors.length > 0 && (
                      <div className="text-[10px] font-bold px-1.5 py-0.5 rounded truncate border bg-rose-50 text-rose-500 border-rose-100 flex items-center gap-1">
                        <span className="shrink-0">⊘</span>
                        <span className="truncate">{blockedDayDoctors.map((d: any) => d.name.split(' ')[0]).join(', ')}</span>
                      </div>
                    )}

                    {/* Horários bloqueados */}
                    {blockedTimesForDay.slice(0, 2).map((bt: any, i: number) => (
                      <div key={i} className="px-1.5 py-0.5 rounded border bg-rose-50 text-rose-600 border-rose-200 flex flex-col leading-tight">
                        {bt.name && <span className="text-[10px] font-black truncate">{bt.name}</span>}
                        <span className="text-[9px] font-semibold opacity-70 truncate">⊘ {bt.start}–{bt.end}</span>
                      </div>
                    ))}
                    {blockedTimesForDay.length > 2 && (
                      <div className="text-[10px] font-bold text-rose-400">+{blockedTimesForDay.length - 2} bloq.</div>
                    )}

                    {/* Agendamentos */}
                    {dayApts.slice(0, Math.max(0, 3 - Math.min(2, blockedTimesForDay.length))).map((apt: any) => {
                      const docColor = getDoctorColor(apt.doctor_id);
                      return (
                        <div key={apt.id} className={cn(
                          "text-[10px] font-bold px-1.5 py-0.5 rounded truncate border",
                          docColor.bg, docColor.text, docColor.border
                        )}>
                          {apt.time?.substring(0, 5)} - {apt.patient?.name?.split(' ')[0] || '?'}
                        </div>
                      );
                    })}
                    {dayApts.length > 3 && <div className="text-[10px] font-bold text-slate-400">+{dayApts.length - 3} mais</div>}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
