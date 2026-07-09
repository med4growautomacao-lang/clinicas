import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { supabase } from "../lib/supabase";
import { cn } from "@/src/lib/utils";
import { matchesSearch } from "../lib/search";
import { DateRangePicker } from "./DateRangePicker";
import { MetricLottie } from "./MetricLottie";
import {
  Loader2, Building2, Users, CalendarCheck, Trophy, Wallet, Megaphone,
  ArrowUp, ArrowDown, ChevronDown, Check, Search, Percent, TrendingUp,
  DollarSign, Target, XCircle, SlidersHorizontal, Coins, CalendarClock,
  Eye, EyeOff,
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
  { id: "schedulingRate", label: "Taxa de Agendamento",         Icon: Percent,       color: "text-emerald-600 bg-emerald-50", format: "percent",  get: r => r.leads > 0 ? (r.patientsCaptured / r.leads) * 100 : null },
  { id: "conversion",  label: "Taxa de Conversão",              Icon: Percent,       color: "text-indigo-600 bg-indigo-50",   format: "percent",  get: r => r.leads > 0 ? (r.sales / r.leads) * 100 : null },
  { id: "revenue",     label: "Faturamento",                    Icon: Wallet,        color: "text-teal-600 bg-teal-50",       format: "currency", get: r => r.revenue },
  { id: "investment",  label: "Investimento Geral (Google/Meta)", Icon: Megaphone,   color: "text-amber-600 bg-amber-50",     format: "currency", get: r => r.investment },
  { id: "roas",        label: "ROAS",                           Icon: TrendingUp,    color: "text-fuchsia-600 bg-fuchsia-50", format: "ratio",    get: r => r.investment > 0 ? r.revenue / r.investment : null },
  { id: "ticketMedio", label: "Ticket Médio",                   Icon: DollarSign,    color: "text-blue-600 bg-blue-50",       format: "currency", get: r => r.ticketMedio },
  { id: "cpl",         label: "Custo por Lead",                 Icon: Coins,         color: "text-cyan-600 bg-cyan-50",       format: "currency", get: r => r.leads > 0 ? r.investment / r.leads : null },
  { id: "custoAgendamento", label: "Custo por Agendamento",     Icon: CalendarClock, color: "text-lime-600 bg-lime-50",       format: "currency", get: r => r.patientsCaptured > 0 ? r.investment / r.patientsCaptured : null },
  { id: "cpa",         label: "Custo por Conversão",            Icon: Target,        color: "text-orange-600 bg-orange-50",   format: "currency", get: r => r.sales > 0 ? r.investment / r.sales : null },
];

const DEFAULT_VISIBLE = METRICS.map(m => m.id);

const MONTH_NAMES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

