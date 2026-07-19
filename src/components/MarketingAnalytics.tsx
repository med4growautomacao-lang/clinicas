import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { DateRangePicker } from "./DateRangePicker";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "./ui/card";
import { Button } from "./ui/button";
import {
  BarChart3,
  TrendingUp,
  Target,
  DollarSign,
  Users,
  Calendar,
  Filter,
  ArrowUpRight,
  ArrowDownRight,
  Plus,
  Settings as SettingsIcon,
  LayoutDashboard,
  Table as TableIcon,
  Download,
  Info,
  ChevronLeft,
  RefreshCw,
  Edit3,
  Link2,
  X,
  Activity,
  CheckCircle2,
  FileText,
  Store
} from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  Legend,
  LineChart,
  Line
} from 'recharts';
import { cn } from "@/src/lib/utils";
import { TrendBarChart, fmtByType } from "./TrendBarChart";
import { motion, AnimatePresence } from "framer-motion";
import { useMarketing, MarketingData, useFunnelStages, useUtmFunnelCohort, useFunnelCohort, useMarketingKpis, MarketingKpiRow } from "../hooks/useSupabase";
import { ReportQuick } from "./ReportQuick";
import {
  format,
  startOfDay,
  endOfDay,
  subDays,
  eachDayOfInterval,
  isSameDay,
  parseISO,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  subMonths,
  subWeeks,
  addDays,
  addMonths,
  differenceInDays
} from "date-fns";
import { ptBR } from "date-fns/locale";
import MetaLogo from "../assets/logos/Logo Metaads.png";
import GoogleLogo from "../assets/logos/Logo Googleads.png";
import SemOrigemLogo from "../assets/logos/Logo Sem origem.png";
import WhatsAppLogo from "../assets/logos/Logo Whatsapp.png";
import { FilterChips } from "./filters/FilterChips";
import { GranularityToggle } from "./filters/GranularityToggle";
import { DateRangePopover } from "./filters/DateRangePopover";
import { type Period, RANGE_PRESETS } from "../lib/dateRange";
import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../lib/supabase";

type Platform = 'meta_ads' | 'google_ads' | 'no_track';

const PLATFORM_LABELS: Record<Platform, string> = {
  meta_ads: 'META ADS',
  google_ads: 'GOOGLE ADS',
  no_track: 'ORGÂNICO'
};

const PLATFORM_COLORS: Record<Platform, string> = {
  meta_ads: 'text-indigo-600',
  google_ads: 'text-amber-600',
  no_track: 'text-slate-500'
};

const METRICS_CONFIG = [
  { id: 'investment', label: 'Investimento', color: '#4f46e5', type: 'currency', icon: DollarSign, bgColor: 'bg-indigo-50 text-indigo-600' },
  { id: 'leads', label: 'Leads', color: '#0d9488', type: 'number', icon: Users, bgColor: 'bg-teal-50 text-teal-600' },
  { id: 'cpl', label: 'CPL', color: '#f59e0b', type: 'currency', icon: Target, bgColor: 'bg-amber-50 text-amber-600' },
  { id: 'appointments', label: 'Agendamentos', color: '#8b5cf6', type: 'number', icon: Calendar, bgColor: 'bg-violet-50 text-violet-600' },
  { id: 'convs', label: 'Conversões', color: '#10b981', type: 'number', icon: CheckCircle2, bgColor: 'bg-emerald-50 text-emerald-600' },
  { id: 'cpapt', label: 'Custo p/ Agend.', color: '#ec4899', type: 'currency', icon: Target, bgColor: 'bg-pink-50 text-pink-600' },
  { id: 'cpa', label: 'CAC', color: '#f43f5e', type: 'currency', icon: Activity, bgColor: 'bg-rose-50 text-rose-600' },
  { id: 'conv_value', label: 'Valor Conv.', color: '#059669', type: 'currency', icon: DollarSign, bgColor: 'bg-green-50 text-green-600' },
  { id: 'roas', label: 'ROAS', color: '#ea580c', type: 'ratio', icon: TrendingUp, bgColor: 'bg-orange-50 text-orange-600' },
  { id: 'lead_to_apt_rate', label: 'Lead p/ Agend.', color: '#0ea5e9', type: 'percent', icon: Activity, bgColor: 'bg-sky-50 text-sky-600' },
  { id: 'lead_to_conv_rate', label: 'Lead p/ Conv.', color: '#06b6d4', type: 'percent', icon: Activity, bgColor: 'bg-cyan-50 text-cyan-600' },
  { id: 'apt_to_conv_rate', label: 'Agend. p/ Conv.', color: '#8b5cf6', type: 'percent', icon: Activity, bgColor: 'bg-purple-50 text-purple-600' },
];

// --- Persistência da config de exibição (cards de métricas + Funil de Vendas) POR CLÍNICA ---
// As etapas do Funil têm UUID próprio de cada clínica; com uma chave global, configurar uma
// clínica sobrescrevia a config das outras — o que aparecia como "reset" ao trocar de clínica.
// Escopamos cada chave por activeClinicId (mesma fonte do AuthContext: sessionStorage). Na 1ª
// leitura caímos na chave legada global, para não zerar quem já tinha config salva.
const scopeCfgKey = (base: string) => `${base}::${sessionStorage.getItem('activeClinicId') ?? 'none'}`;
const readCfg = (base: string): string | null =>
  localStorage.getItem(scopeCfgKey(base)) ?? localStorage.getItem(base);
const writeCfg = (base: string, value: string) => localStorage.setItem(scopeCfgKey(base), value);

const loadVisibleMetrics = (base: string): string[] => {
  const saved = readCfg(base);
  return saved ? JSON.parse(saved) : METRICS_CONFIG.map(m => m.id);
};
const loadMetricsOrder = (base: string): string[] => {
  const initial = METRICS_CONFIG.map(m => m.id);
  const saved = readCfg(base);
  if (!saved) return initial;
  const parsed: string[] = JSON.parse(saved);
  const valid = parsed.filter((id) => initial.includes(id));
  const missing = initial.filter((id) => !valid.includes(id));
  return [...valid, ...missing];
};
const loadFunnelOrder = (): string[] => {
  const saved = readCfg('mkt_funnel_order');
  return saved ? JSON.parse(saved) : [];
};
const loadFunnelHidden = (): string[] | null => {
  const saved = readCfg('mkt_funnel_hidden');
  return saved ? JSON.parse(saved) : null;
};

// Paleta de cores (hex) para as etapas do Funil de Vendas configurável
const FUNNEL_PALETTE = ['#0d9488', '#8b5cf6', '#10b981', '#0ea5e9', '#f59e0b', '#ec4899', '#6366f1', '#ef4444'];

// ===== UTM / Motivo de Perda (filtros globais + seção UTM × Etapa) =====
const UTM_DIMENSIONS: { id: string; label: string }[] = [
  { id: 'utm_campaign', label: 'Campanha' },
  { id: 'utm_adset', label: 'Conjunto' },
  { id: 'utm_ad', label: 'Anúncio' },
  { id: 'utm_term', label: 'Termo' },
  { id: 'utm_source', label: 'Origem' },
];
const UTM_SERIES_COLORS = ['#0d9488', '#8b5cf6', '#f59e0b', '#0ea5e9', '#ec4899', '#10b981', '#6366f1', '#ef4444'];
const UTM_TOP_N = 10;            // máximo de valores UTM no ranking / matriz
const UTM_TREND_SERIES = 6;      // máximo de séries (linhas) na tendência
const NO_UTM_KEY = '__none__';   // sentinela p/ valor UTM nulo ("Sem UTM")

// Valor da dimensão UTM ativa numa linha do coorte (já vem com colunas utm_*).
function rowUtmKey(row: any, dim: string): string {
  const v = row[dim];
  return (v === null || v === undefined || v === '') ? NO_UTM_KEY : String(v);
}

// Monta os dados de uma pizza (participação %) para uma dimensão UTM, a partir das linhas
// do coorte já filtradas, somando leads nas etapas em `stageSet`. Top fatias + "Outros".
// `compareRows` (opcional): quando em modo Comparar, calcula a % de variação POR FATIA
// (cada valor da UTM vs. o mesmo valor no período comparativo).
function buildPie(rows: any[], dim: string, stageSet: Set<string>, compareRows?: any[]) {
  const PIE_TOP = 6;
  const totals = new Map<string, number>();
  rows.forEach((r: any) => {
    if (!stageSet.has(r.stage_id)) return;
    const k = rowUtmKey(r, dim);
    totals.set(k, (totals.get(k) || 0) + (Number(r.leads) || 0));
  });
  const sorted = [...totals.entries()]
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([key, value]) => ({ key, name: key === NO_UTM_KEY ? 'Sem UTM' : key, value }));
  const total = sorted.reduce((a, b) => a + b.value, 0);

  // Totais do comparativo por valor (para a % por fatia).
  const cmp = new Map<string, number>();
  if (compareRows) {
    compareRows.forEach((r: any) => {
      if (!stageSet.has(r.stage_id)) return;
      const k = rowUtmKey(r, dim);
      cmp.set(k, (cmp.get(k) || 0) + (Number(r.leads) || 0));
    });
  }
  const deltaOf = (key: string, value: number): number | null => {
    if (!compareRows) return null;
    const prev = cmp.get(key) || 0;
    return prev > 0 ? ((value - prev) / prev) * 100 : null;
  };

  let slices = sorted;
  const topKeys = sorted.slice(0, PIE_TOP).map(s => s.key);
  if (sorted.length > PIE_TOP) {
    const rest = sorted.slice(PIE_TOP).reduce((a, b) => a + b.value, 0);
    slices = [...sorted.slice(0, PIE_TOP), { key: '__outros__', name: 'Outros', value: rest }];
  }
  // % do comparativo para "Outros" = soma das chaves fora do top.
  const cmpOutros = [...cmp.entries()].filter(([k]) => !topKeys.includes(k)).reduce((a, [, v]) => a + v, 0);
  // Variação % do TOTAL (vs. comparativo) — exibida no centro da pizza ao comparar.
  const cmpTotal = [...cmp.values()].reduce((a, b) => a + b, 0);
  const totalDelta = compareRows ? (cmpTotal > 0 ? ((total - cmpTotal) / cmpTotal) * 100 : null) : null;

  return {
    total,
    totalDelta,
    slices: slices.map((s, i) => ({
      ...s,
      color: s.key === '__outros__' ? '#cbd5e1' : UTM_SERIES_COLORS[i % UTM_SERIES_COLORS.length],
      pct: total > 0 ? (s.value / total) * 100 : 0,
      delta: s.key === '__outros__'
        ? (compareRows ? (cmpOutros > 0 ? ((s.value - cmpOutros) / cmpOutros) * 100 : null) : null)
        : deltaOf(s.key, s.value),
    })),
  };
}

// Canal → bucket dos cards. Régua única do lado TS (bucketStages + loop de KPIs);
// espelhada no SQL da RPC marketing_kpis — mudou aqui, mude lá também.
const channelBucket = (ch: string | null | undefined): 'forms' | 'balcao' | 'whatsapp' =>
  ch === 'forms' ? 'forms' : ch === 'balcao' ? 'balcao' : 'whatsapp';

// Série temporal (por período) das chaves UTM em `keys`, para uma dimensão — alimenta o
// mini-gráfico de tendência dentro do card de pizza.
function buildDimTrend(rows: any[], dim: string, stageSet: Set<string>, periods: any[], keys: string[]) {
  const byPeriod = new Map<string, Map<string, number>>();
  periods.forEach((p: any) => byPeriod.set(p.label, new Map()));
  rows.forEach((r: any) => {
    if (!stageSet.has(r.stage_id)) return;
    const k = rowUtmKey(r, dim);
    if (!keys.includes(k)) return;
    const period = periods.find((p: any) => r.entry_date >= format(p.start, 'yyyy-MM-dd') && r.entry_date <= format(p.end, 'yyyy-MM-dd'));
    if (!period) return;
    const m = byPeriod.get(period.label)!;
    m.set(k, (m.get(k) || 0) + (Number(r.leads) || 0));
  });
  return periods.map((p: any) => {
    const m = byPeriod.get(p.label)!;
    const row: any = { name: p.label };
    keys.forEach((k) => { row[k] = m.get(k) || 0; });
    return row;
  });
}

