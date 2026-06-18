import { motion } from "framer-motion";
import { cn } from "../lib/utils";

export type TrendPoint = { label: string; value: number; value2?: number | null };

// Formatação dos rótulos (eixo Y, média e tooltip) conforme o tipo da métrica.
export function fmtByType(type?: string): (n: number) => string {
  switch (type) {
    case "currency":
      return (n) => `R$ ${n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, "") + "k" : n.toFixed(0)}`;
    case "percent":
      return (n) => `${n.toFixed(n < 10 ? 1 : 0)}%`;
    case "ratio":
      return (n) => `${n.toFixed(2)}x`;
    default:
      return (n) => `${Math.round(n)}`;
  }
}

// Gráfico de barras de tendência (mesma UI do Painel Comercial):
// régua de quantidade à esquerda (extremidades em negrito), linha de média,
// grade leve, barras em px e régua de datas embaixo (extremidades em negrito).
export function TrendBarChart({
  series,
  format = (n) => `${Math.round(n)}`,
  height = 200,
  maxLabels = 12,
}: {
  series: TrendPoint[];
  format?: (n: number) => string;
  height?: number;
  maxLabels?: number;
}) {
  const allVals = series.flatMap((d) => [d.value, ...(d.value2 != null ? [d.value2] : [])]);
  const maxVal = Math.max(...allVals, 1);
  const avgVal = series.length ? series.reduce((a, d) => a + d.value, 0) / series.length : 0;
  const labelStep = Math.max(1, Math.ceil(series.length / maxLabels));
  const hasCompare = series.some((d) => d.value2 != null);

  return (
    <div className="flex gap-2">
      {/* Régua de quantidade (eixo Y) */}
      <div className="flex flex-col justify-between items-end text-[14px] text-black tabular-nums shrink-0 w-14" style={{ height }}>
        <span className="font-black">{format(maxVal)}</span>
        <span className="font-normal">{format(maxVal / 2)}</span>
        <span className="font-black">{format(0)}</span>
      </div>
      {/* Plotagem + régua de datas */}
      <div className="flex-1 min-w-0">
        <div className="relative" style={{ height }}>
          {/* grade */}
          <div className="absolute inset-x-0 top-0 border-t border-slate-100" />
          <div className="absolute inset-x-0 border-t border-slate-100" style={{ top: height / 2 }} />
          <div className="absolute inset-x-0 bottom-0 border-t border-slate-200" />
          {/* linha de média */}
          {avgVal > 0 && (
            <div className="absolute inset-x-0 z-20 pointer-events-none" style={{ bottom: (avgVal / maxVal) * height }}>
              <div className="border-t border-dashed border-teal-500/60" />
              <span className="absolute right-0 -top-3 text-[11px] font-extrabold text-black bg-white/90 px-1 rounded">méd {format(avgVal)}</span>
            </div>
          )}
          {/* barras */}
          <div className="absolute inset-0 flex items-end gap-1">
            {series.map((d, i) => (
              <div key={`${d.label}-${i}`} className="flex-1 flex items-end justify-center gap-0.5 group min-w-0 h-full">
                <motion.div
                  initial={{ height: 0 }}
                  animate={{ height: Math.max((d.value / maxVal) * height, d.value > 0 ? 4 : 1) }}
                  transition={{ delay: i * 0.02, duration: 0.5 }}
                  className={cn(
                    "bg-gradient-to-t from-teal-500/30 to-teal-500/10 group-hover:from-teal-500/50 group-hover:to-teal-500/20 rounded-t-md relative flex justify-center border-t-2 border-teal-500",
                    hasCompare ? "flex-1" : "w-full"
                  )}
                >
                  <div className="absolute -top-7 opacity-0 group-hover:opacity-100 transition-opacity bg-slate-900 text-white text-[10px] font-bold px-2 py-1 rounded whitespace-nowrap z-30">{format(d.value)}</div>
                </motion.div>
                {hasCompare && d.value2 != null && (
                  <motion.div
                    initial={{ height: 0 }}
                    animate={{ height: Math.max((d.value2 / maxVal) * height, d.value2 > 0 ? 4 : 1) }}
                    transition={{ delay: i * 0.02, duration: 0.5 }}
                    className="flex-1 bg-slate-200 group-hover:bg-slate-300 rounded-t-md border-t-2 border-slate-300"
                  />
                )}
              </div>
            ))}
          </div>
        </div>
        {/* Régua de datas (eixo X) */}
        <div className="flex gap-1 mt-1.5">
          {series.map((d, i) => (
            <div key={`lbl-${d.label}-${i}`} className="flex-1 min-w-0 text-center">
              {(i % labelStep === 0 || i === series.length - 1) && (
                <span className={cn("block text-[13px] text-black tracking-tight whitespace-nowrap", i === 0 || i === series.length - 1 ? "font-black" : "font-normal")}>{d.label}</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