// Cor hex (tom -600 do Tailwind) por métrica, usada na ilustração animada do Pódio.
const PODIUM_ACCENT: Record<string, string> = {
  leads: "#7c3aed", patients: "#0284c7", sales: "#059669", lost: "#e11d48",
  schedulingRate: "#059669", conversion: "#4f46e5", revenue: "#0d9488",
  investment: "#d97706", roas: "#c026d3", ticketMedio: "#2563eb",
  cpl: "#0891b2", custoAgendamento: "#65a30d", cpa: "#ea580c",
};

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

  // Destaque "Hoje": busca independente do filtro de período, sempre o dia atual.
  const [todayRows, setTodayRows] = useState<ClinicMetricRow[]>([]);
  const [todayLoading, setTodayLoading] = useState(true);
  const todayISO = useMemo(() => toISODate(new Date()), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setTodayLoading(true);
      const { data, error } = await supabase.rpc("get_org_clinics_metrics", {
        p_date_from: todayISO,
        p_date_to: todayISO,
      });
      if (!cancelled && !error && Array.isArray(data)) {
        setTodayRows((data as any[]).map(r => ({
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
      if (!cancelled) setTodayLoading(false);
    })();
    return () => { cancelled = true; };
  }, [todayISO]);

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

  // Mesma seleção de clientes/inativas do resto da tela, aplicada ao snapshot de hoje.
  const todayTotals = useMemo(() => {
    const visibleToday = todayRows.filter(r =>
      (showInactive || r.isActive) &&
      (selectedIds.length === 0 || selectedIds.includes(r.clinicId))
    );
    return visibleToday.reduce(
      (acc, r) => ({
        leads: acc.leads + r.leads,
        patients: acc.patients + r.patientsCaptured,
        sales: acc.sales + r.sales,
      }),
      { leads: 0, patients: 0, sales: 0 }
    );
  }, [todayRows, showInactive, selectedIds]);

  const todayDateLabel = useMemo(() => {
    const d = new Date();
    return `${String(d.getDate()).padStart(2, "0")} de ${MONTH_NAMES[d.getMonth()]}`;
  }, []);

  const motivation = useMemo(() => {
    const { leads, patients, sales } = todayTotals;
    if (sales > 0) {
      return { emoji: "🔥", text: `Dia forte! ${leads} leads, ${patients} pacientes agendados e ${sales} consultas fechadas até agora. Continue assim! 🚀` };
    }
    if (leads > 0) {
      return { emoji: "💪", text: `Bom ritmo hoje! ${leads} leads captados até agora.` };
    }
    return { emoji: "🌅", text: "O dia está começando. Assim que os leads chegarem, você acompanha tudo por aqui." };
  }, [todayTotals]);

  // Rótulo humano do período selecionado (usado no pódio e no card de compartilhar).
  const periodLabel = useMemo(() => {
    if (!dateFrom && !dateTo) return "Todo o período";
    const fmt = (iso: string) => { const [, m, d] = iso.split("-"); return `${d}/${m}`; };
    const now = new Date();
    const firstOfMonth = toISODate(new Date(now.getFullYear(), now.getMonth(), 1));
    const today = toISODate(now);
    if (dateFrom === firstOfMonth && dateTo === today) return "Este mês";
    if (dateFrom && dateTo) return `${fmt(dateFrom)} a ${fmt(dateTo)}`;
    if (dateFrom) return `desde ${fmt(dateFrom)}`;
    return `até ${fmt(dateTo!)}`;
  }, [dateFrom, dateTo]);

  // Pódio: métrica escolhida (default Leads) + toggle de esconder nomes; ambos persistem.
  const [podiumMetricId, setPodiumMetricId] = useState<string>(() => localStorage.getItem("orgMetricsPodiumMetric") || "leads");
  const [hidePodiumNames, setHidePodiumNames] = useState<boolean>(() => localStorage.getItem("orgMetricsHideNames") === "1");
  const [podiumMenuOpen, setPodiumMenuOpen] = useState(false);
  const podiumMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!podiumMenuOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (podiumMenuRef.current && !podiumMenuRef.current.contains(e.target as Node)) setPodiumMenuOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [podiumMenuOpen]);

  const podiumMetric = useMemo(() => METRICS.find(m => m.id === podiumMetricId) ?? METRICS[0], [podiumMetricId]);

  // Top 3 pela métrica escolhida (desc; nulos por último).
  const podiumTop3 = useMemo(
    () => [...visible]
      .sort((a, b) => (podiumMetric.get(b) ?? -Infinity) - (podiumMetric.get(a) ?? -Infinity) || a.clinicName.localeCompare(b.clinicName))
      .slice(0, 3),
    [visible, podiumMetric]
  );
  // Ordem visual de degraus: 2º, 1º, 3º (o 1º no centro e mais alto).
  const podiumDisplay = useMemo(() => {
    const withRank = podiumTop3.map((row, i) => ({ row, rank: i }));
    if (withRank.length === 3) return [withRank[1], withRank[0], withRank[2]];
    if (withRank.length === 2) return [withRank[1], withRank[0]];
    return withRank;
  }, [podiumTop3]);

  const setPodiumMetric = (id: string) => { setPodiumMetricId(id); localStorage.setItem("orgMetricsPodiumMetric", id); setPodiumMenuOpen(false); };
  const toggleHideNames = () => setHidePodiumNames(v => { const next = !v; localStorage.setItem("orgMetricsHideNames", next ? "1" : "0"); return next; });

  return (
    <div className="flex flex-col gap-4">
      <style>{`
        @keyframes orgMetricsTodaySweep {
          0%   { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
        @keyframes orgMetricsTodayGlow {
          0%, 100% { box-shadow: 0 0 0 0 var(--glow-c0, transparent); }
          50%      { box-shadow: 0 0 0 2px var(--glow-c1, transparent); }
        }
        @keyframes orgMetricsLiveDot {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%      { opacity: 0.35; transform: scale(0.75); }
        }
        .today-shine {
          background-image: linear-gradient(100deg, rgb(255 255 255) 0%, var(--sweep-c, #fff) 50%, rgb(255 255 255) 100%);
          background-size: 220% 100%;
          animation: orgMetricsTodaySweep 6s linear infinite, orgMetricsTodayGlow 2.6s ease-in-out infinite;
        }
        .today-live-dot { animation: orgMetricsLiveDot 1.6s ease-in-out infinite; }
      `}</style>

      {/* Destaque "Hoje" */}
      <div>
        <div className="flex items-center gap-2 mb-2.5">
          <span className="w-2 h-2 bg-violet-500 rounded-full today-live-dot" />
          <span className="text-[11px] font-black uppercase tracking-wider text-slate-600">Hoje</span>
          <span className="text-[11px] font-semibold text-slate-400">· {todayDateLabel}</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
          <div
            className="today-shine bg-white border rounded-2xl p-4"
            style={{ borderColor: "#d4af37", "--sweep-c": "#faf3dd", "--glow-c0": "rgba(212,175,55,0)", "--glow-c1": "rgba(212,175,55,0.45)" } as React.CSSProperties}
          >
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 rounded-lg bg-violet-50 border border-violet-100 flex items-center justify-center shrink-0">
                <Users className="w-3.5 h-3.5 text-violet-600" />
              </div>
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">Leads Captados</span>
            </div>
            <span className="text-3xl font-black text-violet-600">{todayLoading ? "…" : todayTotals.leads.toLocaleString("pt-BR")}</span>
          </div>

          <div
            className="today-shine bg-white border rounded-2xl p-4"
            style={{ borderColor: "#d4af37", "--sweep-c": "#faf3dd", "--glow-c0": "rgba(212,175,55,0)", "--glow-c1": "rgba(212,175,55,0.45)" } as React.CSSProperties}
          >
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 rounded-lg bg-sky-50 border border-sky-100 flex items-center justify-center shrink-0">
                <CalendarCheck className="w-3.5 h-3.5 text-sky-600" />
              </div>
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">Pacientes Captados</span>
            </div>
            <span className="text-3xl font-black text-sky-600">{todayLoading ? "…" : todayTotals.patients.toLocaleString("pt-BR")}</span>
          </div>

          <div
            className="today-shine bg-white border rounded-2xl p-4"
            style={{ borderColor: "#d4af37", "--sweep-c": "#faf3dd", "--glow-c0": "rgba(212,175,55,0)", "--glow-c1": "rgba(212,175,55,0.45)" } as React.CSSProperties}
          >
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 rounded-lg bg-emerald-50 border border-emerald-100 flex items-center justify-center shrink-0">
                <Trophy className="w-3.5 h-3.5 text-emerald-600" />
              </div>
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">Consultas Realizadas</span>
            </div>
            <span className="text-3xl font-black text-emerald-600">{todayLoading ? "…" : todayTotals.sales.toLocaleString("pt-BR")}</span>
          </div>
        </div>

        {!todayLoading && (
          <div className="flex items-center gap-2.5 px-4 py-3 bg-emerald-50 border border-emerald-100 rounded-xl">
            <span className="text-lg leading-none">{motivation.emoji}</span>
            <span className="text-xs font-bold text-slate-800">{motivation.text}</span>
          </div>
        )}
      </div>

      {/* Pódio do período */}
      {!loading && podiumTop3.length > 0 && (
        <div>
          <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="text-base font-black text-slate-900">🏆 Pódio do período</span>
              <span className="text-[11px] font-semibold text-slate-400">Líderes em {podiumMetric.label} · {periodLabel}</span>
            </div>
            <div className="flex items-center gap-2">
              {/* Seletor de métrica do pódio */}
              <div className="relative" ref={podiumMenuRef}>
                <button
                  onClick={() => setPodiumMenuOpen(o => !o)}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold border transition-all",
                    podiumMenuOpen ? "bg-violet-600 text-white border-violet-600 shadow-sm" : "bg-white text-slate-600 border-slate-200 hover:border-violet-300"
                  )}
                >
                  <podiumMetric.Icon className="w-3 h-3" />
                  {podiumMetric.label}
                  <ChevronDown className={cn("w-3 h-3 transition-transform", podiumMenuOpen && "rotate-180")} />
                </button>
                {podiumMenuOpen && (
                  <div className="absolute right-0 top-full mt-1 z-50 bg-white border border-slate-200 rounded-xl shadow-lg py-1 w-64 max-h-80 overflow-y-auto">
                    {METRICS.map(m => (
                      <button
                        key={m.id}
                        onClick={() => setPodiumMetric(m.id)}
                        className="w-full flex items-center justify-between gap-3 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
                      >
                        <span className="flex items-center gap-2 truncate">
                          <m.Icon className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          {m.label}
                        </span>
                        {podiumMetricId === m.id && <Check className="w-3 h-3 text-violet-600 shrink-0" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {/* Esconder / mostrar nomes */}
              <button
                onClick={toggleHideNames}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold border transition-all",
                  hidePodiumNames ? "bg-violet-600 text-white border-violet-600 shadow-sm" : "bg-white text-slate-600 border-slate-200 hover:border-violet-300"
                )}
              >
                {hidePodiumNames ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                {hidePodiumNames ? "Nomes ocultos" : "Esconder nomes"}
              </button>
            </div>
          </div>
          <div className="flex items-center gap-3 sm:gap-6">
            {/* Ilustração animada por métrica (Lottie do cliente, com fallback SVG) */}
            <div key={podiumMetricId} className="hidden md:block shrink-0 w-[150px] lg:w-[190px]">
              <MetricLottie metricId={podiumMetricId} accent={PODIUM_ACCENT[podiumMetricId] ?? "#7c3aed"} />
            </div>
            <div className="flex-1 flex items-end justify-center gap-3 sm:gap-4 flex-wrap">
            {podiumDisplay.map(({ row, rank }) => {
              const medal = ["🥇", "🥈", "🥉"][rank];
              const barH = [104, 74, 52][rank];
              const styles = [
                { bar: "bg-amber-50 border-amber-200", icon: "bg-amber-50 border-amber-100", iconColor: "text-amber-600", value: "text-amber-600" },
                { bar: "bg-violet-50 border-violet-200", icon: "bg-violet-50 border-violet-100", iconColor: "text-violet-600", value: "text-violet-600" },
                { bar: "bg-rose-50 border-rose-200", icon: "bg-rose-50 border-rose-100", iconColor: "text-rose-600", value: "text-rose-600" },
              ][rank];
              return (
                <div key={row.clinicId} className="flex flex-col items-center w-[132px] sm:w-[148px]">
                  <div className={cn("w-10 h-10 rounded-xl border flex items-center justify-center mb-2", styles.icon)}>
                    {hidePodiumNames
                      ? <span className={cn("text-sm font-black", styles.iconColor)}>{rank + 1}º</span>
                      : row.logoUrl
                        ? <img src={row.logoUrl} alt="" className="w-full h-full object-cover rounded-xl" />
                        : <Building2 className={cn("w-5 h-5", styles.iconColor)} />}
                  </div>
                  <span className="text-xs font-black text-slate-900 text-center truncate max-w-full">
                    {hidePodiumNames ? `${rank + 1}º lugar` : row.clinicName}
                  </span>
                  <span className={cn("text-xl font-black mt-0.5", styles.value)}>{formatMetric(podiumMetric.get(row), podiumMetric.format)}</span>
                  <span className="text-[8.5px] font-bold text-slate-400 uppercase tracking-wide mb-2 text-center truncate max-w-full">{podiumMetric.label}</span>
                  <div
                    className={cn("w-full rounded-t-2xl border border-b-0 flex items-start justify-center pt-2.5 text-2xl", styles.bar)}
                    style={{ height: barH }}
                  >
                    {medal}
                  </div>
                </div>
              );
            })}
            </div>
          </div>
        </div>
      )}

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
