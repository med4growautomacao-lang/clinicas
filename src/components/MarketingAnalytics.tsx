import React, { useState, useEffect, useMemo, useCallback } from "react";
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
  ChevronRight,
  RefreshCw,
  Edit3,
  Link2,
  X,
  Activity,
  CheckCircle2
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
  BarChart,
  Bar,
  Legend
} from 'recharts';
import { cn } from "@/src/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { useLeads, useMarketing, MarketingData, Lead, useAppointments, useFunnelStages } from "../hooks/useSupabase";
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
  differenceInDays
} from "date-fns";
import { ptBR } from "date-fns/locale";
import MetaLogo from "../assets/logos/Logo Metaads.png";
import GoogleLogo from "../assets/logos/Logo Googleads.png";
import SemOrigemLogo from "../assets/logos/Logo Sem origem.png";

type Period = 'dia' | 'sem' | 'mês';
type Platform = 'meta_ads' | 'google_ads' | 'no_track';

const PLATFORM_LABELS: Record<Platform, string> = {
  meta_ads: 'META ADS',
  google_ads: 'GOOGLE ADS',
  no_track: 'SEM ORIGEM'
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
  { id: 'cpa', label: 'CPA (Conv.)', color: '#f43f5e', type: 'currency', icon: Activity, bgColor: 'bg-rose-50 text-rose-600' },
  { id: 'conv_value', label: 'Valor Conv.', color: '#059669', type: 'currency', icon: DollarSign, bgColor: 'bg-green-50 text-green-600' },
  { id: 'lead_to_apt_rate', label: 'Lead p/ Agend.', color: '#0ea5e9', type: 'percent', icon: Activity, bgColor: 'bg-sky-50 text-sky-600' },
  { id: 'lead_to_conv_rate', label: 'Lead p/ Conv.', color: '#06b6d4', type: 'percent', icon: Activity, bgColor: 'bg-cyan-50 text-cyan-600' },
  { id: 'apt_to_conv_rate', label: 'Agend. p/ Conv.', color: '#8b5cf6', type: 'percent', icon: Activity, bgColor: 'bg-purple-50 text-purple-600' },
];

