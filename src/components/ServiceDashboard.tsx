import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { 
  BarChart3, 
  Clock, 
  MessageSquare, 
  CheckCircle2, 
  Users, 
  TrendingUp, 
  ArrowUpRight, 
  ArrowDownRight,
  UserCheck
} from "lucide-react";
import { motion } from "framer-motion";
import { useDashboardStats } from "../hooks/useSupabase";
import { Loader2 } from "lucide-react";

export function ServiceDashboard() {
  const { data: dashboardData, loading } = useDashboardStats();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 text-teal-600 animate-spin" />
      </div>
    );
  }

  const stats = [
    { 
      title: "Agendamentos (Mês)", 
      value: dashboardData.totalAppointments.toString(), 
      change: "+0%", 
      trend: "neutral", 
      icon: MessageSquare, 
      color: "text-blue-600",
      bg: "bg-blue-50"
    },
    { 
      title: "Mensagens (Mês)", 
      value: dashboardData.totalMessages.toString(), 
      change: "+0%", 
      trend: "neutral", 
      icon: MessageSquare, 
      color: "text-teal-600",
      bg: "bg-teal-50"
    },
    { 
      title: "Faturamento (Mês)", 
      value: new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(dashboardData.totalRevenue), 
      change: "+0%", 
      trend: "neutral", 
      icon: TrendingUp, 
      color: "text-emerald-600",
      bg: "bg-emerald-50"
    },
    { 
      title: "Novos Pacientes", 
      value: dashboardData.newPatients.toString(), 
      change: "+0%", 
      trend: "neutral", 
      icon: Users, 
      color: "text-amber-600",
      bg: "bg-amber-50"
    },
  ];
  return (
    <div className="space-y-6 h-full overflow-y-auto pr-1 custom-scrollbar pb-8">
      {/* Metrics Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat, i) => (
          <motion.div
            key={stat.title}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
          >
            <Card className="border border-slate-200 shadow-sm hover:shadow-md transition-all">
              <CardContent className="p-4">
                <div className="flex justify-between items-start mb-4">
                  <div className={`p-2 rounded-lg ${stat.bg}`}>
                    <stat.icon className={`w-5 h-5 ${stat.color}`} />
                  </div>
                  <div className={`flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded ${
                    stat.trend === "up" ? "bg-emerald-50 text-emerald-600" : 
                    stat.trend === "down" ? "bg-rose-50 text-rose-600" : "bg-slate-50 text-slate-500"
                  }`}>
                    {stat.trend === "up" && <ArrowUpRight className="w-3 h-3" />}
                    {stat.trend === "down" && <ArrowDownRight className="w-3 h-3" />}
                    {stat.change}
                  </div>
                </div>
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                    {stat.title}
                  </p>
                  <h3 className="text-2xl font-bold text-slate-900">{stat.value}</h3>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Performance Chart Placeholder */}
        <Card className="lg:col-span-2 border border-slate-200 shadow-sm overflow-hidden">
          <CardHeader className="bg-slate-50 border-b border-slate-100 py-3">
            <CardTitle className="text-sm font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-teal-600" />
              Volume de Atendimentos (Últimos 7 dias)
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            <div className="h-[300px] w-full flex items-end gap-3 px-2">
              {[45, 52, 38, 65, 48, 72, 58].map((val, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-2 group">
                  <motion.div 
                    initial={{ height: 0 }}
                    animate={{ height: `${val}%` }}
                    transition={{ delay: i * 0.1, duration: 1 }}
                    className="w-full bg-teal-500/20 group-hover:bg-teal-500/40 rounded-t-md relative flex justify-center"
                  >
                    <div className="absolute -top-6 opacity-0 group-hover:opacity-100 transition-opacity bg-slate-900 text-white text-[10px] font-bold px-1.5 py-0.5 rounded mb-1">
                      {val}
                    </div>
                  </motion.div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">
                    {["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"][i]}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Real-time pulse */}
        <Card className="border border-slate-200 shadow-sm overflow-hidden">
          <CardHeader className="bg-slate-50 border-b border-slate-100 py-3">
            <CardTitle className="text-sm font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-teal-600" />
              Status em Tempo Real
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6 space-y-6">
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-xs font-semibold text-slate-600">Capacidade de Resposta</span>
                <span className="text-xs font-bold text-teal-600">Excelente</span>
              </div>
              <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                <div className="bg-teal-500 h-full w-[85%] rounded-full shadow-[0_0_8px_rgba(20,184,166,0.3)]" />
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-xs font-semibold text-slate-600">Taxa de Conclusão</span>
                <span className="text-xs font-bold text-teal-600">98.2%</span>
              </div>
              <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                <div className="bg-teal-500 h-full w-[94%] rounded-full shadow-[0_0_8px_rgba(20,184,166,0.3)]" />
              </div>
            </div>

            <div className="pt-6 border-t border-slate-100">
              <p className="text-sm font-bold text-slate-900 mb-4">Top Assuntos da Semana</p>
              <div className="space-y-3">
                {[
                  { label: "Agendamentos", value: "45%", color: "bg-blue-500" },
                  { label: "Dúvidas Procedimentos", value: "28%", color: "bg-teal-500" },
                  { label: "Cancelamentos", value: "12%", color: "bg-rose-500" },
                  { label: "Outros", value: "15%", color: "bg-slate-500" },
                ].map((item) => (
                  <div key={item.label} className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${item.color}`} />
                    <span className="text-xs font-medium text-slate-500 flex-1">{item.label}</span>
                    <span className="text-xs font-bold text-slate-900">{item.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
