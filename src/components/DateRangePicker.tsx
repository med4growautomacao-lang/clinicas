import React, { useState, useRef, useEffect, useCallback } from "react";
import { DayPicker, DateRange } from "react-day-picker";
import { ptBR } from "date-fns/locale";
import {
  format, parseISO, addMonths,
  subDays, startOfWeek, endOfWeek,
  startOfMonth, endOfMonth, subMonths, subWeeks,
} from "date-fns";
import { CalendarDays, X } from "lucide-react";
import { cn } from "@/src/lib/utils";

interface DateRangePickerProps {
  label?: string;
  from: string;
  to: string;
  onFromChange: (v: string) => void;
  onToChange: (v: string) => void;
  inline?: boolean;
  numberOfMonths?: number;
}

const QUICK_OPTIONS = [
  { id: "all",        label: "Todos" },
  { id: "today",      label: "Hoje" },
  { id: "yesterday",  label: "Ontem" },
  { id: "week",       label: "Esta Semana" },
  { id: "last_week",  label: "Semana Passada" },
  { id: "7days",      label: "Últimos 7 dias" },
  { id: "14days",     label: "Últimos 14 dias" },
  { id: "28days",     label: "Últimos 28 dias" },
  { id: "30days",     label: "Últimos 30 dias" },
  { id: "month",      label: "Este Mês" },
  { id: "last_month", label: "Mês Passado" },
];

function computeQuick(id: string): { from: Date; to: Date; label: string } {
  const today = new Date();
  let from = today, to = today, label = "";
  switch (id) {
    case "today":      label = "Hoje"; break;
    case "yesterday":  from = to = subDays(today, 1); label = "Ontem"; break;
    case "week":       from = startOfWeek(today, { weekStartsOn: 0 }); label = "Esta Semana"; break;
    case "last_week": {
      const lw = subWeeks(today, 1);
      from = startOfWeek(lw, { weekStartsOn: 0 });
      to   = endOfWeek(lw,   { weekStartsOn: 0 });
      label = "Semana Passada"; break;
    }
    case "7days":      from = subDays(today, 7);  to = subDays(today, 1); label = "Últimos 7 dias"; break;
    case "14days":     from = subDays(today, 14); to = subDays(today, 1); label = "Últimos 14 dias"; break;
    case "28days":     from = subDays(today, 28); to = subDays(today, 1); label = "Últimos 28 dias"; break;
    case "30days":     from = subDays(today, 30); to = subDays(today, 1); label = "Últimos 30 dias"; break;
    case "month":      from = startOfMonth(today); label = "Este Mês"; break;
    case "last_month": {
      const lm = subMonths(today, 1);
      from = startOfMonth(lm);
      to   = endOfMonth(lm);
      label = "Mês Passado"; break;
    }
  }
  return { from, to, label };
}

