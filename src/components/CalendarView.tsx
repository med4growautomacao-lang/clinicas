import React from "react";
import {
  format, startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  eachDayOfInterval, isSameMonth, isToday, addMonths, subMonths
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "./ui/button";
import { cn } from "@/src/lib/utils";

export const DOCTOR_COLORS = [
  { bg: "bg-teal-50",   text: "text-teal-700",   border: "border-teal-100",   dot: "bg-teal-500",   primary: "text-teal-600",   badge: "bg-teal-100/50 text-teal-700"   },
  { bg: "bg-indigo-50", text: "text-indigo-700", border: "border-indigo-100", dot: "bg-indigo-500", primary: "text-indigo-600", badge: "bg-indigo-100/50 text-indigo-700" },
  { bg: "bg-rose-50",   text: "text-rose-700",   border: "border-rose-100",   dot: "bg-rose-500",   primary: "text-rose-600",   badge: "bg-rose-100/50 text-rose-700"   },
  { bg: "bg-amber-50",  text: "text-amber-700",  border: "border-amber-100",  dot: "bg-amber-500",  primary: "text-amber-600",  badge: "bg-amber-100/50 text-amber-700"  },
  { bg: "bg-emerald-50",text: "text-emerald-700",border: "border-emerald-100",dot: "bg-emerald-500",primary: "text-emerald-600",badge: "bg-emerald-100/50 text-emerald-700"},
  { bg: "bg-violet-50", text: "text-violet-700", border: "border-violet-100", dot: "bg-violet-500", primary: "text-violet-600", badge: "bg-violet-100/50 text-violet-700" },
  { bg: "bg-sky-50",    text: "text-sky-700",    border: "border-sky-100",    dot: "bg-sky-500",    primary: "text-sky-600",    badge: "bg-sky-100/50 text-sky-700"    },
];

export function getDoctorColor(doctorId: string) {
  if (!doctorId) return DOCTOR_COLORS[0];
  const charSum = doctorId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return DOCTOR_COLORS[charSum % DOCTOR_COLORS.length];
}

export function CalendarView({ currentMonth, setCurrentMonth, appointments, onDayClick, doctors = [] }: {
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
        <Button variant="ghost" size="icon" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))} className="rounded-lg hover:bg-white">
          <ChevronLeft className="w-5 h-5 text-slate-600" />
        </Button>
        <h3 className="text-xl font-bold text-slate-900 capitalize">
          {format(currentMonth, 'MMMM yyyy', { locale: ptBR })}
        </h3>
        <Button variant="ghost" size="icon" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))} className="rounded-lg hover:bg-white">
          <ChevronRight className="w-5 h-5 text-slate-600" />
        </Button>
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

          const blockedDayDoctors = doctors.filter(d => d.days_off?.includes(formattedDate));
          const isFullyBlocked = blockedDayDoctors.length > 0 && blockedDayDoctors.length === doctors.length;

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
                "min-h-[90px] p-2 rounded-lg border transition-all",
                !isCurrentMonth && "bg-slate-50/50 border-transparent opacity-40 cursor-default",
                isCurrentMonth && !isFullyBlocked && "bg-white border-slate-100 hover:border-teal-300 hover:shadow-md cursor-pointer",
                isCurrentMonth && isFullyBlocked && "bg-rose-50 border-slate-100 hover:border-slate-200 cursor-pointer",
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
                    <span className={cn("w-7 h-7 flex items-center justify-center rounded-md text-sm font-bold", isTodayDate ? "bg-teal-600 text-white" : "text-slate-400")}>
                      {format(date, 'd')}
                    </span>
                    <div className="flex gap-0.5 flex-wrap justify-end">
                      {Array.from(new Set(dayApts.map((a: any) => a.doctor_id))).map(docId => (
                        <span key={String(docId)} className={cn("w-2 h-2 rounded-full", getDoctorColor(String(docId)).dot)} />
                      ))}
                    </div>
                  </div>
                  <div className="space-y-1 mt-1">
                    {blockedDayDoctors.length > 0 && (
                      <div className="text-[10px] font-bold px-1.5 py-0.5 rounded truncate border bg-rose-50 text-rose-500 border-rose-100 flex items-center gap-1">
                        <span className="shrink-0">⊘</span>
                        <span className="truncate">{blockedDayDoctors.map((d: any) => d.name.split(' ')[0]).join(', ')}</span>
                      </div>
                    )}
                    {blockedTimesForDay.slice(0, 2).map((bt: any, i: number) => (
                      <div key={i} className="px-1.5 py-0.5 rounded border bg-rose-50 text-rose-600 border-rose-200 flex flex-col leading-tight">
                        {bt.name && <span className="text-[10px] font-black truncate">{bt.name}</span>}
                        <span className="text-[9px] font-semibold opacity-70 truncate">⊘ {bt.start}–{bt.end}</span>
                      </div>
                    ))}
                    {blockedTimesForDay.length > 2 && (
                      <div className="text-[10px] font-bold text-rose-400">+{blockedTimesForDay.length - 2} bloq.</div>
                    )}
                    {dayApts.slice(0, Math.max(0, 3 - Math.min(2, blockedTimesForDay.length))).map((apt: any) => {
                      const docColor = getDoctorColor(apt.doctor_id);
                      return (
                        <div key={apt.id} className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded truncate border", docColor.bg, docColor.text, docColor.border)}>
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
