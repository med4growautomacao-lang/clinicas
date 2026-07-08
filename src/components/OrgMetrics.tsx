import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { supabase } from "../lib/supabase";
import { cn } from "@/src/lib/utils";
import { matchesSearch } from "../lib/search";
import { DateRangePicker } from "./DateRangePicker";
import {
  Loader2, Building2, Users, CalendarCheck, Trophy, Wallet, Megaphone,
  ArrowUp, ArrowDown, ChevronDown, Check, Search, Percent, TrendingUp,
  DollarSign, Target, XCircle, SlidersHorizontal,
} from "lucide-react";

interface ClinicMetricRow {
  clinicId: string;
  clinicName: string;
  logoUrl: string | null;
  isActive: boolean;
  category: string | null;
  leads: number;
  patientsCaptured: number;
  sales: number;
  lost: number;
  revenue: number;
  investment: number;
  ticketMedio: number | null;
}

type Fmt = "number" | "currency" | "percent" | "ratio";

interface MetricDef {
  id: string;
  label: string;
  Icon: React.ElementType;
  color: string;
  valueColor?: string;
  format: Fmt;
  get: (r: ClinicMetricRow) => number | null;
}

function toISODate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatBRL(v: number) {
  return v.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 0,
    maximumFractionDigits: Math.abs(v) >= 1000 || v === 0 ? 0 : 2,
  });
}

function formatMetric(v: number | null, fmt: Fmt): string {
  if (v === null) return "—";
  if (fmt === "currency") return formatBRL(v);
  if (fmt === "percent") return `${v.toFixed(1).replace(".", ",")}%`;
  if (fmt === "ratio") return `${v.toFixed(2).replace(".", ",")}x`;
  return v.toLocaleString("pt-BR");
}

// Pacientes Captados = MAIOR valor entre a Agenda real e o funil (última entrada
// na etapa "agendado" por ticket), já resolvido no backend — cobre clínicas onde
// o card avança no Kanban sem o compromisso ser lançado na Agenda.
const METRICS: MetricDef[] = [
  { id: "leads",       label: "Leads Captados",                Icon: Users,          color: "text-violet-600 bg-violet-50",   format: "number",   get: r => r.leads },
  { id: "patients",    label: "Pacientes Captados",             Icon: CalendarCheck, color: "text-sky-600 bg-sky-50",         format: "number",   get: r => r.patientsCaptured },
  { id: "sales",       label: "Novas Consultas Realizadas",     Icon: Trophy,        color: "text-emerald-600 bg-emerald-50", valueColor: "text-emerald-600", format: "number", get: r => r.sales },
  { id: "lost",        label: "Perdidos",                       Icon: XCircle,       color: "text-rose-600 bg-rose-50",       valueColor: "text-rose-500",    format: "number", get: r => r.lost },
  { id: "conversion",  label: "Taxa de Conversão",              Icon: Percent,       color: "text-indigo-600 bg-indigo-50",   format: "percent",  get: r => r.leads > 0 ? (r.sales / r.leads) * 100 : null },
  { id: "revenue",     label: "Faturamento",                    Icon: Wallet,        color: "text-teal-600 bg-teal-50",       format: "currency", get: r => r.revenue },
  { id: "investment",  label: "Investimento Geral (Google/Meta)", Icon: Megaphone,   color: "text-amber-600 bg-amber-50",     format: "currency", get: r => r.investment },
  { id: "roas",        label: "ROAS",                           Icon: TrendingUp,    color: "text-fuchsia-600 bg-fuchsia-50", format: "ratio",    get: r => r.investment > 0 ? r.revenue / r.investment : null },
  { id: "ticketMedio", label: "Ticket Médio",                   Icon: DollarSign,    color: "text-blue-600 bg-blue-50",       format: "currency", get: r => r.ticketMedio },
  { id: "cpa",         label: "Custo por Conversão",            Icon: Target,        color: "text-orange-600 bg-orange-50",   format: "currency", get: r => r.sales > 0 ? r.investment / r.sales : null },
];

const DEFAULT_VISIBLE = METRICS.map(m => m.id);

