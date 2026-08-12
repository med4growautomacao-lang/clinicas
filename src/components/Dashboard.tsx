import { useState, useMemo } from "react";
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
  Receipt,
  Percent,
  DollarSign,
  Target,
  Bot,
  UserCheck,
  FileText,
  Store
} from "lucide-react";
import { TrendBarChart, fmtByType } from "./TrendBarChart";
import { cn } from "@/src/lib/utils";
import { motion } from "framer-motion";
import { useDashboardStats } from "../hooks/useSupabase";
import { useAuth } from "../contexts/AuthContext";
import GoogleLogo from "../assets/logos/Logo Googleads.png";
import MetaLogo from "../assets/logos/Logo Metaads.png";
import SemOrigemLogo from "../assets/logos/Logo Sem origem.png";
import WhatsAppLogo from "../assets/logos/Logo Whatsapp.png";
import { FilterChips } from "./filters/FilterChips";
import { ReportQuick } from "./ReportQuick";
import { GranularityToggle } from "./filters/GranularityToggle";
import { DateRangePopover } from "./filters/DateRangePopover";
import { type Period, RANGE_PRESETS } from "../lib/dateRange";
import {
  format,
  subDays,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  subMonths,
  subWeeks,
  addMonths
} from "date-fns";

// Visão Geral = leitura RÁPIDA do dono: números essenciais do período + tendência.
// Fonte ÚNICA (mesmas views/RPC que Comercial e Marketing): faturamento = VENDAS
// LANÇADAS (conversions sem 'Orçamento Enviado'), vendas = tickets.outcome, agendados =
// união agenda∪etapa. Detalhe por coorte/UTM fica em Comercial e Marketing.
export function Dashboard() {
  // Orçamento é módulo do WakeDesk (category='outro'), o mesmo discriminador que decide o menu.
  // Numa clínica o card só mostraria zero para sempre, então nem entra na lista.
  const { activeClinicCategory } = useAuth();
  const isOutro = activeClinicCategory === 'outro';
  const [period, setPeriod] = useState<Period>('mês');
  const [isPeriodOpen, setIsPeriodOpen] = useState(false);
  // Origem e Canal são multi-seleção (array vazio = "Todos"). Agente segue único.
  const [origin, setOrigin] = useState<string[]>([]);
  const [channel, setChannel] = useState<string[]>([]);
  const [agent, setAgent] = useState<'todos' | 'ia' | 'humano'>('todos');
  const [activeRangeLabel, setActiveRangeLabel] = useState("ESTE MÊS");
  const [dateRange, setDateRange] = useState({
    start: startOfMonth(new Date()),
    end: endOfMonth(new Date())
  });

  const statsDateRange = useMemo(() => ({
    start: format(dateRange.start, 'yyyy-MM-dd'),
    end: format(dateRange.end, 'yyyy-MM-dd')
  }), [dateRange]);

  const { data: stats, loading, error: statsError, refetch } = useDashboardStats(
    statsDateRange,
    origin.length ? origin.join(',') : 'todos',
    channel.length ? channel.join(',') : 'todos',
    agent
  );
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

  const [selectedMetric, setSelectedMetric] = useState<string>('vendas');

  // ⚠️ Os ids são as CHAVES de stats.chartData vindas da RPC — trocar id apaga a série.
  // `ticket_medio` e `orcamentos_conv` são a exceção: não vêm prontos do banco, são calculados
  // abaixo a partir das chaves cruas do dia (é o mesmo par valor ÷ quantidade dos cards).
  const chartMetrics = [
    { id: 'faturamento', label: 'VENDAS LANÇADAS (R$)', type: 'currency', color: '#0d9488' },
    { id: 'vendas_lancadas', label: 'VENDAS LANÇADAS (Nº)', type: 'number', color: '#a21caf' },
    { id: 'ticket_medio', label: 'TICKET MÉDIO', type: 'currency', color: '#2563eb' },
    { id: 'investimento', label: 'INVESTIMENTO', type: 'currency', color: '#f59e0b' },
    { id: 'roas', label: 'ROAS', type: 'number', color: '#8b5cf6' },
    { id: 'leads', label: 'LEADS', type: 'number', color: '#4f46e5' },
    { id: 'agendamentos', label: 'AGENDADOS', type: 'number', color: '#0ea5e9' },
    // ⚠️ O id NÃO muda: é a chave de stats.chartData vinda da RPC. Só o rótulo, porque a contagem
    // é por CARD (cliente que comprou), não por venda lançada.
    { id: 'vendas', label: 'CLIENTES', type: 'number', color: '#10b981' },
    // Orçamento é módulo do WakeDesk: numa clínica as séries seriam três linhas retas no zero.
    ...(isOutro ? [
      { id: 'orcamentos', label: 'ORÇAMENTOS ENVIADOS', type: 'number', color: '#0284c7' },
      { id: 'orcamentos_valor', label: 'ORÇAMENTOS (R$)', type: 'currency', color: '#0369a1' },
      { id: 'orcamentos_conv', label: 'ORÇAMENTO → VENDA', type: 'percent', color: '#059669' },
    ] : []),
  ];

  const processedChartData = useMemo(() => {
    return stats.chartData.map((d: any) => {
      // Formatar data dd/MM sem parseISO para evitar problemas de timezone
      const [, month, day] = d.date.split('-');
      return {
        ...d,
        name: `${day}/${month}`,
        roas: d.investimento > 0 ? Number((d.faturamento / d.investimento).toFixed(2)) : 0,
        // Ticket do dia: valor lançado ÷ vendas lançadas naquele dia. Dia sem venda fica 0 (barra
        // vazia), não herda o ticket do dia anterior.
        ticket_medio: d.vendas_lancadas > 0 ? Number((d.faturamento / d.vendas_lancadas).toFixed(2)) : 0,
        // Taxa do dia = orçamentos daquele dia que viraram venda ÷ enviados naquele dia. Em janela
        // curta oscila muito (denominador pequeno): a leitura boa é a linha de média do gráfico.
        orcamentos_conv: d.orcamentos > 0 ? Number(((d.orcamentos_ganhos / d.orcamentos) * 100).toFixed(1)) : 0,
      };
    });
  }, [stats.chartData]);

  // Faturamento canônico = VENDAS LANÇADAS (salesValue). Fallback p/ totalConversionsValue
  // durante a transição do deploy (a RPC v2 já devolve salesValue).
  const salesValue = Number(stats.salesValue ?? stats.totalConversionsValue ?? 0);
  // Investimento é null quando há filtro de canal/agente (gasto não é atribuível a esse recorte) → "—".
  const investimento = stats.totalInvestment;
  const roas = investimento != null && investimento > 0 && salesValue > 0 ? (salesValue / investimento) : 0;
  const conversionRate = stats.totalLeads > 0 && stats.totalSales > 0
    ? ((stats.totalSales / stats.totalLeads) * 100)
    : 0;
  // Ticket médio REAL do período: o que entrou dividido por quantas vendas foram lançadas.
  // ⚠️ Divide por salesCount (lançamentos), não por totalSales (clientes): o mesmo cliente pode
  // ter fechado duas vezes, e usar clientes aqui inflaria o ticket sem ninguém perceber.
  const configuredTicket = stats.defaultTicket > 0 ? stats.defaultTicket : 0;
  const realTicket = stats.salesCount > 0 ? salesValue / stats.salesCount : 0;
  const fmtBRL0 = (v: number) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

  const cards = [
    // Dinheiro
    { title: "Vendas lançadas", value: `R$ ${salesValue.toLocaleString('pt-BR', { minimumFractionDigits: 0 })}`, trend: "Valor lançado no fechamento", icon: DollarSign, color: "bg-emerald-50 text-emerald-600" },
    { title: "Investimento", value: investimento == null ? "—" : `R$ ${investimento.toLocaleString('pt-BR', { minimumFractionDigits: 0 })}`, trend: investimento == null ? "Não atribuível por canal/agente" : "Em mídia paga", icon: TrendingUp, color: "bg-amber-50 text-amber-600" },
    { title: "ROAS", value: roas > 0 ? `${roas.toFixed(2).replace('.', ',')}x` : "—", trend: "Vendas ÷ Investimento", icon: Activity, color: "bg-teal-50 text-teal-600" },
    // Em cima o ticket REAL (sai das vendas do período); embaixo a META configurada em Dados da
    // Clínica. Sem venda lançada não há ticket real: mostra "—" em vez de fingir R$ 0.
    { title: "Ticket Médio", value: realTicket > 0 ? fmtBRL0(realTicket) : "—", trend: configuredTicket > 0 ? `Meta: ${fmtBRL0(configuredTicket)}` : "Meta não definida em Dados da Clínica", icon: Target, color: "bg-violet-50 text-violet-600" },
    // Funil
    { title: "Leads", value: `${stats.totalLeads}`, trend: "Novos no período", icon: MessageSquare, color: "bg-indigo-50 text-indigo-600" },
    { title: "Agendados", value: `${stats.totalAppointments}`, trend: "Gerados (agenda ∪ funil)", icon: CalendarCheck, color: "bg-sky-50 text-sky-600" },
    // Quantidade em destaque, valor somado embaixo. Conta pelo dia do ENVIO (sent_at).
    ...(isOutro ? [
      { title: "Orçamentos enviados", value: `${stats.quotesSent}`, trend: `${fmtBRL0(stats.quotesValue)} enviados no período`, icon: FileText, color: "bg-blue-50 text-blue-600" },
      // Taxa por COORTE: dos orçamentos enviados no período, quantos viraram venda. O "X de Y"
      // embaixo não é enfeite — orçamento enviado ontem ainda não teve tempo de fechar, e sem o
      // denominador a porcentagem do mês corrente parece queda de desempenho.
      { title: "Orçamento → Venda", value: stats.quotesSent > 0 ? `${((stats.quotesWon / stats.quotesSent) * 100).toFixed(1).replace('.', ',')}%` : "—", trend: `${stats.quotesWon} de ${stats.quotesSent} viraram venda`, icon: Percent, color: "bg-emerald-50 text-emerald-600" },
    ] : []),
    // ⚠️ Este número conta CARDS ganhos, ou seja, clientes que compraram, não vendas lançadas: o
    // mesmo cliente pode fechar vários negócios no mesmo card e continua contando 1. Faturamento
    // (acima) sai de conversions e soma todas. Não "corrigir" a conta: o rótulo é que estava velho.
    { title: "Clientes que compraram", value: `${stats.totalSales}`, trend: "1 por cliente, não por venda", icon: ShoppingCart, color: "bg-rose-50 text-rose-600" },
    // Quantas VENDAS foram lançadas (o mesmo card pode ter várias). É o par em número do card
    // "Vendas lançadas" em R$ lá de cima: mesma fonte (conversions), mesmo eixo (converted_at).
    // ⚠️ Zero aqui não é bug: clínica que marca ganho mas não lança valor tem R$ 0 no card de
    // dinheiro e 0 aqui — por isso o nº de clientes vem embaixo, para o card nunca ficar mudo.
    { title: "Vendas lançadas (nº)", value: `${stats.salesCount}`, trend: `${stats.totalSales} ${stats.totalSales === 1 ? 'cliente comprou' : 'clientes compraram'}`, icon: Receipt, color: "bg-fuchsia-50 text-fuchsia-600" },
    { title: "Conversão Lead → Cliente", value: conversionRate > 0 ? `${conversionRate.toFixed(1).replace('.', ',')}%` : "—", trend: "Clientes ÷ Leads", icon: TrendingUp, color: "bg-cyan-50 text-cyan-600" },
  ];

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
      {statsError && !loading && (
        <div className="flex items-center justify-between gap-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3">
          <span className="text-sm font-semibold text-red-700">
            {statsError.message} Os números abaixo podem estar desatualizados.
          </span>
          <button
            onClick={() => refetch()}
            className="text-xs font-bold uppercase tracking-widest text-red-700 hover:text-red-900"
          >
            Tentar novamente
          </button>
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
          {/* Filtros de período (granularidade + calendário) */}
          <div className="flex items-center gap-3 bg-white p-1.5 rounded-2xl border border-slate-200 shadow-sm">
            <GranularityToggle
              period={period}
              onChange={(p) => {
                setPeriod(p);
                if (p === 'dia') setRangeById('today');
                else if (p === 'sem') setRangeById('week');
                else if (p === 'mês') setRangeById('month');
              }}
            />

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
            />
          </div>

          {/* Filtro de agente (Todos / IA / Humano) */}
          <FilterChips
            value={agent}
            onChange={(id) => setAgent(id as 'todos' | 'ia' | 'humano')}
            options={[
              { id: 'todos', label: 'Todos', icon: Users },
              { id: 'ia', label: 'IA', icon: Bot },
              { id: 'humano', label: 'Humano', icon: UserCheck },
            ]}
          />

          {/* Filtro de origem (Todos / Meta / Google / Orgânico) — multi */}
          <FilterChips
            multiple
            value={origin}
            onChange={(ids) => setOrigin(ids)}
            options={[
              { id: 'todos', label: 'Todos' },
              { id: 'meta', label: 'Meta', logo: MetaLogo },
              { id: 'google', label: 'Google', logo: GoogleLogo },
              { id: 'sem_origem', label: 'Orgânico', logo: SemOrigemLogo },
            ]}
          />

          {/* Filtro de canal (Todos / Forms / WhatsApp / Balcão) — multi */}
          <FilterChips
            multiple
            value={channel}
            onChange={(ids) => setChannel(ids)}
            options={[
              { id: 'todos', label: 'Todos' },
              { id: 'forms', label: 'Forms', icon: FileText },
              { id: 'whatsapp', label: 'WhatsApp', logo: WhatsAppLogo },
              { id: 'balcao', label: 'Balcão', icon: Store },
            ]}
          />

          {/* Relatório completo do período (mesma fonte do Comercial/agendado) */}
          <ReportQuick start={dateRange.start} end={dateRange.end} />
        </div>
      </div>

      {/* Grid enxuto: 8 cards essenciais em 2 linhas (dinheiro em cima, funil embaixo) */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        {cards.map((stat, i) => (
          <motion.div key={stat.title} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
            <Card className="overflow-hidden border border-slate-100 shadow-sm h-full">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{stat.title}</CardTitle>
                <div className={cn("p-1.5 rounded-lg", stat.color)}>
                  <stat.icon className="h-4 w-4" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-slate-900">{stat.value}</div>
                <p className="text-[11px] text-slate-400 font-medium mt-1">{stat.trend}</p>
              </CardContent>
            </Card>
          </motion.div>
        ))}
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
            // A série segue o activeMetric, não o selectedMetric: numa clínica sem Orçamentos a
            // métrica salva na sessão pode não existir mais, e aí o gráfico desenharia zeros com
            // o rótulo de outra métrica em vez de cair no padrão.
            const activeMetric = chartMetrics.find(m => m.id === selectedMetric) || chartMetrics[0];
            return (
              <TrendBarChart
                series={processedChartData.map((d: any) => ({ label: d.name, value: Number(d[activeMetric.id]) || 0 }))}
                format={fmtByType(activeMetric.type)}
                height={300}
              />
            );
          })()}
        </CardContent>
      </Card>
    </div>
  );
}
