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
  ChevronDown,
  BarChart3,
  Loader2,
  Target,
  XCircle,
  Hourglass,
  BellRing,
  TrendingUp,
  Trophy,
  DollarSign,
  Wallet,
  Timer,
  Percent,
  ChevronRight,
  ChevronLeft,
  Settings as SettingsIcon,
  Phone,
  ExternalLink,
  Inbox,
  FileText,
  Download,
  Copy,
  Check,
  Store,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { format, subDays, addMonths, startOfWeek, endOfWeek, startOfMonth, endOfMonth, subMonths, subWeeks, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useAuth } from "../contexts/AuthContext";
import { supabase } from "../lib/supabase";
import { cn } from "../lib/utils";
import { TrendBarChart, fmtByType } from "./TrendBarChart";
import { Button } from "./ui/button";
import MetaLogo from "../assets/logos/Logo Metaads.png";
import GoogleLogo from "../assets/logos/Logo Googleads.png";
import SemOrigemLogo from "../assets/logos/Logo Sem origem.png";
import WhatsAppLogo from "../assets/logos/Logo Whatsapp.png";
import { FilterChips } from "./filters/FilterChips";
import { GranularityToggle } from "./filters/GranularityToggle";
import { DateRangePopover } from "./filters/DateRangePopover";
import { type Period, RANGE_PRESETS } from "../lib/dateRange";

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
  sla: { breaches: number; firstResponseMin: number; responseMin: number; overBreachMin: number; responseCycles: number; slaMinutes: number };
  finance: { revenue: number; revenueScoped: number; investment: number; investmentTotal: number; convertedValue: number; salesCycleDays: number; attendedConsults: number; defaultTicket: number };
  outcomes: { won: number; lost: number };
  agent: AgentFilter;
  csat: { type: string; answered: number; avg: number | null; distribution: { score: number; count: number }[] };
  funnel: { stage_id: string; name: string; slug: string | null; position: number; is_conversion: boolean; color: string | null; leads: number }[];
  daily: { date: string; aiMessages: number; humanMessages: number; leads: number; appointments: number; realizadas: number; ganhos: number; faturamento: number; faturamentoProjetado: number; investment: number; handoffs: number; followups: number }[];
  totalLeads: number;
  newLeads: number;
  leadsNotAttended: number;
  agendaViaFunil?: boolean;
}

// Linha da lista de leads do drill-down (RPC get_commercial_leads)
interface LeadRow {
  id: string;
  name: string | null;
  phone: string | null;
  source: string | null;
  estimatedValue: number | null;
  createdAt: string;
  lastMessageAt: string | null;
  aiEnabled: boolean | null;
  stageName: string | null;
  stageColor: string | null;
  isConversion: boolean | null;
  outcome: "ganho" | "perdido" | null;
}

type AgentFilter = "todos" | "ia" | "humano";
type OriginFilter = "todos" | "meta" | "google" | "sem_origem";
type ChannelFilter = "todos" | "forms" | "whatsapp" | "balcao";
type ChartMetric = "humanMessages" | "aiMessages" | "leads" | "appointments" | "realizadas" | "ganhos" | "faturamento" | "faturamentoProjetado" | "handoffs" | "followups" | "convAgend" | "convConsulta" | "custoAgend" | "cac" | "roasReal" | "roasProj" | "ticketMedio";

// ==========================================
// Helpers
// ==========================================
// Catálogo de métricas do topo (id -> label) para o botão "Métricas"
const METRICS_CONFIG: { id: string; label: string }[] = [
  { id: "leads", label: "Leads" },
  { id: "nao_atendidos", label: "Não atendidos" },
  { id: "conversao_agend", label: "Conversão Lead → Agend." },
  { id: "conversao_consulta", label: "Conversão Lead → Consulta" },
  { id: "consultas", label: "Consultas (realizadas/marcadas)" },
  { id: "consultas_geradas", label: "Consultas Geradas" },
  { id: "faturamento", label: "Faturamento" },
  { id: "custo_agendamento", label: "Custo por Agendamento" },
  { id: "cac", label: "CAC" },
  { id: "ticket_config", label: "Ticket Médio" },
  { id: "roas", label: "ROAS" },
];
const DEFAULT_METRIC_IDS = METRICS_CONFIG.map((m) => m.id);

// presets de período — "últimos N dias" são os N dias completos ANTERIORES (terminam ontem;
// o dia atual, em andamento, não entra). Para o dia atual use o preset "Hoje".
function computeRange(id: string): { start: Date; end: Date; label: string } {
  const today = new Date();
  const yesterday = subDays(today, 1);
  let start = today, end = today, label = "";
  switch (id) {
    case "today": label = "HOJE"; break;
    case "yesterday": start = subDays(today, 1); end = subDays(today, 1); label = "ONTEM"; break;
    case "week": start = startOfWeek(today, { weekStartsOn: 0 }); label = "ESTA SEMANA"; break;
    case "last_week": { const lw = subWeeks(today, 1); start = startOfWeek(lw, { weekStartsOn: 0 }); end = endOfWeek(lw, { weekStartsOn: 0 }); label = "SEMANA PASSADA"; break; }
    case "7days": start = subDays(today, 7); end = yesterday; label = "ÚLTIMOS 7 DIAS"; break;
    case "14days": start = subDays(today, 14); end = yesterday; label = "ÚLTIMOS 14 DIAS"; break;
    case "28days": start = subDays(today, 28); end = yesterday; label = "ÚLTIMOS 28 DIAS"; break;
    case "30days": start = subDays(today, 30); end = yesterday; label = "ÚLTIMOS 30 DIAS"; break;
    case "month": start = startOfMonth(today); label = "ESTE MÊS"; break;
    case "last_month": { const lm = subMonths(today, 1); start = startOfMonth(lm); end = endOfMonth(lm); label = "MÊS PASSADO"; break; }
  }
  return { start, end, label };
}

type DailyPoint = { date: string; aiMessages: number; humanMessages: number; leads: number; appointments: number; realizadas: number; ganhos: number; faturamento: number; faturamentoProjetado: number; investment: number; handoffs: number; followups: number };
type DailyBucket = Omit<DailyPoint, "date"> & { label: string };

// Agrupa a série diária por dia / semana / mês para o gráfico de tendência
function bucketDaily(daily: DailyPoint[], period: Period): (Omit<DailyPoint, "date"> & { label: string })[] {
  if (period === "dia") return daily.map((d) => ({ ...d, label: format(parseISO(d.date), "dd/MM") }));
  const map = new Map<string, Omit<DailyPoint, "date"> & { label: string }>();
  for (const d of daily) {
    const dt = parseISO(d.date);
    const anchor = period === "sem" ? startOfWeek(dt, { weekStartsOn: 0 }) : startOfMonth(dt);
    const key = format(anchor, period === "sem" ? "yyyy-ww" : "yyyy-MM");
    const label = period === "sem" ? format(anchor, "dd/MM") : format(anchor, "MMM", { locale: ptBR });
    const b = map.get(key) || { label, aiMessages: 0, humanMessages: 0, leads: 0, appointments: 0, realizadas: 0, ganhos: 0, faturamento: 0, faturamentoProjetado: 0, investment: 0, handoffs: 0, followups: 0 };
    b.aiMessages += d.aiMessages; b.humanMessages += d.humanMessages; b.leads += d.leads;
    b.appointments += d.appointments; b.handoffs += d.handoffs; b.followups += d.followups;
    b.realizadas += d.realizadas; b.ganhos += d.ganhos; b.faturamento += d.faturamento; b.faturamentoProjetado += d.faturamentoProjetado; b.investment += d.investment;
    map.set(key, b);
  }
  return Array.from(map.values());
}

// Formata duração em minutos de forma legível (min / h / dias)
function fmtDuration(min: number): string {
  if (!min || min <= 0) return "—";
  if (min < 1) return `${Math.round(min * 60)} s`;
  if (min < 60) return `${min < 10 ? min.toFixed(1) : Math.round(min)} min`;
  const h = min / 60;
  if (h < 48) return `${h.toFixed(1)} h`;
  return `${(h / 24).toFixed(1)} dias`;
}