export function OrgMetrics() {
  const [rows, setRows] = useState<ClinicMetricRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState(() => toISODate(new Date(new Date().getFullYear(), new Date().getMonth(), 1)));
  const [dateTo, setDateTo] = useState(() => toISODate(new Date()));
  const [showInactive, setShowInactive] = useState(false);
  const [sortKey, setSortKey] = useState<string>("leads");
  const [sortDesc, setSortDesc] = useState(true);

  // Seleção de clientes (vazio = todos); persiste entre sessões
  const [selectedIds, setSelectedIds] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("orgMetricsClinics") || "[]"); } catch { return []; }
  });
  const [clinicMenuOpen, setClinicMenuOpen] = useState(false);
  const [clinicQuery, setClinicQuery] = useState("");
  const clinicMenuRef = useRef<HTMLDivElement>(null);

  // Métricas visíveis (cards + colunas da tabela); persiste entre sessões
  const [visibleMetrics, setVisibleMetrics] = useState<string[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("orgMetricsVisible") || "null");
      return Array.isArray(saved) ? saved.filter((id: string) => DEFAULT_VISIBLE.includes(id)) : DEFAULT_VISIBLE;
    } catch { return DEFAULT_VISIBLE; }
  });
  const [metricsMenuOpen, setMetricsMenuOpen] = useState(false);
  const metricsMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!clinicMenuOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (clinicMenuRef.current && !clinicMenuRef.current.contains(e.target as Node)) {
        setClinicMenuOpen(false);
        setClinicQuery("");
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [clinicMenuOpen]);

  useEffect(() => {
    if (!metricsMenuOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (metricsMenuRef.current && !metricsMenuRef.current.contains(e.target as Node)) {
        setMetricsMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [metricsMenuOpen]);

  const toggleMetric = (id: string) => {
    setVisibleMetrics(prev => {
      const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
      localStorage.setItem("orgMetricsVisible", JSON.stringify(next));
      return next;
    });
  };

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("get_org_clinics_metrics", {
      p_date_from: dateFrom || null,
      p_date_to: dateTo || null,
    });
    if (!error && Array.isArray(data)) {
      setRows((data as any[]).map(r => ({
        clinicId: r.clinicId,
        clinicName: r.clinicName,
        logoUrl: r.logoUrl,
        isActive: r.isActive !== false,
        category: r.category,
        leads: Number(r.leads || 0),
        patientsCaptured: Number(r.patientsCaptured || 0),
        sales: Number(r.sales || 0),
        lost: Number(r.lost || 0),
        revenue: Number(r.revenue || 0),
        investment: Number(r.investment || 0),
        ticketMedio: r.ticketMedio != null ? Number(r.ticketMedio) : null,
      })));
    }
    setLoading(false);
  }, [dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);

  const visible = useMemo(
    () => rows.filter(r =>
      (showInactive || r.isActive) &&
      (selectedIds.length === 0 || selectedIds.includes(r.clinicId))
    ),
    [rows, showInactive, selectedIds]
  );

  const toggleClinic = (id: string) => {
    setSelectedIds(prev => {
      const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
      localStorage.setItem("orgMetricsClinics", JSON.stringify(next));
      return next;
    });
  };

  const clearClinicSelection = () => {
    setSelectedIds([]);
    localStorage.setItem("orgMetricsClinics", "[]");
  };

  // Lista do dropdown: respeita o toggle de inativas + busca
  const clinicOptions = useMemo(
    () => rows.filter(r =>
      (showInactive || r.isActive) &&
      matchesSearch(clinicQuery, { name: r.clinicName })
    ),
    [rows, showInactive, clinicQuery]
  );
  const selectedCount = useMemo(
    () => rows.filter(r => selectedIds.includes(r.clinicId)).length,
    [rows, selectedIds]
  );

  const activeMetrics = useMemo(() => METRICS.filter(m => visibleMetrics.includes(m.id)), [visibleMetrics]);
  const sortMetric = useMemo(() => METRICS.find(m => m.id === sortKey) ?? METRICS[0], [sortKey]);

  const sorted = useMemo(() => {
    const list = [...visible];
    list.sort((a, b) => {
      const av = sortMetric.get(a) ?? -Infinity;
      const bv = sortMetric.get(b) ?? -Infinity;
      const diff = av - bv;
      if (diff !== 0) return sortDesc ? -diff : diff;
      return a.clinicName.localeCompare(b.clinicName);
    });
    return list;
  }, [visible, sortMetric, sortDesc]);

  // Linha "totais" usada só para alimentar os cards de resumo (Ticket Médio = média
  // dos valores configurados nas clínicas visíveis que têm um valor definido).
  const totals = useMemo<ClinicMetricRow>(() => {
    const t = visible.reduce(
      (acc, r) => ({
        leads: acc.leads + r.leads,
        patientsCaptured: acc.patientsCaptured + r.patientsCaptured,
        sales: acc.sales + r.sales,
        lost: acc.lost + r.lost,
        revenue: acc.revenue + r.revenue,
        investment: acc.investment + r.investment,
        ticketSum: acc.ticketSum + (r.ticketMedio ?? 0),
        ticketCount: acc.ticketCount + (r.ticketMedio ? 1 : 0),
      }),
      { leads: 0, patientsCaptured: 0, sales: 0, lost: 0, revenue: 0, investment: 0, ticketSum: 0, ticketCount: 0 }
    );
    return {
      clinicId: "__total__", clinicName: "", logoUrl: null, isActive: true, category: null,
      leads: t.leads, patientsCaptured: t.patientsCaptured, sales: t.sales, lost: t.lost,
      revenue: t.revenue, investment: t.investment,
      ticketMedio: t.ticketCount > 0 ? t.ticketSum / t.ticketCount : null,
    };
  }, [visible]);

  const toggleSort = (key: string) => {
    if (sortKey === key) setSortDesc(d => !d);
    else { setSortKey(key); setSortDesc(true); }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Período + filtros */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <DateRangePicker
          label="Período"
          from={dateFrom}
          to={dateTo}
          onFromChange={setDateFrom}
          onToChange={setDateTo}
        />
        <div className="flex items-center gap-2">
          {/* Filtro de clientes */}
          <div className="relative" ref={clinicMenuRef}>
            <button
              onClick={() => { setClinicMenuOpen(o => !o); setClinicQuery(""); }}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold border transition-all",
                selectedIds.length > 0
                  ? "bg-violet-600 text-white border-violet-600 shadow-sm"
                  : "bg-white text-slate-600 border-slate-200 hover:border-violet-300"
              )}
            >
              <Building2 className="w-3 h-3" />
              {selectedIds.length === 0
                ? "Todos os clientes"
                : `${selectedCount} cliente${selectedCount === 1 ? "" : "s"}`}
              <ChevronDown className={cn("w-3 h-3 transition-transform", clinicMenuOpen && "rotate-180")} />
            </button>
            {clinicMenuOpen && (
              <div className="absolute right-0 top-full mt-1 z-50 bg-white border border-slate-200 rounded-xl shadow-lg py-1 w-64">
                <div className="px-2 py-1">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      autoFocus
                      value={clinicQuery}
                      onChange={e => setClinicQuery(e.target.value)}
                      placeholder="Buscar cliente..."
                      className="w-full pl-8 pr-2 py-1.5 text-xs font-semibold text-slate-700 border border-slate-200 rounded-lg focus:outline-none focus:border-violet-300"
                    />
                  </div>
                </div>
                <button
                  onClick={clearClinicSelection}
                  className="w-full flex items-center justify-between gap-3 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors border-b border-slate-100"
                >
                  <span>Todos os clientes</span>
                  {selectedIds.length === 0 && <Check className="w-3 h-3 text-violet-600 shrink-0" />}
                </button>
                <div className="max-h-64 overflow-y-auto">
                  {clinicOptions.length === 0 ? (
                    <p className="px-3 py-3 text-xs font-semibold text-slate-400 text-center">Nenhum cliente encontrado</p>
                  ) : clinicOptions.map(r => (
                    <button
                      key={r.clinicId}
                      onClick={() => toggleClinic(r.clinicId)}
                      className="w-full flex items-center justify-between gap-3 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
                    >
                      <span className="truncate flex items-center gap-1.5">
                        {r.clinicName}
                        {!r.isActive && <span className="text-[9px] font-bold text-rose-400 uppercase shrink-0">Inativa</span>}
                      </span>
                      {selectedIds.includes(r.clinicId) && <Check className="w-3 h-3 text-violet-600 shrink-0" />}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Ativar/desativar métricas */}
          <div className="relative" ref={metricsMenuRef}>
            <button
              onClick={() => setMetricsMenuOpen(o => !o)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold border transition-all",
                metricsMenuOpen
                  ? "bg-violet-600 text-white border-violet-600 shadow-sm"
                  : "bg-white text-slate-600 border-slate-200 hover:border-violet-300"
              )}
            >
              <SlidersHorizontal className="w-3 h-3" />
              Métricas
              <ChevronDown className={cn("w-3 h-3 transition-transform", metricsMenuOpen && "rotate-180")} />
            </button>
            {metricsMenuOpen && (
              <div className="absolute right-0 top-full mt-1 z-50 bg-white border border-slate-200 rounded-xl shadow-lg py-1 w-72 max-h-80 overflow-y-auto">
                {METRICS.map(m => (
                  <button
                    key={m.id}
                    onClick={() => toggleMetric(m.id)}
                    className="w-full flex items-center justify-between gap-3 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
                  >
                    <span className="flex items-center gap-2 truncate">
                      <m.Icon className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      {m.label}
                    </span>
                    {visibleMetrics.includes(m.id) && <Check className="w-3 h-3 text-violet-600 shrink-0" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={() => setShowInactive(v => !v)}
            className={cn(
              "px-3 py-1.5 rounded-lg text-[10px] font-bold border transition-all",
              showInactive
                ? "bg-violet-600 text-white border-violet-600 shadow-sm"
                : "bg-white text-slate-600 border-slate-200 hover:border-violet-300"
            )}
          >
            {showInactive ? "Ocultar inativas" : "Mostrar inativas"}
          </button>
        </div>
      </div>

      {/* Cards de totais */}
      {activeMetrics.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
          {activeMetrics.map(m => (
            <div key={m.id} className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <div className={cn("w-7 h-7 rounded-lg flex items-center justify-center shrink-0", m.color)}>
                  <m.Icon className="w-3.5 h-3.5" />
                </div>
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 truncate">{m.label}</span>
              </div>
              <span className="text-xl font-black text-slate-900 truncate">
                {loading ? "…" : formatMetric(m.get(totals), m.format)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Tabela por clínica */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 text-violet-500 animate-spin" />
          </div>
        ) : sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2 text-slate-400">
            <Building2 className="w-8 h-8" />
            <span className="text-xs font-bold">Nenhuma clínica encontrada</span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-5 py-3 text-[10px] font-black uppercase tracking-wider text-slate-400">Cliente</th>
                  {activeMetrics.map(m => (
                    <th key={m.id} className="px-4 py-3 text-right">
                      <button
                        onClick={() => toggleSort(m.id)}
                        className={cn(
                          "inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider transition-colors whitespace-nowrap",
                          sortKey === m.id ? "text-violet-600" : "text-slate-400 hover:text-slate-600"
                        )}
                      >
                        {m.label}
                        {sortKey === m.id && (sortDesc ? <ArrowDown className="w-3 h-3" /> : <ArrowUp className="w-3 h-3" />)}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map(r => (
                  <tr key={r.clinicId} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60 transition-colors">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3 min-w-[180px]">
                        {r.logoUrl ? (
                          <img src={r.logoUrl} alt="" className="w-8 h-8 rounded-lg object-cover border border-slate-200" />
                        ) : (
                          <div className="w-8 h-8 rounded-lg bg-violet-50 border border-violet-100 flex items-center justify-center">
                            <Building2 className="w-4 h-4 text-violet-500" />
                          </div>
                        )}
                        <div className="flex flex-col">
                          <span className="text-xs font-bold text-slate-900">{r.clinicName}</span>
                          {!r.isActive && <span className="text-[9px] font-bold text-rose-500 uppercase">Inativa</span>}
                        </div>
                      </div>
                    </td>
                    {activeMetrics.map(m => {
                      const val = m.get(r);
                      const cellColor = m.id === "roas"
                        ? (val === null ? "text-slate-400" : val >= 1 ? "text-emerald-600" : "text-rose-500")
                        : (m.valueColor ?? "text-slate-700");
                      return (
                        <td key={m.id} className={cn("px-4 py-3 text-right text-xs font-bold whitespace-nowrap", cellColor)}>
                          {formatMetric(val, m.format)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
