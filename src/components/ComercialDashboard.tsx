import React, { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import {
  Bot,
  UserCheck,
  Zap,
  MessageSquare,
  CalendarCheck,
  ArrowRightLeft,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Users,
  Calendar,
  ChevronDown,
  BarChart3,
  Star,
  ThumbsUp,
  Loader2,
  Target,
  Trophy,
  XCircle,
  Hourglass,
  BellRing,
  TrendingUp,
  DollarSign,
  Wallet,
  Timer,
  Percent,
  ChevronRight,
  ChevronLeft,
  Settings as SettingsIcon,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { format, subDays, addMonths, startOfWeek, endOfWeek, startOfMonth, endOfMonth, subMonths, subWeeks, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { DayPicker } from "react-day-picker";
import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../lib/supabase";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import MetaLogo from "../assets/logos/Logo Metaads.png";
import GoogleLogo from "../assets/logos/Logo Googleads.png";
import SemOrigemLogo from "../assets/logos/Logo Sem origem.png";

// ==========================================
// Tipos do retorno da RPC get_commercial_dashboard
// ==========================================
interface CommercialData {
  agents: {
    ia: { messagesOut: number; leadsTouched: number; appointments: number; leadsEnabled: number; autonomous: number; handoffs: number };
    humano: { messagesOut: number; leadsTouched: number; appointments: number; handoffsReceived: number };
    sistema: { automations: Record<string, number> };
  };
  messages: { inbound: number; total: number };
  appointments: { total: number; ia: number; manual: number; byStatus: Record<string, number> };
  sla: { breaches: number; pending: number; avgFirstResponseMin: number; medianFirstResponseMin: number; slaMinutes: number };
  finance: { revenue: number; investment: number; investmentTotal: number; convertedValue: number; salesCycleDays: number; attendedConsults: number };
  outcomes: { won: number; lost: number };
  agent: AgentFilter;
  csat: { type: string; answered: number; avg: number | null; distribution: { score: number; count: number }[] };
  funnel: { stage_id: string; name: string; slug: string | null; position: number; is_conversion: boolean; color: string | null; leads: number }[];
  daily: { date: string; aiMessages: number; humanMessages: number; leads: number; appointments: number; handoffs: number; followups: number }[];
  totalLeads: number;
  newLeads: number;
}

type Period = "dia" | "sem" | "mês";
type Audience = "dono" | "agencia";
type AgentFilter = "todos" | "ia" | "humano";
type OriginFilter = "todos" | "meta" | "google" | "sem_origem";
type ChartMetric = "humanMessages" | "aiMessages" | "leads" | "appointments" | "handoffs" | "followups";

// ==========================================
// Helpers
// ==========================================
// Catálogo de métricas do topo (id -> label) para o botão "Métricas"
const METRICS_CONFIG: { id: string; label: string }[] = [
  { id: "leads", label: "Leads" },
  { id: "conversao_agend", label: "Conversão Lead → Agend." },
  { id: "conversao_consulta", label: "Conversão Lead → Consulta" },
  { id: "consultas", label: "Consultas Agendadas" },
  { id: "consultas_realizadas", label: "Consultas Realizadas" },
  { id: "custo_agendamento", label: "Custo por Agendamento" },
  { id: "ticket_medio", label: "Ticket Médio" },
  { id: "faturamento", label: "Faturamento" },
  { id: "tempo_resposta", label: "Tempo de Resposta" },
  { id: "ciclo_vendas", label: "Ciclo de Vendas" },
  { id: "roas", label: "ROAS" },
];
const DEFAULT_METRIC_IDS = METRICS_CONFIG.map((m) => m.id);

// presets de período — "últimos N dias" INCLUEM hoje (fim = hoje)
function computeRange(id: string): { start: Date; end: Date; label: string } {
  const today = new Date();
  let start = today, end = today, label = "";
  switch (id) {
    case "today": label = "HOJE"; break;
    case "yesterday": start = subDays(today, 1); end = subDays(today, 1); label = "ONTEM"; break;
    case "week": start = startOfWeek(today, { weekStartsOn: 0 }); label = "ESTA SEMANA"; break;
    case "last_week": { const lw = subWeeks(today, 1); start = startOfWeek(lw, { weekStartsOn: 0 }); end = endOfWeek(lw, { weekStartsOn: 0 }); label = "SEMANA PASSADA"; break; }
    case "7days": start = subDays(today, 6); end = today; label = "ÚLTIMOS 7 DIAS"; break;
    case "14days": start = subDays(today, 13); end = today; label = "ÚLTIMOS 14 DIAS"; break;
    case "28days": start = subDays(today, 27); end = today; label = "ÚLTIMOS 28 DIAS"; break;
    case "30days": start = subDays(today, 29); end = today; label = "ÚLTIMOS 30 DIAS"; break;
    case "month": start = startOfMonth(today); label = "ESTE MÊS"; break;
    case "last_month": { const lm = subMonths(today, 1); start = startOfMonth(lm); end = endOfMonth(lm); label = "MÊS PASSADO"; break; }
  }
  return { start, end, label };
}

const RANGE_PRESETS = [
  { id: "today", label: "Hoje" },
  { id: "yesterday", label: "Ontem" },
  { id: "week", label: "Esta Semana" },
  { id: "last_week", label: "Semana Passada" },
  { id: "7days", label: "Últimos 7 dias" },
  { id: "14days", label: "Últimos 14 dias" },
  { id: "28days", label: "Últimos 28 dias" },
  { id: "30days", label: "Últimos 30 dias" },
  { id: "month", label: "Este Mês" },
  { id: "last_month", label: "Mês Passado" },
];

type DailyPoint = { date: string; aiMessages: number; humanMessages: number; leads: number; appointments: number; handoffs: number; followups: number };

// Agrupa a série diária por dia / semana / mês para o gráfico de tendência
function bucketDaily(daily: DailyPoint[], period: Period): (Omit<DailyPoint, "date"> & { label: string })[] {
  if (period === "dia") return daily.map((d) => ({ ...d, label: format(parseISO(d.date), "dd/MM") }));
  const map = new Map<string, Omit<DailyPoint, "date"> & { label: string }>();
  for (const d of daily) {
    const dt = parseISO(d.date);
    const anchor = period === "sem" ? startOfWeek(dt, { weekStartsOn: 0 }) : startOfMonth(dt);
    const key = format(anchor, period === "sem" ? "yyyy-ww" : "yyyy-MM");
    const label = period === "sem" ? format(anchor, "dd/MM") : format(anchor, "MMM", { locale: ptBR });
    const b = map.get(key) || { label, aiMessages: 0, humanMessages: 0, leads: 0, appointments: 0, handoffs: 0, followups: 0 };
    b.aiMessages += d.aiMessages; b.humanMessages += d.humanMessages; b.leads += d.leads;
    b.appointments += d.appointments; b.handoffs += d.handoffs; b.followups += d.followups;
    map.set(key, b);
  }
  return Array.from(map.values());
}

// Formata duração em minutos de forma legível (min / h / dias)
function fmtDuration(min: number): string {
  if (!min || min <= 0) return "—";
  if (min < 60) return `${min < 10 ? min.toFixed(1) : Math.round(min)} min`;
  const h = min / 60;
  if (h < 48) return `${h.toFixed(1)} h`;
  return `${(h / 24).toFixed(1)} dias`;
}

function pct(num: number, den: number): string {
  if (!den) return "0%";
  return `${((num / den) * 100).toFixed(1)}%`;
}

function fmtBRL(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });
}

const AUTOMATION_LABELS: Record<string, string> = {
  followup: "Follow-ups",
  forms_welcome: "Boas-vindas (Forms)",
  confirm: "Confirmações",
  handoff: "Handoffs",
};

const STATUS_LABELS: Record<string, { label: string; tone: string }> = {
  realizado: { label: "Realizados", tone: "text-emerald-600" },
  compareceu: { label: "Compareceram", tone: "text-emerald-600" },
  confirmado: { label: "Confirmados", tone: "text-blue-600" },
  pendente: { label: "Pendentes", tone: "text-amber-600" },
  faltou: { label: "Faltaram", tone: "text-rose-600" },
  cancelado: { label: "Cancelados", tone: "text-slate-500" },
  indefinido: { label: "Sem status", tone: "text-slate-400" },
};

const CHART_METRICS: { label: string; value: ChartMetric; icon: any }[] = [
  { label: "Msgs Humano", value: "humanMessages", icon: UserCheck },
  { label: "Msgs IA", value: "aiMessages", icon: Bot },
  { label: "Novos Leads", value: "leads", icon: Users },
  { label: "Agendamentos", value: "appointments", icon: CalendarCheck },
  { label: "Handoffs", value: "handoffs", icon: ArrowRightLeft },
  { label: "Follow-ups", value: "followups", icon: BellRing },
];

// ==========================================
// Componente principal
// ==========================================
export function ComercialDashboard() {
  const { profile, activeClinicId } = useAuth();
  const [data, setData] = useState<CommercialData | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<Period>("dia");
  // Conversão (evento) — janela principal; presets INCLUEM hoje
  const [convRange, setConvRange] = useState<{ start: Date; end: Date }>(() => ({ start: subDays(new Date(), 6), end: new Date() }));
  const [convLabel, setConvLabel] = useState("ÚLTIMOS 7 DIAS");
  const [isConvOpen, setIsConvOpen] = useState(false);
  const [convCal1, setConvCal1] = useState<Date>(() => subDays(new Date(), 6));
  const [convCal2, setConvCal2] = useState<Date>(() => addMonths(subDays(new Date(), 6), 1));
  // Entrada (coorte) — null = "Todos"
  const [entryRange, setEntryRange] = useState<{ start: Date; end: Date } | null>(null);
  const [entryLabel, setEntryLabel] = useState("TODOS");
  const [isEntryOpen, setIsEntryOpen] = useState(false);
  const [entryCal1, setEntryCal1] = useState<Date>(() => subDays(new Date(), 6));
  const [entryCal2, setEntryCal2] = useState<Date>(() => addMonths(subDays(new Date(), 6), 1));
  const [audience, setAudience] = useState<Audience>(() => (localStorage.getItem("comercialAudience") as Audience) || "dono");
  const [agent, setAgent] = useState<AgentFilter>(() => (localStorage.getItem("comercialAgent") as AgentFilter) || "todos");
  const [origin, setOrigin] = useState<OriginFilter>(() => (localStorage.getItem("comercialOrigin") as OriginFilter) || "todos");
  const [chartMetric, setChartMetric] = useState<ChartMetric>("humanMessages");
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [visibleMetrics, setVisibleMetrics] = useState<string[]>(() => {
    const saved = localStorage.getItem("comercialVisibleMetrics_v3");
    return saved ? JSON.parse(saved) : DEFAULT_METRIC_IDS;
  });
  const [metricsOrder, setMetricsOrder] = useState<string[]>(() => {
    const saved = localStorage.getItem("comercialMetricsOrder_v3");
    const parsed = saved ? (JSON.parse(saved) as string[]) : DEFAULT_METRIC_IDS;
    // garante que métricas novas apareçam mesmo com ordem salva antiga
    return [...parsed, ...DEFAULT_METRIC_IDS.filter((id) => !parsed.includes(id))];
  });
  const dropdownRef = React.useRef<HTMLDivElement>(null);

  const setConvById = (id: string) => {
    const r = computeRange(id);
    setConvRange({ start: r.start, end: r.end }); setConvLabel(r.label);
    setConvCal1(r.start); setConvCal2(addMonths(r.start, 1)); setIsConvOpen(false);
  };
  const onConvSelect = (r: { from?: Date; to?: Date } | undefined) => {
    if (r?.from) { setConvRange((d) => ({ ...d, start: r.from! })); setConvLabel("PERSONALIZADO"); }
    if (r?.to) { setConvRange((d) => ({ ...d, end: r.to! })); }
  };
  const setEntryById = (id: string) => {
    if (id === "todos") { setEntryRange(null); setEntryLabel("TODOS"); setIsEntryOpen(false); return; }
    const r = computeRange(id);
    setEntryRange({ start: r.start, end: r.end }); setEntryLabel(r.label);
    setEntryCal1(r.start); setEntryCal2(addMonths(r.start, 1)); setIsEntryOpen(false);
  };
  const onEntrySelect = (r: { from?: Date; to?: Date } | undefined) => {
    if (!r) return;
    setEntryRange((d) => ({ start: r.from ?? d?.start ?? r.to!, end: r.to ?? d?.end ?? r.from! }));
    setEntryLabel("PERSONALIZADO");
  };

  const toggleMetric = (id: string) => setVisibleMetrics((prev) => {
    const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
    localStorage.setItem("comercialVisibleMetrics_v3", JSON.stringify(next));
    return next;
  });
  const moveMetric = (id: string, dir: "up" | "down") => setMetricsOrder((prev) => {
    const idx = prev.indexOf(id);
    const ni = dir === "up" ? idx - 1 : idx + 1;
    if (ni < 0 || ni >= prev.length) return prev;
    const next = [...prev];
    [next[idx], next[ni]] = [next[ni], next[idx]];
    localStorage.setItem("comercialMetricsOrder_v3", JSON.stringify(next));
    return next;
  });

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) setIsDropdownOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const fetchData = useCallback(async (silent = false) => {
    const clinicId = activeClinicId || profile?.clinic_id;
    if (!clinicId) return;
    if (!silent) setLoading(true);
    try {
      const { data: res, error } = await supabase.rpc("get_commercial_dashboard", {
        p_clinic_id: clinicId,
        p_entry_from: entryRange ? format(entryRange.start, "yyyy-MM-dd") : null,
        p_entry_to: entryRange ? format(entryRange.end, "yyyy-MM-dd") : null,
        p_conv_from: format(convRange.start, "yyyy-MM-dd"),
        p_conv_to: format(convRange.end, "yyyy-MM-dd"),
        p_agent: agent,
        p_origin: origin,
      });
      if (error) throw error;
      setData(res as CommercialData);
    } catch (err) {
      console.error("ComercialDashboard fetch error:", err);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [activeClinicId, profile?.clinic_id, convRange, entryRange, agent, origin]);

  useEffect(() => {
    const clinicId = activeClinicId || profile?.clinic_id;
    fetchData();
    if (!clinicId) return;
    const channel = supabase
      .channel("comercial_dashboard_rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_messages", filter: `clinic_id=eq.${clinicId}` }, () => fetchData(true))
      .on("postgres_changes", { event: "*", schema: "public", table: "leads", filter: `clinic_id=eq.${clinicId}` }, () => fetchData(true))
      .on("postgres_changes", { event: "*", schema: "public", table: "appointments", filter: `clinic_id=eq.${clinicId}` }, () => fetchData(true))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchData, activeClinicId, profile?.clinic_id]);

  const setAudiencePersist = (a: Audience) => { setAudience(a); localStorage.setItem("comercialAudience", a); };
  const setAgentPersist = (v: AgentFilter) => { setAgent(v); localStorage.setItem("comercialAgent", v); };
  const setOriginPersist = (v: OriginFilter) => { setOrigin(v); localStorage.setItem("comercialOrigin", v); };

  if (loading || !data) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 text-teal-600 animate-spin" /></div>;
  }

  const { agents, appointments, sla, outcomes, csat, funnel } = data;
  const status = appointments.byStatus || {};
  const attended = (status.realizado || 0) + (status.compareceu || 0);
  const noShow = status.faltou || 0;
  const noShowBase = attended + noShow;
  const iaActed = agents.ia.messagesOut > 0 || agents.ia.leadsTouched > 0 || agents.ia.appointments > 0;
  const automations = agents.sistema.automations || {};
  const automationsTotal = Object.values(automations).reduce((a, b) => a + b, 0);

  // ===== KPI strip (headline) — números que importam ao cliente (estilo Marketing) =====
  // Escopados pelo filtro de agente: conversão, consultas, preço/consulta, tempo de resposta.
  // "geral" (não atribuível a agente): faturamento, ticket médio, ROAS, ciclo de vendas.
  const fin = data.finance;
  const convAgendRate = data.newLeads > 0 ? (appointments.total / data.newLeads) * 100 : 0;
  const convConsultaRate = data.newLeads > 0 ? (attended / data.newLeads) * 100 : 0;
  const costPerAppt = appointments.total > 0 && fin.investment > 0 ? fin.investment / appointments.total : null;
  const avgTicket = fin.attendedConsults > 0 && fin.convertedValue > 0 ? fin.convertedValue / fin.attendedConsults : null;
  const roas = fin.investmentTotal > 0 ? fin.revenue / fin.investmentTotal : null;
  const agentNoun = agent === "ia" ? "da IA" : agent === "humano" ? "do humano" : "no total";
  const leadsValue = agent === "ia" ? agents.ia.leadsTouched : agent === "humano" ? agents.humano.leadsTouched : data.newLeads;

  type Kpi = { id: string; title: string; value: React.ReactNode; icon: any; color: string; bg: string; sub?: string; agentScoped: boolean; originScoped: boolean };
  const allKpis: Kpi[] = [
    { id: "leads", title: "Leads", value: leadsValue, icon: Users, color: "text-cyan-600", bg: "bg-cyan-50", sub: agent === "todos" ? "entraram no período" : `atendidos ${agentNoun}`, agentScoped: true, originScoped: true },
    { id: "conversao_agend", title: "Conversão Lead → Agendamento", value: `${convAgendRate.toFixed(1)}%`, icon: Percent, color: "text-emerald-600", bg: "bg-emerald-50", sub: `${appointments.total} agend. ${agentNoun} ÷ ${data.newLeads} leads`, agentScoped: true, originScoped: true },
    { id: "conversao_consulta", title: "Conversão Lead → Consulta", value: `${convConsultaRate.toFixed(1)}%`, icon: CheckCircle2, color: "text-green-600", bg: "bg-green-50", sub: `${attended} realizadas ÷ ${data.newLeads} leads`, agentScoped: true, originScoped: true },
    { id: "consultas", title: "Consultas Agendadas", value: appointments.total, icon: CalendarCheck, color: "text-teal-600", bg: "bg-teal-50", sub: agent === "todos" ? `${appointments.ia} IA · ${appointments.manual} manual` : `via ${agentNoun}`, agentScoped: true, originScoped: true },
    { id: "consultas_realizadas", title: "Consultas Realizadas", value: attended, icon: CheckCircle2, color: "text-emerald-600", bg: "bg-emerald-50", sub: `${pct(attended, appointments.total)} dos agendamentos`, agentScoped: true, originScoped: true },
    { id: "custo_agendamento", title: "Custo por Agendamento", value: costPerAppt != null ? fmtBRL(costPerAppt) : "—", icon: Target, color: "text-rose-600", bg: "bg-rose-50", sub: "investimento ÷ agendamentos", agentScoped: true, originScoped: true },
    { id: "ticket_medio", title: "Ticket Médio das Consultas", value: avgTicket != null ? fmtBRL(avgTicket) : "—", icon: DollarSign, color: "text-blue-600", bg: "bg-blue-50", sub: fin.attendedConsults > 0 ? `valor convertido ÷ ${fin.attendedConsults} realizadas` : "sem consultas realizadas", agentScoped: false, originScoped: false },
    { id: "faturamento", title: "Faturamento Gerado", value: fmtBRL(fin.revenue), icon: Wallet, color: "text-emerald-700", bg: "bg-emerald-50", agentScoped: false, originScoped: false },
    { id: "tempo_resposta", title: "Tempo Médio de Resposta", value: fmtDuration(sla.medianFirstResponseMin), icon: Clock, color: "text-amber-600", bg: "bg-amber-50", sub: sla.slaMinutes > 0 ? `meta: ${fmtDuration(sla.slaMinutes)}` : undefined, agentScoped: true, originScoped: true },
    { id: "ciclo_vendas", title: "Ciclo Médio de Vendas", value: fin.salesCycleDays > 0 ? `${fin.salesCycleDays} dias` : "—", icon: Timer, color: "text-indigo-600", bg: "bg-indigo-50", agentScoped: false, originScoped: true },
    { id: "roas", title: "ROAS", value: roas != null ? `${roas.toFixed(1)}x` : "—", icon: TrendingUp, color: "text-violet-600", bg: "bg-violet-50", sub: fin.investmentTotal > 0 ? `${fmtBRL(fin.revenue)} ÷ ${fmtBRL(fin.investmentTotal)}` : "sem investimento", agentScoped: false, originScoped: false },
  ];
  const kpiById = Object.fromEntries(allKpis.map((k) => [k.id, k]));
  const headlineKpis = metricsOrder.filter((id) => visibleMetrics.includes(id)).map((id) => kpiById[id]).filter(Boolean) as Kpi[];

  // ===== Seções =====
  // Atividade de Atendimento — dirigida pelo filtro global de agente
  const agentTiles =
    agent === "ia"
      ? [
          { icon: MessageSquare, label: "Mensagens enviadas", value: agents.ia.messagesOut, color: "text-teal-600", bg: "bg-teal-50" },
          { icon: Users, label: "Leads atendidos", value: agents.ia.leadsTouched, color: "text-teal-600", bg: "bg-teal-50" },
          { icon: CalendarCheck, label: "Agendamentos", value: agents.ia.appointments, color: "text-emerald-600", bg: "bg-emerald-50" },
          { icon: CheckCircle2, label: "Resolvidos sem humano", value: agents.ia.autonomous, color: "text-blue-600", bg: "bg-blue-50" },
          { icon: ArrowRightLeft, label: "Passados p/ humano", value: agents.ia.handoffs, color: "text-orange-600", bg: "bg-orange-50" },
        ]
      : agent === "humano"
      ? [
          { icon: MessageSquare, label: "Mensagens enviadas", value: agents.humano.messagesOut, color: "text-blue-600", bg: "bg-blue-50" },
          { icon: CalendarCheck, label: "Agendamentos manuais", value: agents.humano.appointments, color: "text-emerald-600", bg: "bg-emerald-50" },
          { icon: ArrowRightLeft, label: "Conversas assumidas", value: agents.humano.handoffsReceived, color: "text-orange-600", bg: "bg-orange-50" },
          { icon: MessageSquare, label: "Mensagens recebidas (leads)", value: data.messages.inbound, color: "text-slate-500", bg: "bg-slate-100" },
        ]
      : [
          { icon: Bot, label: "Mensagens da IA", value: agents.ia.messagesOut, color: "text-teal-600", bg: "bg-teal-50" },
          { icon: UserCheck, label: "Mensagens do Humano", value: agents.humano.messagesOut, color: "text-blue-600", bg: "bg-blue-50" },
          { icon: CalendarCheck, label: "Agendamentos (IA + manual)", value: appointments.total, color: "text-emerald-600", bg: "bg-emerald-50" },
          { icon: ArrowRightLeft, label: "Handoffs IA → humano", value: agents.ia.handoffs, color: "text-orange-600", bg: "bg-orange-50" },
          { icon: MessageSquare, label: "Mensagens recebidas (leads)", value: data.messages.inbound, color: "text-slate-500", bg: "bg-slate-100" },
        ];
  const agentSectionIcon = agent === "ia" ? Bot : agent === "humano" ? UserCheck : Users;
  const agentSectionLabel = agent === "ia" ? "IA" : agent === "humano" ? "Humano" : "Todos os agentes";

  const sectionAgents = (
    <Card key="agents" className="border border-slate-200 shadow-sm overflow-hidden">
      <CardHeader className="bg-slate-50 border-b border-slate-100 py-3 flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2">
          {React.createElement(agentSectionIcon, { className: "w-4 h-4 text-teal-600" })}
          Atividade de Atendimento
        </CardTitle>
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{agentSectionLabel}</span>
      </CardHeader>
      <CardContent className="p-5">
        {agent === "ia" && !iaActed ? (
          <div className="flex flex-col items-center justify-center py-10 gap-2 text-slate-400 text-center">
            <Bot className="w-10 h-10 text-slate-200" />
            <p className="text-sm font-semibold text-slate-500">A IA não atuou neste período</p>
            <p className="text-xs">Esta clínica opera com atendimento humano.</p>
          </div>
        ) : (
          <AnimatePresence mode="wait">
            <motion.div key={agent} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.18 }} className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {agentTiles.map((tile) => (
                <MetricTile key={tile.label} icon={tile.icon} label={tile.label} value={tile.value} color={tile.color} bg={tile.bg} />
              ))}
            </motion.div>
          </AnimatePresence>
        )}
      </CardContent>
    </Card>
  );

  const sectionSistema = (
    <Card key="sistema" className="border border-slate-200 shadow-sm overflow-hidden">
      <CardHeader className="bg-slate-50 border-b border-slate-100 py-3">
        <CardTitle className="text-sm font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2"><Zap className="w-4 h-4 text-violet-600" />Automações do Sistema</CardTitle>
      </CardHeader>
      <CardContent className="p-5">
        {automationsTotal > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {Object.entries(automations).sort((a, b) => b[1] - a[1]).map(([type, count]) => (
              <MetricTile key={type} icon={Zap} label={AUTOMATION_LABELS[type] || type} value={count} color="text-violet-600" bg="bg-violet-50" />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-8 gap-2 text-slate-400 text-center">
            <Zap className="w-9 h-9 text-slate-200" />
            <p className="text-sm font-semibold text-slate-500">Sem automações no período</p>
            <p className="text-xs">Follow-ups, boas-vindas e confirmações aparecem aqui.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );

  const sectionFunnel = (
    <Card key="funnel" className="border border-slate-200 shadow-sm overflow-hidden">
      <CardHeader className="bg-slate-50 border-b border-slate-100 py-3">
        <CardTitle className="text-sm font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2"><Target className="w-4 h-4 text-cyan-600" />Funil Comercial</CardTitle>
      </CardHeader>
      <CardContent className="p-5">
        {funnel.length === 0 || funnel.every((s) => s.leads === 0) ? (
          <div className="flex flex-col items-center justify-center py-8 gap-2 text-slate-400 text-center">
            <Target className="w-9 h-9 text-slate-200" />
            <p className="text-sm font-semibold text-slate-500">Sem movimentações no funil</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {(() => {
              const maxLeads = Math.max(...funnel.map((s) => s.leads), 1);
              const topLeads = funnel.find((s) => s.leads > 0)?.leads || 1;
              return funnel.map((stage, i) => (
                <div key={stage.stage_id} className="flex items-center gap-3">
                  <div className="w-36 shrink-0 text-right">
                    <p className={`text-xs font-bold truncate ${stage.is_conversion ? "text-emerald-700" : "text-slate-600"}`}>{stage.name}</p>
                  </div>
                  <div className="flex-1 bg-slate-100 rounded-lg h-7 overflow-hidden relative">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.max((stage.leads / maxLeads) * 100, stage.leads > 0 ? 3 : 0)}%` }}
                      transition={{ duration: 0.6, delay: i * 0.05 }}
                      className={`h-full rounded-lg ${stage.is_conversion ? "bg-gradient-to-r from-emerald-400 to-emerald-500" : "bg-gradient-to-r from-cyan-400 to-cyan-500"}`}
                    />
                    <span className="absolute inset-y-0 left-2 flex items-center text-[11px] font-bold text-slate-700">{stage.leads}</span>
                  </div>
                  <div className="w-14 shrink-0 text-right">
                    <span className="text-[11px] font-bold text-slate-400">{pct(stage.leads, topLeads)}</span>
                  </div>
                </div>
              ));
            })()}
            <div className="flex items-center gap-4 pt-3 mt-1 border-t border-slate-100">
              <div className="flex items-center gap-2"><Trophy className="w-4 h-4 text-emerald-600" /><span className="text-xs font-medium text-slate-500">Ganhos</span><span className="text-sm font-bold text-emerald-700">{outcomes.won}</span></div>
              <div className="flex items-center gap-2"><XCircle className="w-4 h-4 text-rose-500" /><span className="text-xs font-medium text-slate-500">Perdidos</span><span className="text-sm font-bold text-rose-600">{outcomes.lost}</span></div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );

  const sectionSla = (
    <Card key="sla" className="border border-slate-200 shadow-sm overflow-hidden">
      <CardHeader className="bg-slate-50 border-b border-slate-100 py-3">
        <CardTitle className="text-sm font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2"><Clock className="w-4 h-4 text-amber-500" />SLA & Velocidade de Atendimento</CardTitle>
      </CardHeader>
      <CardContent className="p-5">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="flex flex-col items-center justify-center p-4 rounded-xl bg-emerald-50 border border-emerald-100 text-center">
            <Hourglass className="w-5 h-5 text-emerald-500 mb-1" />
            <p className="text-2xl font-bold text-emerald-700">{fmtDuration(sla.medianFirstResponseMin)}</p>
            <p className="text-[10px] font-bold text-emerald-500/80 uppercase tracking-wider mt-1">1ª resposta (mediana)</p>
            {sla.slaMinutes > 0 && <p className="text-[10px] text-slate-400 font-medium mt-0.5">meta: {fmtDuration(sla.slaMinutes)}</p>}
          </div>
          <div className="flex flex-col items-center justify-center p-4 rounded-xl bg-slate-50 border border-slate-100 text-center">
            <Clock className="w-5 h-5 text-slate-400 mb-1" />
            <p className="text-2xl font-bold text-slate-700">{fmtDuration(sla.avgFirstResponseMin)}</p>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-1">1ª resposta (média)</p>
          </div>
          <div className={`flex flex-col items-center justify-center p-4 rounded-xl border text-center ${sla.breaches > 0 ? "bg-rose-50/60 border-rose-200" : "bg-emerald-50/60 border-emerald-200"}`}>
            <AlertTriangle className={`w-5 h-5 mb-1 ${sla.breaches > 0 ? "text-rose-500" : "text-emerald-500"}`} />
            <p className={`text-2xl font-bold ${sla.breaches > 0 ? "text-rose-700" : "text-emerald-700"}`}>{sla.breaches}</p>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-1">SLA violados</p>
          </div>
          <div className={`flex flex-col items-center justify-center p-4 rounded-xl border text-center ${sla.pending > 0 ? "bg-amber-50/60 border-amber-200" : "bg-emerald-50/60 border-emerald-200"}`}>
            <MessageSquare className={`w-5 h-5 mb-1 ${sla.pending > 0 ? "text-amber-500" : "text-emerald-500"}`} />
            <p className={`text-2xl font-bold ${sla.pending > 0 ? "text-amber-700" : "text-emerald-700"}`}>{sla.pending}</p>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-1">Aguardando resposta</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );

  const sectionAppointments = (
    <Card key="appointments" className="border border-slate-200 shadow-sm overflow-hidden">
      <CardHeader className="bg-slate-50 border-b border-slate-100 py-3">
        <CardTitle className="text-sm font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2"><CalendarCheck className="w-4 h-4 text-teal-600" />Agendamentos & Comparecimento</CardTitle>
      </CardHeader>
      <CardContent className="p-5">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Origem */}
          <div className="space-y-3">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Origem do agendamento</p>
            <AgentMetric icon={Bot} label="Pela IA" value={agents.ia.appointments} tone="text-teal-600" bg="bg-teal-50" />
            <AgentMetric icon={UserCheck} label="Manual (humano)" value={agents.humano.appointments} tone="text-blue-600" bg="bg-blue-50" />
            <div className="pt-2 border-t border-slate-100">
              <AgentMetric icon={CalendarCheck} label="Total" value={appointments.total} tone="text-slate-700" bg="bg-slate-100" />
            </div>
          </div>
          {/* Status */}
          <div className="lg:col-span-2">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Por status</p>
              {noShowBase > 0 && (
                <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${noShow / noShowBase > 0.15 ? "bg-rose-50 text-rose-600" : "bg-emerald-50 text-emerald-600"}`}>
                  No-show: {pct(noShow, noShowBase)}
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              {Object.entries(status).sort((a, b) => b[1] - a[1]).map(([key, count]) => {
                const meta = STATUS_LABELS[key] || { label: key, tone: "text-slate-500" };
                return (
                  <div key={key} className="flex items-center justify-between p-2.5 rounded-lg bg-slate-50/60 border border-slate-100">
                    <span className="text-[11px] font-medium text-slate-500 truncate">{meta.label}</span>
                    <span className={`text-sm font-bold ${meta.tone}`}>{count}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );

  const chartSeries = bucketDaily(data.daily, period);
  const maxVal = Math.max(...chartSeries.map((d) => d[chartMetric]), 1);
  const sectionTrend = (
    <Card key="trend" className="border border-slate-200 shadow-sm overflow-hidden flex flex-col">
      <CardHeader className="bg-slate-50 border-b border-slate-100 py-3 flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2"><BarChart3 className="w-4 h-4 text-teal-600" />Tendências</CardTitle>
        <div className="relative" ref={dropdownRef}>
          <button onClick={() => setIsDropdownOpen(!isDropdownOpen)} className="flex items-center justify-between gap-2 bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-[11px] font-bold text-slate-700 hover:border-teal-300 hover:bg-teal-50/30 transition-all shadow-sm min-w-[150px]">
            <div className="flex items-center gap-2">
              {React.createElement(CHART_METRICS.find((m) => m.value === chartMetric)?.icon || BarChart3, { className: "w-3.5 h-3.5 text-teal-600" })}
              <span>{CHART_METRICS.find((m) => m.value === chartMetric)?.label}</span>
            </div>
            <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-200 ${isDropdownOpen ? "rotate-180" : ""}`} />
          </button>
          <AnimatePresence>
            {isDropdownOpen && (
              <motion.div initial={{ opacity: 0, y: 10, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10, scale: 0.95 }} transition={{ duration: 0.15 }} className="absolute right-0 top-full mt-2 w-56 bg-white border border-slate-100 rounded-xl shadow-xl z-50 py-1.5 overflow-hidden">
                {CHART_METRICS.map((m) => (
                  <button key={m.value} onClick={() => { setChartMetric(m.value); setIsDropdownOpen(false); }} className={`w-full flex items-center gap-3 px-3 py-2 text-[11px] font-bold transition-colors ${chartMetric === m.value ? "bg-teal-50 text-teal-700" : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"}`}>
                    <div className={`p-1.5 rounded-lg ${chartMetric === m.value ? "bg-teal-100" : "bg-slate-100"}`}>{React.createElement(m.icon, { className: `w-3.5 h-3.5 ${chartMetric === m.value ? "text-teal-600" : "text-slate-500"}` })}</div>
                    <span className="flex-1 text-left">{m.label}</span>
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </CardHeader>
      <CardContent className="p-6 flex-1 flex flex-col justify-end">
        <div className="h-[200px] w-full flex items-end gap-1 px-1">
          {chartSeries.map((d, i) => {
            const val = d[chartMetric];
            return (
              <div key={`${d.label}-${i}`} className="flex-1 flex flex-col items-center gap-1.5 group min-w-0">
                <motion.div initial={{ height: 0 }} animate={{ height: `${Math.max((val / maxVal) * 100, val > 0 ? 4 : 1)}%` }} transition={{ delay: i * 0.02, duration: 0.5 }} className="w-full bg-gradient-to-t from-teal-500/30 to-teal-500/10 group-hover:from-teal-500/50 group-hover:to-teal-500/20 rounded-t-md relative flex justify-center border-t-2 border-teal-500">
                  <div className="absolute -top-7 opacity-0 group-hover:opacity-100 transition-opacity bg-slate-900 text-white text-[10px] font-bold px-2 py-1 rounded whitespace-nowrap z-10">{val}</div>
                </motion.div>
                {chartSeries.length <= 16 && <span className="text-[8px] font-bold text-slate-400 uppercase tracking-tighter truncate w-full text-center">{d.label}</span>}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );

  const sectionCsat = (
    <Card key="csat" className="border border-slate-200 shadow-sm overflow-hidden">
      <CardHeader className="bg-slate-50 border-b border-slate-100 py-3">
        <CardTitle className="text-sm font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2"><Star className="w-4 h-4 text-indigo-500" />Satisfação — {csat.type === "nps" ? "NPS" : csat.type === "both" ? "CSAT / NPS" : "CSAT"}</CardTitle>
      </CardHeader>
      <CardContent className="p-5">
        {csat.answered === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 gap-3 text-slate-400">
            <Star className="w-10 h-10 text-slate-200" />
            <p className="text-sm font-semibold">Nenhuma resposta no período</p>
            <p className="text-xs">As notas aparecerão aqui após os pacientes responderem à pesquisa.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="flex flex-col gap-4">
              <div className="flex flex-col items-center justify-center p-5 rounded-xl bg-indigo-50 border border-indigo-100 text-center">
                <Star className="w-5 h-5 text-indigo-400 mb-1" />
                <p className="text-3xl font-bold text-indigo-700">{csat.avg !== null ? Number(csat.avg).toFixed(1) : "—"}</p>
                <p className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider mt-1">Nota Média</p>
                <p className="text-[10px] text-indigo-300 font-medium">de {csat.type === "csat" ? "5" : "10"}</p>
              </div>
              <div className="flex flex-col items-center justify-center p-4 rounded-xl bg-slate-50 border border-slate-100 text-center">
                <ThumbsUp className="w-4 h-4 text-emerald-500 mb-1" />
                <p className="text-xl font-bold text-slate-900">{csat.answered}</p>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-0.5">Respondidos</p>
              </div>
            </div>
            <div className="lg:col-span-2 flex flex-col justify-center gap-2.5">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Distribuição de Notas</p>
              {csat.distribution.map(({ score, count }) => {
                const maxCount = Math.max(...csat.distribution.map((d) => d.count), 1);
                const barPct = (count / maxCount) * 100;
                const isHigh = csat.type === "nps" ? score >= 9 : score >= 4;
                const isMid = csat.type === "nps" ? score >= 7 : score === 3;
                const barColor = isHigh ? "bg-emerald-500" : isMid ? "bg-amber-400" : "bg-rose-400";
                return (
                  <div key={score} className="flex items-center gap-3">
                    <span className="text-xs font-bold text-slate-600 w-5 text-right shrink-0">{score}</span>
                    <div className="flex-1 bg-slate-100 rounded-full h-5 overflow-hidden"><motion.div initial={{ width: 0 }} animate={{ width: `${barPct}%` }} transition={{ duration: 0.6 }} className={`h-full rounded-full ${barColor}`} /></div>
                    <span className="text-xs font-bold text-slate-500 w-6 shrink-0">{count}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );

  // Ordem das seções por público
  const ownerOrder = [sectionAgents, sectionSla, sectionAppointments, sectionSistema, sectionFunnel, sectionTrend, sectionCsat];
  const agencyOrder = [sectionFunnel, sectionAgents, sectionAppointments, sectionSistema, sectionTrend, sectionSla, sectionCsat];
  const orderedSections = audience === "dono" ? ownerOrder : agencyOrder;

  return (
    <div className="space-y-6 h-full overflow-y-auto pr-1 custom-scrollbar pb-8">
      {/* Cabeçalho fixo: período + público + filtros globais */}
      <div className="sticky top-0 z-20 -mx-1 px-1 pt-1 pb-3 space-y-3 bg-slate-50/95 backdrop-blur-sm border-b border-slate-100">
      {/* Controles: granularidade do gráfico + datas (Entrada/Conversão) + público + métricas */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Granularidade do gráfico de tendências */}
          <div className="flex bg-slate-50 rounded-xl p-1 border border-slate-200" title="Granularidade do gráfico de Tendências">
            {(["dia", "sem", "mês"] as Period[]).map((p) => (
              <button key={p} onClick={() => setPeriod(p)} className={cn("px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all", period === p ? "bg-white text-teal-600 shadow-sm border border-slate-200" : "text-slate-400 hover:text-slate-600")}>{p}</button>
            ))}
          </div>
          {/* Entrada (coorte de leads) */}
          <DatePill
            label="Entrada" valueLabel={entryLabel}
            rangeText={entryRange ? `${format(entryRange.start, "dd/MM")} - ${format(entryRange.end, "dd/MM")}` : "todos os leads"}
            open={isEntryOpen} setOpen={setIsEntryOpen}
            presets={[{ id: "todos", label: "Todos" }, ...RANGE_PRESETS]} activeLabel={entryLabel} onPreset={setEntryById}
            selected={entryRange ? { from: entryRange.start, to: entryRange.end } : undefined} onSelect={onEntrySelect}
            cal1={entryCal1} setCal1={setEntryCal1} cal2={entryCal2} setCal2={setEntryCal2}
          />
          {/* Conversão (data do evento/resultado) */}
          <DatePill
            label="Conversão" valueLabel={convLabel}
            rangeText={`${format(convRange.start, "dd/MM")} - ${format(convRange.end, "dd/MM")}`}
            open={isConvOpen} setOpen={setIsConvOpen}
            presets={RANGE_PRESETS} activeLabel={convLabel} onPreset={setConvById}
            selected={{ from: convRange.start, to: convRange.end }} onSelect={onConvSelect}
            cal1={convCal1} setCal1={setConvCal1} cal2={convCal2} setCal2={setConvCal2}
          />
        </div>
        {/* Público + Métricas */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
            {([["dono", "Visão do Dono"], ["agencia", "Visão da Agência"]] as [Audience, string][]).map(([val, label]) => (
              <button key={val} onClick={() => setAudiencePersist(val)} className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${audience === val ? "bg-white text-teal-700 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>{label}</button>
            ))}
          </div>
          <MetricsConfigButton metricsOrder={metricsOrder} visibleMetrics={visibleMetrics} toggleMetric={toggleMetric} moveMetric={moveMetric} />
        </div>
      </div>

      {/* Filtros globais (mudam os dados — mesmo design do Marketing): agente + origem */}
      <div className="flex items-center gap-x-6 gap-y-3 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 bg-white p-1 rounded-xl border border-slate-200 shadow-sm">
            {([
              ["todos", "Todos", Users],
              ["ia", "IA", Bot],
              ["humano", "Humano", UserCheck],
            ] as [AgentFilter, string, any][]).map(([val, label, Icon]) => (
              <button
                key={val}
                onClick={() => setAgentPersist(val)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all",
                  agent === val ? "bg-slate-900 text-white shadow-md shadow-slate-200" : "text-slate-400 hover:text-slate-600 hover:bg-slate-50"
                )}
                style={agent === val ? { backgroundColor: "#1e293b" } : {}}
              >
                <Icon className="w-3 h-3" />
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 bg-white p-1 rounded-xl border border-slate-200 shadow-sm">
            {([
              ["todos", "Todos", null],
              ["meta", "Meta", MetaLogo],
              ["google", "Google", GoogleLogo],
              ["sem_origem", "Orgânico", SemOrigemLogo],
            ] as [OriginFilter, string, string | null][]).map(([val, label, logo]) => (
              <button
                key={val}
                onClick={() => setOriginPersist(val)}
                className={cn(
                  "flex items-center gap-2 px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all",
                  origin === val ? "bg-slate-900 text-white shadow-md shadow-slate-200" : "text-slate-400 hover:text-slate-600 hover:bg-slate-50"
                )}
                style={origin === val ? { backgroundColor: "#1e293b" } : {}}
              >
                {logo && <img src={logo} alt={label} className={cn("w-3 h-3 object-contain", origin === val ? "brightness-0 invert" : "")} />}
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {headlineKpis.map((stat, i) => (
          <motion.div key={stat.title} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}>
            <Card className="border border-slate-200 shadow-sm hover:shadow-md transition-all">
              <CardContent className="p-5">
                <div className="flex justify-between items-start mb-3">
                  <div className={`p-2.5 rounded-xl ${stat.bg}`}><stat.icon className={`w-5 h-5 ${stat.color}`} /></div>
                  {((agent !== "todos" && !stat.agentScoped) || (origin !== "todos" && !stat.originScoped)) && (
                    <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-full" title="Não atribuível ao filtro ativo — valor geral da clínica">geral</span>
                  )}
                </div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">{stat.title}</p>
                <h3 className="text-2xl font-bold text-slate-900">{stat.value}</h3>
                {stat.sub && <p className="text-[10px] text-slate-400 mt-1 font-medium">{stat.sub}</p>}
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Seções ordenadas por público */}
      {orderedSections}
    </div>
  );
}

// ==========================================
// Subcomponente: pill de data (Entrada / Conversão) com presets + calendário
// ==========================================
function DatePill({ label, valueLabel, rangeText, open, setOpen, presets, activeLabel, onPreset, selected, onSelect, cal1, setCal1, cal2, setCal2 }: {
  label: string; valueLabel: string; rangeText: string; open: boolean; setOpen: (v: boolean) => void;
  presets: { id: string; label: string }[]; activeLabel: string; onPreset: (id: string) => void;
  selected: { from?: Date; to?: Date } | undefined; onSelect: (r: { from?: Date; to?: Date } | undefined) => void;
  cal1: Date; setCal1: (d: Date) => void; cal2: Date; setCal2: (d: Date) => void;
}) {
  return (
    <div className="flex items-center gap-2 bg-white p-1.5 rounded-2xl border border-slate-200 shadow-sm">
      <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest pl-1.5">{label}</span>
      <div className="relative">
        <div onClick={() => setOpen(!open)} className="flex items-center gap-2 px-3 py-1.5 rounded-xl hover:bg-slate-50 cursor-pointer transition-all border border-transparent hover:border-slate-200 group">
          <Calendar className={cn("w-4 h-4 transition-colors", open ? "text-teal-600" : "text-slate-400 group-hover:text-teal-600")} />
          <span className="text-xs font-bold text-slate-600 uppercase tracking-tight">{valueLabel}</span>
          <span className="text-[10px] font-medium text-slate-400">{rangeText}</span>
          <ChevronRight className={cn("w-3.5 h-3.5 text-slate-300 transition-transform", open ? "rotate-90 text-teal-600" : "")} />
        </div>
        <AnimatePresence>
          {open && (
            <>
              <div className="fixed inset-0 z-[105]" onClick={() => setOpen(false)} />
              <motion.div initial={{ opacity: 0, y: 10, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10, scale: 0.95 }} className="absolute top-full left-0 mt-3 bg-white rounded-2xl border border-slate-200 shadow-2xl z-[110] overflow-hidden rdp-custom flex">
                <div className="w-44 border-r border-slate-100 p-2 flex flex-col gap-0.5 shrink-0">
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-[2px] px-3 pt-1 pb-1.5">{label}</span>
                  {presets.map((opt) => (
                    <button key={opt.id} onClick={() => onPreset(opt.id)} className={cn("text-left px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors", activeLabel === opt.label.toUpperCase() ? "bg-teal-50 text-teal-700" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900")}>{opt.label}</button>
                  ))}
                </div>
                <div className="flex flex-col divide-y divide-slate-100">
                  <div className="p-3"><DayPicker mode="range" selected={selected as any} onSelect={onSelect} month={cal1} onMonthChange={setCal1} numberOfMonths={1} locale={ptBR} weekStartsOn={0} /></div>
                  <div className="p-3"><DayPicker mode="range" selected={selected as any} onSelect={onSelect} month={cal2} onMonthChange={setCal2} numberOfMonths={1} locale={ptBR} weekStartsOn={0} /></div>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ==========================================
// Subcomponente: linha de métrica de agente
// ==========================================
function AgentMetric({ icon: Icon, label, value, tone, bg }: { icon: any; label: string; value: number; tone: string; bg: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className={`p-1.5 rounded-lg ${bg}`}><Icon className={`w-3.5 h-3.5 ${tone}`} /></div>
      <span className="text-xs font-medium text-slate-500 flex-1">{label}</span>
      <span className="text-sm font-bold text-slate-900">{value}</span>
    </div>
  );
}

// Tile maior (usado no painel de agente em largura total e nas automações)
function MetricTile({ icon: Icon, label, value, color, bg }: { icon: any; label: string; value: number; color: string; bg: string }) {
  return (
    <div className="flex flex-col p-4 rounded-xl bg-slate-50/50 border border-slate-100 hover:border-slate-200 transition-all">
      <div className={`p-2 rounded-lg ${bg} w-fit mb-3`}><Icon className={`w-4 h-4 ${color}`} /></div>
      <p className="text-2xl font-bold text-slate-900">{value}</p>
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-1 leading-tight">{label}</p>
    </div>
  );
}

// Botão "Métricas" (mostrar/ocultar + reordenar KPIs do topo) — mesmo design do Marketing
function MetricsConfigButton({ metricsOrder, visibleMetrics, toggleMetric, moveMetric }: { metricsOrder: string[]; visibleMetrics: string[]; toggleMetric: (id: string) => void; moveMetric: (id: string, dir: "up" | "down") => void }) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div className="relative">
      <Button
        onClick={() => setIsOpen(!isOpen)}
        variant="outline"
        className={cn("gap-2 transition-all shadow-sm", isOpen ? "bg-teal-50 border-teal-200 text-teal-600 shadow-teal-100" : "border-slate-200 bg-white hover:bg-slate-50 text-slate-600")}
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
              className="absolute top-full right-0 mt-2 w-60 bg-white rounded-2xl border border-slate-200 shadow-2xl z-[110] p-3 overflow-hidden"
            >
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-3 pl-2">Métricas Visíveis</p>
              <div className="space-y-1">
                {metricsOrder.map((id, idx) => {
                  const m = METRICS_CONFIG.find((x) => x.id === id);
                  if (!m) return null;
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
                        <button onClick={(e) => { e.stopPropagation(); moveMetric(id, "up"); }} disabled={idx === 0} className="p-0.5 hover:bg-slate-100 rounded text-slate-400 disabled:opacity-30">
                          <ChevronLeft className="w-3 h-3 rotate-90" />
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); moveMetric(id, "down"); }} disabled={idx === metricsOrder.length - 1} className="p-0.5 hover:bg-slate-100 rounded text-slate-400 disabled:opacity-30">
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