export function MarketingAnalytics() {
  const [period, setPeriod] = useState<Period>('dia');
  const [viewMode, setViewMode] = useState<'dashboard' | 'table'>('dashboard');
  const [dateRange, setDateRange] = useState({
    start: subDays(new Date(), 6),
    end: new Date()
  });

  const { data: leads, loading: leadsLoading } = useLeads();
  const { data: appointments, loading: aptsLoading } = useAppointments();
  const { data: marketingData, loading: mktLoading, fetch: fetchMkt, upsert: upsertMkt } = useMarketing();
  const { data: stages } = useFunnelStages();
  const conversionStageId = stages.find(s => s.name.toLowerCase().includes('convers'))?.id || null;
  const [isEditing, setIsEditing] = useState(false);
  const [isComparing, setIsComparing] = useState(false);
  const [compareDateRange, setCompareDateRange] = useState<{ start: Date, end: Date }>({
    start: subDays(new Date(), 14),
    end: subDays(new Date(), 8)
  });

  const [dashboardVisibleMetrics, setDashboardVisibleMetrics] = useState<string[]>(() => {
    const saved = localStorage.getItem('mkt_dash_visible_metrics');
    return saved ? JSON.parse(saved) : METRICS_CONFIG.map(m => m.id);
  });

  const [dashboardMetricsOrder, setDashboardMetricsOrder] = useState<string[]>(() => {
    const saved = localStorage.getItem('mkt_dash_metrics_order');
    const initial = METRICS_CONFIG.map(m => m.id);
    if (!saved) return initial;
    const parsed = JSON.parse(saved);
    const valid = parsed.filter((id: string) => initial.includes(id));
    const missing = initial.filter(id => !valid.includes(id));
    return [...valid, ...missing];
  });

  const [tableVisibleMetrics, setTableVisibleMetrics] = useState<string[]>(() => {
    const saved = localStorage.getItem('mkt_table_visible_metrics');
    return saved ? JSON.parse(saved) : METRICS_CONFIG.map(m => m.id);
  });

  const [tableMetricsOrder, setTableMetricsOrder] = useState<string[]>(() => {
    const saved = localStorage.getItem('mkt_table_metrics_order');
    const initial = METRICS_CONFIG.map(m => m.id);
    if (!saved) return initial;
    const parsed = JSON.parse(saved);
    const valid = parsed.filter((id: string) => initial.includes(id));
    const missing = initial.filter(id => !valid.includes(id));
    return [...valid, ...missing];
  });

  const toggleMetric = (id: string, view: 'dashboard' | 'table') => {
    if (view === 'dashboard') {
      const next = dashboardVisibleMetrics.includes(id) ? dashboardVisibleMetrics.filter(m => m !== id) : [...dashboardVisibleMetrics, id];
      setDashboardVisibleMetrics(next);
      localStorage.setItem('mkt_dash_visible_metrics', JSON.stringify(next));
    } else {
      const next = tableVisibleMetrics.includes(id) ? tableVisibleMetrics.filter(m => m !== id) : [...tableVisibleMetrics, id];
      setTableVisibleMetrics(next);
      localStorage.setItem('mkt_table_visible_metrics', JSON.stringify(next));
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
      localStorage.setItem('mkt_dash_metrics_order', JSON.stringify(next));
    } else {
      const index = tableMetricsOrder.indexOf(id);
      if (index === -1) return;
      const nextIndex = direction === 'up' ? index - 1 : index + 1;
      if (nextIndex < 0 || nextIndex >= tableMetricsOrder.length) return;
      const next = [...tableMetricsOrder];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      setTableMetricsOrder(next);
      localStorage.setItem('mkt_table_metrics_order', JSON.stringify(next));
    }
  };


  const [editValues, setEditValues] = useState<Record<string, any>>({});

  const [isPeriodOpen, setIsPeriodOpen] = useState(false);
  const [activeRangeLabel, setActiveRangeLabel] = useState("ÚLTIMOS 7 DIAS");

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
        start = subDays(today, 6);
        label = "ÚLTIMOS 7 DIAS";
        break;
      case '28days':
        start = subDays(today, 27);
        label = "ÚLTIMOS 28 DIAS";
        break;
      case '30days':
        start = subDays(today, 29);
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

  const getPlatformForLead = (lead: Lead): Platform => {
    const source = lead.source?.toLowerCase() || '';
    if (source === 'meta_ads') return 'meta_ads';
    if (source === 'google_ads') return 'google_ads';
    return 'no_track';
  };

  const calculateStats = (targetPeriods: typeof periods) => {
    const stats: Record<string, Record<Platform, any>> = {};

    // Map patient IDs to platforms
    const patientSourceMap: Record<string, Platform> = {};
    leads.forEach(l => {
      if (l.converted_patient_id) {
        patientSourceMap[l.converted_patient_id] = getPlatformForLead(l);
      }
    });

    targetPeriods.forEach((p, idx) => {
      const pKey = targetPeriods[idx].label;
      stats[pKey] = {
        meta_ads: { leads: 0, convs: 0, investment: 0, conv_value: 0, appointments: 0, whatsapp_leads: 0, forms_leads: 0 },
        google_ads: { leads: 0, convs: 0, investment: 0, conv_value: 0, appointments: 0, whatsapp_leads: 0, forms_leads: 0 },
        no_track: { leads: 0, convs: 0, investment: 0, conv_value: 0, appointments: 0, whatsapp_leads: 0, forms_leads: 0 }
      };

      marketingData.forEach(m => {
        const mDate = parseISO(m.date);
        if (mDate >= p.start && mDate <= p.end) {
          const platform = m.platform as Platform;
          if (stats[pKey][platform]) {
            stats[pKey][platform].investment += m.investment;
            if (m.manual_leads_count !== null) stats[pKey][platform].leads += m.manual_leads_count;
            if (m.manual_appointments_count !== null) stats[pKey][platform].appointments += (m as any).manual_appointments_count;
            if (m.manual_conversions_count !== null) stats[pKey][platform].convs += m.manual_conversions_count;
            if (m.conversions_value) stats[pKey][platform].conv_value += m.conversions_value;
          }
        }
      });

      // Count leads by created_at
      leads.forEach(lead => {
        const leadDate = lead.created_at ? parseISO(lead.created_at) : null;
        if (leadDate && leadDate >= p.start && leadDate <= p.end) {
          const platform = getPlatformForLead(lead);
          const dateStr = format(leadDate, 'yyyy-MM-dd');
          const manualLeads = marketingData.find(d => d.date === dateStr && d.platform === platform)?.manual_leads_count;

          if (manualLeads === null || manualLeads === undefined || manualLeads === 0) {
            stats[pKey][platform].leads += 1;
            if (lead.capture_channel === 'forms') stats[pKey][platform].forms_leads += 1;
            else stats[pKey][platform].whatsapp_leads += 1;
          }
        }
      });

      // Count conversions by updated_at (when lead moved to Conversão stage)
      if (conversionStageId) {
        leads.forEach(lead => {
          if (lead.stage_id !== conversionStageId) return;
          const convDate = lead.updated_at ? parseISO(lead.updated_at) : null;
          if (convDate && convDate >= p.start && convDate <= p.end) {
            const platform = getPlatformForLead(lead);
            const dateStr = format(convDate, 'yyyy-MM-dd');
            const manualConvs = marketingData.find(d => d.date === dateStr && d.platform === platform)?.manual_conversions_count;

            if (manualConvs === null || manualConvs === undefined || manualConvs === 0) {
              stats[pKey][platform].convs += 1;
            }
            // Auto-sum estimated_value if no manual conv_value
            const manualConvValue = marketingData.find(d => d.date === dateStr && d.platform === platform)?.conversions_value;
            if (!manualConvValue) {
              stats[pKey][platform].conv_value += Number(lead.estimated_value || 0);
            }
          }
        });
      }

      appointments.forEach(apt => {
        const aptDate = parseISO(apt.date);
        if (aptDate >= p.start && aptDate <= p.end) {
          const platform = patientSourceMap[apt.patient_id] || 'no_track';
          const dateStr = format(aptDate, 'yyyy-MM-dd');
          const manualApts = marketingData.find(d => d.date === dateStr && d.platform === platform)?.manual_appointments_count;

          if (stats[pKey][platform] && (manualApts === null || manualApts === undefined)) {
            stats[pKey][platform].appointments += 1;
          }
        }
      });
    });

    return stats;
  };

  const metricsByPeriod = useMemo(() => calculateStats(periods), [periods, leads, marketingData, appointments, conversionStageId]);

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

    return calculateStats(compPeriods as any);
  }, [isComparing, periods, dateRange, compareDateRange, leads, marketingData, appointments, conversionStageId]);

  const handleEditData = () => {
    const initial: Record<string, any> = {};
    days.forEach(day => {
      const dateStr = format(day, 'yyyy-MM-dd');
      ['meta_ads', 'google_ads', 'no_track'].forEach(p => {
        const key = `${dateStr}-${p}`;
        // Para pre-encher o editor, calculamos os stats ATUAIS desse dia específico
        const dayStats = calculateStats([{ start: day, end: day, label: dateStr }])[dateStr][p];

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
          manual_appointments_count: Number(editValues[`${key}-appointments`] || 0),
          manual_conversions_count: Number(editValues[`${key}-convs`] || 0),
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
    <div className="min-h-full bg-slate-50 text-slate-900 p-6 space-y-6 font-sans">
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
            <div className="flex bg-slate-50 rounded-xl p-1">
              {(['dia', 'sem', 'mês'] as Period[]).map((p) => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={cn(
                    "px-4 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all",
                    period === p ? "bg-white text-teal-600 shadow-sm border border-slate-200" : "text-slate-400 hover:text-slate-600"
                  )}
                >
                  {p}
                </button>
              ))}
            </div>

            <div className="h-6 w-px bg-slate-200 mx-1" />

            <div className="relative">
              <div
                onClick={() => setIsPeriodOpen(!isPeriodOpen)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-xl hover:bg-slate-50 cursor-pointer transition-all border border-transparent hover:border-slate-200 group"
              >
                <Calendar className={cn("w-4 h-4 transition-colors", isPeriodOpen ? "text-teal-600" : "text-slate-400 group-hover:text-teal-600")} />
                <span className="text-xs font-bold text-slate-600 uppercase tracking-tight">{activeRangeLabel}</span>
                <span className="text-[10px] font-medium text-slate-400">{format(dateRange.start, 'dd/MM')} - {format(dateRange.end, 'dd/MM')}</span>
                <ChevronRight className={cn("w-3.5 h-3.5 text-slate-300 transition-transform", isPeriodOpen ? "rotate-90 text-teal-600" : "")} />
              </div>

              <AnimatePresence>
                {isPeriodOpen && (
                  <>
                    <div className="fixed inset-0 z-[105]" onClick={() => setIsPeriodOpen(false)} />
                    <motion.div
                      initial={{ opacity: 0, y: 10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 10, scale: 0.95 }}
                      className="absolute top-full right-0 mt-3 w-72 bg-white rounded-2xl border border-slate-200 shadow-2xl z-[110] p-4 flex flex-col gap-1 overflow-hidden"
                    >
                      <PeriodOption label="HOJE" onClick={() => setRangeById('today')} active={activeRangeLabel === 'HOJE'} />
                      <PeriodOption label="ONTEM" onClick={() => setRangeById('yesterday')} active={activeRangeLabel === 'ONTEM'} />
                      <PeriodOption label="ESTA SEMANA" onClick={() => setRangeById('week')} active={activeRangeLabel === 'ESTA SEMANA'} />
                      <PeriodOption label="SEMANA PASSADA" onClick={() => setRangeById('last_week')} active={activeRangeLabel === 'SEMANA PASSADA'} />
                      <PeriodOption label="ÚLTIMOS 7 DIAS" onClick={() => setRangeById('7days')} active={activeRangeLabel === 'ÚLTIMOS 7 DIAS'} />
                      <PeriodOption label="ÚLTIMOS 28 DIAS" onClick={() => setRangeById('28days')} active={activeRangeLabel === 'ÚLTIMOS 28 DIAS'} />
                      <PeriodOption label="ÚLTIMOS 30 DIAS" onClick={() => setRangeById('30days')} active={activeRangeLabel === 'ÚLTIMOS 30 DIAS'} />
                      <PeriodOption label="ESTE MÊS" onClick={() => setRangeById('month')} active={activeRangeLabel === 'ESTE MÊS'} />
                      <PeriodOption label="MÊS PASSADO" onClick={() => setRangeById('last_month')} active={activeRangeLabel === 'MÊS PASSADO'} />

                      <div className="pt-4 mt-2 border-t border-slate-100">
                        <span className="text-[9px] font-black text-slate-400 uppercase tracking-[2px] block mb-3 pl-1">Período Principal</span>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <label className="text-[8px] font-bold text-slate-400 uppercase tracking-widest pl-1">Início</label>
                            <input
                              type="date"
                              value={format(dateRange.start, 'yyyy-MM-dd')}
                              onChange={(e) => {
                                setDateRange(v => ({ ...v, start: parseISO(e.target.value) }));
                                setActiveRangeLabel("Personalizado");
                              }}
                              className="w-full bg-slate-50 border-slate-200 rounded-xl p-2.5 text-[10px] font-bold text-slate-600 outline-none border focus:ring-1 focus:ring-teal-500/20"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[8px] font-bold text-slate-400 uppercase tracking-widest pl-1">Fim</label>
                            <input
                              type="date"
                              value={format(dateRange.end, 'yyyy-MM-dd')}
                              onChange={(e) => {
                                setDateRange(v => ({ ...v, end: parseISO(e.target.value) }));
                                setActiveRangeLabel("Personalizado");
                              }}
                              className="w-full bg-slate-50 border-slate-200 rounded-xl p-2.5 text-[10px] font-bold text-slate-600 outline-none border focus:ring-1 focus:ring-teal-500/20"
                            />
                          </div>
                        </div>
                      </div>

                      {isComparing && (
                        <div className="pt-4 mt-2 border-t border-slate-100 bg-teal-50/20 -mx-4 px-4 pb-2">
                          <span className="text-[9px] font-black text-teal-600 uppercase tracking-[2px] block mb-3 pl-1">Período Comparativo</span>
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                              <label className="text-[8px] font-bold text-teal-600/50 uppercase tracking-widest pl-1">Início</label>
                              <input
                                type="date"
                                value={format(compareDateRange.start, 'yyyy-MM-dd')}
                                onChange={(e) => setCompareDateRange(v => ({ ...v, start: parseISO(e.target.value) }))}
                                className="w-full bg-white border-teal-100 rounded-xl p-2.5 text-[10px] font-bold text-slate-600 outline-none border focus:ring-1 focus:ring-teal-500/20"
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-[8px] font-bold text-teal-600/50 uppercase tracking-widest pl-1">Fim</label>
                              <input
                                type="date"
                                value={format(compareDateRange.end, 'yyyy-MM-dd')}
                                onChange={(e) => setCompareDateRange(v => ({ ...v, end: parseISO(e.target.value) }))}
                                className="w-full bg-white border-teal-100 rounded-xl p-2.5 text-[10px] font-bold text-slate-600 outline-none border focus:ring-1 focus:ring-teal-500/20"
                              />
                            </div>
                          </div>
                        </div>
                      )}
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>
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

      <div className="space-y-4">
        <div className={cn("flex justify-end gap-2 transition-all", isEditing ? "opacity-0 pointer-events-none h-0" : "opacity-100 h-10")}>
          <div className="flex bg-white rounded-xl p-1 border border-slate-200 shadow-sm">
            <button
              onClick={() => setViewMode('dashboard')}
              className={cn("p-2 rounded-lg transition-all", viewMode === 'dashboard' ? "bg-teal-600 text-white shadow-md" : "text-slate-400 hover:text-slate-600")}
            >
              <LayoutDashboard className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode('table')}
              className={cn("p-2 rounded-lg transition-all", viewMode === 'table' ? "bg-teal-600 text-white shadow-md" : "text-slate-400 hover:text-slate-600")}
            >
              <TableIcon className="w-4 h-4" />
            </button>
          </div>
        </div>

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

function DashboardView({ periods, metricsByPeriod, comparisonMetricsByPeriod, isComparing, visibleMetrics, metricsOrder, toggleMetric, moveMetric }: any) {

  const [selectedMetric, setSelectedMetric] = useState('leads');
  const [selectedPlatform, setSelectedPlatform] = useState<Platform | 'all'>('all');
  const latestPeriod = periods[periods.length - 1]?.label || '';

  const getTotals = useCallback((metricSet: any) => {
    const res = { investment: 0, leads: 0, convs: 0, conv_value: 0, appointments: 0 };
    if (!metricSet) return res;
    Object.values(metricSet).forEach((p: any) => {
      res.investment += p.investment || 0;
      res.leads += p.leads || 0;
      res.convs += p.convs || 0;
      res.conv_value += p.conv_value || 0;
      res.appointments += p.appointments || 0;
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
        
        res.breakdown[platform].leads += s.leads;
        res.breakdown[platform].whatsapp += s.whatsapp_leads || 0;
        res.breakdown[platform].forms += s.forms_leads || 0;

        if (selectedPlatform === 'all' || selectedPlatform === platform) {
          res.investment += s.investment || 0;
          res.leads += s.leads || 0;
          res.convs += s.convs || 0;
          res.conv_value += s.conv_value || 0;
          res.appointments += s.appointments || 0;
          res.whatsapp += s.whatsapp_leads || 0;
          res.forms += s.forms_leads || 0;
        }
      });
    });
    return res;
  }, [periods, metricsByPeriod, selectedPlatform]);

  const prevTotals = useMemo(() => {
    const res = { investment: 0, leads: 0, convs: 0, conv_value: 0, appointments: 0 };
    if (!isComparing) return res;
    periods.forEach((p: any) => {
      const dayStats = comparisonMetricsByPeriod[p.label];
      if (!dayStats) return;

      ['meta_ads', 'google_ads', 'no_track'].forEach((pKey) => {
        const platform = pKey as Platform;
        const s = dayStats[platform];
        
        if (selectedPlatform === 'all' || selectedPlatform === platform) {
          res.investment += s.investment || 0;
          res.leads += s.leads || 0;
          res.convs += s.convs || 0;
          res.conv_value += s.conv_value || 0;
          res.appointments += s.appointments || 0;
        }
      });
    });
    return res;
  }, [periods, comparisonMetricsByPeriod, isComparing, selectedPlatform]);

  const chartData = useMemo(() => {
    return periods.map((p: any) => {
      const dayStats = metricsByPeriod[p.label];
      const compDayStats = comparisonMetricsByPeriod[p.label];
      
      let stats, compStats;
      if (selectedPlatform === 'all') {
         stats = getTotals(dayStats);
         compStats = getTotals(compDayStats);
      } else {
         stats = dayStats?.[selectedPlatform] || { investment: 0, leads: 0, convs: 0, conv_value: 0, appointments: 0 };
         compStats = compDayStats?.[selectedPlatform] || { investment: 0, leads: 0, convs: 0, conv_value: 0, appointments: 0 };
      }

      return {
        name: p.label,
        leads: stats.leads,
        investment: stats.investment,
        appointments: stats.appointments,
        convs: stats.convs,
        conv_value: stats.conv_value,
        cpl: stats.leads > 0 ? stats.investment / stats.leads : 0,
        cpapt: stats.appointments > 0 ? stats.investment / stats.appointments : 0,
        cpa: stats.convs > 0 ? stats.investment / stats.convs : 0,
        lead_to_apt_rate: stats.leads > 0 ? (stats.appointments / stats.leads) * 100 : 0,
        lead_to_conv_rate: stats.leads > 0 ? (stats.convs / stats.leads) * 100 : 0,
        apt_to_conv_rate: stats.appointments > 0 ? (stats.convs / stats.appointments) * 100 : 0,

        leads_prev: compStats.leads,
        investment_prev: compStats.investment,
        appointments_prev: compStats.appointments,
        convs_prev: compStats.convs,
        conv_value_prev: compStats.conv_value,
        cpl_prev: compStats.leads > 0 ? compStats.investment / compStats.leads : 0,
        cpapt_prev: compStats.appointments > 0 ? compStats.investment / compStats.appointments : 0,
        cpa_prev: compStats.convs > 0 ? compStats.investment / compStats.convs : 0,
        lead_to_apt_rate_prev: compStats.leads > 0 ? (compStats.appointments / compStats.leads) * 100 : 0,
        lead_to_conv_rate_prev: compStats.leads > 0 ? (compStats.convs / compStats.leads) * 100 : 0,
        apt_to_conv_rate_prev: compStats.appointments > 0 ? (compStats.convs / compStats.appointments) * 100 : 0,
      };
    });
  }, [periods, metricsByPeriod, comparisonMetricsByPeriod, getTotals]);

  const activeMetric = METRICS_CONFIG.find(m => m.id === selectedMetric) || METRICS_CONFIG[0];

  const platformData = useMemo(() => {
    return [
      { id: 'meta_ads', name: 'Meta Ads', label: 'META', value: currentTotals.breakdown.meta_ads.leads, color: '#4f46e5', logo: MetaLogo },
      { id: 'google_ads', name: 'Google Ads', label: 'GOOGLE', value: currentTotals.breakdown.google_ads.leads, color: '#10b981', logo: GoogleLogo },
      { id: 'no_track', name: 'Sem Origem', label: 'SEM ORIGEM', value: currentTotals.breakdown.no_track.leads, color: '#94a3b8', logo: SemOrigemLogo },
    ].filter(d => d.value > 0 && (selectedPlatform === 'all' || selectedPlatform === d.id));
  }, [currentTotals, selectedPlatform]);

  const platformTitle = "Origem dos Leads";

  const funnelData = [
    { name: 'Leads', value: currentTotals.leads, color: '#0d9488', subLabel: 'Total de leads' },
    { name: 'Agendamentos', value: currentTotals.appointments, color: '#8b5cf6', subLabel: `${((currentTotals.appointments / (currentTotals.leads || 1)) * 100).toFixed(1)}% de conversão` },
    { name: 'Conversões', value: currentTotals.convs, color: '#10b981', subLabel: `${((currentTotals.convs / (currentTotals.appointments || 1)) * 100).toFixed(1)}% de fechamento` },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-teal-50 flex items-center justify-center">
            <LayoutDashboard className="w-5 h-5 text-teal-600" />
          </div>
          <h2 className="text-xs font-black text-slate-400 uppercase tracking-widest">Resumo de Performance</h2>
        </div>

        <div className="flex items-center gap-1.5 bg-white p-1 rounded-xl border border-slate-200 shadow-sm">
          {[
            { id: 'all', label: 'Todos', logo: null },
            { id: 'meta_ads', label: 'Meta', logo: MetaLogo },
            { id: 'google_ads', label: 'Google', logo: GoogleLogo },
            { id: 'no_track', label: 'Sem Origem', logo: SemOrigemLogo }
          ].map((plat) => (
            <button
              key={plat.id}
              onClick={() => setSelectedPlatform(plat.id as any)}
              className={cn(
                "flex items-center gap-2 px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all",
                selectedPlatform === plat.id 
                  ? "bg-slate-900 text-white shadow-md shadow-slate-200" 
                  : "text-slate-400 hover:text-slate-600 hover:bg-slate-50"
              )}
              style={selectedPlatform === plat.id ? { backgroundColor: '#1e293b' } : {}}
            >
              {plat.logo && (
                <img 
                   src={plat.logo} 
                   alt={plat.label} 
                   className={cn("w-3 h-3 object-contain", selectedPlatform === plat.id ? "brightness-0 invert" : "")} 
                />
              )}
              {plat.label}
            </button>
          ))}
        </div>

        <MetricsConfigButton
          metricsOrder={metricsOrder} 
          visibleMetrics={visibleMetrics} 
          toggleMetric={toggleMetric} 
          moveMetric={moveMetric}
          variant="ghost"
          className="h-8 px-3 rounded-xl hover:bg-slate-100 text-slate-400"
        />
      </div>

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
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-teal-50 flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-teal-600" />
              </div>
              <CardTitle className="text-xs font-black text-slate-400 uppercase tracking-widest">Funil de Vendas</CardTitle>
            </div>
          </CardHeader>

          <div className="flex flex-col gap-6 max-w-4xl mx-auto w-full">
            {funnelData.map((stage, idx) => (
              <div key={stage.name} className="relative flex flex-col items-center">
                <div
                  className="h-16 rounded-2xl flex items-center justify-between px-8 shadow-sm transition-all border border-transparent hover:border-slate-100 group w-full"
                  style={{
                    backgroundColor: `${stage.color}10`,
                    width: `${100 - (idx * 15)}%`
                  }}
                >
                  <div className="flex flex-col">
                    <span className="text-[10px] font-black uppercase tracking-widest opacity-50" style={{ color: stage.color }}>Etapa {idx + 1}</span>
                    <span className="text-sm font-black text-slate-700">{stage.name}</span>
                  </div>

                  <div className="flex items-center gap-6">
                    <div className="text-right">
                      <p className="text-lg font-black" style={{ color: stage.color }}>{stage.value.toLocaleString('pt-BR')}</p>
                      <p className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter">{stage.subLabel}</p>
                    </div>
                  </div>
                </div>

                {idx < funnelData.length - 1 && (
                  <div className="py-2 flex flex-col items-center">
                    <div className="w-px h-6 bg-slate-100" />
                    <ArrowDownRight className="w-4 h-4 text-slate-300 -rotate-45" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>

        <Card className="bg-white border-slate-200 shadow-xl rounded-3xl p-6 overflow-hidden">
          <CardHeader className="p-0 pb-6"><CardTitle className="text-xs font-black text-slate-400 uppercase tracking-widest">{platformTitle}</CardTitle></CardHeader>
          <div className="h-[280px] w-full flex items-center justify-center">
            {platformData.length > 0 ? (
              <div className="relative w-full h-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={platformData} cx="50%" cy="45%" innerRadius={60} outerRadius={85} paddingAngle={8} dataKey="value" stroke="none">
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
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="colorMetric" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={activeMetric.color} stopOpacity={0.1} />
                    <stop offset="95%" stopColor={activeMetric.color} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 'bold' }} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 'bold' }} />
                <Tooltip
                  contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', padding: '12px' }}
                  formatter={(value: any) => [
                    activeMetric.type === 'currency' ? `R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : activeMetric.type === 'percent' ? `${value.toFixed(1)}%` : value,
                    activeMetric.label
                  ]}
                />
                <Area
                  type="monotone"
                  dataKey={selectedMetric}
                  stroke={activeMetric.color}
                  strokeWidth={3}
                  fillOpacity={1}
                  fill="url(#colorMetric)"
                  name={activeMetric.label}
                />
                {isComparing && (
                  <Area
                    type="monotone"
                    dataKey={`${selectedMetric}_prev`}
                    stroke={activeMetric.color}
                    strokeWidth={2}
                    fill="none"
                    strokeDasharray="5 5"
                    name={`${activeMetric.label} (Anterior)`}
                  />
                )}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>
    </div>
  );
}

function StatCard({ title, value, prevValue, type, icon: Icon, color }: any) {
  const delta = (prevValue !== null && prevValue > 0) ? ((value - prevValue) / prevValue) * 100 : null;
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
        <p className="text-xl font-black text-slate-900 mt-1">
          {type === 'currency' ? `R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` :
            type === 'percent' ? `${value.toFixed(1)}%` : value.toLocaleString('pt-BR')}
        </p>
      </div>
    </Card>
  );
}

function PeriodOption({ label, onClick, active }: { label: string, onClick: () => void, active: boolean }) {
  return (
    <button onClick={onClick} className={cn("w-full text-left px-3 py-2.5 rounded-xl text-[10px] font-black tracking-[1px] transition-all uppercase", active ? "bg-teal-50 text-teal-700 border border-teal-100/50 shadow-sm" : "text-slate-400 hover:bg-slate-50 hover:text-slate-600")}>
      {label}
    </button>
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
                <img src={SemOrigemLogo} alt="Sem Origem" className="w-full h-full object-contain opacity-50" />
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
        else if (valueKey === 'leads') { val = currentLeads; pVal = prevLeads; }
        else if (valueKey === 'appointments') { val = currentApts; pVal = prevMetrics?.appointments || 0; }
        else if (valueKey === 'convs') { val = currentConvs; pVal = prevMetrics?.convs || 0; }
        else { val = (dayMetrics as any)?.[valueKey] || 0; pVal = (prevMetrics as any)?.[valueKey] || 0; }

        const delta = pVal > 0 ? ((val - pVal) / pVal) * 100 : null;

        const isCalculated = ['cpl', 'cpa', 'cpapt'].includes(valueKey);

        if (isEditing && period === 'dia' && valueKey && !isCalculated) {
          return (
            <td key={idx} className="px-4 py-2 border-r border-slate-50 last:border-r-0">
              <input type="number" value={editValues[editKey]} onChange={e => setEditValues((prev: any) => ({ ...prev, [editKey]: e.target.value }))} className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-black text-center text-slate-900 focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 outline-none transition-all placeholder:text-slate-300" placeholder="0" />
            </td>
          );
        }

        return (
          <td key={idx} className="px-6 py-3 text-center border-r border-slate-50 last:border-r-0 whitespace-nowrap">
            <div className="flex flex-col items-center">
              <span className={cn("text-xs font-bold transition-all", isComparing ? "text-slate-900" : "text-slate-600")}>
                {type === 'currency' ? `R$ ${val.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : type === 'percent' ? (val > 0 ? `${val.toFixed(1)}%` : '—') : val}
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
        let formatType: 'num' | 'curr' | 'perc' = 'num';

        if (type === 'leads') val = current.leads;
        else if (type === 'convs') val = current.convs;
        else if (type === 'appointments') val = current.appointments;
        else if (type === 'investment') { val = current.investment; formatType = 'curr'; }
        else if (type === 'conv_value') { val = current.value; formatType = 'curr'; }
        else if (type === 'cpl') { val = current.leads > 0 ? current.investment / current.leads : 0; formatType = 'curr'; }
        else if (type === 'cpapt') { val = current.appointments > 0 ? current.investment / current.appointments : 0; formatType = 'curr'; }
        else if (type === 'cpa') { val = current.convs > 0 ? current.investment / current.convs : 0; formatType = 'curr'; }
        else if (type === 'lead_to_apt_rate') { val = current.leads > 0 ? (current.appointments / current.leads) * 100 : 0; formatType = 'perc'; }
        else if (type === 'lead_to_conv_rate') { val = current.leads > 0 ? (current.convs / current.leads) * 100 : 0; formatType = 'perc'; }
        else if (type === 'apt_to_conv_rate') { val = current.appointments > 0 ? (current.convs / current.appointments) * 100 : 0; formatType = 'perc'; }

        return (
          <td key={idx} className="px-6 py-3 text-center border-r border-slate-50 last:border-r-0">
            <span className="text-xs font-black text-slate-900">
              {formatType === 'curr' ? `R$ ${val.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : formatType === 'perc' ? `${val.toFixed(1)}%` : val}
            </span>
          </td>
        );
      })}
    </tr>
  );
}
