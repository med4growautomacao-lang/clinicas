import React, { useState, useRef, useEffect, useCallback } from "react";
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
  const [popupPos, setPopupPos] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

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

  const openPopup = useCallback(() => {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    setPopupPos({ top: rect.bottom + 6, left: rect.left });
    setOpen(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        popupRef.current && !popupRef.current.contains(target) &&
        buttonRef.current && !buttonRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleSelect = (range: DateRange | undefined) => {
    onFromChange(range?.from ? format(range.from, "yyyy-MM-dd") : "");
    onToChange(range?.to ? format(range.to, "yyyy-MM-dd") : "");
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onFromChange("");
    onToChange("");
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
        onClick={() => open ? setOpen(false) : openPopup()}
        className={cn(
          "flex items-center gap-2 bg-white border rounded-xl px-3 shadow-sm transition-all h-full",
          open ? "border-teal-400 ring-2 ring-teal-100" : "border-slate-200 hover:border-slate-300",
        )}
      >
        <CalendarDays className="w-3.5 h-3.5 shrink-0 text-slate-400" />
        {label && (
          <div className="flex flex-col items-start leading-tight shrink-0">
            <span className="font-black text-[8px] uppercase tracking-wider text-slate-400">
              {label}
            </span>
            <span className={cn("font-bold text-[9px]", hasValue ? "text-slate-700" : "text-slate-400")}>
              {displayText()}
            </span>
          </div>
        )}
        {hasValue && (
          <X
            className="w-3 h-3 text-slate-400 hover:text-rose-500 shrink-0 transition-colors"
            onClick={handleClear}
          />
        )}
      </button>

      {open && popupPos && (
        <div
          ref={popupRef}
          className="fixed z-[200] bg-white border border-slate-200 rounded-2xl shadow-2xl p-3 rdp-custom"
          style={{ top: popupPos.top, left: popupPos.left }}
        >
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
    </>
  );
}
