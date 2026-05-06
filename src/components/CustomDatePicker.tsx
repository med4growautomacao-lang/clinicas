import React, { useState, useRef, useEffect, useCallback } from "react";
import { DayPicker } from "react-day-picker";
import { ptBR } from "date-fns/locale";
import { format, parseISO } from "date-fns";
import { CalendarDays } from "lucide-react";
import { cn } from "@/src/lib/utils";

interface CustomDatePickerProps {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  placeholder?: string;
  align?: "left" | "right";
}

export function CustomDatePicker({
  value,
  onChange,
  label,
  placeholder = "dd/mm/aaaa",
  align = "right",
}: CustomDatePickerProps) {
  const [open, setOpen] = useState(false);
  const [popupPos, setPopupPos] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  const selected = value ? parseISO(value) : undefined;

  const openPopup = useCallback(() => {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const left = align === "left" ? rect.left : rect.right - 280;
    setPopupPos({ top: rect.bottom + 6, left });
    setOpen(true);
  }, [align]);

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

  return (
    <>
      <div className="relative w-full">
        {label && (
          <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 ml-1">
            {label}
          </label>
        )}
        <button
          ref={buttonRef}
          type="button"
          onClick={() => open ? setOpen(false) : openPopup()}
          className={cn(
            "w-full flex items-center gap-3 px-4 py-3 bg-slate-50 border transition-all rounded-xl text-left",
            open
              ? "border-teal-400 ring-4 ring-teal-100/30 bg-white shadow-sm"
              : "border-slate-200 hover:border-slate-300"
          )}
        >
          <CalendarDays className={cn("w-4 h-4 transition-colors", open || value ? "text-teal-500" : "text-slate-400")} />
          <span className={cn("flex-1 text-sm font-bold truncate", value ? "text-slate-700" : "text-slate-400")}>
            {selected ? format(selected, "dd/MM/yyyy") : placeholder}
          </span>
        </button>
      </div>

      {open && popupPos && (
        <div
          ref={popupRef}
          className="fixed z-[200] bg-white border border-slate-100 rounded-2xl shadow-2xl p-3 rdp-custom"
          style={{ top: popupPos.top, left: popupPos.left }}
        >
          <DayPicker
            mode="single"
            selected={selected}
            onSelect={(day) => {
              if (day) { onChange(format(day, "yyyy-MM-dd")); setOpen(false); }
            }}
            locale={ptBR}
            weekStartsOn={0}
          />
        </div>
      )}
    </>
  );
}