export function MarketingAnalytics() {
  const { activeClinicId } = useAuth();
  const [period, setPeriod] = useState<Period>('dia');
  const [viewMode, setViewMode] = useState<'dashboard' | 'table'>(() => (localStorage.getItem('marketingViewMode') as any) || 'dashboard');
  const [dateRange, setDateRange] = useState({
    start: subDays(new Date(), 7),
    end: subDays(new Date(), 1)
  });

  const { data: marketingData, loading: mktLoading, fetch: fetchMkt, upsert: upsertMkt } = useMarketing();
  const { data: stages } = useFunnelStages();
  // Leads criados + valor de conversões: agregados no BANCO (RPC marketing_kpis).
  // NUNCA contar KPI sobre useLeads()/useConversions(): o PostgREST clampa a resposta
  // em max_rows e o array capado zera os cards em clínica grande (bug de 18/07/2026).
  const marketingKpis = useMarketingKpis(
    format(dateRange.start, 'yyyy-MM-dd'),
    format(dateRange.end, 'yyyy-MM-dd')
  );
  // Coorte ÚNICO do funil (por ticket / última entrada) com dimensões de UTM e o motivo de
  // perda do ticket. Alimenta cards, Funil, pizza, Tendência e a seção UTM × Etapa, e é a
  // base dos filtros GLOBAIS de UTM e Motivo de Perda.
  const utmCohort = useUtmFunnelCohort(
    format(dateRange.start, 'yyyy-MM-dd'),
    format(dateRange.end, 'yyyy-MM-dd')
  );
  // Funil de Vendas VISUAL: usa o coorte LEVE (marketing_funnel_cohort, sem as dimensões
  // de UTM) — o cohort UTM explode em linhas (etapa×plataforma×canal×motivo×campanha×…)
  // e ESTOURA o max_rows do PostgREST em clínica grande, cortando etapas inteiras (Ganho
  // sumia do funil da Intubação, 5367>5000). O leve fica em ~centenas de linhas.
  const funnelCohort = useFunnelCohort(
    format(dateRange.start, 'yyyy-MM-dd'),
    format(dateRange.end, 'yyyy-MM-dd')
  );
  // Conversões e Agendamentos dos CARDS vêm da RPC marketing_kpis (wins/scheduled,
  // fonte única = tickets.outcome / união agendamento∪etapa).
  const [isEditing, setIsEditing] = useState(false);
  const [isComparing, setIsComparing] = useState(false);
  const [compareDateRange, setCompareDateRange] = useState<{ start: Date, end: Date }>({
    start: subDays(new Date(), 14),
    end: subDays(new Date(), 8)
  });

  // Cohort UTM (seção UTM × Etapa / pizzas) do período de comparação.
  const utmCohortCompare = useUtmFunnelCohort(
    isComparing ? format(compareDateRange.start, 'yyyy-MM-dd') : null,
    isComparing ? format(compareDateRange.end, 'yyyy-MM-dd') : null
  );
  // Cohort LEVE do funil visual (comparação) — mesma razão do principal (evita clamp).
  const funnelCohortCompare = useFunnelCohort(
    isComparing ? format(compareDateRange.start, 'yyyy-MM-dd') : null,
    isComparing ? format(compareDateRange.end, 'yyyy-MM-dd') : null
  );
  // KPIs (leads/valor de conversão) do período de comparação — mesma RPC do principal.
  const marketingKpisCompare = useMarketingKpis(
    isComparing ? format(compareDateRange.start, 'yyyy-MM-dd') : null,
    isComparing ? format(compareDateRange.end, 'yyyy-MM-dd') : null
  );

  // Filtros de origem/canal (no cabeçalho fixo, fora do DashboardView). Vazio = "Todos".
  const [selectedPlatform, setSelectedPlatform] = useState<string[]>([]);
  const [selectedChannel, setSelectedChannel] = useState<string[]>([]);

  const [dashboardVisibleMetrics, setDashboardVisibleMetrics] = useState<string[]>(() => loadVisibleMetrics('mkt_dash_visible_metrics'));
  const [dashboardMetricsOrder, setDashboardMetricsOrder] = useState<string[]>(() => loadMetricsOrder('mkt_dash_metrics_order'));
  const [tableVisibleMetrics, setTableVisibleMetrics] = useState<string[]>(() => loadVisibleMetrics('mkt_table_visible_metrics'));
  const [tableMetricsOrder, setTableMetricsOrder] = useState<string[]>(() => loadMetricsOrder('mkt_table_metrics_order'));

  // Configuração das etapas do Funil de Vendas (escolhidas a partir das etapas do funil de oportunidades)
  const [funnelStagesOrder, setFunnelStagesOrder] = useState<string[]>(() => loadFunnelOrder());
  const [funnelHiddenStages, setFunnelHiddenStages] = useState<string[] | null>(() => loadFunnelHidden());

  // Ao trocar de clínica (agência), recarrega a config salva daquela clínica — cada uma tem a
  // sua. Sem isso, o estado continuaria com a config da clínica anterior. Pula a 1ª execução
  // (os initializers acima já leram a config correta da clínica atual).
  const cfgClinicRef = useRef(activeClinicId);
  useEffect(() => {
    if (cfgClinicRef.current === activeClinicId) return;
    cfgClinicRef.current = activeClinicId;
    setDashboardVisibleMetrics(loadVisibleMetrics('mkt_dash_visible_metrics'));
    setDashboardMetricsOrder(loadMetricsOrder('mkt_dash_metrics_order'));
    setTableVisibleMetrics(loadVisibleMetrics('mkt_table_visible_metrics'));
    setTableMetricsOrder(loadMetricsOrder('mkt_table_metrics_order'));
    setFunnelStagesOrder(loadFunnelOrder());
    setFunnelHiddenStages(loadFunnelHidden());
  }, [activeClinicId]);

  // Padrão: o topo do funil é "Contato via WhatsApp". As etapas de entrada
  // (Sincronização/Forms) entram ocultas por padrão — todo lead delas passa
  // por WhatsApp depois. O usuário pode reexibi-las pelo ⚙️.
  const effectiveFunnelHidden = funnelHiddenStages ?? stages
    .filter(s => s.slug === 'sincronizacao' || s.slug === 'forms')
    .map(s => s.id);

  const funnelEffectiveOrder = (order: string[]) => {
    const ids = [...stages].sort((a, b) => a.position - b.position).map(s => s.id);
    const saved = order.filter(id => ids.includes(id));
    const missing = ids.filter(id => !saved.includes(id));
    return [...saved, ...missing];
  };

  const toggleFunnelStage = (id: string) => {
    const next = effectiveFunnelHidden.includes(id)
      ? effectiveFunnelHidden.filter(x => x !== id)
      : [...effectiveFunnelHidden, id];
    setFunnelHiddenStages(next);
    writeCfg('mkt_funnel_hidden', JSON.stringify(next));
  };

  const moveFunnelStage = (id: string, direction: 'up' | 'down') => {
    const cur = funnelEffectiveOrder(funnelStagesOrder);
    const i = cur.indexOf(id);
    if (i === -1) return;
    const j = direction === 'up' ? i - 1 : i + 1;
    if (j < 0 || j >= cur.length) return;
    const next = [...cur];
    [next[i], next[j]] = [next[j], next[i]];
    setFunnelStagesOrder(next);
    writeCfg('mkt_funnel_order', JSON.stringify(next));
  };

  const toggleMetric = (id: string, view: 'dashboard' | 'table') => {
    if (view === 'dashboard') {
      const next = dashboardVisibleMetrics.includes(id) ? dashboardVisibleMetrics.filter(m => m !== id) : [...dashboardVisibleMetrics, id];
      setDashboardVisibleMetrics(next);
      writeCfg('mkt_dash_visible_metrics', JSON.stringify(next));
    } else {
      const next = tableVisibleMetrics.includes(id) ? tableVisibleMetrics.filter(m => m !== id) : [...tableVisibleMetrics, id];
      setTableVisibleMetrics(next);
      writeCfg('mkt_table_visible_metrics', JSON.stringify(next));
    }
  };

  const moveMetric = (id: string, direction: 'up' | 'down', view: 'dashboard' | 'table') => {
    if (view === 'dashboard') {
      const index = dashboardMetricsOrder.indexOf(id);
      if (index === -1) return;
      const nextIndex = direction === 'up' ? index - 1 : index + 1;
      if (nextIndex < 0 || nextIndex >= dashboardMetricsOrder.length) return;
      const next = [...dashboardMetricsOrder];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      setDashboardMetricsOrder(next);
      writeCfg('mkt_dash_metrics_order', JSON.stringify(next));
    } else {
      const index = tableMetricsOrder.indexOf(id);
      if (index === -1) return;
      const nextIndex = direction === 'up' ? index - 1 : index + 1;
      if (nextIndex < 0 || nextIndex >= tableMetricsOrder.length) return;
      const next = [...tableMetricsOrder];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      setTableMetricsOrder(next);
      writeCfg('mkt_table_metrics_order', JSON.stringify(next));
    }
  };


  const [editValues, setEditValues] = useState<Record<string, any>>({});

  const [isPeriodOpen, setIsPeriodOpen] = useState(false);
  const [activeRangeLabel, setActiveRangeLabel] = useState("ÚLTIMOS 7 DIAS");
  const [calMonth1, setCalMonth1] = useState<Date>(() => subDays(new Date(), 7));
  const [calMonth2, setCalMonth2] = useState<Date>(() => addMonths(subDays(new Date(), 7), 1));

  const setRangeById = (id: string) => {
    const today = new Date();
    let start = today;
    let end = today;
    let label = "";

    switch (id) {
      case 'today':
        label = "HOJE";
        break;
      case 'yesterday':
        start = subDays(today, 1);
        end = subDays(today, 1);
        label = "ONTEM";
        break;
      case 'week':
        start = startOfWeek(today, { weekStartsOn: 0 });
        label = "ESTA SEMANA";
        break;
      case '7days':
        start = subDays(today, 7);
        end = subDays(today, 1);
        label = "ÚLTIMOS 7 DIAS";
        break;
      case '14days':
        start = subDays(today, 14);
        end = subDays(today, 1);
        label = "ÚLTIMOS 14 DIAS";
        break;
      case '28days':
        start = subDays(today, 28);
        end = subDays(today, 1);
        label = "ÚLTIMOS 28 DIAS";
        break;
      case '30days':
        start = subDays(today, 30);
        end = subDays(today, 1);
        label = "ÚLTIMOS 30 DIAS";
        break;
      case 'month':
        start = startOfMonth(today);
        label = "ESTE MÊS";
        break;
      case 'last_month':
        const lastMonth = subMonths(today, 1);
        start = startOfMonth(lastMonth);
        end = endOfMonth(lastMonth);
        label = "MÊS PASSADO";
        break;
      case 'last_week':
        const lastWeek = subWeeks(today, 1);
        start = startOfWeek(lastWeek, { weekStartsOn: 0 });
        end = endOfWeek(lastWeek, { weekStartsOn: 0 });
        label = "SEMANA PASSADA";
        break;
    }

    setDateRange({ start, end });
    setActiveRangeLabel(label);
    setCalMonth1(start);
    setCalMonth2(addMonths(start, 1));
    setIsPeriodOpen(false);
  };

  useEffect(() => {
    const fetchStart = isComparing
      ? format(compareDateRange.start < dateRange.start ? compareDateRange.start : dateRange.start, 'yyyy-MM-dd')
      : format(dateRange.start, 'yyyy-MM-dd');

    const fetchEnd = isComparing
      ? format(compareDateRange.end > dateRange.end ? compareDateRange.end : dateRange.end, 'yyyy-MM-dd')
      : format(dateRange.end, 'yyyy-MM-dd');

    fetchMkt(fetchStart, fetchEnd);
  }, [dateRange, compareDateRange, isComparing, fetchMkt]);

  const periods = useMemo(() => {
    if (period === 'dia') {
      return eachDayOfInterval({ start: dateRange.start, end: dateRange.end }).map(d => ({
        start: startOfDay(d),
        end: endOfDay(d),
        label: format(d, 'dd/MM')
      }));
    }

    if (period === 'sem') {
      const weeks: { start: Date, end: Date, label: string }[] = [];
      let current = startOfWeek(dateRange.start, { weekStartsOn: 0 });

      while (current <= dateRange.end) {
        const s = current;
        const e = endOfWeek(current, { weekStartsOn: 0 });
        weeks.push({
          start: s,
          end: e,
          label: `${format(s, 'd/M')} - ${format(e, 'd/M')}`
        });
        current = addDays(e, 1);
      }
      return weeks;
    }

    if (period === 'mês') {
      const months: { start: Date, end: Date, label: string }[] = [];
      let current = startOfMonth(dateRange.start);

      while (current <= dateRange.end) {
        const s = current;
        const e = endOfMonth(current);
        months.push({
          start: s,
          end: e,
          label: format(s, 'MMM', { locale: ptBR }).toUpperCase()
        });
        current = addDays(e, 1);
      }
      return months;
    }

    return [];
  }, [dateRange, period]);

  const days = useMemo(() => {
    return eachDayOfInterval({ start: dateRange.start, end: dateRange.end });
  }, [dateRange]);

  const calculateStats = (targetPeriods: typeof periods, kpiRows?: MarketingKpiRow[]) => {
    const stats: Record<string, Record<Platform, any>> = {};
    // Índice (dia|plataforma) → linha manual: evita marketingData.find() dentro do
    // loop de kpiRows (era O(períodos × linhas × marketingData) na visão diária).
    const manualByKey = new Map(marketingData.map(m => [`${m.date}|${m.platform}`, m]));
    const mkStat = () => ({
      leads: 0, convs: 0, investment: 0, conv_value: 0, appointments: 0, whatsapp_leads: 0, forms_leads: 0,
      ch: {
        forms:    { leads: 0, convs: 0, conv_value: 0, appointments: 0 },
        whatsapp: { leads: 0, convs: 0, conv_value: 0, appointments: 0 },
        balcao:   { leads: 0, convs: 0, conv_value: 0, appointments: 0 },
      },
    });

    targetPeriods.forEach((p, idx) => {
      const pKey = targetPeriods[idx].label;
      stats[pKey] = {
        meta_ads: mkStat(),
        google_ads: mkStat(),
        no_track: mkStat()
      };

      marketingData.forEach(m => {
        const mDate = parseISO(m.date);
        if (mDate >= p.start && mDate <= p.end) {
          const platform = m.platform as Platform;
          if (stats[pKey][platform]) {
            stats[pKey][platform].investment += m.investment;
            if (m.manual_leads_count !== null) stats[pKey][platform].leads += m.manual_leads_count;
            // Agendamentos e Conversões vêm do funil (stageBucket), não de override manual.
            if (m.conversions_value) stats[pKey][platform].conv_value += m.conversions_value;
          }
        }
      });

      // Leads criados + VALOR de conversões: agregados no BANCO (RPC marketing_kpis,
      // por dia × plataforma × canal) — imune ao clamp de max_rows do PostgREST.
      // Override manual por (dia, plataforma) continua valendo: manual_leads_count
      // preenchido substitui a contagem real do dia (já somado no loop do marketingData
      // acima); idem conversions_value. Exclusão de "Orçamento Enviado" mora na RPC.
      const pStartStr = format(p.start, 'yyyy-MM-dd');
      const pEndStr = format(p.end, 'yyyy-MM-dd');
      (kpiRows || []).forEach(row => {
        if (row.day < pStartStr || row.day > pEndStr) return;
        const platform = (row.platform || 'no_track') as Platform;
        if (!stats[pKey][platform]) return;
        const manual = manualByKey.get(`${row.day}|${platform}`);
        const ch = channelBucket(row.channel);
        const nLeads = Number(row.leads) || 0;
        const manualLeads = manual?.manual_leads_count;
        if (nLeads > 0 && (manualLeads === null || manualLeads === undefined || manualLeads === 0)) {
          stats[pKey][platform].leads += nLeads;
          stats[pKey][platform].ch[ch].leads += nLeads;
          if (ch === 'forms') stats[pKey][platform].forms_leads += nLeads;
          else if (ch === 'whatsapp') stats[pKey][platform].whatsapp_leads += nLeads;
        }
        const vConv = Number(row.conv_value) || 0;
        if (vConv > 0 && !manual?.conversions_value) {
          stats[pKey][platform].conv_value += vConv;
          stats[pKey][platform].ch[ch].conv_value += vConv;
        }
        // Conversões e Agendamentos: MESMA fonte da verdade que VG/Comercial —
        // wins = tickets.outcome='ganho'; scheduled = união agendamento∪etapa (dedupe).
        // Vêm da RPC marketing_kpis v2 (views v_kpi_*). O Funil de Vendas visual segue
        // por ETAPA (utmCohort) — é outra pergunta (movimento no funil, não desfecho).
        const nWins = Number(row.wins) || 0;
        if (nWins > 0) {
          stats[pKey][platform].convs += nWins;
          stats[pKey][platform].ch[ch].convs += nWins;
        }
        const nSched = Number(row.scheduled) || 0;
        if (nSched > 0) {
          stats[pKey][platform].appointments += nSched;
          stats[pKey][platform].ch[ch].appointments += nSched;
        }
      });
    });

    return stats;
  };

  const metricsByPeriod = useMemo(() => calculateStats(periods, marketingKpis), [periods, marketingKpis, marketingData]);

  const comparisonMetricsByPeriod = useMemo(() => {
    if (!isComparing) return {};
    const primaryDuration = differenceInDays(dateRange.end, dateRange.start) + 1;
    const compareDuration = differenceInDays(compareDateRange.end, compareDateRange.start) + 1;

    const compPeriods = periods.map(p => {
      const offsetStart = differenceInDays(p.start, dateRange.start);
      const scale = compareDuration / primaryDuration;
      const duration = differenceInDays(p.end, p.start) + 1;

      const newStart = addDays(compareDateRange.start, Math.floor(offsetStart * scale));
      return {
        start: newStart,
        end: addDays(newStart, Math.floor(duration * scale) - 1),
        label: p.label
      };
    });

    return calculateStats(compPeriods as any, marketingKpisCompare);
  }, [isComparing, periods, dateRange, compareDateRange, marketingKpisCompare, marketingData]);

  const handleEditData = () => {
    const initial: Record<string, any> = {};
    // Pré-preenche o editor com a MESMA fonte da tela (RPC marketing_kpis: leads, valor,
    // wins, scheduled). Sem ela, Leads/Agendamentos/Conversões/Valor pré-preenchiam 0 — e
    // salvar gravaria manual_leads_count=0 por cima do real. Um só calculateStats p/ todos os dias.
    const dayPeriods = days.map(day => ({ start: day, end: day, label: format(day, 'yyyy-MM-dd') }));
    const statsByDay = calculateStats(dayPeriods as any, marketingKpis);
    days.forEach(day => {
      const dateStr = format(day, 'yyyy-MM-dd');
      ['meta_ads', 'google_ads', 'no_track'].forEach(p => {
        const key = `${dateStr}-${p}`;
        const dayStats = statsByDay[dateStr][p];

        initial[`${key}-investment`] = dayStats.investment || 0;
        initial[`${key}-leads`] = dayStats.leads || 0;
        initial[`${key}-appointments`] = dayStats.appointments || 0;
        initial[`${key}-convs`] = dayStats.convs || 0;
        initial[`${key}-value`] = dayStats.conv_value || 0;
      });
    });
    setEditValues(initial);
    setIsEditing(true);
  };

  const saveEditData = async () => {
    const toUpsert: Partial<MarketingData>[] = [];
    days.forEach(day => {
      const dateStr = format(day, 'yyyy-MM-dd');
      (['meta_ads', 'google_ads', 'no_track'] as Platform[]).forEach(p => {
        const key = `${dateStr}-${p}`;
        toUpsert.push({
          date: dateStr,
          platform: p,
          investment: Number(editValues[`${key}-investment`] || 0),
          manual_leads_count: Number(editValues[`${key}-leads`] || 0),
          // manual_appointments_count / manual_conversions_count NÃO entram no payload: o editor os
          // semeia a partir do funil (calculateStats), não da coluna salva, então gravá-los aqui
          // sobrescreveria o valor manual com 0 (upsert onConflict). Omitir preserva o que está salvo.
          conversions_value: Number(editValues[`${key}-value`] || 0)
        });
      });
    });
    await upsertMkt(toUpsert);
    setIsEditing(false);
    fetchMkt(format(dateRange.start, 'yyyy-MM-dd'), format(dateRange.end, 'yyyy-MM-dd'));
  };

  if (mktLoading && marketingData.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <RefreshCw className="w-8 h-8 text-teal-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-full bg-slate-50 text-slate-900 px-6 pb-6 font-sans">
      {/* Cabeçalho FIXO: topo (período/ações) + barra de filtros (origem/canal).
          Fundo SÓLIDO (sem backdrop-blur) — o blur re-renderiza a cada frame de scroll e pesava a tela. */}
      <div className="sticky top-0 z-30 -mx-6 px-6 pt-6 pb-3 space-y-4 bg-slate-50 border-b border-slate-100 shadow-sm">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-teal-600 flex items-center justify-center shadow-lg shadow-teal-100">
            <BarChart3 className="w-7 h-7 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Métricas de Marketing
            </h1>
            <p className="text-slate-500 text-sm font-medium">Acompanhe o ROI e desempenho dos seus anúncios</p>
          </div>
        </div>

        <div className="flex flex-wrap xl:flex-nowrap items-center gap-3">
          {/* Date Pill */}
          <div className="flex items-center gap-3 bg-white p-1.5 rounded-2xl border border-slate-200 shadow-sm">
            <GranularityToggle period={period} onChange={setPeriod} />

            <div className="h-6 w-px bg-slate-200 mx-1" />

            <DateRangePopover
              valueLabel={activeRangeLabel}
              rangeText={`${format(dateRange.start, 'dd/MM')} - ${format(dateRange.end, 'dd/MM')}`}
              presets={RANGE_PRESETS}
              activeLabel={activeRangeLabel}
              onPreset={setRangeById}
              selected={{ from: dateRange.start, to: dateRange.end }}
              onSelect={(r) => {
                if (r?.from) { setDateRange(d => ({ ...d, start: r.from! })); setActiveRangeLabel("PERSONALIZADO"); }
                if (r?.to)   { setDateRange(d => ({ ...d, end: r.to! })); }
              }}
              month1={calMonth1}
              setMonth1={setCalMonth1}
              month2={calMonth2}
              setMonth2={setCalMonth2}
              open={isPeriodOpen}
              setOpen={setIsPeriodOpen}
              footer={isComparing && (
                <div className="p-3 bg-teal-50/30">
                  <span className="text-[9px] font-black text-teal-600 uppercase tracking-[2px] block mb-2">Período Comparativo</span>
                  <DateRangePicker
                    inline
                    numberOfMonths={1}
                    from={format(compareDateRange.start, 'yyyy-MM-dd')}
                    to={format(compareDateRange.end, 'yyyy-MM-dd')}
                    onFromChange={(v) => { if (v) setCompareDateRange(r => ({ ...r, start: parseISO(v) })); }}
                    onToChange={(v) => { if (v) setCompareDateRange(r => ({ ...r, end: parseISO(v) })); }}
                  />
                </div>
              )}
            />
          </div>

          {/* Actions Area */}
          <div className="flex items-center gap-2">
            {!isEditing ? (
              <>
                <Button
                  onClick={() => {
                    if (!isComparing) {
                      const dayDelta = differenceInDays(dateRange.end, dateRange.start) + 1;
                      setCompareDateRange({
                        start: subDays(dateRange.start, dayDelta),
                        end: subDays(dateRange.end, dayDelta)
                      });
                      // Abre o calendário para o usuário ajustar o 2º período (comparativo).
                      setIsPeriodOpen(true);
                    }
                    setIsComparing(!isComparing);
                  }}
                  variant="outline"
                  className={cn(
                    "rounded-xl h-9 gap-2 text-[10px] font-bold uppercase transition-all shadow-sm",
                    isComparing ? "bg-teal-50 border-teal-200 text-teal-600 shadow-teal-100" : "border-slate-200 bg-white hover:bg-slate-50 text-slate-600"
                  )}
                >
                  <RefreshCw className={cn("w-3.5 h-3.5 transition-transform duration-500", isComparing ? "rotate-180 text-teal-600" : "text-slate-400")} />
                  Comparar
                </Button>

                <SyncInvestmentButton
                  clinicId={activeClinicId}
                  onDone={() => fetchMkt(format(dateRange.start, 'yyyy-MM-dd'), format(dateRange.end, 'yyyy-MM-dd'))}
                />

                {/* Relatório completo do período (mesma fonte do Comercial/agendado) */}
                <ReportQuick start={dateRange.start} end={dateRange.end} className="rounded-xl h-9" />

                {viewMode === 'table' && (
                  <Button
                    onClick={handleEditData}
                    variant="outline"
                    className="rounded-xl border-slate-200 bg-white hover:bg-slate-50 h-9 gap-2 text-[10px] font-bold uppercase transition-all shadow-sm"
                  >
                    <Edit3 className="w-3.5 h-3.5 text-teal-600" />
                    Editar Dados
                  </Button>
                )}
              </>
            ) : (
              <div className="flex items-center gap-2">
                <Button onClick={() => setIsEditing(false)} variant="ghost" className="rounded-xl text-slate-500 h-9 px-4 text-[10px] font-bold uppercase">
                  Cancelar
                </Button>
                <Button onClick={saveEditData} className="rounded-xl bg-teal-600 hover:bg-teal-700 text-white h-9 px-6 text-[10px] font-black uppercase shadow-lg shadow-teal-100 transition-all active:scale-[0.98]">
                  Salvar
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Barra de filtros: alternância de visão + origem/canal + métricas (some ao editar) */}
      <div className={cn("flex items-center flex-wrap gap-3 transition-all", isEditing && "opacity-0 pointer-events-none h-0 overflow-hidden")}>
        <div className="flex bg-white rounded-xl p-1 border border-slate-200 shadow-sm">
          <button
            onClick={() => { setViewMode('dashboard'); localStorage.setItem('marketingViewMode', 'dashboard'); }}
            className={cn("p-2 rounded-lg transition-all", viewMode === 'dashboard' ? "bg-teal-600 text-white shadow-md" : "text-slate-400 hover:text-slate-600")}
          >
            <LayoutDashboard className="w-4 h-4" />
          </button>
          <button
            onClick={() => { setViewMode('table'); localStorage.setItem('marketingViewMode', 'table'); }}
            className={cn("p-2 rounded-lg transition-all", viewMode === 'table' ? "bg-teal-600 text-white shadow-md" : "text-slate-400 hover:text-slate-600")}
          >
            <TableIcon className="w-4 h-4" />
          </button>
        </div>

        {viewMode === 'dashboard' && (
          <>
            <FilterChips
              multiple
              allId="all"
              value={selectedPlatform}
              onChange={(ids: string[]) => setSelectedPlatform(ids)}
              options={[
                { id: 'all', label: 'Todos' },
                { id: 'meta_ads', label: 'Meta', logo: MetaLogo },
                { id: 'google_ads', label: 'Google', logo: GoogleLogo },
                { id: 'no_track', label: 'Orgânico', logo: SemOrigemLogo },
              ]}
            />
            <FilterChips
              multiple
              allId="all"
              value={selectedChannel}
              onChange={(ids: string[]) => setSelectedChannel(ids)}
              options={[
                { id: 'all', label: 'Todos' },
                { id: 'forms', label: 'Forms', icon: FileText },
                { id: 'whatsapp', label: 'WhatsApp', logo: WhatsAppLogo },
                { id: 'balcao', label: 'Balcão', icon: Store },
              ]}
            />
            <div className="ml-auto">
              <MetricsConfigButton
                metricsOrder={dashboardMetricsOrder}
                visibleMetrics={dashboardVisibleMetrics}
                toggleMetric={(id: string) => toggleMetric(id, 'dashboard')}
                moveMetric={(id: string, dir: any) => moveMetric(id, dir, 'dashboard')}
                variant="ghost"
                className="h-8 px-3 rounded-xl hover:bg-slate-100 text-slate-400"
              />
            </div>
          </>
        )}
      </div>
      </div>
      {/* fim do cabeçalho fixo */}

      <div className="space-y-4 pt-4">
        <AnimatePresence mode="wait">
          <motion.div
            key={`${viewMode}-${period}-${isEditing}`}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="pb-24"
          >
            {viewMode === 'dashboard' ? (
              <DashboardView
                periods={periods}
                metricsByPeriod={metricsByPeriod}
                comparisonMetricsByPeriod={comparisonMetricsByPeriod}
                isComparing={isComparing}
                visibleMetrics={dashboardVisibleMetrics}
                toggleMetric={(id: string) => toggleMetric(id, 'dashboard')}
                metricsOrder={dashboardMetricsOrder}
                moveMetric={(id: string, dir) => moveMetric(id, dir as any, 'dashboard')}
                funnelStages={stages}
                funnelCohort={funnelCohort}
                funnelCohortCompare={funnelCohortCompare}
                utmCohort={utmCohort}
                utmCohortCompare={utmCohortCompare}
                funnelOrder={funnelStagesOrder}
                funnelHidden={effectiveFunnelHidden}
                toggleFunnelStage={toggleFunnelStage}
                moveFunnelStage={moveFunnelStage}
                selectedPlatform={selectedPlatform}
                selectedChannel={selectedChannel}
              />
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  {/* ... same as before but I'll update props below ... */}
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-teal-50 flex items-center justify-center">
                      <TableIcon className="w-5 h-5 text-teal-600" />
                    </div>
                    <h2 className="text-xs font-black text-slate-400 uppercase tracking-widest">Tabela de Métricas</h2>
                  </div>

                  <MetricsConfigButton
                    metricsOrder={tableMetricsOrder}
                    visibleMetrics={tableVisibleMetrics}
                    toggleMetric={(id: string) => toggleMetric(id, 'table')}
                    moveMetric={(id: string, dir) => moveMetric(id, dir as any, 'table')}
                    variant="ghost"
                    className="h-8 px-3 rounded-xl hover:bg-slate-100 text-slate-400"
                  />
                </div>

                <Card className="bg-white border-slate-200 shadow-xl rounded-3xl overflow-hidden">
                  <div className="overflow-x-auto custom-scrollbar">
                    <table className="w-full text-left border-collapse min-w-[1000px]">
                      <thead>
                        <tr className="border-b border-slate-100 bg-slate-50/50">
                          <th className="p-6 text-[11px] font-black text-teal-600 uppercase tracking-[2px] border-r border-slate-100">Métrica / Período</th>
                          {periods.map(p => (
                            <th key={p.label} className="p-6 text-[11px] font-black text-slate-500 text-center uppercase tracking-wider min-w-[140px]">
                              {p.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        <PlatformRows platform="meta_ads" periods={periods} metricsByPeriod={metricsByPeriod} comparisonMetricsByPeriod={comparisonMetricsByPeriod} isComparing={isComparing} isEditing={isEditing} editValues={editValues} setEditValues={setEditValues} period={period} visibleMetrics={tableVisibleMetrics} metricsOrder={tableMetricsOrder} />
                        <PlatformRows platform="google_ads" periods={periods} metricsByPeriod={metricsByPeriod} comparisonMetricsByPeriod={comparisonMetricsByPeriod} isComparing={isComparing} isEditing={isEditing} editValues={editValues} setEditValues={setEditValues} period={period} visibleMetrics={tableVisibleMetrics} metricsOrder={tableMetricsOrder} />
                        <PlatformRows platform="no_track" periods={periods} metricsByPeriod={metricsByPeriod} comparisonMetricsByPeriod={comparisonMetricsByPeriod} isComparing={isComparing} isEditing={isEditing} editValues={editValues} setEditValues={setEditValues} period={period} visibleMetrics={tableVisibleMetrics} metricsOrder={tableMetricsOrder} />
                        <SummaryRows periods={periods} metricsByPeriod={metricsByPeriod} comparisonMetricsByPeriod={comparisonMetricsByPeriod} isComparing={isComparing} visibleMetrics={tableVisibleMetrics} metricsOrder={tableMetricsOrder} />
                      </tbody>
                    </table>
                  </div>
                </Card>
              </div>
            )}

            <AnimatePresence>
              {isEditing && (
                <motion.div
                  initial={{ y: 100, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: 100, opacity: 0 }}
                  className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[50] flex items-center gap-3 bg-white/90 backdrop-blur-md border border-slate-200 p-2 pl-6 rounded-2xl shadow-2xl ring-1 ring-slate-900/5 min-w-[400px]"
                >
                  <div className="flex items-center gap-3 mr-auto">
                    <div className="w-2 h-2 rounded-full bg-teal-500 animate-pulse" />
                    <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Alterações não salvas</span>
                  </div>
                  <Button onClick={() => setIsEditing(false)} variant="ghost" className="h-10 rounded-xl text-slate-500 font-bold px-4 hover:bg-slate-100">
                    Cancelar
                  </Button>
                  <Button onClick={saveEditData} className="h-10 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-black px-8 uppercase shadow-lg shadow-teal-100 transition-all active:scale-[0.98]">
                    Salvar
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

// Botão + popover para sincronizar o INVESTIMENTO de X a Y — Meta e Google Ads.
// Cada edge (meta-spend-sync / google-spend-sync) lê as credenciais da clínica no servidor
// (segredo nunca vai ao browser), busca o gasto diário na API respectiva e faz upsert em
// marketing_data. "Não configurado" numa plataforma é ignorado em silêncio (a clínica pode ter
// só uma das duas); só erro real aparece. Ao concluir, atualiza a tela via onDone.
const SYNC_PLATFORMS: { fn: string; label: string; notConfigured: string }[] = [
  { fn: 'meta-spend-sync', label: 'Meta', notConfigured: 'meta_not_configured' },
  { fn: 'google-spend-sync', label: 'Google', notConfigured: 'google_not_configured' },
];

function SyncInvestmentButton({ clinicId, onDone }: { clinicId: string | null; onDone: () => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const [from, setFrom] = useState(() => format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [to, setTo] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const fmtBRL = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v || 0);

  const runSync = async () => {
    if (!clinicId || syncing) return;
    setSyncing(true);
    setResult(null);

    const okLines: string[] = [];
    const errLines: string[] = [];
    let touched = false;

    for (const p of SYNC_PLATFORMS) {
      try {
        const { data, error } = await supabase.functions.invoke(p.fn, {
          body: { clinic_id: clinicId, since: from, until: to },
        });
        if (error) {
          // status não-2xx: o corpo detalhado vem em error.context (Response), não em error.message.
          let detail = error.message;
          try { const b = await (error as any).context?.json?.(); if (b?.detail || b?.error) detail = b.detail || b.error; } catch { /* usa message */ }
          errLines.push(`${p.label}: ${detail}`);
          continue;
        }
        if (!data?.ok) {
          // Plataforma sem credencial nesta clínica → pula em silêncio; outro erro → mostra.
          if (data?.error !== p.notConfigured) errLines.push(`${p.label}: ${data?.detail || data?.error || 'falha'}`);
          continue;
        }
        touched = true;
        okLines.push(`${p.label}: ${data.days} dia(s) · ${fmtBRL(data.total_spend)}`);
      } catch (e: any) {
        errLines.push(`${p.label}: ${e?.message || 'erro'}`);
      }
    }

    if (touched) onDone();
    if (okLines.length === 0 && errLines.length === 0) {
      setResult({ ok: false, msg: 'Nenhuma plataforma de anúncios configurada nesta clínica.' });
    } else {
      setResult({ ok: errLines.length === 0, msg: [...okLines, ...errLines].join('\n') });
    }
    setSyncing(false);
  };

  return (
    <div className="relative">
      <Button
        onClick={() => setIsOpen(!isOpen)}
        variant="outline"
        className={cn(
          "rounded-xl h-9 gap-2 text-[10px] font-bold uppercase transition-all shadow-sm",
          isOpen ? "bg-teal-50 border-teal-200 text-teal-600 shadow-teal-100" : "border-slate-200 bg-white hover:bg-slate-50 text-slate-600"
        )}
      >
        <Download className={cn("w-3.5 h-3.5", isOpen ? "text-teal-600" : "text-slate-400")} />
        Sincronizar Investimento
      </Button>

      <AnimatePresence>
        {isOpen && (
          <>
            <div className="fixed inset-0 z-[105]" onClick={() => setIsOpen(false)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="absolute top-full right-0 mt-2 w-80 bg-white rounded-2xl border border-slate-200 shadow-2xl z-[110] p-4 overflow-hidden"
            >
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Sincronizar Investimento · Meta + Google</p>
              <p className="text-[11px] text-slate-500 mb-3">Puxa o gasto diário direto das contas de anúncios e grava no período escolhido.</p>

              <DateRangePicker
                inline
                numberOfMonths={1}
                from={from}
                to={to}
                onFromChange={(v) => { if (v) setFrom(v); }}
                onToChange={(v) => { if (v) setTo(v); }}
              />

              {result && (
                <div className={cn(
                  "mt-3 text-[11px] font-medium rounded-xl px-3 py-2 whitespace-pre-line",
                  result.ok ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
                )}>
                  {result.msg}
                </div>
              )}

              <Button
                onClick={runSync}
                disabled={syncing || !clinicId}
                className="mt-3 w-full rounded-xl bg-teal-600 hover:bg-teal-700 text-white h-9 text-[10px] font-black uppercase shadow-lg shadow-teal-100 transition-all active:scale-[0.98] disabled:opacity-60"
              >
                {syncing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                {syncing ? 'Sincronizando…' : 'Sincronizar'}
              </Button>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

function MetricsConfigButton({ metricsOrder, visibleMetrics, toggleMetric, moveMetric, variant = 'outline', className }: any) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="relative">
      <Button
        onClick={() => setIsOpen(!isOpen)}
        variant={variant as any}
        className={cn(
          "gap-2 transition-all shadow-sm",
          className,
          isOpen ? "bg-teal-50 border-teal-200 text-teal-600 shadow-teal-100" : (variant === 'outline' ? "border-slate-200 bg-white hover:bg-slate-50 text-slate-600" : "hover:bg-slate-100 text-slate-400")
        )}
      >
        <SettingsIcon className={cn("w-4 h-4 transition-transform duration-500", isOpen ? "rotate-90 text-teal-600" : "")} />
        <span className="text-[10px] font-bold uppercase tracking-tight">Métricas</span>
      </Button>

      <AnimatePresence>
        {isOpen && (
          <>
            <div className="fixed inset-0 z-[105]" onClick={() => setIsOpen(false)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="absolute top-full right-0 mt-2 w-56 bg-white rounded-2xl border border-slate-200 shadow-2xl z-[110] p-3 overflow-hidden"
            >
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-3 pl-2">Métricas Visíveis</p>
              <div className="space-y-1">
                {metricsOrder.map((id: string) => {
                  const m = METRICS_CONFIG.find(x => x.id === id);
                  if (!m) return null;
                  const idx = metricsOrder.indexOf(id);
                  return (
                    <div key={id} className="group relative flex items-center gap-1">
                      <button
                        onClick={() => toggleMetric(id)}
                        className={cn(
                          "flex-1 flex items-center justify-between px-3 py-2 rounded-xl text-[10px] font-bold transition-all",
                          visibleMetrics.includes(id) ? "bg-teal-50 text-teal-700" : "text-slate-400 hover:bg-slate-50 hover:text-slate-600"
                        )}
                      >
                        <span className="uppercase tracking-tight">{m.label}</span>
                        {visibleMetrics.includes(id) && <CheckCircle2 className="w-3 h-3" />}
                      </button>

                      <div className="flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity pr-1">
                        <button
                          onClick={(e) => { e.stopPropagation(); moveMetric(id, 'up'); }}
                          disabled={idx === 0}
                          className="p-0.5 hover:bg-slate-100 rounded text-slate-400 disabled:opacity-30"
                        >
                          <ChevronLeft className="w-3 h-3 rotate-90" />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); moveMetric(id, 'down'); }}
                          disabled={idx === metricsOrder.length - 1}
                          className="p-0.5 hover:bg-slate-100 rounded text-slate-400 disabled:opacity-30"
                        >
                          <ChevronLeft className="w-3 h-3 -rotate-90" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

function FunnelConfigButton({ stages, order, hidden, toggleStage, moveStage, fixedIds }: any) {
  const [isOpen, setIsOpen] = useState(false);

  const orderedStages = useMemo(() => {
    const byId = new Map<string, any>((stages || []).map((s: any) => [s.id, s]));
    const saved = (order || []).filter((id: string) => byId.has(id));
    const missing = (stages || [])
      .filter((s: any) => !saved.includes(s.id))
      .sort((a: any, b: any) => a.position - b.position)
      .map((s: any) => s.id);
    return [...saved, ...missing].map((id: string) => byId.get(id)).filter(Boolean);
  }, [stages, order]);

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        title="Configurar etapas do funil"
        className={cn(
          "w-8 h-8 rounded-lg flex items-center justify-center transition-all",
          isOpen ? "bg-teal-50 text-teal-600" : "text-slate-300 hover:bg-slate-100 hover:text-slate-500"
        )}
      >
        <SettingsIcon className={cn("w-4 h-4 transition-transform duration-500", isOpen ? "rotate-90" : "")} />
      </button>

      <AnimatePresence>
        {isOpen && (
          <>
            <div className="fixed inset-0 z-[105]" onClick={() => setIsOpen(false)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="absolute top-full right-0 mt-2 w-60 bg-white rounded-2xl border border-slate-200 shadow-2xl z-[110] p-3 overflow-hidden"
            >
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-3 pl-2">Etapas do Funil</p>
              {orderedStages.length === 0 ? (
                <p className="text-[10px] text-slate-400 px-2 py-2">Nenhuma etapa de funil encontrada.</p>
              ) : (
                <div className="space-y-1">
                  {orderedStages.map((s: any, idx: number) => {
                    const isFixed = fixedIds?.has?.(s.id);
                    const isVisible = isFixed || !(hidden || []).includes(s.id);
                    return (
                      <div key={s.id} className="group relative flex items-center gap-1">
                        <button
                          onClick={() => { if (!isFixed) toggleStage(s.id); }}
                          disabled={isFixed}
                          title={isFixed ? 'Etapa fixa' : undefined}
                          className={cn(
                            "flex-1 flex items-center justify-between px-3 py-2 rounded-xl text-[10px] font-bold transition-all",
                            isFixed ? "bg-teal-50/60 text-teal-700/70 cursor-default" : isVisible ? "bg-teal-50 text-teal-700" : "text-slate-400 hover:bg-slate-50 hover:text-slate-600"
                          )}
                        >
                          <span className="uppercase tracking-tight truncate">{s.name}{isFixed && <span className="ml-1 normal-case text-[8px] text-teal-600/60">(fixa)</span>}</span>
                          {isVisible && <CheckCircle2 className="w-3 h-3 shrink-0" />}
                        </button>

                        <div className="flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity pr-1">
                          <button
                            onClick={(e) => { e.stopPropagation(); moveStage(s.id, 'up'); }}
                            disabled={idx === 0}
                            className="p-0.5 hover:bg-slate-100 rounded text-slate-400 disabled:opacity-30"
                          >
                            <ChevronLeft className="w-3 h-3 rotate-90" />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); moveStage(s.id, 'down'); }}
                            disabled={idx === orderedStages.length - 1}
                            className="p-0.5 hover:bg-slate-100 rounded text-slate-400 disabled:opacity-30"
                          >
                            <ChevronLeft className="w-3 h-3 -rotate-90" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

function DashboardView({ periods, metricsByPeriod, comparisonMetricsByPeriod, isComparing, visibleMetrics, metricsOrder, toggleMetric, moveMetric, funnelStages, funnelCohort, funnelCohortCompare, utmCohort, utmCohortCompare, funnelOrder, funnelHidden, toggleFunnelStage, moveFunnelStage, selectedPlatform, selectedChannel }: any) {

  const [selectedMetric, setSelectedMetric] = useState('leads');
  const latestPeriod = periods[periods.length - 1]?.label || '';

  // Ajusta uma linha de stats (por plataforma ou já somada) ao canal selecionado.
  // Investimento não tem canal — fica sempre cheio.
  const adjChannel = useCallback((s: any) => {
    if (!s) return { investment: 0, leads: 0, convs: 0, conv_value: 0, appointments: 0 };
    if (selectedChannel.length === 0) {
      return { investment: s.investment || 0, leads: s.leads || 0, convs: s.convs || 0, conv_value: s.conv_value || 0, appointments: s.appointments || 0 };
    }
    // Soma os canais selecionados (investimento não tem canal -> fica cheio)
    const acc = { investment: s.investment || 0, leads: 0, convs: 0, conv_value: 0, appointments: 0 };
    selectedChannel.forEach((ch) => {
      const c = s.ch?.[ch] || {};
      acc.leads += c.leads || 0;
      acc.convs += c.convs || 0;
      acc.conv_value += c.conv_value || 0;
      acc.appointments += c.appointments || 0;
    });
    return acc;
  }, [selectedChannel]);

  const getTotals = useCallback((metricSet: any) => {
    const res: any = {
      investment: 0, leads: 0, convs: 0, conv_value: 0, appointments: 0,
      ch: { forms: { leads: 0, convs: 0, conv_value: 0, appointments: 0 }, whatsapp: { leads: 0, convs: 0, conv_value: 0, appointments: 0 }, balcao: { leads: 0, convs: 0, conv_value: 0, appointments: 0 } },
    };
    if (!metricSet) return res;
    Object.values(metricSet).forEach((p: any) => {
      res.investment += p.investment || 0;
      res.leads += p.leads || 0;
      res.convs += p.convs || 0;
      res.conv_value += p.conv_value || 0;
      res.appointments += p.appointments || 0;
      (['forms', 'whatsapp', 'balcao'] as const).forEach((ch) => {
        const c = p.ch?.[ch] || {};
        res.ch[ch].leads += c.leads || 0;
        res.ch[ch].convs += c.convs || 0;
        res.ch[ch].conv_value += c.conv_value || 0;
        res.ch[ch].appointments += c.appointments || 0;
      });
    });
    return res;
  }, []);

  // Sum across ALL periods in the range, respecting the selected platform
  const currentTotals = useMemo(() => {
    const res = { 
      investment: 0, leads: 0, convs: 0, conv_value: 0, appointments: 0,
      whatsapp: 0, forms: 0,
      breakdown: {
        meta_ads: { leads: 0, whatsapp: 0, forms: 0 },
        google_ads: { leads: 0, whatsapp: 0, forms: 0 },
        no_track: { leads: 0, whatsapp: 0, forms: 0 }
      }
    };
    periods.forEach((p: any) => {
      const dayStats = metricsByPeriod[p.label];
      if (!dayStats) return;

      ['meta_ads', 'google_ads', 'no_track'].forEach((pKey) => {
        const platform = pKey as Platform;
        const s = dayStats[platform];
        
        // Pizza "Origem dos Leads": respeita o canal selecionado
        res.breakdown[platform].leads += selectedChannel.length === 0 ? (s.leads || 0) : selectedChannel.reduce((sum: number, ch: string) => sum + (s.ch?.[ch]?.leads || 0), 0);
        res.breakdown[platform].whatsapp += s.ch?.whatsapp?.leads || 0;
        res.breakdown[platform].forms += s.ch?.forms?.leads || 0;

        if (selectedPlatform.length === 0 || selectedPlatform.includes(platform)) {
          const a = adjChannel(s);
          res.investment += a.investment;
          res.leads += a.leads;
          res.convs += a.convs;
          res.conv_value += a.conv_value;
          res.appointments += a.appointments;
          res.whatsapp += s.ch?.whatsapp?.leads || 0;
          res.forms += s.ch?.forms?.leads || 0;
        }
      });
    });
    return res;
  }, [periods, metricsByPeriod, selectedPlatform, selectedChannel, adjChannel]);

  const prevTotals = useMemo(() => {
    const res = { investment: 0, leads: 0, convs: 0, conv_value: 0, appointments: 0 };
    if (!isComparing) return res;
    periods.forEach((p: any) => {
      const dayStats = comparisonMetricsByPeriod[p.label];
      if (!dayStats) return;

      ['meta_ads', 'google_ads', 'no_track'].forEach((pKey) => {
        const platform = pKey as Platform;
        const s = dayStats[platform];
        
        if (selectedPlatform.length === 0 || selectedPlatform.includes(platform)) {
          const a = adjChannel(s);
          res.investment += a.investment;
          res.leads += a.leads;
          res.convs += a.convs;
          res.conv_value += a.conv_value;
          res.appointments += a.appointments;
        }
      });
    });
    return res;
  }, [periods, comparisonMetricsByPeriod, isComparing, selectedPlatform, selectedChannel, adjChannel]);

  const chartData = useMemo(() => {
    return periods.map((p: any) => {
      const dayStats = metricsByPeriod[p.label];
      const compDayStats = comparisonMetricsByPeriod[p.label];
      
      // Soma só as plataformas selecionadas (vazio = todas) via getTotals.
      const pick = (ds: any) => (!ds || selectedPlatform.length === 0)
        ? ds
        : Object.fromEntries(Object.entries(ds).filter(([k]) => selectedPlatform.includes(k)));
      const rawStats = getTotals(pick(dayStats));
      const rawCompStats = getTotals(pick(compDayStats));
      const stats = adjChannel(rawStats);
      const compStats = adjChannel(rawCompStats);

      // Com filtro de CANAL ativo, investimento não é atribuível → métricas derivadas viram
      // NaN (o gráfico as trata como 0/vazio), coerente com os cards que mostram "—".
      const invNA = selectedChannel.length > 0;
      return {
        name: p.label,
        leads: stats.leads,
        investment: invNA ? NaN : stats.investment,
        appointments: stats.appointments,
        convs: stats.convs,
        conv_value: stats.conv_value,
        cpl: invNA ? NaN : (stats.leads > 0 ? stats.investment / stats.leads : 0),
        cpapt: invNA ? NaN : (stats.appointments > 0 ? stats.investment / stats.appointments : 0),
        cpa: invNA ? NaN : (stats.convs > 0 ? stats.investment / stats.convs : 0),
        lead_to_apt_rate: stats.leads > 0 ? (stats.appointments / stats.leads) * 100 : 0,
        lead_to_conv_rate: stats.leads > 0 ? (stats.convs / stats.leads) * 100 : 0,
        apt_to_conv_rate: stats.appointments > 0 ? (stats.convs / stats.appointments) * 100 : 0,
        roas: invNA ? NaN : (stats.investment > 0 ? stats.conv_value / stats.investment : 0),

        leads_prev: compStats.leads,
        investment_prev: invNA ? NaN : compStats.investment,
        appointments_prev: compStats.appointments,
        convs_prev: compStats.convs,
        conv_value_prev: compStats.conv_value,
        cpl_prev: invNA ? NaN : (compStats.leads > 0 ? compStats.investment / compStats.leads : 0),
        cpapt_prev: invNA ? NaN : (compStats.appointments > 0 ? compStats.investment / compStats.appointments : 0),
        cpa_prev: invNA ? NaN : (compStats.convs > 0 ? compStats.investment / compStats.convs : 0),
        lead_to_apt_rate_prev: compStats.leads > 0 ? (compStats.appointments / compStats.leads) * 100 : 0,
        lead_to_conv_rate_prev: compStats.leads > 0 ? (compStats.convs / compStats.leads) * 100 : 0,
        apt_to_conv_rate_prev: compStats.appointments > 0 ? (compStats.convs / compStats.appointments) * 100 : 0,
        roas_prev: invNA ? NaN : (compStats.investment > 0 ? compStats.conv_value / compStats.investment : 0),
      };
    });
  }, [periods, metricsByPeriod, comparisonMetricsByPeriod, getTotals, selectedPlatform, selectedChannel, adjChannel]);

  const activeMetric = METRICS_CONFIG.find(m => m.id === selectedMetric) || METRICS_CONFIG[0];

  const platformData = useMemo(() => {
    return [
      { id: 'meta_ads', name: 'Meta Ads', label: 'META', value: currentTotals.breakdown.meta_ads.leads, color: '#4f46e5', logo: MetaLogo },
      { id: 'google_ads', name: 'Google Ads', label: 'GOOGLE', value: currentTotals.breakdown.google_ads.leads, color: '#10b981', logo: GoogleLogo },
      { id: 'no_track', name: 'Orgânico', label: 'ORGÂNICO', value: currentTotals.breakdown.no_track.leads, color: '#94a3b8', logo: SemOrigemLogo },
    ].filter(d => d.value > 0 && (selectedPlatform.length === 0 || selectedPlatform.includes(d.id)));
  }, [currentTotals, selectedPlatform]);

  const platformTitle = "Origem dos Leads";

  // Funil de Vendas: contagem POR TICKET (ciclo). Cada etapa conta tickets distintos cuja
  // ÚLTIMA entrada na etapa caiu no período (via RPC marketing_funnel_cohort). Respeita os
  // filtros de origem e canal. Ticket novo (após fechar) conta de novo.
  const funnelData = useMemo(() => {
    const byId = new Map<string, any>((funnelStages || []).map((s: any) => [s.id, s]));
    const savedOrder = (funnelOrder || []).filter((id: string) => byId.has(id));
    const missing = (funnelStages || [])
      .filter((s: any) => !savedOrder.includes(s.id))
      .sort((a: any, b: any) => a.position - b.position)
      .map((s: any) => s.id);
    const visibleStages = [...savedOrder, ...missing]
      .filter((id: string) => !(funnelHidden || []).includes(id))
      .map((id: string) => byId.get(id))
      .filter(Boolean);

    // Agrega o coorte por etapa, respeitando o filtro de origem (Todos/Meta/Google/Sem Origem).
    // O RPC retorna uma linha por (etapa, plataforma); somamos só as plataformas selecionadas.
    const countByStage = new Map<string, number>();
    (funnelCohort || []).forEach((r: any) => {
      if (selectedPlatform.length > 0 && !selectedPlatform.includes(r.platform)) return;
      if (selectedChannel.length > 0 && !selectedChannel.includes(r.channel)) return;
      countByStage.set(r.stage_id, (countByStage.get(r.stage_id) || 0) + (Number(r.leads) || 0));
    });

    const base = visibleStages.map((stage: any, idx: number) => ({
      id: stage.id,
      name: stage.name,
      value: countByStage.get(stage.id) || 0,
      color: FUNNEL_PALETTE[idx % FUNNEL_PALETTE.length],
    }));

    return base.map((stage, idx, arr) => ({
      ...stage,
      subLabel: idx === 0
        ? 'Tickets que passaram pela etapa no período'
        : `${((stage.value / (arr[idx - 1].value || 1)) * 100).toFixed(1)}% de conversão`,
    }));
  }, [funnelStages, funnelCohort, funnelOrder, funnelHidden, selectedPlatform, selectedChannel]);

  // Maior volume entre as etapas visíveis — referência de 100% da largura das barras do funil.
  const funnelMax = useMemo(() => Math.max(1, ...funnelData.map((s: any) => s.value)), [funnelData]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6 gap-4">
        {metricsOrder.filter((id: string) => visibleMetrics.includes(id)).map((id: string) => {
          const m = METRICS_CONFIG.find(x => x.id === id);
          if (!m) return null;

          let value = 0;
          let prevValue = null;

          if (id === 'investment') { value = currentTotals.investment; prevValue = isComparing ? prevTotals.investment : null; }
          else if (id === 'leads') { value = currentTotals.leads; prevValue = isComparing ? prevTotals.leads : null; }
          else if (id === 'appointments') { value = currentTotals.appointments; prevValue = isComparing ? prevTotals.appointments : null; }
          else if (id === 'convs') { value = currentTotals.convs; prevValue = isComparing ? prevTotals.convs : null; }
          else if (id === 'conv_value') { value = currentTotals.conv_value; prevValue = isComparing ? prevTotals.conv_value : null; }
          else if (id === 'roas') {
            value = currentTotals.investment > 0 ? currentTotals.conv_value / currentTotals.investment : 0;
            prevValue = isComparing ? (prevTotals.investment > 0 ? prevTotals.conv_value / prevTotals.investment : 0) : null;
          }
          else if (id === 'cpl') {
            value = currentTotals.leads > 0 ? currentTotals.investment / currentTotals.leads : 0;
            prevValue = isComparing ? (prevTotals.leads > 0 ? prevTotals.investment / prevTotals.leads : 0) : null;
          }
          else if (id === 'cpapt') {
            value = currentTotals.appointments > 0 ? currentTotals.investment / currentTotals.appointments : 0;
            prevValue = isComparing ? (prevTotals.appointments > 0 ? prevTotals.investment / prevTotals.appointments : 0) : null;
          }
          else if (id === 'cpa') {
            value = currentTotals.convs > 0 ? currentTotals.investment / currentTotals.convs : 0;
            prevValue = isComparing ? (prevTotals.convs > 0 ? prevTotals.investment / prevTotals.convs : 0) : null;
          }
          else if (id === 'lead_to_apt_rate') {
            value = currentTotals.leads > 0 ? (currentTotals.appointments / currentTotals.leads) * 100 : 0;
            prevValue = isComparing ? (prevTotals.leads > 0 ? (prevTotals.appointments / prevTotals.leads) * 100 : 0) : null;
          }
          else if (id === 'lead_to_conv_rate') {
            value = currentTotals.leads > 0 ? (currentTotals.convs / currentTotals.leads) * 100 : 0;
            prevValue = isComparing ? (prevTotals.leads > 0 ? (prevTotals.convs / prevTotals.leads) * 100 : 0) : null;
          }
          else if (id === 'apt_to_conv_rate') {
            value = currentTotals.appointments > 0 ? (currentTotals.convs / currentTotals.appointments) * 100 : 0;
            prevValue = isComparing ? (prevTotals.appointments > 0 ? (prevTotals.convs / prevTotals.appointments) * 100 : 0) : null;
          }

          // Investimento não é atribuível por CANAL (o gasto é por plataforma). Com filtro de
          // canal ativo, o investimento e tudo que deriva dele viram "—" (NaN = sentinel do StatCard).
          if (selectedChannel.length > 0 && ['investment', 'roas', 'cpl', 'cpapt', 'cpa'].includes(id)) {
            value = NaN;
            prevValue = null;
          }

          return (
            <StatCard
              key={id}
              title={m.label}
              value={value}
              prevValue={prevValue}
              type={m.type}
              icon={m.icon}
              color={m.bgColor}
            />
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 bg-white border-slate-200 shadow-xl rounded-3xl p-8 overflow-hidden">
          <CardHeader className="p-0 pb-8">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-teal-50 flex items-center justify-center">
                  <TrendingUp className="w-5 h-5 text-teal-600" />
                </div>
                <div className="flex flex-col">
                  <CardTitle className="text-xs font-black text-slate-400 uppercase tracking-widest">Funil de Vendas</CardTitle>
                  <span className="text-[9px] font-semibold text-slate-300 normal-case tracking-tight">por ticket · última entrada na etapa</span>
                </div>
              </div>
              <FunnelConfigButton
                stages={funnelStages}
                order={funnelOrder}
                hidden={funnelHidden}
                toggleStage={toggleFunnelStage}
                moveStage={moveFunnelStage}
              />
            </div>
          </CardHeader>

          <div className="flex flex-col gap-4 max-w-4xl mx-auto w-full">
            {funnelData.length === 0 && (
              <p className="text-center text-xs text-slate-400 py-8">
                Nenhuma etapa selecionada. Use o ⚙️ para escolher as etapas do funil.
              </p>
            )}
            {funnelData.map((stage, idx) => {
              // Largura proporcional ao nº de leads, com a MAIOR etapa = 100% (mais fiel).
              // Os escritos (etapa/nome/conversão) ficam ACIMA da barra; só o número fica
              // dentro. Um mínimo pequeno garante que o número caiba mesmo em etapas baixas.
              const widthPct = Math.max(10, (stage.value / funnelMax) * 100);
              return (
                <div key={stage.id} className="flex flex-col items-center gap-1.5">
                  <div className="flex flex-col items-center gap-0.5 text-center">
                    <div className="flex items-baseline gap-2">
                      <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: stage.color, opacity: 0.6 }}>Etapa {idx + 1}</span>
                      <span className="text-sm font-black text-slate-700">{stage.name}</span>
                    </div>
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter">{stage.subLabel}</span>
                  </div>
                  <div
                    className="h-14 rounded-2xl flex items-center justify-center shadow-sm transition-all border border-transparent hover:border-slate-100"
                    style={{
                      backgroundColor: `${stage.color}10`,
                      width: `${widthPct}%`
                    }}
                  >
                    <span className="text-lg font-black" style={{ color: stage.color }}>{stage.value.toLocaleString('pt-BR')}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        <Card className="bg-white border-slate-200 shadow-xl rounded-3xl p-6 overflow-hidden">
          <CardHeader className="p-0 pb-6"><CardTitle className="text-xs font-black text-slate-400 uppercase tracking-widest">{platformTitle}</CardTitle></CardHeader>
          <div className="h-[280px] w-full flex items-center justify-center">
            {platformData.length > 0 ? (
              <div className="relative w-full h-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={platformData} cx="50%" cy="45%" innerRadius={60} outerRadius={85} paddingAngle={8} dataKey="value" stroke="none" isAnimationActive={false}>
                      {platformData.map((e, i) => <Cell key={i} fill={e.color} />)}
                    </Pie>
                    <Tooltip contentStyle={{ borderRadius: '20px', border: 'none', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)' }} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none pb-4">
                  <span className="text-[20px] font-black text-slate-700 leading-none">{currentTotals.leads}</span>
                  <span className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter">Leads</span>
                </div>
                <div className="flex flex-col gap-2 pt-2 border-t border-slate-50">
                  {platformData.map((item: any, i) => (
                    <div key={i} className="flex items-center justify-between px-2">
                       <div className="flex items-center gap-2">
                          {item.logo ? (
                            <div className="w-4 h-4 flex items-center justify-center">
                              <img 
                                src={item.logo} 
                                alt={item.name} 
                                className="w-full h-full object-contain" 
                              />
                            </div>
                          ) : (
                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: item.color }} />
                          )}
                          <span className="text-[10px] font-black text-slate-500 uppercase tracking-tight">{item.label || item.name}</span>
                       </div>
                       <span className="text-[11px] font-black text-slate-700 font-sans">{item.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : <div className="text-slate-300 text-[10px] font-bold uppercase tracking-widest">Sem dados</div>}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6">
        <Card className="bg-white border-slate-200 shadow-xl rounded-3xl p-6 overflow-hidden">
          <CardHeader className="p-0 pb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <CardTitle className="text-xs font-black text-slate-400 uppercase tracking-widest">Tendência de Performance</CardTitle>
            <div className="flex flex-wrap bg-slate-50 p-1 rounded-xl border border-slate-100 shadow-inner">
              {metricsOrder.filter((id: string) => visibleMetrics.includes(id)).map(id => {
                const m = METRICS_CONFIG.find(x => x.id === id);
                if (!m) return null;
                return (
                  <button
                    key={id}
                    onClick={() => setSelectedMetric(id)}
                    className={cn(
                      "px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all",
                      selectedMetric === id ? "bg-white text-teal-600 shadow-sm border border-slate-200" : "text-slate-400 hover:text-slate-600"
                    )}
                  >
                    {m.label}
                  </button>
                );
              })}
            </div>
          </CardHeader>
          {(() => {
            const series = chartData.map((d: any) => ({
              label: d.name,
              value: Number(d[selectedMetric]) || 0,
              value2: isComparing ? (Number(d[`${selectedMetric}_prev`]) || 0) : undefined,
            }));
            return <TrendBarChart series={series} format={fmtByType(activeMetric.type)} height={260} />;
          })()}
        </Card>
      </div>

      <UtmFunnelSection
        cohort={utmCohort}
        cohortCompare={utmCohortCompare}
        isComparing={isComparing}
        stages={funnelStages}
        funnelOrder={funnelOrder}
        funnelHidden={funnelHidden}
        periods={periods}
        selectedPlatform={selectedPlatform}
        selectedChannel={selectedChannel}
      />
    </div>
  );
}

// Tendência em LINHAS (uma por valor UTM — lê melhor com várias séries que barras).
function UtmTrendChart({ data, series, height = 260, showLegend = false }: {
  data: any[];
  series: { key: string; name: string; color: string }[];
  height?: number;
  showLegend?: boolean;
}) {
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 9, fill: '#94a3b8' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
          <YAxis tick={{ fontSize: 9, fill: '#94a3b8' }} axisLine={false} tickLine={false} allowDecimals={false} width={28} />
          <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 20px -5px rgb(0 0 0 / 0.1)', fontSize: 11 }} />
          {showLegend && <Legend wrapperStyle={{ fontSize: 10 }} />}
          {series.map(s => (
            <Line key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={2} dot={false} activeDot={{ r: 3 }} isAnimationActive={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// Card de pizza (donut) reutilizável: participação % por valor UTM, com total no centro.
// `trend` (opcional): mini-gráfico de tendência no rodapé (linhas nas cores das fatias).
function UtmPieCard({ title, pie, trend }: {
  title: string;
  pie: { total: number; totalDelta?: number | null; slices: any[] };
  trend?: { data: any[]; series: { key: string; name: string; color: string }[] };
}) {
  return (
    <Card className="bg-white border-slate-200 shadow-xl rounded-3xl p-6 overflow-hidden">
      <CardHeader className="p-0 pb-6">
        <CardTitle className="text-xs font-black text-slate-400 uppercase tracking-widest">{title}</CardTitle>
      </CardHeader>
      {pie.total === 0 ? (
        <div className="h-[280px] flex items-center justify-center text-slate-300 text-[10px] font-bold uppercase tracking-widest">Sem dados</div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="relative h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={pie.slices} cx="50%" cy="50%" innerRadius={60} outerRadius={88} paddingAngle={3} dataKey="value" stroke="none" isAnimationActive={false}>
                  {pie.slices.map((s: any, i: number) => <Cell key={i} fill={s.color} />)}
                </Pie>
                <Tooltip
                  contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)', fontSize: 12 }}
                  formatter={(v: any, _n: any, p: any) => [`${Number(v).toLocaleString('pt-BR')} (${p?.payload?.pct?.toFixed(1)}%)`, p?.payload?.name]}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 pointer-events-none">
              <span className="text-[20px] font-black text-slate-700 leading-none">{pie.total.toLocaleString('pt-BR')}</span>
              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter">Total</span>
              {pie.totalDelta != null && (
                <span className={cn("mt-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-black", pie.totalDelta >= 0 ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600")}>
                  {pie.totalDelta >= 0 ? '↑' : '↓'} {Math.abs(pie.totalDelta).toFixed(1)}%
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            {pie.slices.map((s: any) => (
              <div key={s.key} className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                  <span className="text-[11px] font-bold text-slate-600 truncate" title={s.name}>{s.name}</span>
                </div>
                <div className="flex items-baseline gap-2 shrink-0">
                  {s.delta != null && (
                    <span className={cn("px-1.5 py-0.5 rounded-full text-[9px] font-black", s.delta >= 0 ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600")}>
                      {s.delta >= 0 ? '↑' : '↓'} {Math.abs(s.delta).toFixed(0)}%
                    </span>
                  )}
                  <span className="text-[11px] font-black text-slate-700 tabular-nums">{s.pct.toFixed(1)}%</span>
                  <span className="text-[10px] font-bold text-slate-400 tabular-nums">{s.value.toLocaleString('pt-BR')}</span>
                </div>
              </div>
            ))}
          </div>

          {trend && trend.series.length > 0 && (
            <div className="pt-3 border-t border-slate-50">
              <span className="text-[9px] font-black text-slate-300 uppercase tracking-widest">Tendência</span>
              <UtmTrendChart data={trend.data} series={trend.series} height={110} />
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

// ============================================================================
// Seção "Análise por UTM × Etapa de Funil"
// Cruza desempenho por UTM (campanha/conjunto/anúncio/termo/origem) com as etapas
// do funil. Fonte: coorte único marketing_utm_funnel_cohort (por ticket / última
// entrada). A dimensão UTM e os valores UTM/Motivo de Perda são filtros GLOBAIS
// (aplicados no pai); aqui o filtro próprio é só o de Etapas (lente analítica).
// ============================================================================
function UtmFunnelSection({ cohort, cohortCompare, isComparing, stages, funnelOrder, funnelHidden, periods, selectedPlatform, selectedChannel }: any) {
  // Filtros LOCAIS da seção (aplicam-se SÓ aos gráficos de UTM): dimensão + valores UTM +
  // motivo de perda + etapas. Não afetam cards/Funil/pizza/Tendência de Performance.
  const [utmDimension, setUtmDimension] = useState<string>('utm_campaign');
  const [selectedUtm, setSelectedUtm] = useState<string[]>([]);
  const [selectedLossReasons, setSelectedLossReasons] = useState<string[]>([]);
  const [selectedStages, setSelectedStages] = useState<string[]>([]);

  // Quais etapas aparecem no filtro/visão desta seção (config própria, via ⚙️).
  // Enquanto o usuário não customizar, segue a config do Funil de Vendas (ordem/ocultas).
  const [stageOrder, setStageOrder] = useState<string[]>(() => {
    const saved = localStorage.getItem('mkt_utm_stage_order');
    return saved ? JSON.parse(saved) : [];
  });
  const [stageHiddenOverride, setStageHiddenOverride] = useState<string[] | null>(() => {
    const saved = localStorage.getItem('mkt_utm_stage_hidden');
    return saved ? JSON.parse(saved) : null;
  });
  const effectiveStageHidden = stageHiddenOverride ?? funnelHidden ?? [];
  const effectiveStageOrder = stageOrder.length > 0 ? stageOrder : (funnelOrder || []);

  const toggleStageVisibility = (id: string) => {
    const willHide = !effectiveStageHidden.includes(id);
    const next = willHide ? [...effectiveStageHidden, id] : effectiveStageHidden.filter((x: string) => x !== id);
    setStageHiddenOverride(next);
    localStorage.setItem('mkt_utm_stage_hidden', JSON.stringify(next));
    // Se a etapa saiu da visão, remove-a também da seleção ativa do filtro.
    if (willHide) setSelectedStages((prev) => prev.filter((x) => x !== id));
  };

  const moveStageOption = (id: string, direction: 'up' | 'down') => {
    const byId = new Map<string, any>((stages || []).map((s: any) => [s.id, s]));
    const sortedIds = [...(stages || [])].sort((a: any, b: any) => a.position - b.position).map((s: any) => s.id);
    const saved = effectiveStageOrder.filter((x: string) => byId.has(x));
    const cur = [...saved, ...sortedIds.filter((x: string) => !saved.includes(x))];
    const i = cur.indexOf(id);
    if (i === -1) return;
    const j = direction === 'up' ? i - 1 : i + 1;
    if (j < 0 || j >= cur.length) return;
    const next = [...cur];
    [next[i], next[j]] = [next[j], next[i]];
    setStageOrder(next);
    localStorage.setItem('mkt_utm_stage_order', JSON.stringify(next));
  };

  // Etapas FIXAS: sempre aparecem no filtro (não podem ser ocultadas pelo ⚙️).
  const fixedStageIds = useMemo(
    () => new Set((stages || []).filter((s: any) => ['forms', 'whatsapp', 'ganho', 'perdido'].includes(s.slug)).map((s: any) => s.id)),
    [stages]
  );
  const perdidoStageId = useMemo(() => (stages || []).find((s: any) => s.slug === 'perdido')?.id ?? null, [stages]);

  // Etapas visíveis na ordem escolhida (default = config do Funil de Vendas).
  // As fixas entram sempre, mesmo se ocultas na config.
  const visibleStages = useMemo(() => {
    const byId = new Map<string, any>((stages || []).map((s: any) => [s.id, s]));
    const savedOrder = (effectiveStageOrder || []).filter((id: string) => byId.has(id));
    const missing = (stages || [])
      .filter((s: any) => !savedOrder.includes(s.id))
      .sort((a: any, b: any) => a.position - b.position)
      .map((s: any) => s.id);
    return [...savedOrder, ...missing]
      .filter((id: string) => fixedStageIds.has(id) || !(effectiveStageHidden || []).includes(id))
      .map((id: string) => byId.get(id))
      .filter(Boolean);
  }, [stages, effectiveStageOrder, effectiveStageHidden, fixedStageIds]);

  const visibleStageIds = useMemo(() => new Set(visibleStages.map((s: any) => s.id)), [visibleStages]);
  // Etapas usadas como métrica em Ranking/Tendência: as selecionadas ou (vazio) todas as visíveis.
  const effectiveStageIds = useMemo(
    () => (selectedStages.length > 0 ? selectedStages : visibleStages.map((s: any) => s.id)),
    [selectedStages, visibleStages]
  );
  const effectiveStageSet = useMemo(() => new Set(effectiveStageIds), [effectiveStageIds]);

  // Linhas no escopo da seção: filtros globais de origem/canal + etapas visíveis.
  const baseRows = useMemo(() => {
    return (cohort || []).filter((r: any) => {
      if (selectedPlatform.length > 0 && !selectedPlatform.includes(r.platform)) return false;
      if (selectedChannel.length > 0 && !selectedChannel.includes(r.channel)) return false;
      if (!visibleStageIds.has(r.stage_id)) return false;
      return true;
    });
  }, [cohort, selectedPlatform, selectedChannel, visibleStageIds]);

  const utmKeyOf = useCallback((r: any) => rowUtmKey(r, utmDimension), [utmDimension]);
  const utmLabelOf = (key: string) => (key === NO_UTM_KEY ? 'Sem UTM' : key);

  // Opções dos filtros locais (a partir de baseRows; independem da própria seleção).
  const utmOptions = useMemo(() => {
    const totals = new Map<string, number>();
    baseRows.forEach((r: any) => {
      if (!effectiveStageSet.has(r.stage_id)) return;
      const k = utmKeyOf(r);
      totals.set(k, (totals.get(k) || 0) + (Number(r.leads) || 0));
    });
    return [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([key, value]) => ({ key, label: utmLabelOf(key), value }));
  }, [baseRows, effectiveStageSet, utmKeyOf]);

  // Motivos de perda derivados dos dados reais (variam por clínica). "Fora do perfil" = "sem perfil".
  const lossReasonOptions = useMemo(() => {
    const totals = new Map<string, number>();
    baseRows.forEach((r: any) => { if (r.loss_reason) totals.set(r.loss_reason, (totals.get(r.loss_reason) || 0) + (Number(r.leads) || 0)); });
    return [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([key, value]) => ({ key, label: key, value }));
  }, [baseRows]);

  const changeDimension = (id: string) => { setUtmDimension(id); setSelectedUtm([]); };
  const utmFilterActive = (key: string) => selectedUtm.length === 0 || selectedUtm.includes(key);
  const lossFilterActive = (lr: string | null) => selectedLossReasons.length === 0 || (!!lr && selectedLossReasons.includes(lr));

  // Linhas após os filtros locais de UTM (valor) e Motivo de perda — alimentam os 3 gráficos.
  const filteredRows = useMemo(
    () => baseRows.filter((r: any) => utmFilterActive(utmKeyOf(r)) && lossFilterActive(r.loss_reason)),
    [baseRows, utmKeyOf, selectedUtm, selectedLossReasons]
  );

  // Mesmas regras de filtro aplicadas ao coorte do período COMPARATIVO (base dos % de variação).
  const compareRows = useMemo(() => {
    if (!isComparing) return [];
    return (cohortCompare || []).filter((r: any) => {
      if (selectedPlatform.length > 0 && !selectedPlatform.includes(r.platform)) return false;
      if (selectedChannel.length > 0 && !selectedChannel.includes(r.channel)) return false;
      if (!visibleStageIds.has(r.stage_id)) return false;
      if (!utmFilterActive(utmKeyOf(r))) return false;
      if (!lossFilterActive(r.loss_reason)) return false;
      return true;
    });
  }, [isComparing, cohortCompare, selectedPlatform, selectedChannel, visibleStageIds, utmKeyOf, selectedUtm, selectedLossReasons]);

  // Totais do comparativo por valor UTM (etapas efetivas) + total geral.
  const compareTotals = useMemo(() => {
    const m = new Map<string, number>();
    compareRows.forEach((r: any) => { if (effectiveStageSet.has(r.stage_id)) m.set(utmKeyOf(r), (m.get(utmKeyOf(r)) || 0) + (Number(r.leads) || 0)); });
    return m;
  }, [compareRows, effectiveStageSet, utmKeyOf]);
  const pctDelta = (cur: number, prev: number): number | null => (prev > 0 ? ((cur - prev) / prev) * 100 : null);

  // === Ranking por UTM (Σ leads nas etapas efetivas, por valor da dimensão) ===
  const rankingData = useMemo(() => {
    const totals = new Map<string, number>();
    filteredRows.forEach((r: any) => {
      if (!effectiveStageSet.has(r.stage_id)) return;
      const k = utmKeyOf(r);
      totals.set(k, (totals.get(k) || 0) + (Number(r.leads) || 0));
    });
    return [...totals.entries()]
      .map(([key, value]) => ({ key, name: utmLabelOf(key), value, delta: isComparing ? pctDelta(value, compareTotals.get(key) || 0) : null }))
      .filter(d => d.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, UTM_TOP_N);
  }, [filteredRows, effectiveStageSet, utmKeyOf, isComparing, compareTotals]);

  // "Todos" os tipos de UTM: mostra uma pizza por dimensão (5 gráficos).
  const isAllDims = utmDimension === 'all';

  // Pizza (participação %) da dimensão ativa, com % de variação POR FATIA quando comparando.
  const pieData = useMemo(
    () => buildPie(filteredRows, utmDimension, effectiveStageSet, isComparing ? compareRows : undefined),
    [filteredRows, utmDimension, effectiveStageSet, isComparing, compareRows]
  );

  // Uma pizza por dimensão UTM (usada no modo "Todos"), com mini-tendência das top fatias
  // e % de variação por fatia.
  const allPies = useMemo(() => {
    if (!isAllDims) return [];
    return UTM_DIMENSIONS.map(d => {
      const pie = buildPie(filteredRows, d.id, effectiveStageSet, isComparing ? compareRows : undefined);
      const top = pie.slices.filter((s: any) => s.key !== '__outros__').slice(0, 4);
      const trend = {
        data: buildDimTrend(filteredRows, d.id, effectiveStageSet, periods, top.map((s: any) => s.key)),
        series: top.map((s: any) => ({ key: s.key, name: s.name, color: s.color })),
      };
      return { id: d.id, label: d.label, pie, trend };
    });
  }, [isAllDims, filteredRows, effectiveStageSet, periods, isComparing, compareRows]);

  // === Tendência por UTM (uma série por valor UTM, top N, ao longo dos períodos) ===
  const { trendData, trendKeys } = useMemo(() => {
    // top N valores UTM por volume nas etapas efetivas
    const topKeys = rankingData.slice(0, UTM_TREND_SERIES).map(d => d.key);
    const byPeriodKey = new Map<string, Map<string, number>>(); // periodLabel -> (utmKey -> leads)
    periods.forEach((p: any) => byPeriodKey.set(p.label, new Map()));
    filteredRows.forEach((r: any) => {
      if (!effectiveStageSet.has(r.stage_id)) return;
      const k = utmKeyOf(r);
      if (!topKeys.includes(k)) return;
      const period = periods.find((p: any) => r.entry_date >= format(p.start, 'yyyy-MM-dd') && r.entry_date <= format(p.end, 'yyyy-MM-dd'));
      if (!period) return;
      const m = byPeriodKey.get(period.label)!;
      m.set(k, (m.get(k) || 0) + (Number(r.leads) || 0));
    });
    const data = periods.map((p: any) => {
      const m = byPeriodKey.get(p.label)!;
      const row: any = { name: p.label };
      topKeys.forEach((k) => { row[k] = m.get(k) || 0; });
      return row;
    });
    return { trendData: data, trendKeys: topKeys };
  }, [rankingData, filteredRows, effectiveStageSet, utmKeyOf, periods]);

  // Séries (cor por valor UTM) para a tendência em barras empilhadas.
  const trendSeries = useMemo(
    () => trendKeys.map((k, i) => ({ key: k, name: utmLabelOf(k), color: UTM_SERIES_COLORS[i % UTM_SERIES_COLORS.length] })),
    [trendKeys]
  );

  const rankingMax = useMemo(() => Math.max(1, ...rankingData.map(d => d.value)), [rankingData]);
  const activeDimLabel = UTM_DIMENSIONS.find(d => d.id === utmDimension)?.label || 'UTM';

  const stageChipOptions = useMemo(
    () => [{ id: 'all', label: 'Todas' }, ...visibleStages.map((s: any) => ({ id: s.id, label: s.name }))],
    [visibleStages]
  );

  return (
    <div className="space-y-4 pt-2">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-teal-50 flex items-center justify-center">
          <Filter className="w-5 h-5 text-teal-600" />
        </div>
        <div className="flex flex-col">
          <h2 className="text-xs font-black text-slate-400 uppercase tracking-widest">Análise por UTM × Etapa</h2>
          <span className="text-[9px] font-semibold text-slate-300 normal-case tracking-tight">por ticket · última entrada na etapa</span>
        </div>
      </div>

      {/* Filtros desta seção — aplicam-se SÓ aos gráficos de UTM abaixo. */}
      <div className="flex items-center flex-wrap gap-3">
        <FilterChips
          value={utmDimension}
          onChange={changeDimension}
          options={[{ id: 'all', label: 'Todos' }, ...UTM_DIMENSIONS.map(d => ({ id: d.id, label: d.label }))]}
        />
        {!isAllDims && (
          <UtmValuePicker
            label={activeDimLabel}
            allLabel={`Todas as ${activeDimLabel.toLowerCase()}s`}
            options={utmOptions}
            selected={selectedUtm}
            onChange={setSelectedUtm}
          />
        )}
        <UtmValuePicker
          label="Motivo de perda"
          allLabel="Filtrar por motivo"
          options={lossReasonOptions}
          selected={selectedLossReasons}
          onChange={(v: string[]) => {
            setSelectedLossReasons(v);
            // Ao escolher um motivo de perda, marca automaticamente a etapa "Perdido".
            if (v.length > 0 && perdidoStageId) {
              setSelectedStages(prev => (prev.includes(perdidoStageId) ? prev : [...prev, perdidoStageId]));
            }
          }}
        />
        <div className="flex items-center gap-1.5">
          <FilterChips
            multiple
            allId="all"
            value={selectedStages}
            onChange={(ids: string[]) => setSelectedStages(ids)}
            options={stageChipOptions}
          />
          <FunnelConfigButton
            stages={stages}
            order={effectiveStageOrder}
            hidden={effectiveStageHidden}
            toggleStage={toggleStageVisibility}
            moveStage={moveStageOption}
            fixedIds={fixedStageIds}
          />
        </div>
      </div>

      {isAllDims ? (
      /* "Todos" os tipos: uma pizza de participação por dimensão (5 gráficos) */
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {allPies.map((p: any) => (
          <UtmPieCard key={p.id} title={`Participação por ${p.label}`} pie={p.pie} trend={p.trend} />
        ))}
      </div>
      ) : (
      <>
      {/* Ranking + Participação (pizza) lado a lado */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card className="bg-white border-slate-200 shadow-xl rounded-3xl p-6 overflow-hidden">
        <CardHeader className="p-0 pb-6">
          <CardTitle className="text-xs font-black text-slate-400 uppercase tracking-widest">Ranking por {activeDimLabel}</CardTitle>
        </CardHeader>
        {rankingData.length === 0 ? (
          <div className="h-[280px] flex items-center justify-center text-slate-300 text-[10px] font-bold uppercase tracking-widest">Sem dados</div>
        ) : (
          <div className="flex flex-col gap-3">
            {rankingData.map((d, idx) => {
              const widthPct = Math.max(4, (d.value / rankingMax) * 100);
              const color = UTM_SERIES_COLORS[idx % UTM_SERIES_COLORS.length];
              return (
                <div key={d.key} className="flex flex-col gap-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[11px] font-bold text-slate-600 truncate" title={d.name}>{d.name}</span>
                    <div className="flex items-baseline gap-2 shrink-0">
                      {d.delta != null && (
                        <span className={cn("px-1.5 py-0.5 rounded-full text-[9px] font-black", d.delta >= 0 ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600")}>
                          {d.delta >= 0 ? '↑' : '↓'} {Math.abs(d.delta).toFixed(0)}%
                        </span>
                      )}
                      <span className="text-[11px] font-black text-slate-700 tabular-nums">{d.value.toLocaleString('pt-BR')}</span>
                    </div>
                  </div>
                  <div className="h-3 rounded-full bg-slate-50 overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{ width: `${widthPct}%`, backgroundColor: color }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <UtmPieCard title={`Participação por ${activeDimLabel}`} pie={pieData} />
      </div>

      {/* Tendência por UTM — barras empilhadas (top valores) + linha de média */}
      <Card className="bg-white border-slate-200 shadow-xl rounded-3xl p-6 overflow-hidden">
        <CardHeader className="p-0 pb-6">
          <CardTitle className="text-xs font-black text-slate-400 uppercase tracking-widest">Tendência por {activeDimLabel}</CardTitle>
        </CardHeader>
        {trendSeries.length === 0 ? (
          <div className="h-[300px] flex items-center justify-center text-slate-300 text-[10px] font-bold uppercase tracking-widest">Sem dados</div>
        ) : (
          <UtmTrendChart data={trendData} series={trendSeries} height={300} showLegend />
        )}
      </Card>
      </>
      )}

    </div>
  );
}

// Dropdown popover de seleção de valores UTM (multi, com busca). Modelado no padrão
// dos botões de config deste arquivo (overlay + motion.div). Vazio = "Todos".
function UtmValuePicker({ label, allLabel, options, selected, onChange }: {
  label: string;
  allLabel?: string;
  options: { key: string; label: string; value: number }[];
  selected: string[];
  onChange: (v: string[]) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');

  const filtered = useMemo(
    () => options.filter(o => o.label.toLowerCase().includes(query.toLowerCase())),
    [options, query]
  );

  const toggle = (key: string) => {
    onChange(selected.includes(key) ? selected.filter(k => k !== key) : [...selected, key]);
  };

  const summary = selected.length === 0 ? (allLabel ?? `Todas as ${label.toLowerCase()}s`) : `${selected.length} selecionada(s)`;

  return (
    <div className="relative">
      <Button
        onClick={() => setIsOpen(!isOpen)}
        variant="outline"
        className={cn(
          "rounded-xl h-9 gap-2 text-[10px] font-bold uppercase transition-all shadow-sm",
          isOpen || selected.length > 0 ? "bg-teal-50 border-teal-200 text-teal-600 shadow-teal-100" : "border-slate-200 bg-white hover:bg-slate-50 text-slate-600"
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
              <div className="flex items-center justify-between mb-2">
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest pl-1">{label}</p>
                {selected.length > 0 && (
                  <button onClick={() => onChange([])} className="text-[9px] font-bold text-teal-600 hover:underline uppercase tracking-tight">Limpar</button>
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

function StatCard({ title, value, prevValue, type, icon: Icon, color }: any) {
  // Valor não-finito (NaN/null) = "não atribuível" (ex.: investimento sob filtro de canal) → "—".
  const isNA = value == null || !Number.isFinite(value);
  const delta = (!isNA && prevValue !== null && prevValue > 0) ? ((value - prevValue) / prevValue) * 100 : null;
  return (
    <Card className="bg-white border-slate-200 shadow-lg rounded-3xl p-5 overflow-hidden group hover:shadow-xl transition-all">
      <div className="flex items-start justify-between">
        <div className={cn("p-2.5 rounded-2xl", color)}><Icon className="w-5 h-5" /></div>
        {delta !== null && (
          <div className={cn("flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-black", delta > 0 ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600")}>
            {delta > 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
            {Math.abs(delta).toFixed(1)}%
          </div>
        )}
      </div>
      <div className="mt-4">
        <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{title}</h3>
        <p className="text-lg font-black text-slate-900 mt-1 whitespace-nowrap">
          {isNA ? "—" :
            type === 'currency' ? `R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` :
            type === 'percent' ? `${value.toFixed(1)}%` :
            type === 'ratio' ? `${value.toFixed(2)}x` : value.toLocaleString('pt-BR')}
        </p>
      </div>
    </Card>
  );
}


function PlatformRows({ platform, periods, metricsByPeriod, comparisonMetricsByPeriod, isComparing, isEditing, editValues, setEditValues, period, visibleMetrics, metricsOrder }: any) {
  return (
    <>
      <tr className={cn(
        platform === 'meta_ads' ? "bg-blue-50/60" : 
        platform === 'google_ads' ? "bg-emerald-50/60" : 
        "bg-slate-50/50"
      )}>
        <td className={cn("px-6 py-4 border-r border-slate-100")}>
          <div className="flex items-center gap-3">
            {platform === 'meta_ads' && (
              <div className="w-5 h-5 rounded flex items-center justify-center bg-blue-100/50 p-1">
                <img src={MetaLogo} alt="Meta" className="w-full h-full object-contain" />
              </div>
            )}
            {platform === 'google_ads' && (
              <div className="w-5 h-5 rounded flex items-center justify-center bg-emerald-100/50 p-1">
                <img src={GoogleLogo} alt="Google" className="w-full h-full object-contain" />
              </div>
            )}
            {platform === 'no_track' && (
              <div className="w-5 h-5 rounded flex items-center justify-center bg-slate-100/50 p-1">
                <img src={SemOrigemLogo} alt="Orgânico" className="w-full h-full object-contain opacity-50" />
              </div>
            )}
            <span className={cn("text-[10px] font-black tracking-[3px]", PLATFORM_COLORS[platform as Platform])}>
              {PLATFORM_LABELS[platform as Platform]}
            </span>
          </div>
        </td>
        {periods.map((_: any, idx: number) => <td key={idx} className="px-6 py-4 bg-slate-50/30" />)}
      </tr>
      {metricsOrder.filter((id: string) => visibleMetrics.includes(id)).map((id: string) => {
        const m = METRICS_CONFIG.find(x => x.id === id);
        if (!m) return null;
        return (
          <MetricRow
            key={m.id}
            label={m.label.toUpperCase()}
            periods={periods}
            metrics={metricsByPeriod}
            compareMetrics={comparisonMetricsByPeriod}
            isComparing={isComparing}
            platform={platform}
            type={m.type}
            valueKey={m.id}
            isEditing={isEditing}
            editValues={editValues}
            setEditValues={setEditValues}
            period={period}
          />
        );
      })}
    </>
  );
}

function SummaryRows({ periods, metricsByPeriod, comparisonMetricsByPeriod, isComparing, visibleMetrics, metricsOrder }: any) {
  return (
    <>
      <tr className="bg-teal-50/50">
        <td className="px-6 py-4 text-[10px] font-black tracking-[3px] text-teal-600 border-r border-slate-100">RESUMO GERAL</td>
        {periods.map((_, idx) => <td key={idx} />)}
      </tr>
      {metricsOrder.filter((id: string) => visibleMetrics.includes(id)).map((id: string) => {
        const m = METRICS_CONFIG.find(x => x.id === id);
        if (!m) return null;
        return (
          <SummaryMetricRow
            key={m.id}
            label={m.label.toUpperCase()}
            periods={periods}
            metrics={metricsByPeriod}
            compareMetrics={comparisonMetricsByPeriod}
            isComparing={isComparing}
            type={m.id}
          />
        );
      })}
    </>
  );
}

function MetricRow({ label, periods, metrics, compareMetrics, isComparing, platform, type, valueKey, isEditing, editValues, setEditValues, period }: any) {
  return (
    <tr className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
      <td className="px-6 py-3 text-[9px] font-bold text-slate-400 uppercase tracking-wider pl-10 border-r border-slate-100 whitespace-nowrap">{label}</td>
      {periods.map((p: any, idx: number) => {
        const pKey = p.label;
        const dateStr = format(p.start, 'yyyy-MM-dd');
        const dayMetrics = metrics[pKey]?.[platform];
        const prevMetrics = compareMetrics?.[pKey]?.[platform];
        const editKey = `${dateStr}-${platform}-${valueKey}`;

        const currentInv = (isEditing && period === 'dia' ? Number(editValues[`${dateStr}-${platform}-investment`] || 0) : dayMetrics?.investment) || 0;
        const currentLeads = (isEditing && period === 'dia' ? Number(editValues[`${dateStr}-${platform}-leads`] || 0) : dayMetrics?.leads) || 0;
        const currentApts = (isEditing && period === 'dia' ? Number(editValues[`${dateStr}-${platform}-appointments`] || 0) : dayMetrics?.appointments) || 0;
        const currentConvs = (isEditing && period === 'dia' ? Number(editValues[`${dateStr}-${platform}-convs`] || 0) : dayMetrics?.convs) || 0;
        const currentValue = (isEditing && period === 'dia' ? Number(editValues[`${dateStr}-${platform}-value`] || 0) : dayMetrics?.value) || 0;

        const prevInv = prevMetrics?.investment || 0;
        const prevLeads = prevMetrics?.leads || 0;

        let val = 0;
        let pVal = 0;

        if (type === 'currency' && valueKey === 'investment') { val = currentInv; pVal = prevInv; }
        else if (type === 'currency' && (valueKey === 'value' || valueKey === 'conv_value')) { val = currentValue; pVal = prevMetrics?.conv_value || 0; }
        else if (valueKey === 'lead_to_apt_rate') { val = currentLeads > 0 ? (currentApts / currentLeads) * 100 : 0; pVal = prevLeads > 0 ? ((prevMetrics?.appointments || 0) / prevLeads) * 100 : 0; }
        else if (valueKey === 'lead_to_conv_rate') { val = currentLeads > 0 ? (currentConvs / currentLeads) * 100 : 0; pVal = prevLeads > 0 ? ((prevMetrics?.convs || 0) / prevLeads) * 100 : 0; }
        else if (valueKey === 'apt_to_conv_rate') { val = currentApts > 0 ? (currentConvs / currentApts) * 100 : 0; pVal = (prevMetrics?.appointments || 0) > 0 ? ((prevMetrics?.convs || 0) / (prevMetrics?.appointments || 1)) * 100 : 0; }
        else if (valueKey === 'cpl') { val = currentLeads > 0 ? currentInv / currentLeads : 0; pVal = prevLeads > 0 ? prevInv / prevLeads : 0; }
        else if (valueKey === 'cpapt') { val = currentApts > 0 ? currentInv / currentApts : 0; pVal = (prevMetrics?.appointments || 0) > 0 ? prevInv / prevMetrics.appointments : 0; }
        else if (valueKey === 'cpa') { val = currentConvs > 0 ? currentInv / currentConvs : 0; pVal = (prevMetrics?.convs || 0) > 0 ? prevInv / prevMetrics.convs : 0; }
        else if (valueKey === 'roas') { val = currentInv > 0 ? currentValue / currentInv : 0; pVal = prevInv > 0 ? (prevMetrics?.conv_value || 0) / prevInv : 0; }
        else if (valueKey === 'leads') { val = currentLeads; pVal = prevLeads; }
        else if (valueKey === 'appointments') { val = currentApts; pVal = prevMetrics?.appointments || 0; }
        else if (valueKey === 'convs') { val = currentConvs; pVal = prevMetrics?.convs || 0; }
        else { val = (dayMetrics as any)?.[valueKey] || 0; pVal = (prevMetrics as any)?.[valueKey] || 0; }

        const delta = pVal > 0 ? ((val - pVal) / pVal) * 100 : null;

        const isCalculated = ['cpl', 'cpa', 'cpapt', 'roas'].includes(valueKey);

        if (isEditing && period === 'dia' && valueKey && !isCalculated) {
          const isMoney = valueKey === 'investment' || valueKey === 'conversions_value' || valueKey === 'conv_value';
          return (
            <td key={idx} className="px-4 py-2 border-r border-slate-50 last:border-r-0">
              <input
                type="text"
                inputMode={isMoney ? 'decimal' : 'numeric'}
                value={editValues[editKey] ?? ''}
                onChange={e => {
                  const raw = e.target.value;
                  if (isMoney) {
                    // aceita "2.500,50" ou "2500.50" - normaliza pra US no state
                    const cleaned = raw.replace(/[^\d.,]/g, '');
                    const hasComma = cleaned.includes(',');
                    const hasDot = cleaned.includes('.');
                    let normalized = cleaned;
                    if (hasComma && hasDot) {
                      const lastComma = cleaned.lastIndexOf(',');
                      const lastDot = cleaned.lastIndexOf('.');
                      normalized = lastComma > lastDot
                        ? cleaned.replace(/\./g, '').replace(',', '.')
                        : cleaned.replace(/,/g, '');
                    } else if (hasComma) {
                      normalized = cleaned.replace(',', '.');
                    }
                    setEditValues((prev: any) => ({ ...prev, [editKey]: normalized }));
                  } else {
                    setEditValues((prev: any) => ({ ...prev, [editKey]: raw.replace(/\D/g, '') }));
                  }
                }}
                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-black text-center text-slate-900 focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 outline-none transition-all placeholder:text-slate-300"
                placeholder="0"
              />
            </td>
          );
        }

        return (
          <td key={idx} className="px-6 py-3 text-center border-r border-slate-50 last:border-r-0 whitespace-nowrap">
            <div className="flex flex-col items-center">
              <span className={cn("text-xs font-bold transition-all", isComparing ? "text-slate-900" : "text-slate-600")}>
                {type === 'currency' ? `R$ ${val.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : type === 'percent' ? (val > 0 ? `${val.toFixed(1)}%` : '—') : type === 'ratio' ? `${val.toFixed(2)}x` : val}
              </span>
              {isComparing && (
                <div className={cn("text-[8px] font-black mt-1 px-1.5 py-0.5 rounded-full", delta && delta > 0 ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600")}>
                  {delta !== null ? `${Math.abs(delta).toFixed(1)}%` : '—'}
                </div>
              )}
            </div>
          </td>
        );
      })}
    </tr>
  );
}

function SummaryMetricRow({ label, periods, metrics, compareMetrics, isComparing, type }: any) {
  return (
    <tr className="border-b border-slate-100 bg-teal-50/10">
      <td className="px-6 py-3 text-[9px] font-bold text-teal-700 uppercase tracking-wider pl-10 border-r border-slate-100">{label}</td>
      {periods.map((p: any, idx: number) => {
        const stats = metrics[p.label];
        const prevStats = compareMetrics?.[p.label];
        const platforms = ['meta_ads', 'google_ads', 'no_track'] as Platform[];

        const getTotals = (s: any) => {
          const res = { leads: 0, convs: 0, investment: 0, value: 0, appointments: 0 };
          platforms.forEach(pl => {
            res.leads += s?.[pl]?.leads || 0;
            res.convs += s?.[pl]?.convs || 0;
            res.investment += s?.[pl]?.investment || 0;
            res.value += s?.[pl]?.conv_value || 0;
            res.appointments += s?.[pl]?.appointments || 0;
          });
          return res;
        };

        const current = getTotals(stats);
        const previous = getTotals(prevStats);

        let val: any = 0;
        let formatType: 'num' | 'curr' | 'perc' | 'ratio' = 'num';

        if (type === 'leads') val = current.leads;
        else if (type === 'convs') val = current.convs;
        else if (type === 'appointments') val = current.appointments;
        else if (type === 'investment') { val = current.investment; formatType = 'curr'; }
        else if (type === 'conv_value') { val = current.value; formatType = 'curr'; }
        else if (type === 'cpl') { val = current.leads > 0 ? current.investment / current.leads : 0; formatType = 'curr'; }
        else if (type === 'cpapt') { val = current.appointments > 0 ? current.investment / current.appointments : 0; formatType = 'curr'; }
        else if (type === 'cpa') { val = current.convs > 0 ? current.investment / current.convs : 0; formatType = 'curr'; }
        else if (type === 'roas') { val = current.investment > 0 ? current.value / current.investment : 0; formatType = 'ratio'; }
        else if (type === 'lead_to_apt_rate') { val = current.leads > 0 ? (current.appointments / current.leads) * 100 : 0; formatType = 'perc'; }
        else if (type === 'lead_to_conv_rate') { val = current.leads > 0 ? (current.convs / current.leads) * 100 : 0; formatType = 'perc'; }
        else if (type === 'apt_to_conv_rate') { val = current.appointments > 0 ? (current.convs / current.appointments) * 100 : 0; formatType = 'perc'; }

        return (
          <td key={idx} className="px-6 py-3 text-center border-r border-slate-50 last:border-r-0">
            <span className="text-xs font-black text-slate-900">
              {formatType === 'curr' ? `R$ ${val.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : formatType === 'perc' ? `${val.toFixed(1)}%` : formatType === 'ratio' ? `${val.toFixed(2)}x` : val}
            </span>
          </td>
        );
      })}
    </tr>
  );
}
