import { cn } from "../../lib/utils";
import type { Period } from "../../lib/dateRange";

// Toggle de granularidade Dia / Semana / Mês (usado no gráfico de tendência).
// Borderless por padrão; o Comercial passa `className="border border-slate-200"`
// quando usa o toggle como pílula isolada. Visão Geral/Marketing o aninham dentro
// do mesmo container branco do calendário (sem borda própria).

export function GranularityToggle({
  period,
  onChange,
  className,
}: {
  period: Period;
  onChange: (p: Period) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex bg-slate-50 rounded-xl p-1", className)} title="Granularidade do gráfico de Tendências">
      {(["dia", "sem", "mês"] as Period[]).map((p) => (
        <button
          key={p}
          onClick={() => onChange(p)}
          className={cn(
            "px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all",
            period === p ? "bg-white text-teal-600 shadow-sm border border-slate-200" : "text-slate-400 hover:text-slate-600"
          )}
        >
          {p}
        </button>
      ))}
    </div>
  );
}