// Tempo de resposta: distingue "sem respostas no período" (—) de resposta quase
// instantânea (tempo ~0, comum na IA, em que os timestamps quase coincidem).
function fmtResponseTime(min: number, cycles: number): string {
  if (!cycles || cycles <= 0) return "—";
  if (min < 0.1) return "Instantâneo";
  return fmtDuration(min);
}

function pct(num: number, den: number): string {
  if (!den) return "0%";
  return `${((num / den) * 100).toFixed(1)}%`;
}

function fmtBRL(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });
}

// Rótulo amigável da origem do lead (source -> label)
function originLabel(source: string | null): string {
  if (source === "meta_ads") return "Meta";
  if (source === "google_ads") return "Google";
  if (!source) return "Orgânico";
  return "Orgânico";
}

// Badge de status do lead a partir do outcome do ticket mais recente
function leadStatusBadge(outcome: "ganho" | "perdido" | null): { label: string; cls: string } {
  if (outcome === "ganho") return { label: "Ganho", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" };
  if (outcome === "perdido") return { label: "Perdido", cls: "bg-rose-50 text-rose-600 border-rose-200" };
  return { label: "Em aberto", cls: "bg-slate-50 text-slate-500 border-slate-200" };
}

function fmtDateShort(iso: string | null): string {
  if (!iso) return "—";
  try { return format(parseISO(iso), "dd/MM/yy"); } catch { return "—"; }
}

const LEADS_PAGE_SIZE = 20;

const AUTOMATION_LABELS: Record<string, string> = {
  followup: "Follow-ups",
  forms_welcome: "Boas-vindas (Forms)",
  confirm: "Confirmações",
  handoff: "Handoffs",
};

const CHART_METRICS: { label: string; value: ChartMetric; icon: any; type?: string }[] = [
  { label: "Novos Leads", value: "leads", icon: Users },
  { label: "Agendamentos", value: "appointments", icon: CalendarCheck },
  { label: "Consultas Realizadas", value: "realizadas", icon: CheckCircle2 },
  { label: "Vendas (ganhos)", value: "ganhos", icon: Trophy },
  { label: "Conversão Lead → Agend.", value: "convAgend", icon: Percent, type: "percent" },
  { label: "Conversão Lead → Consulta", value: "convConsulta", icon: Percent, type: "percent" },
  { label: "Custo por Agendamento", value: "custoAgend", icon: Target, type: "currency" },
  { label: "CAC", value: "cac", icon: UserCheck, type: "currency" },
  { label: "Faturamento Real", value: "faturamento", icon: Wallet, type: "currency" },
  { label: "Faturamento Projetado", value: "faturamentoProjetado", icon: Wallet, type: "currency" },
  { label: "ROAS Real", value: "roasReal", icon: TrendingUp, type: "ratio" },
  { label: "ROAS Projetado", value: "roasProj", icon: TrendingUp, type: "ratio" },
  { label: "Ticket Médio", value: "ticketMedio", icon: DollarSign, type: "currency" },
  { label: "Msgs IA", value: "aiMessages", icon: Bot },
  { label: "Msgs Humano", value: "humanMessages", icon: UserCheck },
  { label: "Handoffs", value: "handoffs", icon: ArrowRightLeft },
  { label: "Follow-ups", value: "followups", icon: BellRing },
];

// Calcula o valor da métrica selecionada num bucket (dia/semana/mês). Taxas/derivadas usam os
// brutos agregados do bucket (numerador/denominador); o resto lê o campo direto.
function chartValue(d: DailyBucket, metric: ChartMetric, ticket: number): number {
  switch (metric) {
    case "convAgend": return d.leads > 0 ? (d.appointments / d.leads) * 100 : 0;
    case "convConsulta": return d.leads > 0 ? (d.realizadas / d.leads) * 100 : 0;
    case "custoAgend": return d.appointments > 0 ? d.investment / d.appointments : 0;
    case "cac": return d.ganhos > 0 ? d.investment / d.ganhos : 0;
    case "roasReal": return d.investment > 0 ? d.faturamento / d.investment : 0;
    case "roasProj": return d.investment > 0 ? d.faturamentoProjetado / d.investment : 0;
    case "ticketMedio": return ticket;
    default: return (d as any)[metric] ?? 0;
  }
}

// ==========================================
// Geração de relatório em texto para WhatsApp
// ==========================================
type ReportKind = "completo" | "geral" | "ia" | "humano";

// Dinheiro em reais cheios (sem centavos) — mais limpo p/ o cliente
function fmtMoney0(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

// Retorno amigável (ROAS) — "R$ X p/ cada R$ 1"
function fmtRetorno(v: number | null): string {
  return v != null ? `R$ ${v.toFixed(v < 10 ? 1 : 0)} p/ cada R$ 1` : "—";
}

// Bloco "Visão Geral" (escopo "todos") — linguagem simples, com parcial (realizado) e previsto (agendado)
function buildGeneralBlock(d: CommercialData): string {
  const s = d.appointments.byStatus || {};
  const realizadas = (s.realizado || 0) + (s.compareceu || 0);
  const noShow = s.faltou || 0;
  const canceled = s.cancelado || 0;
  const fin = d.finance;
  const interessados = d.newLeads;
  const previstas = d.appointments.total; // consultas marcadas (base do "previsto")
  const pctMarcou = interessados > 0 ? Math.round((previstas / interessados) * 100) : 0;
  const ticket = fin.defaultTicket > 0 ? fin.defaultTicket : null;
  const validAppts = Math.max(previstas - (noShow + canceled), 0);
  const fatPrevisto = ticket != null ? validAppts * ticket : null;
  const realRevenue = fin.revenueScoped ?? fin.revenue;
  const semFatLancado = realRevenue <= 0 && realizadas > 0;
  const retornoReal = fin.investment > 0 && realRevenue > 0 ? realRevenue / fin.investment : null;
  const retornoPrev = fin.investment > 0 && fatPrevisto != null && fatPrevisto > 0 ? fatPrevisto / fin.investment : null;

  const atendimento = [
    "*👥 ATENDIMENTO*",
    `• Interessados: *${interessados}*`,
    `• Consultas marcadas: *${previstas}*${interessados > 0 ? ` (${pctMarcou}%)` : ""}`,
    `• Consultas realizadas: *${realizadas}*`,
    `• Viraram clientes: *${d.outcomes.won}*`,
  ].join("\n");

  const finLines = [
    "*💰 FINANCEIRO*",
    `• Faturamento realizado: *${semFatLancado || realRevenue <= 0 ? "—" : fmtMoney0(realRevenue)}*`,
    `• Faturamento previsto: *${fatPrevisto != null && fatPrevisto > 0 ? fmtMoney0(fatPrevisto) : "—"}*`,
  ];
  if (fin.investment > 0) {
    finLines.push(`• Investido em anúncios: *${fmtMoney0(fin.investment)}*`);
    finLines.push(`• Retorno realizado: *${fmtRetorno(retornoReal)}*`);
    finLines.push(`• Retorno previsto: *${fmtRetorno(retornoPrev)}*`);
  }
  return `${atendimento}\n\n${finLines.join("\n")}`;
}

// Bloco atribuído a um agente (IA ou Humano) — usa d.agent para escopo
function buildAgentBlock(d: CommercialData): string {
  const isIa = d.agent === "ia";
  const s = d.appointments.byStatus || {};
  const realizadas = (s.realizado || 0) + (s.compareceu || 0);
  const fin = d.finance;
  const interessados = isIa ? d.agents.ia.leadsTouched : d.agents.humano.leadsTouched;
  const previstas = d.appointments.total;
  const pctMarcou = interessados > 0 ? Math.round((previstas / interessados) * 100) : 0;
  const ticket = fin.defaultTicket > 0 ? fin.defaultTicket : null;
  const noShow = s.faltou || 0;
  const canceled = s.cancelado || 0;
  const validAppts = Math.max(previstas - (noShow + canceled), 0);
  const fatPrevisto = ticket != null ? validAppts * ticket : null;
  const lines = [
    isIa ? "*🤖 INTELIGÊNCIA ARTIFICIAL*" : "*🧑‍💼 EQUIPE (ATENDIMENTO HUMANO)*",
    `• Atendeu: *${interessados}* interessados`,
    `• Consultas marcadas: *${previstas}*${interessados > 0 ? ` (${pctMarcou}%)` : ""}`,
    `• Consultas realizadas: *${realizadas}*`,
  ];
  if (isIa) {
    lines.push(`• Resolveu sozinha (sem humano): *${d.agents.ia.autonomous}*`);
    lines.push(`• Passou p/ humano: *${d.agents.ia.handoffs}*`);
  } else {
    lines.push(`• Assumiu da IA: *${d.agents.humano.handoffsReceived}* conversas`);
  }
  if (fatPrevisto != null && fatPrevisto > 0) lines.push(`• Faturamento previsto: *${fmtMoney0(fatPrevisto)}*`);
  return lines.join("\n");
}

// Monta o texto completo: cabeçalho (clínica + datas de entrada e conversão) + blocos + legenda
function buildReportText(
  meta: { clinicName: string; entryPeriod: string; convPeriod: string; scopeLine: string | null },
  blocks: string[],
): string {
  const header = [
    "📊 *RELATÓRIO COMERCIAL*",
    meta.clinicName ? `🏥 ${meta.clinicName}` : null,
    `📥 Entrada do lead: ${meta.entryPeriod}`,
    `🎯 Conversão: ${meta.convPeriod}`,
    meta.scopeLine ? `🔎 ${meta.scopeLine}` : null,
  ].filter(Boolean).join("\n");
  const body = [header, ...blocks].join("\n\n");
  const legenda = "_Realizado = já aconteceu · Previsto = projeção do que já está agendado_";
  return `${body}\n\n${legenda}\n_Gerado em ${format(new Date(), "dd/MM/yyyy 'às' HH:mm")}_`;
}

// ==========================================
// Componente principal
// ==========================================
export function ComercialDashboard({ onOpenLead }: { onOpenLead?: (leadId: string) => void } = {}) {
  const { profile, activeClinicId } = useAuth();
  const [data, setData] = useState<CommercialData | null>(null);
  const [clinicFeatures, setClinicFeatures] = useState<{ feature_followup?: boolean; feature_ia?: boolean } | null>(null);
  const [clinicName, setClinicName] = useState("");
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<Period>("dia");
  // Estado inicial padrão do Resultados: ESTE MÊS nos 2 calendários (Entrada e
  // Conversão) e "Todos" em agente/origem/canal (sempre abre nesse baseline).
  const initMonth = computeRange("month");
  // Conversão = DATA DA CONSULTA (appointments.date). Alimenta p_appt no backend.
  const [convRange, setConvRange] = useState<{ start: Date; end: Date }>(() => ({ start: initMonth.start, end: initMonth.end }));
  const [convLabel, setConvLabel] = useState(initMonth.label);
  const [isConvOpen, setIsConvOpen] = useState(false);
  const [convCal1, setConvCal1] = useState<Date>(() => initMonth.start);
  const [convCal2, setConvCal2] = useState<Date>(() => addMonths(initMonth.start, 1));
  // Entrada (coorte) — também começa em ESTE MÊS
  const [entryRange, setEntryRange] = useState<{ start: Date; end: Date } | null>(() => ({ start: initMonth.start, end: initMonth.end }));
  const [entryLabel, setEntryLabel] = useState(initMonth.label);
  const [isEntryOpen, setIsEntryOpen] = useState(false);
  const [entryCal1, setEntryCal1] = useState<Date>(() => initMonth.start);
  const [entryCal2, setEntryCal2] = useState<Date>(() => addMonths(initMonth.start, 1));
  // Agenda = DATA DE CRIAÇÃO do agendamento (appointments.created_at). Alimenta p_conv.
  // Começa em ESTE MÊS; aceita "Todos" (null).
  const [apptRange, setApptRange] = useState<{ start: Date; end: Date } | null>(() => ({ start: initMonth.start, end: initMonth.end }));
  const [apptLabel, setApptLabel] = useState(initMonth.label);
  const [isApptOpen, setIsApptOpen] = useState(false);
  const [apptCal1, setApptCal1] = useState<Date>(() => initMonth.start);
  const [apptCal2, setApptCal2] = useState<Date>(() => addMonths(initMonth.start, 1));
  const [agent, setAgent] = useState<AgentFilter>("todos");
  // Origem e Canal são multi-seleção: array vazio = "Todos". Agente segue único.
  const [origin, setOrigin] = useState<OriginFilter[]>([]);
  const [channel, setChannel] = useState<ChannelFilter[]>([]);
  const [chartMetric, setChartMetric] = useState<ChartMetric>("humanMessages");
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [visibleMetrics, setVisibleMetrics] = useState<string[]>(() => {
    const saved = localStorage.getItem("comercialVisibleMetrics_v3");
    if (!saved) return DEFAULT_METRIC_IDS;
    const parsed = JSON.parse(saved) as string[];
    // Métricas NOVAS (que o usuário nunca viu — nem na ordem salva) entram visíveis por padrão.
    const known = JSON.parse(localStorage.getItem("comercialMetricsOrder_v3") || "[]") as string[];
    const brandNew = DEFAULT_METRIC_IDS.filter((id) => !parsed.includes(id) && !known.includes(id));
    return [...parsed, ...brandNew];
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
  const setApptById = (id: string) => {
    if (id === "todos") { setApptRange(null); setApptLabel("TODOS"); setIsApptOpen(false); return; }
    const r = computeRange(id);
    setApptRange({ start: r.start, end: r.end }); setApptLabel(r.label);
    setApptCal1(r.start); setApptCal2(addMonths(r.start, 1)); setIsApptOpen(false);
  };
  const onApptSelect = (r: { from?: Date; to?: Date } | undefined) => {
    if (!r) return;
    setApptRange((d) => ({ start: r.from ?? d?.start ?? r.to!, end: r.to ?? d?.end ?? r.from! }));
    setApptLabel("PERSONALIZADO");
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
        // Mapeamento calendário -> coluna no backend:
        //   Agenda (apptRange)    -> p_conv -> appointments.created_at (geração: Geradas/CAC)
        //   Conversão (convRange) -> p_appt -> appointments.date       (realização: realizadas/faturamento)
        p_conv_from: apptRange ? format(apptRange.start, "yyyy-MM-dd") : null,
        p_conv_to: apptRange ? format(apptRange.end, "yyyy-MM-dd") : null,
        p_agent: agent,
        p_origin: origin.length ? origin.join(",") : "todos",
        p_channel: channel.length ? channel.join(",") : "todos",
        p_appt_from: format(convRange.start, "yyyy-MM-dd"),
        p_appt_to: format(convRange.end, "yyyy-MM-dd"),
      });
      if (error) throw error;
      setData(res as CommercialData);
    } catch (err) {
      console.error("ComercialDashboard fetch error:", err);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [activeClinicId, profile?.clinic_id, convRange, entryRange, apptRange, agent, origin, channel]);

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

  // Features da clínica (esconder "Automações do Sistema" quando não há follow-up nem IA)
  useEffect(() => {
    const clinicId = activeClinicId || profile?.clinic_id;
    if (!clinicId) { setClinicFeatures(null); setClinicName(""); return; }
    let cancelled = false;
    supabase.from("clinics").select("features, name").eq("id", clinicId).maybeSingle()
      .then(({ data: c }) => {
        if (cancelled) return;
        setClinicFeatures((c?.features as { feature_followup?: boolean; feature_ia?: boolean } | null) ?? null);
        setClinicName((c?.name as string) ?? "");
      });
    return () => { cancelled = true; };
  }, [activeClinicId, profile?.clinic_id]);

  // ===== Lista de leads do filtro (drill-down) =====
  const [leadsList, setLeadsList] = useState<LeadRow[]>([]);
  const [leadsTotal, setLeadsTotal] = useState(0);
  const [leadsPage, setLeadsPage] = useState(0);
  const [leadsLoading, setLeadsLoading] = useState(true);

  // Volta para a 1ª página sempre que um filtro muda
  useEffect(() => { setLeadsPage(0); }, [convRange, entryRange, agent, origin, channel]);

  const fetchLeads = useCallback(async () => {
    const clinicId = activeClinicId || profile?.clinic_id;
    if (!clinicId) return;
    setLeadsLoading(true);
    try {
      const { data: res, error } = await supabase.rpc("get_commercial_leads", {
        p_clinic_id: clinicId,
        p_entry_from: entryRange ? format(entryRange.start, "yyyy-MM-dd") : null,
        p_entry_to: entryRange ? format(entryRange.end, "yyyy-MM-dd") : null,
        p_conv_from: format(convRange.start, "yyyy-MM-dd"),
        p_conv_to: format(convRange.end, "yyyy-MM-dd"),
        p_agent: agent,
        p_origin: origin.length ? origin.join(",") : "todos",
        p_channel: channel.length ? channel.join(",") : "todos",
        p_limit: LEADS_PAGE_SIZE,
        p_offset: leadsPage * LEADS_PAGE_SIZE,
      });
      if (error) throw error;
      const r = res as { total: number; rows: LeadRow[] } | null;
      setLeadsList(r?.rows || []);
      setLeadsTotal(r?.total || 0);
    } catch (err) {
      console.error("ComercialDashboard leads fetch error:", err);
    } finally {
      setLeadsLoading(false);
    }
  }, [activeClinicId, profile?.clinic_id, convRange, entryRange, agent, origin, channel, leadsPage]);

  useEffect(() => { fetchLeads(); }, [fetchLeads]);

  // Filtros não são persistidos: o Resultados sempre inicia em "Todos".
  const setAgentPersist = (v: AgentFilter) => setAgent(v);
  const setOriginPersist = (v: OriginFilter[]) => setOrigin(v);
  const setChannelPersist = (v: ChannelFilter[]) => setChannel(v);

  // ===== Relatório em texto (WhatsApp) =====
  const [reportLoading, setReportLoading] = useState<ReportKind | null>(null);
  const [reportText, setReportText] = useState("");
  const [reportKind, setReportKind] = useState<ReportKind>("completo");
  const [showReport, setShowReport] = useState(false);
  const [reportCopied, setReportCopied] = useState(false);

  // Busca os dados de um escopo de agente respeitando os filtros de data/origem atuais
  const fetchScoped = useCallback(async (agentScope: AgentFilter): Promise<CommercialData | null> => {
    const clinicId = activeClinicId || profile?.clinic_id;
    if (!clinicId) return null;
    const { data: res, error } = await supabase.rpc("get_commercial_dashboard", {
      p_clinic_id: clinicId,
      p_entry_from: entryRange ? format(entryRange.start, "yyyy-MM-dd") : null,
      p_entry_to: entryRange ? format(entryRange.end, "yyyy-MM-dd") : null,
      // Agenda (apptRange)->p_conv (created_at); Conversão (convRange)->p_appt (a.date)
      p_conv_from: apptRange ? format(apptRange.start, "yyyy-MM-dd") : null,
      p_conv_to: apptRange ? format(apptRange.end, "yyyy-MM-dd") : null,
      p_agent: agentScope,
      // O relatório respeita SOMENTE o filtro de data + o tipo escolhido (Geral/IA/Humano).
      // Ignora os filtros de origem/canal/agente da tela para não distorcer o que foi pedido.
      p_origin: "todos",
      p_channel: "todos",
      p_appt_from: format(convRange.start, "yyyy-MM-dd"),
      p_appt_to: format(convRange.end, "yyyy-MM-dd"),
    });
    if (error) throw error;
    return res as CommercialData;
  }, [activeClinicId, profile?.clinic_id, convRange, entryRange, apptRange]);

  const generateReport = useCallback(async (kind: ReportKind) => {
    setReportLoading(kind);
    setReportKind(kind);
    try {
      const fmtRange = (r: { start: Date; end: Date }) =>
        `${format(r.start, "dd/MM/yyyy")} a ${format(r.end, "dd/MM/yyyy")}`;
      const meta = {
        clinicName,
        entryPeriod: entryRange ? fmtRange(entryRange) : "Todos os leads",
        convPeriod: fmtRange(convRange),
        scopeLine: null,
      };
      let text = "";
      if (kind === "geral") {
        const d = await fetchScoped("todos");
        if (d) text = buildReportText(meta, [buildGeneralBlock(d)]);
      } else if (kind === "ia") {
        const d = await fetchScoped("ia");
        if (d) text = buildReportText(meta, [buildAgentBlock(d)]);
      } else if (kind === "humano") {
        const d = await fetchScoped("humano");
        if (d) text = buildReportText(meta, [buildAgentBlock(d)]);
      } else {
        const [todos, ia, humano] = await Promise.all([fetchScoped("todos"), fetchScoped("ia"), fetchScoped("humano")]);
        const blocks: string[] = [];
        if (todos) blocks.push(buildGeneralBlock(todos));
        // Inclui IA só se a clínica tem IA e ela atuou no período ("humano ou IA se tiver")
        const iaActed = !!ia && (ia.agents.ia.messagesOut > 0 || ia.agents.ia.leadsTouched > 0 || ia.agents.ia.appointments > 0);
        if (iaActed && ia) blocks.push(buildAgentBlock(ia));
        if (humano) blocks.push(buildAgentBlock(humano));
        text = buildReportText(meta, blocks);
      }
      setReportText(text);
      setReportCopied(false);
      setShowReport(true);
    } catch (err) {
      console.error("ComercialDashboard report error:", err);
      alert("Não foi possível gerar o relatório. Tente novamente.");
    } finally {
      setReportLoading(null);
    }
  }, [clinicName, convRange, entryRange, fetchScoped]);

  const copyReport = async () => {
    try {
      await navigator.clipboard.writeText(reportText);
      setReportCopied(true);
      setTimeout(() => setReportCopied(false), 2000);
    } catch {
      alert("Não foi possível copiar. Selecione o texto manualmente.");
    }
  };

  const downloadReport = () => {
    const blob = new Blob([reportText], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `relatorio-comercial-${reportKind}-${format(new Date(), "yyyy-MM-dd")}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Spinner cheio só no 1º carregamento (sem dados ainda). Em mudanças de filtro,
  // mantém os dados atuais visíveis durante o refetch (sem "piscar" a tela inteira).
  if (!data) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 text-teal-600 animate-spin" /></div>;
  }

  const { agents, appointments, sla, outcomes, funnel } = data;
  const status = appointments.byStatus || {};
  const attended = (status.realizado || 0) + (status.compareceu || 0);
  const noShow = status.faltou || 0;
  const noShowBase = attended + noShow;
  // Consultas a realizar = agendamentos que ainda não aconteceram (pendentes/confirmados), por byStatus.
  const toRealize = (status.pendente || 0) + (status.confirmado || 0);
  const iaActed = agents.ia.messagesOut > 0 || agents.ia.leadsTouched > 0 || agents.ia.appointments > 0;
  const automations = agents.sistema.automations || {};
  const automationsTotal = Object.values(automations).reduce((a, b) => a + b, 0);
  // Handoffs IA -> humano no período (não vem de automation_logs; é leads.handoff_triggered_at).
  const handoffsCount = agents.ia.handoffs || 0;
  // Só mostra "Automações do Sistema" se a clínica tem follow-up ou IA (default: ligado).
  const showAutomations = clinicFeatures?.feature_followup !== false || clinicFeatures?.feature_ia !== false;

  // ===== KPI strip (headline) — números que importam ao cliente (estilo Marketing) =====
  // Escopados pelo filtro de agente: conversão, consultas, preço/consulta, tempo de resposta.
  // "geral" (não atribuível a agente): faturamento, ticket médio, ROAS, ciclo de vendas.
  const fin = data.finance;
  const agentNoun = agent === "ia" ? "da IA" : agent === "humano" ? "do humano" : "no total";
  // Denominador das taxas acompanha o filtro de agente: leads atendidos pela IA/humano
  // (= leadsTouched) ou a coorte inteira quando "Todos". Mantém coerência com o card "Leads".
  const leadsValue = agent === "ia" ? agents.ia.leadsTouched : agent === "humano" ? agents.humano.leadsTouched : data.newLeads;
  // Geração = agendamentos CRIADOS (eixo Conversão). As taxas/custos de "agendamento"
  // usam isto; "total" (appointments.total) agora é o total na AGENDA (eixo a.date).
  const apptGenerated = (appointments as any).generated ?? 0;
  const convAgendRate = leadsValue > 0 ? (apptGenerated / leadsValue) * 100 : 0;          // agendamentos gerados ÷ leads
  const convConsultaRate = leadsValue > 0 ? (attended / leadsValue) * 100 : 0;          // parcial: realizadas ÷ leads
  const convConsultaPrevistaRate = leadsValue > 0 ? (apptGenerated / leadsValue) * 100 : 0; // previsto: gerados ÷ leads
  // Custo por agendamento: parcial = invest ÷ realizadas; previsto = invest ÷ (marcadas + realizadas),
  // ou seja os agendamentos que seguem de pé (exclui faltas e cancelados).
  const apptStanding = attended + toRealize; // realizadas + marcadas (pendente/confirmado)
  const costPerAppt = apptStanding > 0 && fin.investment > 0 ? fin.investment / apptStanding : null;             // previsto: invest ÷ (marcadas + realizadas)
  const costPerRealizada = attended > 0 && fin.investment > 0 ? fin.investment / attended : null;                // parcial: invest ÷ realizadas
  // CAC = investimento ÷ clientes. Parcial: ÷ vendas reais (ganhos). Previsto: ÷ agendamentos gerados.
  const cac = outcomes.won > 0 && fin.investment > 0 ? fin.investment / outcomes.won : null;
  const cacPrevisto = apptGenerated > 0 && fin.investment > 0 ? fin.investment / apptGenerated : null;
  // Ticket médio = espelho do valor configurado em Dados da Clínica (ai_config.default_ticket_value).
  const configuredTicket = fin.defaultTicket > 0 ? fin.defaultTicket : null;
  // ===== Perdas (seção Comparecimento & Perdas) =====
  const canceled = status.cancelado || 0;
  const cancelRate = appointments.total > 0 ? (canceled / appointments.total) * 100 : 0;
  // Perda projetada = (faltas + cancelamentos) × ticket configurado.
  const lostAppts = noShow + canceled;
  const projectedLoss = configuredTicket != null ? lostAppts * configuredTicket : null;
  // Faturamento projetado: valora só os agendamentos que seguem de pé (exclui faltas e cancelamentos).
  const validAppts = Math.max(appointments.total - lostAppts, 0);
  const projectedRevenue = configuredTicket != null ? validAppts * configuredTicket : null;
  // Faturamento Real do recorte: receita das consultas realizadas escopada por origem/agente (revenueScoped);
  // cai no revenue não escopado só se a RPC não devolver o campo (versão antiga da função).
  const realRevenue = fin.revenueScoped ?? fin.revenue;
  // Sem lançamento no financeiro: há consultas realizadas mas nenhuma receita registrada (clínica não
  // lança pagamentos). Mostra "—" em vez de "R$ 0,00" para não parecer que faturou zero.
  const noRevenueRecorded = realRevenue <= 0 && attended > 0;
  // ROAS real e projetado usam o investimento ESCOPADO (fin.investment) para serem coerentes por canal.
  const roas = fin.investment > 0 ? realRevenue / fin.investment : null;
  // ROAS projetado = faturamento projetado (agend. × ticket) ÷ investimento.
  const projectedRoas = fin.investment > 0 && projectedRevenue != null ? projectedRevenue / fin.investment : null;
  const leadsDenomLabel = agent === "todos" ? "leads" : "leads atendidos";

  type Kpi = { id: string; title: string; value: React.ReactNode; icon: any; color: string; bg: string; sub?: string; valueLabel?: string; value2?: React.ReactNode; value2Label?: string; agentScoped: boolean; originScoped: boolean };
  const allKpis: Kpi[] = [
    { id: "leads", title: "Leads", value: leadsValue, icon: Users, color: "text-cyan-600", bg: "bg-cyan-50", sub: agent === "todos" ? "entraram no período" : agent === "ia" ? "maioria das respostas pela IA" : "maioria das respostas por humano", agentScoped: true, originScoped: true },
    { id: "nao_atendidos", title: "Não atendidos", value: data.leadsNotAttended ?? 0, icon: XCircle, color: "text-rose-600", bg: "bg-rose-50", sub: "entraram e ninguém respondeu", agentScoped: false, originScoped: true },
    { id: "conversao_agend", title: "Conversão Lead → Agendamento", value: `${convAgendRate.toFixed(1)}%`, icon: Percent, color: "text-emerald-600", bg: "bg-emerald-50", sub: `${apptGenerated} agend. gerados ${agentNoun} ÷ ${leadsValue} ${leadsDenomLabel}`, agentScoped: true, originScoped: true },
    { id: "conversao_consulta", title: "Conversão Lead → Consulta", value: `${convConsultaRate.toFixed(1)}%`, valueLabel: "parcial", value2: `${convConsultaPrevistaRate.toFixed(1)}%`, value2Label: "previsto", icon: CheckCircle2, color: "text-green-600", bg: "bg-green-50", agentScoped: true, originScoped: true },
    { id: "consultas", title: "Consultas", value: attended, valueLabel: "realizadas", value2: toRealize, value2Label: "marcadas", icon: CheckCircle2, color: "text-emerald-600", bg: "bg-emerald-50", sub: "no período (Conversão)", agentScoped: true, originScoped: true },
    { id: "consultas_geradas", title: "Consultas Geradas", value: apptGenerated, icon: CalendarCheck, color: "text-teal-600", bg: "bg-teal-50", sub: "criadas no período (Agenda)", agentScoped: true, originScoped: true },
    { id: "faturamento", title: "Faturamento", value: noRevenueRecorded ? "—" : fmtBRL(realRevenue), valueLabel: "parcial", value2: projectedRevenue != null ? fmtBRL(projectedRevenue) : "—", value2Label: "previsto", icon: Wallet, color: "text-emerald-700", bg: "bg-emerald-50", agentScoped: true, originScoped: true },
    { id: "custo_agendamento", title: "Custo por Consulta", value: costPerRealizada != null ? fmtBRL(costPerRealizada) : "—", valueLabel: "parcial", value2: costPerAppt != null ? fmtBRL(costPerAppt) : "—", value2Label: "previsto", icon: Target, color: "text-rose-600", bg: "bg-rose-50", agentScoped: true, originScoped: true },
    { id: "cac", title: "CAC", value: cac != null ? fmtBRL(cac) : "—", valueLabel: "parcial", value2: cacPrevisto != null ? fmtBRL(cacPrevisto) : "—", value2Label: "previsto", icon: UserCheck, color: "text-rose-600", bg: "bg-rose-50", agentScoped: false, originScoped: true },
    { id: "ticket_config", title: "Ticket Médio", value: configuredTicket != null ? fmtBRL(configuredTicket) : "—", icon: DollarSign, color: "text-blue-600", bg: "bg-blue-50", sub: "definido em Dados da Clínica", agentScoped: false, originScoped: false },
    { id: "roas", title: "ROAS", value: noRevenueRecorded ? "—" : (roas != null ? `${roas.toFixed(1)}x` : "—"), valueLabel: "parcial", value2: projectedRoas != null ? `${projectedRoas.toFixed(1)}x` : "—", value2Label: "previsto", icon: TrendingUp, color: "text-violet-600", bg: "bg-violet-50", agentScoped: false, originScoped: true },
  ];
  const kpiById = Object.fromEntries(allKpis.map((k) => [k.id, k]));
  const headlineKpis = metricsOrder.filter((id) => visibleMetrics.includes(id)).map((id) => kpiById[id]).filter(Boolean) as Kpi[];

  // ===== Seções =====
  // Atividade de Atendimento — dirigida pelo filtro global de agente
  const agentTiles =
    agent === "ia"
      ? [
          { icon: MessageSquare, label: "Mensagens respondidas", value: agents.ia.messagesOut, color: "text-teal-600", bg: "bg-teal-50" },
          { icon: Users, label: "Leads atendidos", value: agents.ia.leadsTouched, color: "text-teal-600", bg: "bg-teal-50" },
          { icon: CalendarCheck, label: "Agendamentos", value: agents.ia.appointments, color: "text-emerald-600", bg: "bg-emerald-50" },
          { icon: CheckCircle2, label: "Resolvidos sem humano", value: agents.ia.autonomous, color: "text-blue-600", bg: "bg-blue-50" },
          { icon: ArrowRightLeft, label: "Passados p/ humano", value: agents.ia.handoffs, color: "text-orange-600", bg: "bg-orange-50" },
        ]
      : agent === "humano"
      ? [
          { icon: MessageSquare, label: "Mensagens respondidas", value: agents.humano.messagesOut, color: "text-blue-600", bg: "bg-blue-50" },
          { icon: CalendarCheck, label: "Agendamentos manuais", value: agents.humano.appointments, color: "text-emerald-600", bg: "bg-emerald-50" },
          { icon: ArrowRightLeft, label: "Conversas assumidas", value: agents.humano.handoffsReceived, color: "text-orange-600", bg: "bg-orange-50" },
          { icon: MessageSquare, label: "Mensagens recebidas (leads)", value: data.messages.inbound, color: "text-slate-500", bg: "bg-slate-100" },
        ]
      : [
          { icon: MessageSquare, label: "Mensagens recebidas (leads)", value: data.messages.inbound, color: "text-slate-500", bg: "bg-slate-100" },
          { icon: Bot, label: "Mensagens enviadas pela IA", value: agents.ia.messagesOut, color: "text-teal-600", bg: "bg-teal-50" },
          { icon: UserCheck, label: "Mensagens enviadas pelo humano", value: agents.humano.messagesOut, color: "text-blue-600", bg: "bg-blue-50" },
          { icon: Timer, label: "Ciclo médio de vendas", value: fin.salesCycleDays > 0 ? `${fin.salesCycleDays} dias` : "—", color: "text-indigo-600", bg: "bg-indigo-50" },
          { icon: ArrowRightLeft, label: "Handoffs IA → humano", value: agents.ia.handoffs, color: "text-orange-600", bg: "bg-orange-50" },
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
        {automationsTotal > 0 || handoffsCount > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {Object.entries(automations).sort((a, b) => b[1] - a[1]).map(([type, count]) => (
              <MetricTile key={type} icon={Zap} label={AUTOMATION_LABELS[type] || type} value={count} color="text-violet-600" bg="bg-violet-50" />
            ))}
            <MetricTile key="handoff" icon={ArrowRightLeft} label="Handoffs IA → humano" value={handoffsCount} color="text-orange-600" bg="bg-orange-50" />
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
        <CardTitle className="text-sm font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2"><Target className="w-4 h-4 text-cyan-600" />Estágio Atual dos Leads</CardTitle>
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
            <p className="text-2xl font-bold text-emerald-700">{fmtResponseTime(sla.firstResponseMin, sla.responseCycles)}</p>
            <p className="text-[10px] font-bold text-emerald-500/80 uppercase tracking-wider mt-1">Tempo médio da 1ª resposta</p>
          </div>
          <div className="flex flex-col items-center justify-center p-4 rounded-xl bg-slate-50 border border-slate-100 text-center">
            <Clock className="w-5 h-5 text-slate-400 mb-1" />
            <p className="text-2xl font-bold text-slate-700">{fmtResponseTime(sla.responseMin, sla.responseCycles)}</p>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-1">Tempo médio de respostas</p>
          </div>
          <div className={`flex flex-col items-center justify-center p-4 rounded-xl border text-center ${sla.breaches > 0 ? "bg-rose-50/60 border-rose-200" : "bg-emerald-50/60 border-emerald-200"}`}>
            <AlertTriangle className={`w-5 h-5 mb-1 ${sla.breaches > 0 ? "text-rose-500" : "text-emerald-500"}`} />
            <p className={`text-2xl font-bold ${sla.breaches > 0 ? "text-rose-700" : "text-emerald-700"}`}>{sla.breaches}</p>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-1">Estouros de SLA</p>
          </div>
          <div className={`flex flex-col items-center justify-center p-4 rounded-xl border text-center ${sla.overBreachMin > 0 ? "bg-amber-50/60 border-amber-200" : "bg-emerald-50/60 border-emerald-200"}`}>
            <Timer className={`w-5 h-5 mb-1 ${sla.overBreachMin > 0 ? "text-amber-500" : "text-emerald-500"}`} />
            <p className={`text-2xl font-bold ${sla.overBreachMin > 0 ? "text-amber-700" : "text-emerald-700"}`}>{sla.breaches > 0 ? fmtDuration(sla.overBreachMin) : "—"}</p>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-1">Tempo médio de estouro de SLA</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );

  const sectionAppointments = (
    <Card key="appointments" className="border border-slate-200 shadow-sm overflow-hidden">
      <CardHeader className="bg-slate-50 border-b border-slate-100 py-3">
        <CardTitle className="text-sm font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-rose-500" />Comparecimento & Perdas</CardTitle>
      </CardHeader>
      <CardContent className="p-5">
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          {/* No-show */}
          <div className={`flex flex-col items-center justify-center p-4 rounded-xl border text-center ${noShowBase > 0 && noShow / noShowBase > 0.15 ? "bg-rose-50/60 border-rose-200" : "bg-emerald-50/60 border-emerald-200"}`}>
            <Percent className={`w-5 h-5 mb-1 ${noShowBase > 0 && noShow / noShowBase > 0.15 ? "text-rose-500" : "text-emerald-500"}`} />
            <p className={`text-2xl font-bold ${noShowBase > 0 && noShow / noShowBase > 0.15 ? "text-rose-700" : "text-emerald-700"}`}>{noShowBase > 0 ? pct(noShow, noShowBase) : "—"}</p>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-1">Taxa de no-show</p>
          </div>
          {/* Faltaram */}
          <div className="flex flex-col items-center justify-center p-4 rounded-xl bg-rose-50/60 border border-rose-100 text-center">
            <XCircle className="w-5 h-5 text-rose-500 mb-1" />
            <p className="text-2xl font-bold text-rose-700">{noShow}</p>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-1">Faltaram</p>
          </div>
          {/* Cancelados */}
          <div className="flex flex-col items-center justify-center p-4 rounded-xl bg-slate-50 border border-slate-100 text-center">
            <XCircle className="w-5 h-5 text-slate-400 mb-1" />
            <p className="text-2xl font-bold text-slate-700">{canceled}</p>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-1">Cancelados</p>
          </div>
          {/* Taxa de cancelamento */}
          <div className="flex flex-col items-center justify-center p-4 rounded-xl bg-amber-50/60 border border-amber-100 text-center">
            <Percent className="w-5 h-5 text-amber-500 mb-1" />
            <p className="text-2xl font-bold text-amber-700">{appointments.total > 0 ? `${cancelRate.toFixed(1)}%` : "—"}</p>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-1">Taxa de cancelamento</p>
          </div>
          {/* Perda projetada */}
          <div className="flex flex-col items-center justify-center p-4 rounded-xl bg-rose-50/60 border border-rose-200 text-center">
            <Wallet className="w-5 h-5 text-rose-500 mb-1" />
            <p className="text-2xl font-bold text-rose-700">{projectedLoss != null ? fmtBRL(projectedLoss) : "—"}</p>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-1">Perda projetada</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );

  const chartSeries = bucketDaily(data.daily, period);
  const sectionTrend = (
    <Card key="trend" className="border border-slate-200 shadow-sm flex flex-col">
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
              <motion.div initial={{ opacity: 0, y: 10, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10, scale: 0.95 }} transition={{ duration: 0.15 }} className="absolute right-0 top-full mt-2 w-56 bg-white border border-slate-100 rounded-xl shadow-xl z-50 py-1.5 max-h-80 overflow-y-auto">
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
      <CardContent className="p-6 pt-7">
        <TrendBarChart series={chartSeries.map((d) => ({ label: d.label, value: chartValue(d, chartMetric, fin.defaultTicket) }))} height={176} format={fmtByType(CHART_METRICS.find((m) => m.value === chartMetric)?.type)} />
      </CardContent>
    </Card>
  );

  // ===== Seção: Leads do filtro (drill-down da população do KPI "Leads") =====
  const leadsTotalPages = Math.max(1, Math.ceil(leadsTotal / LEADS_PAGE_SIZE));
  const leadsScopeLabel = agent === "ia" ? "atendidos pela IA" : agent === "humano" ? "atendidos por humano" : "na coorte de entrada";
  const sectionLeads = (
    <Card key="leads" className="border border-slate-200 shadow-sm overflow-hidden">
      <CardHeader className="bg-slate-50 border-b border-slate-100 py-3 flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2">
          <Users className="w-4 h-4 text-cyan-600" />
          Leads do filtro
        </CardTitle>
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
          {leadsTotal} {leadsTotal === 1 ? "lead" : "leads"} · {leadsScopeLabel}
        </span>
      </CardHeader>
      <CardContent className="p-0">
        {leadsLoading ? (
          <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 text-teal-600 animate-spin" /></div>
        ) : leadsList.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2 text-slate-400 text-center">
            <Inbox className="w-9 h-9 text-slate-200" />
            <p className="text-sm font-semibold text-slate-500">Nenhum lead para os filtros atuais</p>
            <p className="text-xs">Ajuste Entrada, Conversão, Agente ou Origem.</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/50 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    <th className="text-left font-bold px-4 py-2.5">Lead</th>
                    <th className="text-left font-bold px-3 py-2.5">Origem</th>
                    <th className="text-left font-bold px-3 py-2.5">Etapa</th>
                    <th className="text-left font-bold px-3 py-2.5">Status</th>
                    <th className="text-left font-bold px-3 py-2.5">Entrada</th>
                    <th className="text-left font-bold px-3 py-2.5">Última msg</th>
                    <th className="text-right font-bold px-3 py-2.5">Valor</th>
                    {onOpenLead && <th className="px-3 py-2.5 w-8" />}
                  </tr>
                </thead>
                <tbody>
                  {leadsList.map((lead) => {
                    const badge = leadStatusBadge(lead.outcome);
                    const clickable = !!onOpenLead;
                    return (
                      <tr
                        key={lead.id}
                        onClick={clickable ? () => onOpenLead!(lead.id) : undefined}
                        className={cn(
                          "border-b border-slate-50 transition-colors",
                          clickable ? "cursor-pointer hover:bg-teal-50/40" : ""
                        )}
                      >
                        <td className="px-4 py-2.5">
                          <p className="font-semibold text-slate-700 truncate max-w-[180px]">{lead.name || "Sem nome"}</p>
                          {lead.phone && (
                            <span className="flex items-center gap-1 text-[11px] text-slate-400 font-medium">
                              <Phone className="w-3 h-3" />{lead.phone}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-slate-500">{originLabel(lead.source)}</td>
                        <td className="px-3 py-2.5">
                          {lead.stageName ? (
                            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600">
                              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: lead.stageColor || "#94a3b8" }} />
                              {lead.stageName}
                            </span>
                          ) : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-3 py-2.5">
                          <span className={cn("inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border", badge.cls)}>{badge.label}</span>
                        </td>
                        <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">{fmtDateShort(lead.createdAt)}</td>
                        <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">{fmtDateShort(lead.lastMessageAt)}</td>
                        <td className="px-3 py-2.5 text-right font-semibold text-slate-700 whitespace-nowrap">
                          {lead.estimatedValue ? fmtBRL(Number(lead.estimatedValue)) : "—"}
                        </td>
                        {onOpenLead && (
                          <td className="px-3 py-2.5 text-slate-300"><ExternalLink className="w-3.5 h-3.5" /></td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {leadsTotal > LEADS_PAGE_SIZE && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100">
                <span className="text-[11px] font-medium text-slate-400">
                  {leadsPage * LEADS_PAGE_SIZE + 1}–{Math.min((leadsPage + 1) * LEADS_PAGE_SIZE, leadsTotal)} de {leadsTotal}
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setLeadsPage((p) => Math.max(0, p - 1))}
                    disabled={leadsPage === 0}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold text-slate-600 border border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />Anterior
                  </button>
                  <span className="text-[11px] font-bold text-slate-500 px-1">{leadsPage + 1}/{leadsTotalPages}</span>
                  <button
                    onClick={() => setLeadsPage((p) => Math.min(leadsTotalPages - 1, p + 1))}
                    disabled={leadsPage >= leadsTotalPages - 1}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold text-slate-600 border border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                  >
                    Próximo<ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );

  // Ordem das seções (visão única)
  const orderedSections = [sectionAgents, sectionSla, sectionAppointments, ...(showAutomations ? [sectionSistema] : []), sectionTrend, sectionFunnel, sectionLeads];

  return (
    <div className="space-y-6 h-full overflow-y-auto pr-1 custom-scrollbar pb-8">
      {/* Cabeçalho fixo: período + público + filtros globais */}
      <div className="sticky top-0 z-20 -mx-1 px-1 pt-1 pb-3 space-y-3 bg-slate-50/95 backdrop-blur-sm border-b border-slate-100">
      {/* Controles: granularidade do gráfico + datas (Entrada/Conversão), alinhados à direita */}
      <div className="flex items-center justify-end gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Granularidade do gráfico de tendências */}
          <GranularityToggle period={period} onChange={setPeriod} className="border border-slate-200" />
          {/* Entrada (coorte de leads) */}
          <DatePill
            label="Entrada" valueLabel={entryLabel}
            rangeText={entryRange ? `${format(entryRange.start, "dd/MM")} - ${format(entryRange.end, "dd/MM")}` : "todos os leads"}
            open={isEntryOpen} setOpen={setIsEntryOpen}
            presets={[{ id: "todos", label: "Todos" }, ...RANGE_PRESETS]} activeLabel={entryLabel} onPreset={setEntryById}
            selected={entryRange ? { from: entryRange.start, to: entryRange.end } : undefined} onSelect={onEntrySelect}
            cal1={entryCal1} setCal1={setEntryCal1} cal2={entryCal2} setCal2={setEntryCal2}
          />
          {/* Agenda = data de CRIAÇÃO do agendamento (appointments.created_at): rege Geradas / taxa Lead→Agend / CAC */}
          <DatePill
            label="Agenda" valueLabel={apptLabel}
            rangeText={apptRange ? `${format(apptRange.start, "dd/MM")} - ${format(apptRange.end, "dd/MM")}` : "todas as datas"}
            open={isApptOpen} setOpen={setIsApptOpen}
            presets={[{ id: "todos", label: "Todos" }, ...RANGE_PRESETS]} activeLabel={apptLabel} onPreset={setApptById}
            selected={apptRange ? { from: apptRange.start, to: apptRange.end } : undefined} onSelect={onApptSelect}
            cal1={apptCal1} setCal1={setApptCal1} cal2={apptCal2} setCal2={setApptCal2}
          />
          {/* Conversão = data da CONSULTA (appointments.date): rege realizadas / comparecimento / faturamento real */}
          <DatePill
            label="Conversão" valueLabel={convLabel}
            rangeText={`${format(convRange.start, "dd/MM")} - ${format(convRange.end, "dd/MM")}`}
            open={isConvOpen} setOpen={setIsConvOpen}
            presets={RANGE_PRESETS} activeLabel={convLabel} onPreset={setConvById}
            selected={{ from: convRange.start, to: convRange.end }} onSelect={onConvSelect}
            cal1={convCal1} setCal1={setConvCal1} cal2={convCal2} setCal2={setConvCal2}
          />
        </div>
      </div>

      {/* Filtros globais (mudam os dados — mesmo design do Marketing): agente + origem + Relatório/Métricas à direita */}
      <div className="flex items-center gap-x-6 gap-y-3 flex-wrap">
        <FilterChips
          value={agent}
          onChange={(id) => setAgentPersist(id as AgentFilter)}
          options={[
            { id: "todos", label: "Todos", icon: Users },
            { id: "ia", label: "IA", icon: Bot },
            { id: "humano", label: "Humano", icon: UserCheck },
          ]}
        />
        <FilterChips
          multiple
          value={origin}
          onChange={(ids) => setOriginPersist(ids as OriginFilter[])}
          options={[
            { id: "todos", label: "Todos" },
            { id: "meta", label: "Meta", logo: MetaLogo },
            { id: "google", label: "Google", logo: GoogleLogo },
            { id: "sem_origem", label: "Orgânico", logo: SemOrigemLogo },
          ]}
        />
        {/* Filtro de canal de captação: Forms / WhatsApp / Balcão */}
        <FilterChips
          multiple
          value={channel}
          onChange={(ids) => setChannelPersist(ids as ChannelFilter[])}
          options={[
            { id: "todos", label: "Todos" },
            { id: "forms", label: "Forms", icon: FileText },
            { id: "whatsapp", label: "WhatsApp", logo: WhatsAppLogo },
            { id: "balcao", label: "Balcão", icon: Store },
          ]}
        />
        {/* Relatório + Métricas — alinhados à direita, abaixo dos filtros de data */}
        <div className="flex items-center gap-2 ml-auto">
          <ReportButton onGenerate={generateReport} loadingKind={reportLoading} iaAvailable={clinicFeatures?.feature_ia !== false} />
          <MetricsConfigButton metricsOrder={metricsOrder} visibleMetrics={visibleMetrics} toggleMetric={toggleMetric} moveMetric={moveMetric} />
        </div>
      </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6 gap-4">
        {headlineKpis.map((stat, i) => (
          <motion.div key={stat.title} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }} className="h-full">
            <Card className="h-full flex flex-col bg-white border-slate-200 shadow-lg rounded-2xl p-4 overflow-hidden group hover:shadow-xl transition-all">
              <div className="flex items-start justify-between">
                <div className={`p-2 rounded-xl ${stat.bg}`}><stat.icon className={`w-4 h-4 ${stat.color}`} /></div>
                {((agent !== "todos" && !stat.agentScoped) || (origin.length > 0 && !stat.originScoped)) && (
                  <span className="text-[8px] font-black uppercase tracking-wider text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-full" title="Não atribuível ao filtro ativo — valor geral da clínica">geral</span>
                )}
              </div>
              <div className="mt-3 flex flex-col flex-1">
                <h3 className="text-[9px] font-black text-slate-400 uppercase tracking-widest min-h-[22px] leading-tight">{stat.title}</h3>
                <p className={`${stat.valueLabel ? "text-sm" : "text-base"} font-black text-slate-900 mt-0.5 whitespace-nowrap`}>
                  {stat.valueLabel && <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mr-1">{stat.valueLabel}:</span>}
                  {stat.value}
                </p>
                {stat.value2 != null && (
                  <p className="text-[10px] font-bold text-slate-400 mt-1 whitespace-nowrap uppercase tracking-wider">
                    {stat.value2Label}: <span className="text-slate-600 font-black normal-case">{stat.value2}</span>
                  </p>
                )}
              </div>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Seções ordenadas por público */}
      {orderedSections}

      {/* Modal de preview do relatório */}
      <AnimatePresence>
        {showReport && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm"
            onClick={() => setShowReport(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 12 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 bg-slate-50">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-teal-600" />
                  <span className="text-sm font-bold text-slate-700 uppercase tracking-wider">Relatório p/ WhatsApp</span>
                </div>
                <button onClick={() => setShowReport(false)} className="p-1 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors">
                  <XCircle className="w-5 h-5" />
                </button>
              </div>
              <div className="p-4 overflow-y-auto custom-scrollbar">
                <pre className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-slate-700 font-sans bg-slate-50 rounded-xl border border-slate-100 p-4">{reportText}</pre>
              </div>
              <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-slate-100 bg-slate-50">
                <Button onClick={downloadReport} variant="outline" className="gap-2 border-slate-200 bg-white hover:bg-slate-50 text-slate-600">
                  <Download className="w-4 h-4" />
                  <span className="text-[11px] font-bold uppercase tracking-tight">Baixar .txt</span>
                </Button>
                <Button onClick={copyReport} className="gap-2 bg-teal-600 hover:bg-teal-700 text-white">
                  {reportCopied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  <span className="text-[11px] font-bold uppercase tracking-tight">{reportCopied ? "Copiado!" : "Copiar"}</span>
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
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
      <DateRangePopover
        valueLabel={valueLabel}
        rangeText={rangeText}
        presets={presets}
        activeLabel={activeLabel}
        onPreset={onPreset}
        selected={selected}
        onSelect={onSelect}
        month1={cal1}
        setMonth1={setCal1}
        month2={cal2}
        setMonth2={setCal2}
        open={open}
        setOpen={setOpen}
        presetsTitle={label}
      />
    </div>
  );
}

// ==========================================
// Subcomponente: linha de métrica de agente
// ==========================================
// Tile maior (usado no painel de agente em largura total e nas automações)
function MetricTile({ icon: Icon, label, value, color, bg }: { icon: any; label: string; value: React.ReactNode; color: string; bg: string }) {
  return (
    <div className="flex flex-col p-4 rounded-xl bg-slate-50/50 border border-slate-100 hover:border-slate-200 transition-all">
      <div className={`p-2 rounded-lg ${bg} w-fit mb-3`}><Icon className={`w-4 h-4 ${color}`} /></div>
      <p className="text-2xl font-bold text-slate-900">{value}</p>
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-1 leading-tight">{label}</p>
    </div>
  );
}

// Botão "Relatório" (dropdown: completo / geral / IA / humano) — gera texto p/ WhatsApp
function ReportButton({ onGenerate, loadingKind, iaAvailable }: {
  onGenerate: (kind: ReportKind) => void;
  loadingKind: ReportKind | null;
  iaAvailable: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const busy = loadingKind != null;
  const options: { kind: ReportKind; label: string; desc: string }[] = [
    { kind: "completo", label: "Completo", desc: "Geral + atribuição (IA/Humano)" },
    { kind: "geral", label: "Somente Geral", desc: "Números totais da clínica" },
    ...(iaAvailable ? [{ kind: "ia" as ReportKind, label: "Somente IA", desc: "Atribuído à IA" }] : []),
    { kind: "humano", label: "Somente Humano", desc: "Atribuído ao humano" },
  ];
  return (
    <div className="relative">
      <Button
        onClick={() => setIsOpen(!isOpen)}
        disabled={busy}
        variant="outline"
        className={cn("gap-2 transition-all shadow-sm", isOpen ? "bg-teal-50 border-teal-200 text-teal-600 shadow-teal-100" : "border-slate-200 bg-white hover:bg-slate-50 text-slate-600")}
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin text-teal-600" /> : <FileText className="w-4 h-4" />}
        <span className="text-[10px] font-bold uppercase tracking-tight">Relatório</span>
      </Button>
      <AnimatePresence>
        {isOpen && (
          <>
            <div className="fixed inset-0 z-[105]" onClick={() => setIsOpen(false)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="absolute top-full right-0 mt-2 w-64 bg-white rounded-2xl border border-slate-200 shadow-2xl z-[110] p-2 overflow-hidden"
            >
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2 pl-2 pt-1">Baixar relatório</p>
              <div className="space-y-0.5">
                {options.map((opt) => (
                  <button
                    key={opt.kind}
                    onClick={() => { onGenerate(opt.kind); setIsOpen(false); }}
                    disabled={busy}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left hover:bg-teal-50 transition-colors group disabled:opacity-50"
                  >
                    <div className="p-1.5 rounded-lg bg-slate-100 group-hover:bg-teal-100">
                      {loadingKind === opt.kind ? <Loader2 className="w-3.5 h-3.5 text-teal-600 animate-spin" /> : <FileText className="w-3.5 h-3.5 text-slate-500 group-hover:text-teal-600" />}
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[11px] font-bold text-slate-700 uppercase tracking-tight">{opt.label}</span>
                      <span className="text-[10px] text-slate-400">{opt.desc}</span>
                    </div>
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
