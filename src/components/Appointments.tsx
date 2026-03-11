import React, { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import {
  Calendar as CalendarIcon,
  Clock,
  User,
  Filter,
  Bot,
  Phone,
  Plus,
  Search,
  ChevronRight,
  ChevronLeft,
  Activity,
  UserCheck,
  CalendarDays,
  Stethoscope,
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
  isToday
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { useAuth } from "../contexts/AuthContext";

const appointments = [
  ...Array.from({ length: 10 }).map((_, i) => ({
    id: i + 1,
    patient: ["Carlos Santos", "Ana Oliveira", "Lucas Lima", "Maria Eduarda", "Gabriel Souza", "Beatriz Rocha", "Mateus Costa", "Isabela Lima", "Davi Silva", "Sophia Mendes"][i],
    doctor: ["Dr. Carlos Eduardo", "Dra. Julia Souza", "Dr. Roberto Silva", "Dra. Patrícia Lima", "Dr. André Santos", "Dra. Fernanda Rocha", "Dr. Bruno Menezes", "Dra. Camila Alves", "Dr. Tiago Oliveira", "Dra. Beatriz Costa"][i],
    date: new Date(),
    dateLabel: "Hoje",
    time: `${9 + Math.floor(i / 2)}:${i % 2 === 0 ? "00" : "30"}`,
    status: i % 3 === 0 ? "Pendente" : "Confirmado",
    source: i % 2 === 0 ? "IA" : "Humano",
    avatarColor: ["bg-blue-50", "bg-yellow-50", "bg-purple-50", "bg-rose-50", "bg-emerald-50", "bg-orange-50", "bg-indigo-50", "bg-pink-50", "bg-teal-50", "bg-lime-50"][i],
  })),
  ...Array.from({ length: 40 }).map((_, i) => {
    const date = new Date();
    date.setDate(date.getDate() + (i - 20));
    if (isToday(date)) date.setDate(date.getDate() + 1);
    return {
      id: i + 11,
      patient: `Paciente ${i + 1}`,
      doctor: ["Dr. Carlos Eduardo", "Dra. Julia Souza", "Dr. Roberto Silva"][i % 3],
      date: date,
      dateLabel: format(date, "dd/MM"),
      time: "10:00",
      status: "Confirmado",
      source: "IA",
      avatarColor: "bg-slate-50",
    };
  }),
];

export function Appointments() {
  const { userRole } = useAuth();
  const [filter, setFilter] = useState("Todos");
  const [dateFilter, setDateFilter] = useState<"all" | "today">("all");
  const [viewMode, setViewMode] = useState<"list" | "calendar">("list");
  const [currentMonth, setCurrentMonth] = useState(new Date());

  // Simulating the doctor name for the logged-in doctor
  const loggedDoctorName = "Dr. Carlos Eduardo";

  const filteredAppointments = useMemo(() => {
    return appointments.filter((apt) => {
      const matchesDoctor = userRole === 'medico' 
        ? apt.doctor === loggedDoctorName
        : (filter === "Todos" || apt.doctor.includes(filter));
      
      const matchesDate = dateFilter === "today" ? isToday(apt.date) : true;
      return matchesDoctor && matchesDate;
    });
  }, [filter, dateFilter, userRole]);

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
        >
          <h2 className="text-3xl font-bold tracking-tight text-slate-900">
            {userRole === 'medico' ? 'Minha ' : 'Agenda de '}<span className="text-teal-600">Consultas</span>
          </h2>
          <p className="text-slate-500 font-medium text-base">
            {dateFilter === "today" ? "Consultas agendadas para hoje." : "Acompanhe todos os agendamentos."}
          </p>
        </motion.div>
        <Button className="py-5 px-6 group">
          <Plus className="w-5 h-5 mr-2 group-hover:rotate-90 transition-transform" />
          Nova Consulta
        </Button>
      </div>

      <Card className="border border-slate-200 shadow-sm overflow-hidden">
        <CardHeader className="border-b border-slate-200 pb-4 px-6 bg-slate-50/50">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-[200px]">
                <input
                  type="text"
                  placeholder="Buscar paciente..."
                  className="w-full pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-200 transition-all font-medium text-sm"
                />
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              </div>

              <div className="flex items-center gap-1 bg-white p-1 rounded-lg border border-slate-200">
                <button
                  onClick={() => setDateFilter("all")}
                  className={cn(
                    "px-3 py-1.5 text-xs font-semibold rounded-md transition-all",
                    dateFilter === "all" ? "bg-teal-600 text-white" : "text-slate-500 hover:text-slate-900"
                  )}
                >
                  Tudo
                </button>
                <button
                  onClick={() => setDateFilter("today")}
                  className={cn(
                    "px-3 py-1.5 text-xs font-semibold rounded-md transition-all",
                    dateFilter === "today" ? "bg-teal-600 text-white" : "text-slate-500 hover:text-slate-900"
                  )}
                >
                  Hoje
                </button>
              </div>

              {userRole !== 'medico' && (
                <div className="flex flex-wrap items-center gap-1 bg-white p-1 rounded-lg border border-slate-200 max-w-2xl">
                  {["Todos", ...Array.from(new Set(appointments.map(a => a.doctor)))].map((f) => (
                    <button
                      key={f}
                      onClick={() => setFilter(f)}
                      className={cn(
                        "px-2 py-1 text-[10px] font-semibold rounded-md transition-all whitespace-nowrap",
                        filter === f ? "bg-teal-600 text-white" : "text-slate-500 hover:text-slate-900 hover:bg-slate-50"
                      )}
                    >
                      {f === "Todos" ? "Todos" : f.split(' ')[0] + ' ' + (f.split(' ').length > 1 ? f.split(' ')[f.split(' ').length - 1] : '')}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex bg-white p-1 rounded-lg border border-slate-200 w-fit">
              <button
                onClick={() => setViewMode("list")}
                className={cn(
                  "px-4 py-1.5 text-xs font-semibold rounded-md transition-all",
                  viewMode === "list" ? "bg-teal-600 text-white" : "text-slate-500 hover:text-slate-900"
                )}
              >
                Lista
              </button>
              <button
                onClick={() => setViewMode("calendar")}
                className={cn(
                  "px-4 py-1.5 text-xs font-semibold rounded-md transition-all",
                  viewMode === "calendar" ? "bg-teal-600 text-white" : "text-slate-500 hover:text-slate-900"
                )}
              >
                Calendário
              </button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <AnimatePresence mode="wait">
            {viewMode === "list" ? (
              <motion.div
                key="list"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                transition={{ duration: 0.2 }}
                className="overflow-x-auto"
              >
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50">
                      <th className="px-6 py-3 font-semibold text-slate-600 uppercase tracking-wider text-[10px]">Paciente</th>
                      <th className="px-6 py-3 font-semibold text-slate-600 uppercase tracking-wider text-[10px]">Médico</th>
                      <th className="px-6 py-3 font-semibold text-slate-600 uppercase tracking-wider text-[10px]">Data</th>
                      <th className="px-6 py-3 font-semibold text-slate-600 uppercase tracking-wider text-[10px]">Origem</th>
                      <th className="px-6 py-3 font-semibold text-slate-600 uppercase tracking-wider text-[10px]">Status</th>
                      <th className="px-6 py-3 text-right"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredAppointments.map((apt, i) => (
                      <motion.tr
                        key={apt.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.03 }}
                        className="hover:bg-slate-50 group transition-all"
                      >
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center group-hover:scale-105 transition-transform", apt.avatarColor)}>
                              <User className="w-5 h-5 text-slate-600" />
                            </div>
                            <span className="font-semibold text-slate-800">
                              {apt.patient}
                            </span>
                          </div>
                        </td>
                        <td className="px-6 py-4 font-medium text-slate-600">
                          <div className="flex items-center gap-2">
                            <Stethoscope className="w-3.5 h-3.5 text-teal-600" />
                            {apt.doctor}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex flex-col">
                            <span className="flex items-center text-slate-700 font-semibold text-sm">
                              <CalendarIcon className="w-3.5 h-3.5 mr-2 text-teal-600" />
                              {apt.dateLabel}
                            </span>
                            <span className="flex items-center text-slate-400 font-medium text-xs mt-0.5">
                              <Clock className="w-3 h-3 mr-1.5" />
                              {apt.time}
                            </span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          {apt.source === "IA" ? (
                            <span className="inline-flex items-center text-[10px] font-semibold tracking-wider uppercase text-teal-700 bg-teal-50 px-2 py-1 rounded-md border border-teal-100">
                              <Bot className="w-3 h-3 mr-1" /> Assistente IA
                            </span>
                          ) : (
                            <span className="inline-flex items-center text-[10px] font-semibold tracking-wider uppercase text-slate-500 bg-slate-50 px-2 py-1 rounded-md border border-slate-100">
                              <Phone className="w-3 h-3 mr-1" /> Recepção
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <span
                            className={cn(
                              "inline-flex items-center rounded-md px-2.5 py-1 text-xs font-semibold",
                              apt.status === "Confirmado"
                                ? "bg-emerald-50 text-emerald-700 border border-emerald-100"
                                : apt.status === "Pendente"
                                  ? "bg-amber-50 text-amber-700 border border-amber-100"
                                  : "bg-rose-50 text-rose-600 border border-rose-100",
                            )}
                          >
                            {apt.status}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700"
                          >
                            <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                          </Button>
                        </td>
                      </motion.tr>
                    ))}
                  </tbody>
                </table>
              </motion.div>
            ) : (
              <motion.div
                key="calendar"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={{ duration: 0.2 }}
                className="p-6"
              >
                <CalendarView
                  currentMonth={currentMonth}
                  setCurrentMonth={setCurrentMonth}
                  appointments={filteredAppointments}
                />
              </motion.div>
            )}
          </AnimatePresence>

          <div className="p-4 bg-slate-50 flex items-center justify-between border-t border-slate-200">
            <p className="text-sm font-medium text-slate-400">
              Mostrando {filteredAppointments.length} agendamentos.
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="opacity-50" disabled>Anterior</Button>
              <Button size="sm" variant="outline" className="opacity-50" disabled>Próxima</Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function CalendarView({ currentMonth, setCurrentMonth, appointments: data }: {
  currentMonth: Date,
  setCurrentMonth: (d: Date) => void,
  appointments: any[]
}) {
  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(monthStart);
  const startDate = startOfWeek(monthStart, { weekStartsOn: 0 });
  const endDate = endOfWeek(monthEnd, { weekStartsOn: 0 });

  const calendarDays = eachDayOfInterval({
    start: startDate,
    end: endDate,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between bg-slate-50 p-3 rounded-lg border border-slate-200">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
          className="rounded-lg hover:bg-white"
        >
          <ChevronLeft className="w-5 h-5 text-slate-600" />
        </Button>
        <h3 className="text-xl font-bold text-slate-900 capitalize">
          {format(currentMonth, 'MMMM yyyy', { locale: ptBR })}
        </h3>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
          className="rounded-lg hover:bg-white"
        >
          <ChevronRight className="w-5 h-5 text-slate-600" />
        </Button>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map(day => (
          <div key={day} className="text-center py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            {day}
          </div>
        ))}
        {calendarDays.map((date, i) => {
          const dayApts = data.filter(apt => isSameDay(apt.date, date));
          const isCurrentMonth = isSameMonth(date, monthStart);
          const isTodayDate = isToday(date);

          return (
            <motion.div
              key={date.toString()}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: i * 0.005 }}
              className={cn(
                "min-h-[90px] p-2 rounded-lg border transition-all group cursor-pointer",
                isCurrentMonth ? "bg-white border-slate-100" : "bg-slate-50/50 border-transparent opacity-40",
                isTodayDate && "ring-2 ring-teal-500/30 border-teal-500 shadow-sm",
                dayApts.length > 0 && isCurrentMonth && "border-slate-200 hover:shadow-sm"
              )}
            >
              <div className="flex justify-between items-start mb-1">
                <span className={cn(
                  "w-7 h-7 flex items-center justify-center rounded-md text-sm font-bold",
                  isTodayDate ? "bg-teal-600 text-white" : "text-slate-400 group-hover:text-teal-600"
                )}>
                  {format(date, 'd')}
                </span>
                {dayApts.length > 0 && isCurrentMonth && (
                  <span className="w-2 h-2 rounded-full bg-teal-500"></span>
                )}
              </div>

              <div className="space-y-1 mt-1">
                {dayApts.map((apt) => (
                  <div
                    key={apt.id}
                    className={cn(
                      "text-[10px] font-semibold px-1.5 py-0.5 rounded truncate",
                      apt.status === "Confirmado" ? "bg-teal-50 text-teal-700" : "bg-amber-50 text-amber-700"
                    )}
                  >
                    {apt.time} - {apt.patient.split(' ')[0]}
                  </div>
                ))}
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
