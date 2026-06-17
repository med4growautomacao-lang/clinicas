import React, { useState, useMemo } from "react";
import { DayPicker } from "react-day-picker";
import "react-day-picker/dist/style.css";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { 
  Users, 
  CalendarCheck, 
  TrendingUp, 
  MessageSquare, 
  Activity, 
  Loader2, 
  ShoppingCart, 
  DollarSign, 
  Target, 
  BarChart3,
  Calendar,
  ChevronRight,
  Clock,
  Timer,
  AlertCircle
} from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from "recharts";
import { cn } from "@/src/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { useDashboardStats, useAppointments, useDoctors } from "../hooks/useSupabase";
import { CalendarView } from "./CalendarView";
import {
  format,
  subDays,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  subMonths,
  subWeeks,
  addMonths,
  parseISO
} from "date-fns";
import { ptBR } from "date-fns/locale";

type Period = 'dia' | 'sem' | 'mês';

export function Dashboard() {
  const [period, setPeriod] = useState<Period>('mês');
  const [isPeriodOpen, setIsPeriodOpen] = useState(false);
  const [activeRangeLabel, setActiveRangeLabel] = useState("ESTE MÊS");
  const [dateRange, setDateRange] = useState({
    start: startOfMonth(new Date()),
    end: endOfMonth(new Date())
  });

  const statsDateRange = useMemo(() => ({
    start: format(dateRange.start, 'yyyy-MM-dd'),
    end: format(dateRange.end, 'yyyy-MM-dd')
  }), [dateRange]);

  const { data: stats, loading } = useDashboardStats(statsDateRange);
  const { data: appointments } = useAppointments();
  const { data: doctors } = useDoctors();
  const [calendarMonth, setCalendarMonth] = useState(new Date());
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
        end = endOfMonth(today);
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

  const [selectedMetric, setSelectedMetric] = useState<string>('agendamentos');

  const chartMetrics = [
    { id: 'faturamento', label: 'FATURAMENTO', type: 'currency', color: '#0d9488' },
    { id: 'investimento', label: 'INVESTIMENTO', type: 'currency', color: '#f59e0b' },
    { id: 'roas', label: 'ROAS', type: 'number', color: '#8b5cf6' },
    { id: 'leads', label: 'LEADS', type: 'number', color: '#4f46e5' },
    { id: 'agendamentos', label: 'AGENDAMENTOS', type: 'number', color: '#0ea5e9' },
    { id: 'vendas', label: 'VENDAS', type: 'number', color: '#10b981' },
  ];

  const processedChartData = useMemo(() => {
    return stats.chartData.map(d => {
      // Formatar data dd/MM sem parseISO para evitar problemas de timezone
      const [year, month, day] = d.date.split('-');
      const formattedDate = `${day}/${month}`;

      return {
        ...d,
        name: formattedDate,
        roas: d.investimento > 0 ? Number((d.faturamento / d.investimento).toFixed(2)) : 0,
        cpl: d.leads > 0 ? Number((d.investimento / d.leads).toFixed(2)) : 0,
        cac: d.vendas > 0 ? Number((d.investimento / d.vendas).toFixed(2)) : 0,
        cpApt: d.agendamentos > 0 ? Number((d.investimento / d.agendamentos).toFixed(2)) : 0,
        convRate: d.leads > 0 ? Number(((d.vendas / d.leads) * 100).toFixed(1)) : 0,
        ticketMed: d.vendas > 0 ? Number((d.faturamento / d.vendas).toFixed(0)) : 0,
      };
    });
  }, [stats.chartData]);

  // Métricas de conversão derivadas
  const cac = stats.totalInvestment > 0 && stats.totalSales > 0
    ? (stats.totalInvestment / stats.totalSales)
    : 0;

  const conversionRate = stats.totalLeads > 0 && stats.totalSales > 0
    ? ((stats.totalSales / stats.totalLeads) * 100)
    : 0;

  const averageTicket = stats.totalSales > 0 && stats.totalRevenue > 0
    ? (stats.totalRevenue / stats.totalSales)
    : 0;

  const roas = stats.totalInvestment > 0 && stats.totalRevenue > 0
    ? (stats.totalRevenue / stats.totalInvestment)
    : 0;

  const trendLabel = activeRangeLabel === "Personalizado" 
    ? "Período selecionado" 
    : activeRangeLabel.toLowerCase();

  const formatValue = (val: any) => {
    const metric = chartMetrics.find(m => m.id === selectedMetric);
    if (!metric) return val;
    if (metric.type === 'currency') return `R$ ${val.toLocaleString('pt-BR')}`;
    if (metric.type === 'percent') return `${val}%`;
    return val;
  };

  return (
    <div className="space-y-8 relative">
      {loading && (
        <div className="absolute inset-0 bg-white/50 backdrop-blur-[1px] z-50 flex items-center justify-center rounded-3xl">
          <div className="bg-white p-4 rounded-2xl shadow-xl border border-slate-100 flex items-center gap-3">
            <Loader2 className="w-5 h-5 text-teal-600 animate-spin" />
            <span className="text-xs font-bold text-slate-600 uppercase tracking-widest">Atualizando...</span>
          </div>
        </div>
      )}
      {/* Header com Filtros */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}>
          <h2 className="text-3xl font-bold tracking-tight text-slate-900">
            Painel <span className="text-teal-600">Administrativo</span>
          </h2>
          <p className="text-slate-500 font-medium text-base">
            Resumo do período selecionado (por data do evento). Detalhe por coorte fica em Comercial e Marketing.
          </p>
        </motion.div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Date Pill Replicated from MarketingAnalytics */}
          <div className="flex items-center gap-3 bg-white p-1.5 rounded-2xl border border-slate-200 shadow-sm">
            <div className="flex bg-slate-50 rounded-xl p-1">
              {(['dia', 'sem', 'mês'] as Period[]).map((p) => (
                <button
                  key={p}
                  onClick={() => {
                    setPeriod(p);
                    if (p === 'dia') setRangeById('today');
                    else if (p === 'sem') setRangeById('week');
                    else if (p === 'mês') setRangeById('month');
                  }}
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
                      className="absolute top-full right-0 mt-3 bg-white rounded-2xl border border-slate-200 shadow-2xl z-[110] overflow-hidden rdp-custom flex"
                    >
                      {/* Quick options */}
                      <div className="w-44 border-r border-slate-100 p-2 flex flex-col gap-0.5 shrink-0">
                        <span className="text-[9px] font-black text-slate-400 uppercase tracking-[2px] px-3 pt-1 pb-1.5">Período</span>
                        {[
                          { id: 'today',      label: 'Hoje' },
                          { id: 'yesterday',  label: 'Ontem' },
                          { id: 'week',       label: 'Esta Semana' },
                          { id: 'last_week',  label: 'Semana Passada' },
                          { id: '7days',      label: 'Últimos 7 dias' },
                          { id: '14days',     label: 'Últimos 14 dias' },
                          { id: '28days',     label: 'Últimos 28 dias' },
                          { id: '30days',     label: 'Últimos 30 dias' },
                          { id: 'month',      label: 'Este Mês' },
                          { id: 'last_month', label: 'Mês Passado' },
                        ].map(opt => (
                          <button
                            key={opt.id}
                            onClick={() => setRangeById(opt.id)}
                            className={cn(
                              "text-left px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors",
                              activeRangeLabel === opt.label.toUpperCase()
                                ? "bg-teal-50 text-teal-700"
                                : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                            )}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>

                      {/* Two stacked DayPickers */}
                      <div className="flex flex-col divide-y divide-slate-100">
                        <div className="p-3">
                          <DayPicker
                            mode="range"
                            selected={{ from: dateRange.start, to: dateRange.end }}
                            onSelect={(r) => {
                              if (r?.from) { setDateRange(d => ({ ...d, start: r.from! })); setActiveRangeLabel("PERSONALIZADO"); }
                              if (r?.to)   { setDateRange(d => ({ ...d, end: r.to! })); }
                            }}
                            month={calMonth1}
                            onMonthChange={setCalMonth1}
                            numberOfMonths={1}
                            locale={ptBR}
                            weekStartsOn={0}
                          />
                        </div>
                        <div className="p-3">
                          <DayPicker
                            mode="range"
                            selected={{ from: dateRange.start, to: dateRange.end }}
                            onSelect={(r) => {
                              if (r?.from) { setDateRange(d => ({ ...d, start: r.from! })); setActiveRangeLabel("PERSONALIZADO"); }
                              if (r?.to)   { setDateRange(d => ({ ...d, end: r.to! })); }
                            }}
                            month={calMonth2}
                            onMonthChange={setCalMonth2}
                            numberOfMonths={1}
                            locale={ptBR}
                            weekStartsOn={0}
                          />
                        </div>
                      </div>
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>

      {/* Grid de Cards - Reordenado conforme solicitação */}
      {/* Layout Superior: Cards + Métricas de Conversão */}
      <div className="grid gap-6 lg:grid-cols-4">
        {/* Lado Esquerdo: Grid de Cards Principais (3 colunas) */}
        <div className="lg:col-span-3 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {[
            // Dinheiro
            { title: "Recebido", value: `R$ ${stats.totalRevenue.toLocaleString('pt-BR', { minimumFractionDigits: 0 })}`, trend: "Pago no caixa", icon: TrendingUp, color: "bg-emerald-50 text-emerald-600" },
            { title: "A Receber", value: `R$ ${stats.pendingRevenue.toLocaleString('pt-BR', { minimumFractionDigits: 0 })}`, trend: "Transações pendentes", icon: Clock, color: "bg-amber-50 text-amber-600" },
            { title: "Investimento", value: `R$ ${stats.totalInvestment.toLocaleString('pt-BR', { minimumFractionDigits: 0 })}`, trend: "Em mídia paga", icon: DollarSign, color: "bg-sky-50 text-sky-600" },
            { title: "ROAS", value: roas > 0 ? `${roas.toFixed(2).replace('.', ',')}x` : "—", trend: "Recebido ÷ Investimento", icon: Activity, color: "bg-teal-50 text-teal-600" },

            // Comercial
            { title: "Novos Leads", value: `+${stats.totalLeads}`, trend: "Interações no período", icon: MessageSquare, color: "bg-indigo-50 text-indigo-600" },
            { title: "Agendamentos", value: stats.totalAppointments.toString(), trend: "Consultas com data no período", icon: CalendarCheck, color: "bg-teal-50 text-teal-600" },
            { title: "Vendas (Leads)", value: stats.totalSales.toString(), trend: "Convertidos no período", icon: ShoppingCart, color: "bg-rose-50 text-rose-600" },
          ].map((stat, i) => (
            <motion.div key={stat.title} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }}>
              <Card className="overflow-hidden border border-slate-100 shadow-sm h-full">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{stat.title}</CardTitle>
                  <div className={cn("p-1.5 rounded-lg", stat.color)}>
                    <stat.icon className="h-4 w-4" />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-slate-900">{stat.value}</div>
                  <div className="flex items-center gap-1 mt-1">
                    <p className="text-[10px] font-medium text-slate-400 capitalize">{stat.trend}</p>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>

        {/* Lado Direito: Métricas de Conversão (1 coluna) */}
        <Card className="lg:col-span-1 border border-slate-100 shadow-sm flex flex-col">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-teal-600" />
              Conversão
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1">
            <div className="space-y-3">
              {[
                { label: "Taxa de Conversão", value: conversionRate > 0 ? `${conversionRate.toFixed(1).replace('.', ',')}%` : "—", description: "Vendas ÷ Leads", icon: TrendingUp, color: "text-emerald-600 bg-emerald-50" },
                { label: "Ticket Médio", value: averageTicket > 0 ? `R$ ${averageTicket.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}` : "—", description: "Receita ÷ Vendas", icon: DollarSign, color: "text-teal-600 bg-teal-50" },
                { label: "CAC (Custo p/ Venda)", value: cac > 0 ? `R$ ${cac.toFixed(2).replace('.', ',')}` : "—", description: "Investimento ÷ Vendas", icon: Users, color: "text-indigo-600 bg-indigo-50" },
              ].map((metric) => (
                <div key={metric.label} className="flex items-center gap-3 p-2 rounded-xl bg-slate-50/80 border border-slate-100">
                  <div className={cn("p-2 rounded-lg", metric.color)}>
                    <metric.icon className="w-3.5 h-3.5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-bold text-slate-900 leading-tight">{metric.label}</p>
                    <p className="text-[8px] text-slate-400 font-medium">{metric.description}</p>
                  </div>
                  <span className="text-xs font-bold text-slate-900 tabular-nums">{metric.value}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Gráfico de Tendência (Largura Total) */}
      <Card className="border border-slate-100 shadow-sm overflow-hidden">
        <CardHeader className="flex flex-col space-y-4 pb-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-teal-600" />
              Tendência de Performance
            </CardTitle>
          </div>
          
          {/* Metric Selector Pill */}
          <div className="flex items-center gap-2 bg-slate-50 p-1 rounded-2xl border border-slate-100 overflow-x-auto no-scrollbar">
            {chartMetrics.map((m) => (
              <button
                key={m.id}
                onClick={() => setSelectedMetric(m.id)}
                className={cn(
                  "whitespace-nowrap px-3 py-1.5 rounded-xl text-[9px] font-black tracking-widest transition-all",
                  selectedMetric === m.id 
                    ? "bg-white text-teal-600 shadow-sm border border-slate-200" 
                    : "text-slate-400 hover:text-slate-600"
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="pl-2 pt-2">
          {(() => {
            const activeMetric = chartMetrics.find(m => m.id === selectedMetric) || chartMetrics[0];
            const values = processedChartData.map((d: any) => d[selectedMetric]).filter((v: number) => v != null);
            const avg = values.length > 0 ? values.reduce((a: number, b: number) => a + b, 0) / values.length : 0;
            const avgLabel = activeMetric.type === 'currency'
              ? `Média R$ ${avg.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`
              : activeMetric.type === 'percent'
              ? `Média ${avg.toFixed(1)}%`
              : `Média ${avg.toFixed(1)}`;

            return (
              <div className="h-[400px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={processedChartData}>
                    <defs>
                      <linearGradient id="colorMetricDash" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={activeMetric.color} stopOpacity={0.2} />
                        <stop offset="95%" stopColor={activeMetric.color} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="8 8" vertical={false} stroke="#f1f5f9" />
                    <XAxis 
                      dataKey="name" 
                      stroke="#94a3b8" 
                      fontSize={11} 
                      fontWeight="bold" 
                      tickLine={false} 
                      axisLine={false} 
                      dy={10} 
                    />
                    <YAxis 
                      stroke="#94a3b8" 
                      fontSize={11} 
                      fontWeight="bold" 
                      tickLine={false} 
                      axisLine={false} 
                      tickFormatter={(v) => {
                        if (activeMetric.type === 'currency') return `R$ ${v >= 1000 ? (v/1000).toFixed(0)+'k' : v}`;
                        if (activeMetric.type === 'percent') return `${v}%`;
                        return v;
                      }}
                    />
                    <Tooltip 
                      cursor={{ stroke: activeMetric.color, strokeWidth: 2, strokeDasharray: '5 5' }} 
                      contentStyle={{ 
                        borderRadius: "20px", 
                        border: "none", 
                        boxShadow: "0 20px 25px -5px rgb(0 0 0 / 0.1)", 
                        fontWeight: "bold", 
                        fontSize: '12px',
                        padding: '16px'
                      }} 
                      formatter={(v) => [formatValue(v), activeMetric.label]}
                    />
                    <ReferenceLine
                      y={avg}
                      stroke={activeMetric.color}
                      strokeDasharray="6 3"
                      strokeWidth={1.5}
                      strokeOpacity={0.4}
                      label={{ 
                        value: avgLabel, 
                        position: 'insideTopRight', 
                        fontSize: 10, 
                        fontWeight: 'black', 
                        fill: activeMetric.color, 
                        opacity: 0.6,
                        dy: -10
                      }}
                    />
                    <Area 
                      type="monotone"
                      dataKey={selectedMetric} 
                      stroke={activeMetric.color} 
                      strokeWidth={4}
                      fillOpacity={1}
                      fill="url(#colorMetricDash)"
                      animationDuration={1500}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            );
          })()}
        </CardContent>
      </Card>

      {/* Calendário de Agendamentos */}
      <Card className="border border-slate-100 shadow-sm overflow-hidden">
        <CardHeader className="flex flex-row items-center gap-2 pb-4">
          <Calendar className="w-5 h-5 text-teal-600" />
          <CardTitle className="text-lg font-bold text-slate-900">Calendário de Agendamentos</CardTitle>
        </CardHeader>
        <CardContent className="px-6 pb-6">
          <CalendarView
            currentMonth={calendarMonth}
            setCurrentMonth={setCalendarMonth}
            appointments={appointments}
            onDayClick={() => {}}
            doctors={doctors}
          />
        </CardContent>
      </Card>

      {/* Rodapé: métricas de atendimento (secundário) */}
      <div className="pt-2">
        <h3 className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-3 px-1">Atendimento</h3>
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            { title: "Estouros de SLA", value: stats.totalSlaBreaches.toString(), trend: "Atrasos no atendimento", icon: AlertCircle, color: "bg-red-50 text-red-600" },
            { title: "Tempo de Resposta", value: stats.avgResponseTime > 0 ? `${stats.avgResponseTime.toFixed(0)} min` : "—", trend: "Média até a 1ª resposta", icon: Timer, color: "bg-blue-50 text-blue-600" },
            { title: "Ciclo de Vendas", value: stats.avgSalesCycle > 0 ? `${stats.avgSalesCycle.toFixed(1)} dias` : "—", trend: "Lead → Conversão", icon: Clock, color: "bg-purple-50 text-purple-600" },
          ].map((stat) => (
            <Card key={stat.title} className="border border-slate-100 shadow-sm bg-slate-50/40">
              <CardContent className="flex items-center gap-3 py-4">
                <div className={cn("p-2 rounded-lg shrink-0", stat.color)}>
                  <stat.icon className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">{stat.title}</p>
                  <p className="text-lg font-bold text-slate-900 leading-tight">{stat.value}</p>
                  <p className="text-[9px] font-medium text-slate-400">{stat.trend}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

function PeriodOption({ label, onClick, active }: { label: string; onClick: () => void; active?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left px-3 py-2 rounded-xl text-[10px] font-black tracking-widest transition-all",
        active ? "bg-teal-600 text-white shadow-lg shadow-teal-100" : "text-slate-400 hover:bg-slate-50 hover:text-slate-600"
      )}
    >
      {label}
    </button>
  );
}

