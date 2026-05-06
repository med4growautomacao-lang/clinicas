import React, { useState, useRef, useEffect } from "react";
import { DayPicker, DateRange } from "react-day-picker";
import { ptBR } from "date-fns/locale";
import { format, parseISO } from "date-fns";
import { CalendarDays, X } from "lucide-react";
import { cn } from "@/src/lib/utils";

interface DateRangePickerProps {
  label?: string;
  labelColor?: string;
  from: string;
  to: string;
  onFromChange: (v: string) => void;
  onToChange: (v: string) => void;
  /** Render only the calendar (no trigger button) */
  inline?: boolean;
  numberOfMonths?: number;
}

export function DateRangePicker({
  label,
  labelColor,
  from,
  to,
  onFromChange,
  onToChange,
  inline = false,
  numberOfMonths = 2,
}: DateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selected: DateRange | undefined =
    from || to
      ? { from: from ? parseISO(from) : undefined, to: to ? parseISO(to) : undefined }
      : undefined;

  const hasValue = !!(from || to);

  const displayText = () => {
    if (from && to) return `${format(parseISO(from), "dd/MM/yy")} — ${format(parseISO(to), "dd/MM/yy")}`;
    if (from) return `A partir de ${format(parseISO(from), "dd/MM/yy")}`;
    if (to) return `Até ${format(parseISO(to), "dd/MM/yy")}`;
    return "Qualquer período";
  };

  useEffect(() => {
    if (inline) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [inline]);

  const handleSelect = (range: DateRange | undefined) => {
    onFromChange(range?.from ? format(range.from, "yyyy-MM-dd") : "");
    onToChange(range?.to ? format(range.to, "yyyy-MM-dd") : "");
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onFromChange("");
    onToChange("");
  };

  const picker = (
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

  if (inline) return picker;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        className={cn(
          "flex items-center gap-2 bg-white border rounded-xl px-3 py-1.5 shadow-sm transition-all text-xs font-medium",
          open ? "border-teal-400 ring-2 ring-teal-100" : "border-slate-200 hover:border-slate-300",
          hasValue ? "text-slate-700" : "text-slate-400"
        )}
      >
        <CalendarDays className={cn("w-3.5 h-3.5 shrink-0", labelColor || "text-slate-400")} />
        {label && (
          <span className={cn("font-black text-[10px] uppercase tracking-wider shrink-0", labelColor || "text-slate-400")}>
            {label}
          </span>
        )}
        <span className="text-slate-600 text-[11px]">{displayText()}</span>
        {hasValue && (
          <X
            className="w-3 h-3 text-slate-400 hover:text-rose-500 shrink-0 transition-colors"
            onClick={handleClear}
          />
        )}
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-2 z-[70] bg-white border border-slate-200 rounded-2xl shadow-2xl p-3 rdp-custom">
          <DayPicker
            mode="range"
            selected={selected}
            onSelect={handleSelect}
            numberOfMonths={numberOfMonths}
            locale={ptBR}
            weekStartsOn={0}
          />
        </div>
      )}
    </div>
  );
}
