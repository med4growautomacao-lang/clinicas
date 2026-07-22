import React, { useState, useRef, useEffect, useCallback } from "react";
import { ChevronRight, Check } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

const MENU_MAX_H = 250;

interface Option {
  value: string;
  label: string;
  icon?: any;
}

interface CustomDropdownProps {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  icon?: any;
  label?: string;
}

export function CustomDropdown({ 
  options, 
  value, 
  onChange, 
  placeholder = "Selecione...", 
  icon: Icon,
  label 
}: CustomDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  // Posição em coordenadas de viewport: o menu é `fixed`, senão um modal com
  // corpo rolável (overflow-y-auto) corta a lista.
  const [pos, setPos] = useState<{ top: number; left: number; width: number; maxH: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const selectedOption = options.find(opt => opt.value === value);

  const place = useCallback(() => {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom - 8;
    const above = rect.top - 8;
    // Abre para cima quando não cabe embaixo e há mais espaço acima.
    const flip = below < Math.min(MENU_MAX_H, 160) && above > below;
    const maxH = Math.min(MENU_MAX_H, Math.max(flip ? above : below, 120));
    setPos({
      top: flip ? rect.top - 8 - maxH : rect.bottom + 8,
      left: rect.left,
      width: rect.width,
      maxH,
    });
  }, []);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Reposiciona enquanto aberto. `capture` pega o scroll do corpo do modal também.
  useEffect(() => {
    if (!isOpen) return;
    const onScrollOrResize = () => place();
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [isOpen, place]);

  return (
    <div className="relative w-full" ref={containerRef}>
      {label && (
        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 ml-1">
          {label}
        </label>
      )}
      
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          if (isOpen) { setIsOpen(false); return; }
          place();
          setIsOpen(true);
        }}
        className={cn(
          "w-full flex items-center gap-3 px-4 py-3 bg-slate-50 border transition-all duration-300 rounded-xl text-left",
          isOpen 
            ? "border-teal-400 ring-4 ring-teal-100/30 bg-white shadow-sm" 
            : "border-slate-200 hover:border-slate-300"
        )}
      >
        {Icon && (
          <Icon className={cn(
            "w-4 h-4 transition-colors duration-300",
            isOpen || value ? "text-teal-500" : "text-slate-400"
          )} />
        )}
        
        <span className={cn(
          "flex-1 text-sm font-bold truncate",
          value ? "text-slate-700" : "text-slate-400"
        )}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>

        <ChevronRight className={cn(
          "w-4 h-4 text-slate-300 transition-transform duration-300",
          isOpen ? "rotate-90 text-teal-500" : "rotate-0"
        )} />
      </button>

      <AnimatePresence>
        {isOpen && pos && (
          <motion.div
            initial={{ opacity: 0, y: 5, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 5, scale: 0.98 }}
            style={{ top: pos.top, left: pos.left, width: pos.width, maxHeight: pos.maxH }}
            className="fixed bg-white border border-slate-100 rounded-xl shadow-2xl z-[210] py-2 overflow-y-auto custom-scrollbar"
          >
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  onChange(option.value);
                  setIsOpen(false);
                }}
                className={cn(
                  "w-full px-4 py-2.5 flex items-center justify-between hover:bg-teal-50/50 transition-colors text-left",
                  value === option.value && "bg-teal-50"
                )}
              >
                <div className="flex items-center gap-3">
                  {option.icon && <option.icon className={cn("w-4 h-4", value === option.value ? "text-teal-600" : "text-slate-400")} />}
                  <span className={cn(
                    "text-sm font-bold transition-colors",
                    value === option.value ? "text-teal-700" : "text-slate-600"
                  )}>
                    {option.label}
                  </span>
                </div>
                {value === option.value && (
                  <Check className="w-4 h-4 text-teal-600" />
                )}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
