import type { ReactNode } from "react";
import { Calendar, ChevronRight } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { DayPicker } from "react-day-picker";
import "react-day-picker/dist/style.css";
import { ptBR } from "date-fns/locale";
import { cn } from "../../lib/utils";

// Gatilho (ícone + label + range) + popup com coluna de presets e 2 calendários.
// Presentational: estado (open, datas, presets) vive em cada dashboard.
// `footer` é opcional — usado pelo Marketing para o bloco de período comparativo.

type DateRange = { from?: Date; to?: Date } | undefined;

export function DateRangePopover({
  valueLabel,
  rangeText,
  presets,
  activeLabel,
  onPreset,
  selected,
  onSelect,
  month1,
  setMonth1,
  month2,
  setMonth2,
  open,
  setOpen,
  presetsTitle = "Período",
  align = "right",
  footer,
}: {
  valueLabel: string;
  rangeText: string;
  presets: { id: string; label: string }[];
  activeLabel: string;
  onPreset: (id: string) => void;
  selected: DateRange;
  onSelect: (range: DateRange) => void;
  month1: Date;
  setMonth1: (d: Date) => void;
  month2: Date;
  setMonth2: (d: Date) => void;
  open: boolean;
  setOpen: (v: boolean) => void;
  presetsTitle?: string;
  align?: "left" | "right";
  footer?: ReactNode;
}) {
  return (
    <div className="relative">
      <div
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-xl hover:bg-slate-50 cursor-pointer transition-all border border-transparent hover:border-slate-200 group"
      >
        <Calendar className={cn("w-4 h-4 transition-colors", open ? "text-teal-600" : "text-slate-400 group-hover:text-teal-600")} />
        <span className="text-xs font-bold text-slate-600 uppercase tracking-tight">{valueLabel}</span>
        <span className="text-[10px] font-medium text-slate-400">{rangeText}</span>
        <ChevronRight className={cn("w-3.5 h-3.5 text-slate-300 transition-transform", open ? "rotate-90 text-teal-600" : "")} />
      </div>

      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-[105]" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              className={cn(
                "absolute top-full mt-3 bg-white rounded-2xl border border-slate-200 shadow-2xl z-[110] overflow-hidden rdp-custom flex",
                align === "right" ? "right-0" : "left-0"
              )}
            >
              <div className="w-44 border-r border-slate-100 p-2 flex flex-col gap-0.5 shrink-0">
                <span className="text-[9px] font-black text-slate-400 uppercase tracking-[2px] px-3 pt-1 pb-1.5">{presetsTitle}</span>
                {presets.map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => onPreset(opt.id)}
                    className={cn(
                      "text-left px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors",
                      activeLabel === opt.label.toUpperCase() ? "bg-teal-50 text-teal-700" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <div className="flex flex-col divide-y divide-slate-100">
                <div className="p-3">
                  <DayPicker mode="range" selected={selected as any} onSelect={onSelect as any} month={month1} onMonthChange={setMonth1} numberOfMonths={1} locale={ptBR} weekStartsOn={0} />
                </div>
                <div className="p-3">
                  <DayPicker mode="range" selected={selected as any} onSelect={onSelect as any} month={month2} onMonthChange={setMonth2} numberOfMonths={1} locale={ptBR} weekStartsOn={0} />
                </div>
                {footer}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
