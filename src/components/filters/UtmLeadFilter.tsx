import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Filter, CheckCircle2 } from "lucide-react";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";

// Dimensões de UTM (no app, "UTM" = origem + nomes de campanha/conjunto/anúncio/termo,
// unificando Meta + Google). Mesmo conjunto usado no módulo de Marketing.
export const UTM_DIMENSIONS: { id: string; label: string }[] = [
  { id: 'utm_campaign', label: 'Campanha' },
  { id: 'utm_adset', label: 'Conjunto' },
  { id: 'utm_ad', label: 'Anúncio' },
  { id: 'utm_term', label: 'Termo' },
  { id: 'utm_source', label: 'Origem' },
];

export const NO_UTM_KEY = '__none__';

// Valor da dimensão UTM ativa em um LEAD. Nulo/vazio → NO_UTM_KEY ("Sem UTM").
export function leadUtmKey(lead: any, dim: string): string {
  let v: string | null | undefined;
  switch (dim) {
    case 'utm_source':   v = lead.source; break;
    case 'utm_campaign': v = lead.fb_campaign_name || lead.g_campaign_name; break;
    case 'utm_adset':    v = lead.fb_adset_name || lead.g_adset_name; break;
    case 'utm_ad':       v = lead.fb_ad_name || lead.g_ad_name; break;
    case 'utm_term':     v = lead.g_term_name; break;
    default:             v = null;
  }
  return (v === null || v === undefined || v === '') ? NO_UTM_KEY : String(v);
}

// Filtro de UTM no formato do seletor "Filtrar por motivo", com COMBINAÇÃO de dimensões:
// guarda seleções por dimensão (mapa) → E entre dimensões (Campanha X e Conjunto Y) e OU
// dentro de uma dimensão. Os chips alternam qual dimensão está em edição; as seleções de
// cada dimensão são preservadas. Controlado pelo pai.
export function UtmLeadFilter({ dimension, onDimensionChange, options, filters, onChange }: {
  dimension: string;
  onDimensionChange: (d: string) => void;
  options: { key: string; label: string; value: number }[];
  filters: Record<string, string[]>;
  onChange: (f: Record<string, string[]>) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');

  const selected = filters[dimension] || [];
  const totalSelected = Object.values(filters).reduce((a, arr) => a + (arr?.length || 0), 0);

  const filtered = useMemo(
    () => options.filter(o => o.label.toLowerCase().includes(query.toLowerCase())),
    [options, query]
  );

  const toggle = (key: string) => {
    const cur = filters[dimension] || [];
    const next = cur.includes(key) ? cur.filter(k => k !== key) : [...cur, key];
    const f = { ...filters };
    if (next.length) f[dimension] = next; else delete f[dimension];
    onChange(f);
  };
  const clearDimension = () => {
    const f = { ...filters };
    delete f[dimension];
    onChange(f);
  };

  const summary = totalSelected === 0 ? 'Filtrar por UTM' : `${totalSelected} selecionada(s)`;

  return (
    <div className="relative">
      <Button
        onClick={() => setIsOpen(!isOpen)}
        variant="outline"
        className={cn(
          "rounded-xl h-8 gap-1.5 text-[10px] font-bold uppercase transition-all shadow-sm px-2.5",
          isOpen || totalSelected > 0 ? "bg-teal-50 border-teal-200 text-teal-600 shadow-teal-100" : "border-slate-200 bg-white hover:bg-slate-50 text-slate-600"
        )}
      >
        <Filter className="w-3.5 h-3.5" />
        {summary}
      </Button>

      <AnimatePresence>
        {isOpen && (
          <>
            <div className="fixed inset-0 z-[105]" onClick={() => setIsOpen(false)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="absolute top-full left-0 mt-2 w-72 bg-white rounded-2xl border border-slate-200 shadow-2xl z-[110] p-3 overflow-hidden"
            >
              {/* Dimensão da UTM (o ponto indica que já há valores escolhidos nessa dimensão) */}
              <div className="flex flex-wrap gap-1 mb-2">
                {UTM_DIMENSIONS.map(d => {
                  const count = filters[d.id]?.length || 0;
                  return (
                    <button
                      key={d.id}
                      onClick={() => onDimensionChange(d.id)}
                      className={cn(
                        "flex items-center gap-1 px-2 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all",
                        dimension === d.id ? "bg-slate-900 text-white" : "text-slate-400 hover:text-slate-600 hover:bg-slate-50"
                      )}
                    >
                      {d.label}
                      {count > 0 && (
                        <span className={cn("min-w-[14px] h-[14px] px-1 rounded-full text-[8px] font-black flex items-center justify-center", dimension === d.id ? "bg-white/25 text-white" : "bg-teal-100 text-teal-700")}>{count}</span>
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center justify-between mb-2">
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest pl-1">Valores</p>
                {selected.length > 0 && (
                  <button onClick={clearDimension} className="text-[9px] font-bold text-teal-600 hover:underline uppercase tracking-tight">Limpar dimensão</button>
                )}
              </div>
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Buscar..."
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs text-slate-700 mb-2 focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 outline-none transition-all placeholder:text-slate-300"
              />
              <div className="max-h-64 overflow-y-auto custom-scrollbar space-y-1">
                {filtered.length === 0 ? (
                  <p className="text-[10px] text-slate-400 px-2 py-2">Nenhum valor encontrado.</p>
                ) : filtered.map(o => (
                  <button
                    key={o.key}
                    onClick={() => toggle(o.key)}
                    className={cn(
                      "w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl text-[10px] font-bold transition-all",
                      selected.includes(o.key) ? "bg-teal-50 text-teal-700" : "text-slate-500 hover:bg-slate-50 hover:text-slate-600"
                    )}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      {selected.includes(o.key) && <CheckCircle2 className="w-3 h-3 shrink-0" />}
                      <span className="truncate" title={o.label}>{o.label}</span>
                    </span>
                    <span className="tabular-nums text-slate-400 shrink-0">{o.value}</span>
                  </button>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
