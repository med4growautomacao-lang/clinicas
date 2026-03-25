import React, { useState, useEffect, useMemo } from "react";
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
  X
} from "lucide-react";
import { cn } from "@/src/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { useLeads, useMarketing, MarketingData, Lead } from "../hooks/useSupabase";
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
  addDays
} from "date-fns";
import { ptBR } from "date-fns/locale";

type Period = 'dia' | 'sem' | 'mês';
type Platform = 'meta_ads' | 'google_ads' | 'no_track';

const PLATFORM_LABELS: Record<Platform, string> = {
  meta_ads: 'META ADS',
  google_ads: 'GOOGLE ADS',
  no_track: 'SEM RASTREIO'
};

const PLATFORM_COLORS: Record<Platform, string> = {
  meta_ads: 'text-indigo-600',
  google_ads: 'text-amber-600',
  no_track: 'text-slate-500'
};

export function MarketingAnalytics() {
  const [period, setPeriod] = useState<Period>('dia');
  const [viewMode, setViewMode] = useState<'dash' | 'tabela'>('tabela');
  const [dateRange, setDateRange] = useState({
    start: subDays(new Date(), 6),
    end: new Date()
  });

  const { data: leads, loading: leadsLoading } = useLeads();
  const { data: marketingData, loading: mktLoading, fetch: fetchMkt, upsert: upsertMkt } = useMarketing();
  const [isEditing, setIsEditing] = useState(false);
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
    }

    setDateRange({ start, end });
    setActiveRangeLabel(label);
    setIsPeriodOpen(false);
  };

  useEffect(() => {
    fetchMkt(format(dateRange.start, 'yyyy-MM-dd'), format(dateRange.end, 'yyyy-MM-dd'));
  }, [dateRange, fetchMkt]);

  // Generate periods based on interval and selected grouping (dia, sem, mês)
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

  // Generate fixed daily range for editing purposes (always per day)
  const days = useMemo(() => {
    return eachDayOfInterval({ start: dateRange.start, end: dateRange.end });
  }, [dateRange]);

  // Lead sourcing mapping logic
  const getPlatformForLead = (lead: Lead): Platform => {
    const source = lead.source?.toLowerCase() || '';
    if (source.includes('facebook') || source.includes('instagram') || source.includes('meta')) return 'meta_ads';
    if (source.includes('google')) return 'google_ads';
    return 'no_track';
  };

  // Metrics calculation aggregated by period
  const metricsByPeriod = useMemo(() => {
    const stats: Record<string, Record<Platform, any>> = {};

    periods.forEach(p => {
      const pKey = p.label;
      stats[pKey] = {
        meta_ads: { leads: 0, convs: 0, investment: 0, conv_value: 0 },
        google_ads: { leads: 0, convs: 0, investment: 0, conv_value: 0 },
        no_track: { leads: 0, convs: 0, investment: 0, conv_value: 0 }
      };

      // Aggregate from marketing_data
      marketingData.forEach(m => {
        const mDate = parseISO(m.date);
        if (mDate >= p.start && mDate <= p.end) {
          const platform = m.platform as Platform;
          if (stats[pKey][platform]) {
            stats[pKey][platform].investment += m.investment;
            stats[pKey][platform].conv_value += m.conversions_value;
            if (m.manual_leads_count !== null) stats[pKey][platform].leads += m.manual_leads_count;
            if (m.manual_conversions_count !== null) stats[pKey][platform].convs += m.manual_conversions_count;
          }
        }
      });

      // Aggregate Leads from leads table if not overridden by manual data for THAT DAY
      leads.forEach(lead => {
        const leadDate = lead.created_at ? parseISO(lead.created_at) : null;
        if (leadDate && leadDate >= p.start && leadDate <= p.end) {
          const platform = getPlatformForLead(lead);
          
          // Check if there's a manual override for this specific day
          const dateStr = format(leadDate, 'yyyy-MM-dd');
          const manualLeads = marketingData.find(d => d.date === dateStr && d.platform === platform)?.manual_leads_count;
          
          if (manualLeads === null || manualLeads === undefined) {
             stats[pKey][platform].leads += 1;
          }

          if (lead.converted_patient_id) {
            const manualConvs = marketingData.find(d => d.date === dateStr && d.platform === platform)?.manual_conversions_count;
            if (manualConvs === null || manualConvs === undefined) {
               stats[pKey][platform].convs += 1;
            }
          }
        }
      });
    });

    return stats;
  }, [periods, leads, marketingData]);

  const handleEditData = () => {
    // Fill initial values for editing
    const initial: Record<string, any> = {};
    days.forEach(day => {
      const dateStr = format(day, 'yyyy-MM-dd');
      ['meta_ads', 'google_ads', 'no_track'].forEach(p => {
        const key = `${dateStr}-${p}`;
        const existing = marketingData.find(d => d.date === dateStr && d.platform === p);
        initial[`${key}-investment`] = existing?.investment || 0;
        initial[`${key}-leads`] = existing?.manual_leads_count ?? "";
        initial[`${key}-convs`] = existing?.manual_conversions_count ?? "";
        initial[`${key}-value`] = existing?.conversions_value || 0;
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
          manual_leads_count: editValues[`${key}-leads`] === "" ? null : Number(editValues[`${key}-leads`]),
          manual_conversions_count: editValues[`${key}-convs`] === "" ? null : Number(editValues[`${key}-convs`]),
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
                      <PeriodOption label="ÚLTIMOS 7 DIAS" onClick={() => setRangeById('7days')} active={activeRangeLabel === 'ÚLTIMOS 7 DIAS'} />
                      <PeriodOption label="ÚLTIMOS 30 DIAS" onClick={() => setRangeById('30days')} active={activeRangeLabel === 'ÚLTIMOS 30 DIAS'} />
                      <PeriodOption label="ESTE MÊS" onClick={() => setRangeById('month')} active={activeRangeLabel === 'ESTE MÊS'} />
                      <PeriodOption label="MÊS PASSADO" onClick={() => setRangeById('last_month')} active={activeRangeLabel === 'MÊS PASSADO'} />
                      
                      <div className="pt-4 mt-2 border-t border-slate-100">
                        <span className="text-[9px] font-black text-slate-400 uppercase tracking-[2px] block mb-3 pl-1">Personalizado</span>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                              <label className="text-[8px] font-bold text-slate-400 uppercase tracking-widest pl-1">Início</label>
                              <input 
                                type="date" 
                                value={format(dateRange.start, 'yyyy-MM-dd')}
                                onChange={(e) => {
                                  setDateRange(v => ({...v, start: parseISO(e.target.value)}));
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
                                  setDateRange(v => ({...v, end: parseISO(e.target.value)}));
                                  setActiveRangeLabel("Personalizado");
                                }}
                                className="w-full bg-slate-50 border-slate-200 rounded-xl p-2.5 text-[10px] font-bold text-slate-600 outline-none border focus:ring-1 focus:ring-teal-500/20" 
                              />
                            </div>
                        </div>
                      </div>
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
           </div>

           <Button 
            onClick={handleEditData}
            variant="outline" 
            className="rounded-xl border-slate-200 bg-white hover:bg-slate-50 h-9 gap-2 text-[10px] font-bold uppercase transition-all shadow-sm"
           >
              <Edit3 className="w-3.5 h-3.5 text-teal-600" />
              Editar Dados
           </Button>

           <Button 
            variant="outline" 
            className="rounded-xl border-slate-200 bg-white hover:bg-slate-50 h-9 gap-2 text-[10px] font-bold uppercase shadow-sm"
           >
              <Link2 className="w-3.5 h-3.5 text-teal-600" />
              Integrações
           </Button>
        </div>
      </div>

      {/* View Selector */}
      <div className="flex justify-end gap-2">
         <div className="flex bg-white rounded-xl p-1 border border-slate-200 shadow-sm">
            <button
              onClick={() => setViewMode('dash')}
              className={cn(
                "p-2 rounded-lg transition-all",
                viewMode === 'dash' ? "bg-teal-600 text-white shadow-md" : "text-slate-400 hover:text-slate-600"
              )}
            >
               <LayoutDashboard className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode('tabela')}
              className={cn(
                "p-2 rounded-lg transition-all",
                viewMode === 'tabela' ? "bg-teal-600 text-white shadow-md" : "text-slate-400 hover:text-slate-600"
              )}
            >
               <TableIcon className="w-4 h-4" />
            </button>
         </div>
      </div>

      {/* Main Table */}
      <Card className="bg-white border-slate-200 shadow-xl rounded-3xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="p-6 text-[11px] font-black text-teal-600 uppercase tracking-[2px] bg-slate-50 border-r border-slate-100">Métrica / Período</th>
                {periods.map(p => (
                  <th key={p.label} className="p-6 text-[11px] font-black text-slate-500 text-center uppercase tracking-wider min-w-[120px]">
                    {p.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* META ADS SECTION */}
              <PlatformRows 
                platform="meta_ads" 
                periods={periods} 
                metricsByPeriod={metricsByPeriod} 
              />
              
              {/* GOOGLE ADS SECTION */}
              <PlatformRows 
                platform="google_ads" 
                periods={periods} 
                metricsByPeriod={metricsByPeriod} 
              />
              
              {/* SEM RASTREIO SECTION */}
              <PlatformRows 
                platform="no_track" 
                periods={periods} 
                metricsByPeriod={metricsByPeriod} 
              />

              {/* RESUMO GERAL */}
              <SummaryRows 
                periods={periods} 
                metricsByPeriod={metricsByPeriod} 
              />
            </tbody>
          </table>
        </div>
      </Card>

      {/* Edit Modal */}
      <AnimatePresence>
        {isEditing && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
              onClick={() => setIsEditing(false)}
            />
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="relative w-full max-w-5xl max-h-[90vh] bg-white rounded-3xl border border-slate-200 shadow-2xl overflow-hidden flex flex-col"
            >
               <div className="p-8 border-b border-slate-100 flex items-center justify-between">
                  <div>
                    <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-3">
                      <Edit3 className="w-6 h-6 text-teal-600" />
                      Editar Métricas
                    </h2>
                    <p className="text-slate-500 text-sm mt-1 font-medium">Atualize investimentos e conversões manualmente</p>
                  </div>
                  <button onClick={() => setIsEditing(false)} className="text-slate-400 hover:text-slate-600 p-2 hover:bg-slate-100 rounded-xl transition-all">
                    <X className="w-6 h-6" />
                  </button>
               </div>

               <div className="p-8 overflow-y-auto flex-1 bg-slate-50/30">
                  <div className="space-y-12">
                     {days.map(day => {
                        const dateStr = format(day, 'yyyy-MM-dd');
                        return (
                          <div key={dateStr} className="space-y-4">
                             <div className="flex items-center gap-3">
                                <Calendar className="w-4 h-4 text-teal-600" />
                                <h3 className="font-bold text-slate-500 uppercase tracking-widest text-xs">
                                  {format(day, "EEEE, dd 'de' MMMM", { locale: ptBR })}
                                </h3>
                                <div className="h-px bg-slate-200 flex-1" />
                             </div>

                             <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                {(['meta_ads', 'google_ads', 'no_track'] as Platform[]).map(p => {
                                   const key = `${dateStr}-${p}`;
                                   return (
                                     <div key={p} className="p-6 rounded-2xl bg-white border border-slate-200 shadow-sm space-y-4">
                                        <div className="flex items-center justify-between pointer-events-none">
                                           <span className={cn("text-[10px] font-black tracking-widest uppercase", PLATFORM_COLORS[p])}>
                                              {PLATFORM_LABELS[p]}
                                           </span>
                                        </div>

                                        <div className="grid grid-cols-2 gap-4">
                                           <div className="space-y-2">
                                              <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest pl-1">Investimento</label>
                                              <input
                                                type="number"
                                                value={editValues[`${key}-investment`] || ""}
                                                onChange={e => setEditValues(v => ({...v, [`${key}-investment`]: e.target.value}))}
                                                className="w-full bg-slate-50 border-slate-200 rounded-xl px-4 py-2.5 text-sm font-bold text-slate-900 focus:ring-2 focus:ring-teal-500/20 outline-none border transition-all"
                                                placeholder="0,00"
                                              />
                                           </div>
                                           <div className="space-y-2">
                                              <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest pl-1">Valor Conv</label>
                                              <input
                                                type="number"
                                                value={editValues[`${key}-value`] || ""}
                                                onChange={e => setEditValues(v => ({...v, [`${key}-value`]: e.target.value}))}
                                                className="w-full bg-slate-50 border-slate-200 rounded-xl px-4 py-2.5 text-sm font-bold text-slate-900 focus:ring-2 focus:ring-teal-500/20 outline-none border transition-all"
                                                placeholder="0,00"
                                              />
                                           </div>
                                           <div className="space-y-2">
                                              <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest pl-1">Leads (Manual)</label>
                                              <input
                                                type="number"
                                                value={editValues[`${key}-leads`] || ""}
                                                onChange={e => setEditValues(v => ({...v, [`${key}-leads`]: e.target.value}))}
                                                className="w-full bg-slate-50 border-slate-200 rounded-xl px-4 py-2.5 text-sm font-bold text-slate-600 focus:ring-2 focus:ring-slate-200 outline-none border transition-all"
                                                placeholder="Auto"
                                              />
                                           </div>
                                           <div className="space-y-2">
                                              <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest pl-1">Conv (Manual)</label>
                                              <input
                                                type="number"
                                                value={editValues[`${key}-convs`] || ""}
                                                onChange={e => setEditValues(v => ({...v, [`${key}-convs`]: e.target.value}))}
                                                className="w-full bg-slate-50 border-slate-200 rounded-xl px-4 py-2.5 text-sm font-bold text-slate-600 focus:ring-2 focus:ring-slate-200 outline-none border transition-all"
                                                placeholder="Auto"
                                              />
                                           </div>
                                        </div>
                                     </div>
                                   );
                                })}
                             </div>
                          </div>
                        )
                     })}
                  </div>
               </div>

               <div className="p-8 border-t border-slate-100 bg-white flex items-center justify-end gap-4">
                  <Button variant="ghost" onClick={() => setIsEditing(false)} className="rounded-xl text-slate-500 font-bold">
                    Cancelar
                  </Button>
                  <Button onClick={saveEditData} className="rounded-xl bg-teal-600 hover:bg-teal-700 text-white px-8 h-12 font-bold shadow-lg shadow-teal-100 transition-all active:scale-[0.98]">
                    Salvar Alterações
                  </Button>
               </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function PeriodOption({ label, onClick, active }: { label: string, onClick: () => void, active: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left px-3 py-2.5 rounded-xl text-[10px] font-black tracking-[1px] transition-all uppercase",
        active 
          ? "bg-teal-50 text-teal-700 border border-teal-100/50 shadow-sm" 
          : "text-slate-400 hover:bg-slate-50 hover:text-slate-600"
      )}
    >
      {label}
    </button>
  );
}

function PlatformRows({ platform, periods, metricsByPeriod }: { platform: Platform, periods: any[], metricsByPeriod: any }) {
  return (
    <>
      <tr className="bg-slate-50/50">
        <td className={cn("px-6 py-4 text-[10px] font-black tracking-[3px] border-r border-slate-100", PLATFORM_COLORS[platform])}>
          {PLATFORM_LABELS[platform]}
        </td>
        {periods.map((_, idx) => <td key={idx} className="px-6 py-4 bg-slate-50/30" />)}
      </tr>
      <MetricRow label="INVESTIMENTO" periods={periods} metrics={metricsByPeriod} platform={platform} type="currency" valueKey="investment" />
      <MetricRow label="LEADS GERADOS" periods={periods} metrics={metricsByPeriod} platform={platform} valueKey="leads" />
      <MetricRow label="CUSTO POR LEAD" periods={periods} metrics={metricsByPeriod} platform={platform} type="cpl" />
      <MetricRow label="CONVERSÕES" periods={periods} metrics={metricsByPeriod} platform={platform} valueKey="convs" />
      <MetricRow label="VALOR DE CONVERSÕES" periods={periods} metrics={metricsByPeriod} platform={platform} type="currency" valueKey="conv_value" />
      <MetricRow label="TAXA DE CONVERSÃO" periods={periods} metrics={metricsByPeriod} platform={platform} type="percent" />
    </>
  );
}

function SummaryRows({ periods, metricsByPeriod }: { periods: any[], metricsByPeriod: any }) {
  return (
    <>
      <tr className="bg-teal-50/50">
        <td className="px-6 py-4 text-[10px] font-black tracking-[3px] text-teal-600 border-r border-slate-100">
          RESUMO GERAL
        </td>
        {periods.map((_, idx) => <td key={idx} />)}
      </tr>
      <SummaryMetricRow label="TOTAL LEADS" periods={periods} metrics={metricsByPeriod} type="total_leads" />
      <SummaryMetricRow label="INV. TOTAL" periods={periods} metrics={metricsByPeriod} type="total_investment" />
      <SummaryMetricRow label="CPL MÉDIO" periods={periods} metrics={metricsByPeriod} type="avg_cpl" />
      <SummaryMetricRow label="TOTAL CONVERSÕES" periods={periods} metrics={metricsByPeriod} type="total_convs" />
      <SummaryMetricRow label="VALOR DE CONVERSÕES" periods={periods} metrics={metricsByPeriod} type="total_value" />
      <SummaryMetricRow label="TAXA GLOBAL" periods={periods} metrics={metricsByPeriod} type="global_rate" />
    </>
  );
}

function MetricRow({ label, periods, metrics, platform, type, valueKey }: any) {
  return (
    <tr className="border-b border-slate-100 hover:bg-slate-50/50 transition-colors">
      <td className="px-6 py-3 text-[9px] font-bold text-slate-400 uppercase tracking-wider pl-10 border-r border-slate-100">{label}</td>
      {periods.map((p: any, idx: number) => {
        const pKey = p.label;
        const dayMetrics = metrics[pKey]?.[platform];
        let val = dayMetrics?.[valueKey || ''];
        
        if (type === 'currency') {
          return <td key={idx} className="px-6 py-3 text-xs font-bold text-center text-slate-600">R$ {Number(val || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>;
        }
        if (type === 'percent') {
          const rate = dayMetrics.leads > 0 ? (dayMetrics.convs / dayMetrics.leads) * 100 : 0;
          return <td key={idx} className="px-6 py-3 text-xs font-bold text-center text-slate-500">{rate > 0 ? `${rate.toFixed(1)}%` : '—'}</td>;
        }
        if (type === 'cpl') {
          const cpl = dayMetrics.leads > 0 ? dayMetrics.investment / dayMetrics.leads : 0;
          return <td key={idx} className="px-6 py-3 text-xs font-bold text-center text-slate-500">
            {cpl > 0 ? `R$ ${cpl.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '—'}
          </td>;
        }
        return <td key={idx} className="px-6 py-3 text-xs font-bold text-center text-slate-900">{val || 0}</td>;
      })}
    </tr>
  );
}

function SummaryMetricRow({ label, periods, metrics, type }: any) {
  return (
    <tr className="border-b border-slate-100 bg-teal-50/10">
      <td className="px-6 py-3 text-[9px] font-bold text-teal-700 uppercase tracking-wider pl-10 border-r border-slate-100">{label}</td>
      {periods.map((p: any, idx: number) => {
        const pKey = p.label;
        const dayStats = metrics[pKey];
        const platforms = ['meta_ads', 'google_ads', 'no_track'] as Platform[];
        
        const totalLeads = platforms.reduce((sum, p) => sum + dayStats[p].leads, 0);
        const totalConvs = platforms.reduce((sum, p) => sum + dayStats[p].convs, 0);
        const totalInvestment = platforms.reduce((sum, p) => sum + dayStats[p].investment, 0);
        const totalValue = platforms.reduce((sum, p) => sum + dayStats[p].conv_value, 0);

        if (type === 'total_leads') return <td key={idx} className="px-6 py-3 text-sm font-black text-center text-slate-800">{totalLeads}</td>;
        if (type === 'total_convs') return <td key={idx} className="px-6 py-3 text-sm font-black text-center text-slate-800">{totalConvs}</td>;
        if (type === 'total_investment') return <td key={idx} className="px-6 py-3 text-sm font-black text-center text-teal-600">R$ {totalInvestment.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>; 
        if (type === 'total_value') return <td key={idx} className="px-6 py-3 text-sm font-black text-center text-teal-600">R$ {totalValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>;
        if (type === 'avg_cpl') {
           const avg = totalLeads > 0 ? totalInvestment / totalLeads : 0;
           return <td key={idx} className="px-6 py-3 text-sm font-black text-center text-slate-400">{avg > 0 ? `R$ ${avg.toFixed(2)}` : '—'}</td>;
        }
        if (type === 'global_rate') {
           const rate = totalLeads > 0 ? (totalConvs / totalLeads) * 100 : 0;
           return <td key={idx} className="px-6 py-3 text-sm font-black text-center text-slate-400">{rate > 0 ? `${rate.toFixed(1)}%` : '—'}</td>;
        }
        
        return <td key={idx} className="px-6 py-3 text-xs font-bold text-center text-slate-400">0</td>;
      })}
    </tr>
  );
}
