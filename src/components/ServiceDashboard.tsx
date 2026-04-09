import React, { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import {
  MessageSquare,
  Users,
  TrendingUp,
  Bot,
  UserCheck,
  AlertTriangle,
  CalendarCheck,
  ArrowRightLeft,
  Clock,
  Loader2,
  BarChart3,
  Send,
  BellRing,
  Calendar,
  ChevronDown,
  Star,
  ThumbsUp,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../lib/supabase";

interface DashboardData {
  totalLeads: number;
  leadsServedByAI: number;
  totalMessagesMonth: number;
  aiMessages: number;
  humanMessages: number;
  userMessages: number;
  aiAppointments: number;
  totalAppointments: number;
  handoffs: number;
  followups: number;
  confirmations: number;
  slaBreaches: number;
  pendingLeads: number;
  csatAnswered: number;
  csatAvgScore: number | null;
  csatType: string;
  csatDistribution: { score: number; count: number }[];
  dailyData: { 
    day: string; 
    label: string; 
    messages: number; 
    aiMessages: number; 
    appointments: number; 
    leads: number;
    aiLeads: number;
    handoffs: number;
    followups: number;
    confirmations: number;
  }[];
}

type DateRange = '7d' | '15d' | '30d' | 'custom';
type ChartMetric = 'messages' | 'aiMessages' | 'appointments' | 'leads' | 'aiLeads' | 'handoffs' | 'followups' | 'confirmations';

function getDateRangeStart(range: DateRange, customStart?: string): string {
  if (range === 'custom' && customStart) {
    return new Date(customStart).toISOString();
  }
  const now = new Date();
  const days = range === '7d' ? 7 : range === '15d' ? 15 : 30;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

export function ServiceDashboard() {
  const { profile, activeClinicId } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState<DateRange>('30d');
  const [chartMetric, setChartMetric] = useState<ChartMetric>('messages');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const dropdownRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const fetchData = useCallback(async () => {
    const clinicId = activeClinicId || profile?.clinic_id;
    if (!clinicId) return;

    try {
      const now = new Date();
      const rangeStart = getDateRangeStart(dateRange, customStartDate);
      const rangeEnd = dateRange === 'custom' && customEndDate
        ? new Date(customEndDate + 'T23:59:59').toISOString()
        : now.toISOString();

      const rangeDays = dateRange === '7d' ? 7 : dateRange === '15d' ? 15 : dateRange === '30d' ? 30 : 
        Math.min(Math.ceil((new Date(rangeEnd).getTime() - new Date(rangeStart).getTime()) / (24*60*60*1000)), 30);

      const [
        leadsRes,
        aiLeadsRes,
        msgMonthRes,
        aiMsgRes,
        humanMsgRes,
        userMsgRes,
        humanInboundRes,
        aiAptsRes,
        totalAptsRes,
        handoffRes,
        followupRes,
        confirmRes,
        slaRes,
        pendingRes,
        dailyMessagesRes,
        dailyLeadsRes,
        dailyAptsRes,
        dailyLogsRes,
        csatRes,
        csatConfigRes,
      ] = await Promise.all([
        supabase.from('leads').select('id', { count: 'exact', head: true }).eq('clinic_id', clinicId),
        supabase.from('chat_messages').select('lead_id').eq('clinic_id', clinicId).eq('sender', 'ai').gte('created_at', rangeStart).lte('created_at', rangeEnd),
        supabase.from('chat_messages').select('id', { count: 'exact', head: true }).eq('clinic_id', clinicId).gte('created_at', rangeStart).lte('created_at', rangeEnd),
        supabase.from('chat_messages').select('id', { count: 'exact', head: true }).eq('clinic_id', clinicId).eq('sender', 'ai').gte('created_at', rangeStart).lte('created_at', rangeEnd),
        supabase.from('chat_messages').select('id', { count: 'exact', head: true }).eq('clinic_id', clinicId).eq('sender', 'human').eq('direction', 'outbound').gte('created_at', rangeStart).lte('created_at', rangeEnd),
        supabase.from('chat_messages').select('id', { count: 'exact', head: true }).eq('clinic_id', clinicId).eq('sender', 'user').gte('created_at', rangeStart).lte('created_at', rangeEnd),
        supabase.from('chat_messages').select('id', { count: 'exact', head: true }).eq('clinic_id', clinicId).eq('sender', 'human').eq('direction', 'inbound').gte('created_at', rangeStart).lte('created_at', rangeEnd),
        supabase.from('appointments').select('id', { count: 'exact', head: true }).eq('clinic_id', clinicId).eq('source', 'ia').gte('created_at', rangeStart).lte('created_at', rangeEnd),
        supabase.from('appointments').select('id', { count: 'exact', head: true }).eq('clinic_id', clinicId).gte('created_at', rangeStart).lte('created_at', rangeEnd),
        supabase.from('automation_logs').select('id', { count: 'exact', head: true }).eq('clinic_id', clinicId).eq('type', 'handoff').gte('triggered_at', rangeStart).lte('triggered_at', rangeEnd),
        supabase.from('automation_logs').select('id', { count: 'exact', head: true }).eq('clinic_id', clinicId).eq('type', 'followup').gte('triggered_at', rangeStart).lte('triggered_at', rangeEnd),
        supabase.from('automation_logs').select('id', { count: 'exact', head: true }).eq('clinic_id', clinicId).eq('type', 'confirm').gte('triggered_at', rangeStart).lte('triggered_at', rangeEnd),
        supabase.from('leads').select('id', { count: 'exact', head: true }).eq('clinic_id', clinicId).gt('sla_breach_count', 0),
        supabase.from('leads').select('id, last_message_at, last_outbound_at').eq('clinic_id', clinicId).not('last_message_at', 'is', null),
        supabase.from('chat_messages').select('created_at, sender').eq('clinic_id', clinicId).gte('created_at', rangeStart).lte('created_at', rangeEnd).order('created_at', { ascending: true }),
        supabase.from('leads').select('created_at').eq('clinic_id', clinicId).gte('created_at', rangeStart).lte('created_at', rangeEnd).order('created_at', { ascending: true }),
        supabase.from('appointments').select('created_at').eq('clinic_id', clinicId).gte('created_at', rangeStart).lte('created_at', rangeEnd).order('created_at', { ascending: true }),
        supabase.from('automation_logs').select('triggered_at, type').eq('clinic_id', clinicId).gte('triggered_at', rangeStart).lte('triggered_at', rangeEnd).order('triggered_at', { ascending: true }),
        supabase.from('leads').select('csat_score').eq('clinic_id', clinicId).not('csat_score', 'is', null).gte('csat_answered_at', rangeStart).lte('csat_answered_at', rangeEnd),
        supabase.from('ai_config').select('csat_type').eq('clinic_id', clinicId).maybeSingle(),
      ]);

      const uniqueAILeads = new Set((aiLeadsRes.data || []).map((m: any) => m.lead_id)).size;

      const dayLabels = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
      const buckets: { [key: string]: any } = {};
      const chartDaysCount = Math.min(rangeDays, 31);
      for (let i = chartDaysCount - 1; i >= 0; i--) {
        const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
        const key = d.toISOString().split('T')[0];
        buckets[key] = { messages: 0, aiMessages: 0, appointments: 0, leads: 0, aiLeads: 0, handoffs: 0, followups: 0, confirmations: 0 };
      }

      // Track unique leads per day for aiLeads metric
      const dailyUniqueAILeads: { [day: string]: Set<string> } = {};

      (dailyMessagesRes.data || []).forEach((msg: any) => {
        const key = msg.created_at.split('T')[0];
        if (buckets[key]) {
          buckets[key].messages++;
          if (msg.sender === 'ai') {
            buckets[key].aiMessages++;
            if (!dailyUniqueAILeads[key]) dailyUniqueAILeads[key] = new Set();
            dailyUniqueAILeads[key].add(msg.lead_id);
          }
        }
      });

      // Update aiLeads count from the sets
      Object.keys(dailyUniqueAILeads).forEach(day => {
        if (buckets[day]) buckets[day].aiLeads = dailyUniqueAILeads[day].size;
      });

      (dailyLeadsRes.data || []).forEach((l: any) => {
        const key = l.created_at.split('T')[0];
        if (buckets[key]) buckets[key].leads++;
      });
      (dailyAptsRes.data || []).forEach((a: any) => {
        const key = a.created_at.split('T')[0];
        if (buckets[key]) buckets[key].appointments++;
      });
      (dailyLogsRes.data || []).forEach((log: any) => {
        const key = log.triggered_at.split('T')[0];
        if (buckets[key]) {
          if (log.type === 'handoff') buckets[key].handoffs++;
          else if (log.type === 'followup') buckets[key].followups++;
          else if (log.type === 'confirm') buckets[key].confirmations++;
        }
      });

      const dailyData = Object.entries(buckets).map(([day, val]) => ({
        day,
        label: dayLabels[new Date(day + 'T12:00:00').getDay()],
        ...val
      }));

      const csatScores = (csatRes.data || []).map((l: any) => l.csat_score as number);
      const csatAnswered = csatScores.length;
      const csatAvgScore = csatAnswered > 0 ? csatScores.reduce((a, b) => a + b, 0) / csatAnswered : null;
      const csatDistMap: Record<number, number> = {};
      csatScores.forEach((s) => { csatDistMap[s] = (csatDistMap[s] || 0) + 1; });
      const csatDistribution = Object.entries(csatDistMap)
        .map(([score, count]) => ({ score: parseInt(score), count: count as number }))
        .sort((a, b) => b.score - a.score);

      const pending = (pendingRes.data || []).filter((l: any) => {
        if (!l.last_message_at) return false;
        if (!l.last_outbound_at) return true;
        return new Date(l.last_message_at) > new Date(l.last_outbound_at);
      }).length;

      setData({
        totalLeads: leadsRes.count || 0,
        leadsServedByAI: uniqueAILeads,
        totalMessagesMonth: msgMonthRes.count || 0,
        aiMessages: aiMsgRes.count || 0,
        humanMessages: humanMsgRes.count || 0,
        userMessages: (userMsgRes.count || 0) + (humanInboundRes.count || 0),
        aiAppointments: aiAptsRes.count || 0,
        totalAppointments: totalAptsRes.count || 0,
        handoffs: handoffRes.count || 0,
        followups: followupRes.count || 0,
        confirmations: confirmRes.count || 0,
        slaBreaches: slaRes.count || 0,
        pendingLeads: pending,
        csatAnswered,
        csatAvgScore,
        csatType: csatConfigRes.data?.csat_type ?? 'csat',
        csatDistribution,
        dailyData,
      });
    } catch (err) {
      console.error('ServiceDashboard fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [activeClinicId, profile?.clinic_id, dateRange, customStartDate, customEndDate]);

  useEffect(() => {
    const clinicId = activeClinicId || profile?.clinic_id;
    fetchData();
    if (!clinicId) return;
    const channel = supabase.channel('service_dashboard_rt').on('postgres_changes', { event: '*', schema: 'public', table: 'chat_messages', filter: `clinic_id=eq.${clinicId}` }, () => fetchData()).on('postgres_changes', { event: '*', schema: 'public', table: 'leads', filter: `clinic_id=eq.${clinicId}` }, () => fetchData()).on('postgres_changes', { event: '*', schema: 'public', table: 'automation_logs', filter: `clinic_id=eq.${clinicId}` }, () => fetchData()).on('postgres_changes', { event: '*', schema: 'public', table: 'appointments', filter: `clinic_id=eq.${clinicId}` }, () => fetchData()).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchData, activeClinicId, profile?.clinic_id]);

  if (loading || !data) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 text-teal-600 animate-spin" /></div>;
  }

  const kpis = [
    { title: "Leads Atendidos pela IA", value: data.leadsServedByAI.toString(), icon: Bot, color: "text-teal-600", bg: "bg-teal-50", subtitle: "no período selecionado" },
    { title: "Agendamentos Realizados", value: data.totalAppointments.toString(), icon: CalendarCheck, color: "text-emerald-600", bg: "bg-emerald-50", subtitle: data.aiAppointments > 0 ? `${data.aiAppointments} pela IA` : "Agendamentos totais" },
    { title: "Taxa de Conversão da IA", value: data.leadsServedByAI > 0 ? `${((data.aiAppointments / data.leadsServedByAI) * 100).toFixed(1)}%` : '0%', icon: TrendingUp, color: "text-blue-600", bg: "bg-blue-50", subtitle: `${data.aiAppointments} agend. de ${data.leadsServedByAI} leads` },
    { title: "Volume de Mensagens", value: data.totalMessagesMonth.toString(), icon: BarChart3, color: "text-purple-600", bg: "bg-purple-50", subtitle: "no período selecionado" },
  ];

  const chartMetrics: { label: string; value: ChartMetric; icon: any }[] = [
    { label: 'Msgs Totais', value: 'messages', icon: MessageSquare },
    { label: 'Msgs IA', value: 'aiMessages', icon: Bot },
    { label: 'Agendamentos', value: 'appointments', icon: CalendarCheck },
    { label: 'Novos Leads', value: 'leads', icon: Users },
    { label: 'Atend. IA', value: 'aiLeads', icon: UserCheck },
    { label: 'Handoffs', value: 'handoffs', icon: ArrowRightLeft },
    { label: 'Follow-ups', value: 'followups', icon: BellRing },
    { label: 'Confirm.', value: 'confirmations', icon: CalendarCheck },
  ];

  const activePoints = data.dailyData.map(d => d[chartMetric]);
  const maxVal = Math.max(...activePoints, 1);

  return (
    <div className="space-y-6 h-full overflow-y-auto pr-1 custom-scrollbar pb-8">
      {/* Date Filter */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 text-slate-500"><Calendar className="w-4 h-4" /><span className="text-xs font-bold uppercase tracking-wider">Período:</span></div>
        <div className="flex gap-1.5">
          {['7d', '15d', '30d', 'custom'].map((v) => (
            <button key={v} onClick={() => setDateRange(v as DateRange)} className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${dateRange === v ? 'bg-teal-600 text-white shadow-sm' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>{v === 'custom' ? 'Personalizado' : v.replace('d', ' dias')}</button>
          ))}
        </div>
        {dateRange === 'custom' && (
          <div className="flex items-center gap-2">
            <input type="date" value={customStartDate} onChange={(e) => setCustomStartDate(e.target.value)} className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-teal-200 focus:border-teal-300 outline-none" />
            <span className="text-xs text-slate-400 font-medium">até</span>
            <input type="date" value={customEndDate} onChange={(e) => setCustomEndDate(e.target.value)} className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-teal-200 focus:border-teal-300 outline-none" />
          </div>
        )}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((stat, i) => (
          <motion.div key={stat.title} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }}>
            <Card className="border border-slate-200 shadow-sm hover:shadow-md transition-all min-h-[140px]"><CardContent className="p-5"><div className="flex justify-between items-start mb-3"><div className={`p-2.5 rounded-xl ${stat.bg}`}><stat.icon className={`w-5 h-5 ${stat.color}`} /></div></div><p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">{stat.title}</p><h3 className="text-2xl font-bold text-slate-900">{stat.value}</h3>{stat.subtitle && <p className="text-[10px] text-slate-400 mt-1 font-medium">{stat.subtitle}</p>}</CardContent></Card>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Trend Chart */}
        <Card className="lg:col-span-2 border border-slate-200 shadow-sm overflow-hidden flex flex-col">
          <CardHeader className="bg-slate-50 border-b border-slate-100 py-3 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-teal-600" />
              Tendências
            </CardTitle>
            <div className="relative mt-2 sm:mt-0" ref={dropdownRef}>
              <button
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                className="flex items-center justify-between gap-2 bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-[11px] font-bold text-slate-700 hover:border-teal-300 hover:bg-teal-50/30 transition-all shadow-sm min-w-[150px]"
              >
                <div className="flex items-center gap-2">
                  {React.createElement(chartMetrics.find(m => m.value === chartMetric)?.icon || BarChart3, { className: "w-3.5 h-3.5 text-teal-600" })}
                  <span>{chartMetrics.find(m => m.value === chartMetric)?.label}</span>
                </div>
                <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-200 ${isDropdownOpen ? 'rotate-180' : ''}`} />
              </button>

              <AnimatePresence>
                {isDropdownOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.95 }}
                    transition={{ duration: 0.15, ease: "easeOut" }}
                    className="absolute right-0 top-full mt-2 w-56 bg-white border border-slate-100 rounded-xl shadow-xl z-50 py-1.5 overflow-hidden"
                  >
                    <div className="max-h-[300px] overflow-y-auto custom-scrollbar">
                      {chartMetrics.map((m) => (
                        <button
                          key={m.value}
                          onClick={() => {
                            setChartMetric(m.value);
                            setIsDropdownOpen(false);
                          }}
                          className={`w-full flex items-center gap-3 px-3 py-2 text-[11px] font-bold transition-colors ${
                            chartMetric === m.value 
                              ? 'bg-teal-50 text-teal-700' 
                              : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
                          }`}
                        >
                          <div className={`p-1.5 rounded-lg ${chartMetric === m.value ? 'bg-teal-100' : 'bg-slate-100'}`}>
                            {React.createElement(m.icon, { className: `w-3.5 h-3.5 ${chartMetric === m.value ? 'text-teal-600' : 'text-slate-500'}` })}
                          </div>
                          <span className="flex-1 text-left">{m.label}</span>
                          {chartMetric === m.value && <div className="w-1.5 h-1.5 rounded-full bg-teal-500 shadow-[0_0_8px_rgba(20,184,166,0.6)]" />}
                        </button>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </CardHeader>
          <CardContent className="p-6 flex-1 flex flex-col justify-end">
            <div className="h-[220px] w-full flex items-end gap-1 px-1">
              {data.dailyData.map((d, i) => {
                const val = d[chartMetric];
                return (
                  <div key={d.day} className="flex-1 flex flex-col items-center gap-1.5 group min-w-0">
                    <motion.div
                      initial={{ height: 0 }}
                      animate={{ height: `${Math.max((val / maxVal) * 100, 4)}%` }}
                      transition={{ delay: i * 0.03, duration: 0.6 }}
                      className="w-full bg-gradient-to-t from-teal-500/30 to-teal-500/10 group-hover:from-teal-500/50 group-hover:to-teal-500/20 rounded-t-md relative flex justify-center border-t-2 border-teal-500"
                    >
                      <div className="absolute -top-7 opacity-0 group-hover:opacity-100 transition-opacity bg-slate-900 text-white text-[10px] font-bold px-2 py-1 rounded whitespace-nowrap z-10">{val}</div>
                    </motion.div>
                    {data.dailyData.length <= 15 && <span className="text-[8px] font-bold text-slate-400 uppercase tracking-tighter">{d.label}</span>}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Alerts Panel */}
        <Card className="border border-slate-200 shadow-sm overflow-hidden">
          <CardHeader className="bg-slate-50 border-b border-slate-100 py-3"><CardTitle className="text-sm font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-amber-500" />Alertas</CardTitle></CardHeader>
          <CardContent className="p-5 space-y-4">
            {[{ label: "SLA Violados", value: data.slaBreaches, critical: data.slaBreaches > 0, icon: Clock }, { label: "Aguardando Resposta", value: data.pendingLeads, critical: data.pendingLeads > 0, icon: AlertTriangle }].map((alert) => (
              <div key={alert.label} className={`flex items-center gap-4 p-4 rounded-xl border ${alert.critical ? 'bg-rose-50/60 border-rose-200' : 'bg-emerald-50/60 border-emerald-200' }`}>
                <div className={`p-2.5 rounded-xl ${alert.critical ? 'bg-rose-100' : 'bg-emerald-100'}`}><alert.icon className={`w-5 h-5 ${alert.critical ? 'text-rose-600' : 'text-emerald-600'}`} /></div>
                <div className="flex-1"><p className="text-xs font-bold text-slate-600">{alert.label}</p><p className={`text-2xl font-bold ${alert.critical ? 'text-rose-700' : 'text-emerald-700'}`}>{alert.value}</p></div>
              </div>
            ))}
            <div className="pt-3 border-t border-slate-100">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-3">Automações (Período)</p>
              <div className="space-y-2.5">
                {[{ label: "Handoffs", value: data.handoffs, icon: ArrowRightLeft, color: "text-orange-600", bg: "bg-orange-50" }, { label: "Follow-ups", value: data.followups, icon: BellRing, color: "text-indigo-600", bg: "bg-indigo-50" }, { label: "Confirmações", value: data.confirmations, icon: CalendarCheck, color: "text-teal-600", bg: "bg-teal-50" }].map((m) => (
                  <div key={m.label} className="flex items-center gap-3"><div className={`p-1.5 rounded-lg ${m.bg}`}><m.icon className={`w-3.5 h-3.5 ${m.color}`} /></div><span className="text-xs font-medium text-slate-500 flex-1">{m.label}</span><span className="text-xs font-bold text-slate-900">{m.value}</span></div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* CSAT / NPS Card */}
      <Card className="border border-slate-200 shadow-sm overflow-hidden">
        <CardHeader className="bg-slate-50 border-b border-slate-100 py-3">
          <CardTitle className="text-sm font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2">
            <Star className="w-4 h-4 text-indigo-500" />
            Satisfação dos Pacientes — {data.csatType === 'nps' ? 'NPS' : data.csatType === 'both' ? 'CSAT / NPS' : 'CSAT'}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-5">
          {data.csatAnswered === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 gap-3 text-slate-400">
              <Star className="w-10 h-10 text-slate-200" />
              <p className="text-sm font-semibold">Nenhuma resposta no período</p>
              <p className="text-xs">As notas aparecerão aqui após os pacientes responderem à pesquisa.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* KPIs */}
              <div className="flex flex-col gap-4">
                <div className="flex flex-col items-center justify-center p-5 rounded-xl bg-indigo-50 border border-indigo-100 text-center">
                  <Star className="w-5 h-5 text-indigo-400 mb-1" />
                  <p className="text-3xl font-bold text-indigo-700">{data.csatAvgScore !== null ? data.csatAvgScore.toFixed(1) : '—'}</p>
                  <p className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider mt-1">Nota Média</p>
                  <p className="text-[10px] text-indigo-300 font-medium">de {data.csatType === 'csat' ? '5' : '10'}</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col items-center justify-center p-4 rounded-xl bg-slate-50 border border-slate-100 text-center">
                    <ThumbsUp className="w-4 h-4 text-emerald-500 mb-1" />
                    <p className="text-xl font-bold text-slate-900">{data.csatAnswered}</p>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-0.5">Respondidos</p>
                  </div>
                  <div className="flex flex-col items-center justify-center p-4 rounded-xl bg-slate-50 border border-slate-100 text-center">
                    <TrendingUp className="w-4 h-4 text-blue-500 mb-1" />
                    <p className="text-xl font-bold text-slate-900">{data.totalLeads > 0 ? ((data.csatAnswered / data.totalLeads) * 100).toFixed(0) : 0}%</p>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-0.5">Resp. Rate</p>
                  </div>
                </div>
              </div>

              {/* Distribution */}
              <div className="lg:col-span-2 flex flex-col justify-center gap-2.5">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Distribuição de Notas</p>
                {data.csatDistribution.map(({ score, count }) => {
                  const maxCount = Math.max(...data.csatDistribution.map(d => d.count), 1);
                  const pct = (count / maxCount) * 100;
                  const isHigh = data.csatType === 'nps' ? score >= 9 : score >= 4;
                  const isMid = data.csatType === 'nps' ? score >= 7 : score === 3;
                  const barColor = isHigh ? 'bg-emerald-500' : isMid ? 'bg-amber-400' : 'bg-rose-400';
                  return (
                    <div key={score} className="flex items-center gap-3">
                      <span className="text-xs font-bold text-slate-600 w-5 text-right shrink-0">{score}</span>
                      <div className="flex-1 bg-slate-100 rounded-full h-5 overflow-hidden">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${pct}%` }}
                          transition={{ duration: 0.6 }}
                          className={`h-full rounded-full ${barColor}`}
                        />
                      </div>
                      <span className="text-xs font-bold text-slate-500 w-6 shrink-0">{count}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border border-slate-200 shadow-sm overflow-hidden">
        <CardHeader className="bg-slate-50 border-b border-slate-100 py-3"><CardTitle className="text-sm font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2"><Bot className="w-4 h-4 text-teal-600" />Performance do Comercial (Período)</CardTitle></CardHeader>
        <CardContent className="p-5">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[{ label: "Respostas do Comercial", value: data.aiMessages, pct: (data.totalMessagesMonth > 0 ? (data.aiMessages / data.totalMessagesMonth * 100) : 0).toFixed(0), icon: Bot, color: "text-teal-600", bg: "bg-teal-50" }, { label: "Respostas Humanas", value: data.humanMessages, pct: (data.totalMessagesMonth > 0 ? (data.humanMessages / data.totalMessagesMonth * 100) : 0).toFixed(0), icon: UserCheck, color: "text-blue-600", bg: "bg-blue-50" }, { label: "Mensagens de Leads", value: data.userMessages, pct: (data.totalMessagesMonth > 0 ? (data.userMessages / data.totalMessagesMonth * 100) : 0).toFixed(0), icon: Send, color: "text-amber-600", bg: "bg-amber-50" }, { label: "Conversão", value: `${((data.aiAppointments / Math.max(data.leadsServedByAI, 1)) * 100).toFixed(1)}%`, pct: ((data.aiAppointments / Math.max(data.leadsServedByAI, 1)) * 100).toFixed(1), icon: TrendingUp, color: "text-emerald-600", bg: "bg-emerald-50" }].map((m, i) => (
              <motion.div key={m.label} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.3 + i * 0.08 }} className="flex flex-col items-center text-center p-4 rounded-xl bg-slate-50/50 border border-slate-100 hover:border-slate-200 transition-all">
                <div className={`p-3 rounded-xl ${m.bg} mb-3`}><m.icon className={`w-5 h-5 ${m.color}`} /></div>
                <p className="text-2xl font-bold text-slate-900">{m.value}</p>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-1">{m.label}</p>
                <div className="w-full mt-3"><div className="w-full bg-slate-200 rounded-full h-1.5 overflow-hidden"><motion.div initial={{ width: 0 }} animate={{ width: `${m.pct}%` }} transition={{ duration: 1, delay: 0.5 + i * 0.1 }} className={`h-full rounded-full ${m.color.includes('teal') ? 'bg-teal-500' : m.color.includes('blue') ? 'bg-blue-500' : m.color.includes('amber') ? 'bg-amber-500' : 'bg-emerald-500'}`} /></div><p className="text-[10px] font-bold text-slate-400 mt-1">{m.pct}%</p></div>
              </motion.div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
