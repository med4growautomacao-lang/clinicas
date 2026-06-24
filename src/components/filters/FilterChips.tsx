import type { LucideIcon } from "lucide-react";
import { cn } from "../../lib/utils";

// Grupo de pílulas de filtro genérico (origem, canal, agente, etc.).
// Cada dashboard passa as suas próprias `options` e handlers — o componente é só
// presentational, então dá pra ocultar/trocar opções em um módulo sem afetar os outros.

export type FilterChipOption = {
  id: string;
  label: string;
  logo?: string;     // caminho de imagem (Meta/Google/WhatsApp/Sem origem)
  icon?: LucideIcon; // ícone lucide (ex.: Users, Bot, FileText, Store)
};

export function FilterChips({
  options,
  value,
  onChange,
  className,
}: {
  options: FilterChipOption[];
  value: string;
  onChange: (id: string) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-1.5 bg-white p-1 rounded-xl border border-slate-200 shadow-sm", className)}>
      {options.map((opt) => {
        const active = value === opt.id;
        const Icon = opt.icon;
        return (
          <button
            key={opt.id}
            onClick={() => onChange(opt.id)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all",
              active ? "bg-slate-900 text-white shadow-md shadow-slate-200" : "text-slate-400 hover:text-slate-600 hover:bg-slate-50"
            )}
            style={active ? { backgroundColor: "#1e293b" } : {}}
          >
            {opt.logo && (
              <img
                src={opt.logo}
                alt={opt.label}
                className={cn("w-3 h-3 object-contain", active ? "brightness-0 invert" : "")}
              />
            )}
            {Icon && <Icon className="w-3 h-3" />}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