export function DateRangePicker({
  label,
  from,
  to,
  onFromChange,
  onToChange,
  inline = false,
  numberOfMonths = 2,
}: DateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const [popupPos, setPopupPos] = useState<{ top: number; left: number } | null>(null);
  const [activeLabel, setActiveLabel] = useState("");
  const [month1, setMonth1] = useState<Date>(() => (from ? parseISO(from) : new Date()));
  const [month2, setMonth2] = useState<Date>(() => addMonths(from ? parseISO(from) : new Date(), 1));
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popupRef  = useRef<HTMLDivElement>(null);

  const selected: DateRange | undefined =
    from || to
      ? { from: from ? parseISO(from) : undefined, to: to ? parseISO(to) : undefined }
      : undefined;

  const hasValue = !!(from || to);

  const displayText = () => {
    if (activeLabel) return activeLabel;
    if (from && to) return `${format(parseISO(from), "dd/MM/yy")} — ${format(parseISO(to), "dd/MM/yy")}`;
    if (from) return `A partir de ${format(parseISO(from), "dd/MM/yy")}`;
    if (to)   return `Até ${format(parseISO(to), "dd/MM/yy")}`;
    return "Qualquer período";
  };

  const openPopup = useCallback(() => {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    setPopupPos({ top: rect.bottom + 6, left: rect.left });
    setOpen(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (
        popupRef.current && !popupRef.current.contains(t) &&
        buttonRef.current && !buttonRef.current.contains(t)
      ) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleSelect = (range: DateRange | undefined) => {
    onFromChange(range?.from ? format(range.from, "yyyy-MM-dd") : "");
    onToChange(range?.to   ? format(range.to,   "yyyy-MM-dd") : "");
    setActiveLabel("");
  };

  const applyQuick = (id: string) => {
    if (id === "all") {
      onFromChange("");
      onToChange("");
      setActiveLabel("Todos");
      setOpen(false);
      return;
    }
    const { from: f, to: t, label: l } = computeQuick(id);
    onFromChange(format(f, "yyyy-MM-dd"));
    onToChange(format(t,   "yyyy-MM-dd"));
    setActiveLabel(l);
    setMonth1(f);
    setMonth2(addMonths(f, 1));
    setOpen(false);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onFromChange("");
    onToChange("");
    setActiveLabel("");
  };

  if (inline) {
    return (
      <div className="rdp-custom">
        <DayPicker
          mode="range"
          selected={selected}
          onSelect={handleSelect}
          numberOfMonths={numberOfMonths}
          locale={ptBR}
          weekStartsOn={0}
        />
      </div>
    );
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openPopup())}
        className={cn(
          "flex items-center gap-2 bg-white border rounded-xl px-3 shadow-sm transition-all h-full",
          open ? "border-teal-400 ring-2 ring-teal-100" : "border-slate-200 hover:border-slate-300",
        )}
      >
        <CalendarDays className="w-3.5 h-3.5 shrink-0 text-slate-400" />
        {label && (
          <div className="flex flex-col items-start leading-tight shrink-0">
            <span className="font-black text-[8px] uppercase tracking-wider text-slate-400">{label}</span>
            <span className={cn("font-bold text-[9px]", hasValue ? "text-slate-700" : "text-slate-400")}>
              {displayText()}
            </span>
          </div>
        )}
        {hasValue && (
          <X className="w-3 h-3 text-slate-400 hover:text-rose-500 shrink-0 transition-colors" onClick={handleClear} />
        )}
      </button>

      {open && popupPos && (
        <div
          ref={popupRef}
          className="fixed z-[200] bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden rdp-custom"
          style={{ top: popupPos.top, left: popupPos.left }}
        >
          <div className="flex">
            {/* Quick options */}
            <div className="w-44 border-r border-slate-100 p-2 flex flex-col gap-0.5 shrink-0">
              <span className="text-[9px] font-black text-slate-400 uppercase tracking-[2px] px-3 pt-1 pb-1.5">Período</span>
              {QUICK_OPTIONS.map(opt => (
                <button
                  key={opt.id}
                  onClick={() => applyQuick(opt.id)}
                  className={cn(
                    "text-left px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors",
                    activeLabel === opt.label
                      ? "bg-teal-50 text-teal-700"
                      : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Two stacked calendars */}
            <div className="flex flex-col divide-y divide-slate-100">
              <div className="p-3">
                <DayPicker
                  mode="range"
                  selected={selected}
                  onSelect={handleSelect}
                  month={month1}
                  onMonthChange={setMonth1}
                  numberOfMonths={1}
                  locale={ptBR}
                  weekStartsOn={0}
                />
              </div>
              <div className="p-3">
                <DayPicker
                  mode="range"
                  selected={selected}
                  onSelect={handleSelect}
                  month={month2}
                  onMonthChange={setMonth2}
                  numberOfMonths={1}
                  locale={ptBR}
                  weekStartsOn={0}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export { computeQuick, QUICK_OPTIONS };
