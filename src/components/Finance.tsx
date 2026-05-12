import React, { useState } from "react";
import { CustomDatePicker } from "./CustomDatePicker";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
} from "recharts";
import {
  ArrowUpRight,
  ArrowDownRight,
  DollarSign,
  CreditCard,
  Wallet,
  TrendingUp,
  PieChart,
  Target,
  Loader2,
  Plus,
  ArrowUp,
  ArrowDown,
  Calendar,
  X,
  Edit2,
  Trash2,
  AlertCircle,
  Info,
  Clock,
  User,
  Phone,
  Hash,
} from "lucide-react";
import { cn } from "@/src/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { useFinancial, FinancialTransaction } from "../hooks/useSupabase";
import { MoneyInput } from "./ui/money-input";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";

export function Finance() {
  const { data: transactions, loading, create, update, remove } = useFinancial();
  const [showModal, setShowModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [selectedTx, setSelectedTx] = useState<FinancialTransaction | null>(null);
  const [formData, setFormData] = useState({
    type: 'receita' as 'receita' | 'despesa',
    amount: '',
    description: '',
    category: '',
    payment_method: 'pix' as any,
    status: 'pago' as any,
    date: format(new Date(), 'yyyy-MM-dd'),
  });
  const [submitting, setSubmitting] = useState(false);

  const receitas = transactions.filter(t => t.type === 'receita' && t.status === 'pago');
  const despesas = transactions.filter(t => t.type === 'despesa' && t.status === 'pago');

  const totalReceita = receitas.reduce((sum, t) => sum + Number(t.amount), 0);
  const totalDespesa = despesas.reduce((sum, t) => sum + Number(t.amount), 0);
  const lucro = totalReceita - totalDespesa;

  // Group by month for chart
  const monthlyData: Record<string, { receita: number; despesa: number }> = {};
  transactions.filter(t => t.status === 'pago').forEach(t => {
    const month = t.date?.substring(0, 7); // "2024-03"
    if (!month) return;
    if (!monthlyData[month]) monthlyData[month] = { receita: 0, despesa: 0 };
    if (t.type === 'receita') monthlyData[month].receita += Number(t.amount);
    else monthlyData[month].despesa += Number(t.amount);
  });

  const chartData = Object.entries(monthlyData)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-6)
    .map(([month, d]) => ({
      name: new Date(month + '-01').toLocaleString('pt-BR', { month: 'short' }),
      revenue: d.receita,
      expenses: d.despesa,
    }));

  const handleSubmit = async () => {
    if (!formData.amount || !formData.description) return;
    setSubmitting(true);
    
    const payload = {
      ...formData,
      amount: Number(formData.amount),
    };

    if (selectedTx) {
      await update(selectedTx.id, payload);
    } else {
      await create(payload as any);
    }

    setShowModal(false);
    setSelectedTx(null);
    setFormData({
      type: 'receita',
      amount: '',
      description: '',
      category: '',
      payment_method: 'pix',
      status: 'pago',
      date: format(new Date(), 'yyyy-MM-dd'),
    });
    setSubmitting(false);
  };

  const handleDelete = async () => {
    if (!selectedTx) return;
    setSubmitting(true);
    await remove(selectedTx.id);
    setShowDeleteConfirm(false);
    setSelectedTx(null);
    setSubmitting(false);
  };

  const openEditModal = (tx: FinancialTransaction) => {
    setSelectedTx(tx);
    setFormData({
      type: tx.type,
      amount: tx.amount.toString(),
      description: tx.description || '',
      category: tx.category || '',
      payment_method: tx.payment_method || 'pix',
      status: tx.status || 'pago',
      date: tx.date || format(new Date(), 'yyyy-MM-dd'),
    });
    setShowModal(true);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 text-teal-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }}>
          <h2 className="text-3xl font-bold tracking-tight text-slate-900">
            Painel <span className="text-teal-600">Financeiro</span>
          </h2>
          <p className="text-slate-500 font-medium text-base">
            Acompanhe o crescimento e a saúde financeira da clínica.
          </p>
        </motion.div>
        <div className="flex items-center gap-3">
          <Button onClick={() => { setSelectedTx(null); setShowModal(true); }} className="py-5 px-6 group bg-teal-600 hover:bg-teal-700">
            <Plus className="w-5 h-5 mr-2 group-hover:rotate-90 transition-transform" />
            Nova Transação
          </Button>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {[
          { title: "Faturamento", value: `R$ ${totalReceita.toLocaleString('pt-BR', { minimumFractionDigits: 0 })}`, positive: true, icon: DollarSign, color: "text-emerald-500", bg: "bg-emerald-50" },
          { title: "Despesas Totais", value: `R$ ${totalDespesa.toLocaleString('pt-BR', { minimumFractionDigits: 0 })}`, positive: false, icon: CreditCard, color: "text-rose-400", bg: "bg-rose-50" },
          { title: "Lucro Líquido", value: `R$ ${lucro.toLocaleString('pt-BR', { minimumFractionDigits: 0 })}`, positive: lucro >= 0, icon: Wallet, color: "text-teal-600", bg: "bg-teal-50" },
        ].map((stat, i) => (
          <motion.div key={stat.title} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }}>
            <Card className="border border-slate-200 shadow-sm overflow-hidden group">
              <div className={cn("h-1.5 w-full", stat.positive ? "bg-emerald-400" : "bg-rose-400")} />
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-xs font-semibold uppercase tracking-wider text-slate-500">{stat.title}</CardTitle>
                <div className={cn("p-1.5 rounded-lg transition-transform group-hover:scale-105", stat.bg)}>
                  <stat.icon className={cn("h-4 w-4", stat.color)} />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-slate-900">{stat.value}</div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      <div className="grid gap-8 lg:grid-cols-3">
        <Card className="lg:col-span-2 border border-slate-200 shadow-sm overflow-hidden">
          <CardHeader className="pb-2 border-b border-slate-100 bg-slate-50/50">
            <CardTitle className="text-lg font-bold text-slate-900 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Target className="w-5 h-5 text-teal-600" />
                Receita vs Despesas
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            <div className="h-[350px] w-full">
              {chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 10, right: 30, left: 10, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#0d9488" stopOpacity={0.4} />
                        <stop offset="95%" stopColor="#0d9488" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="colorExpenses" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#f43f5e" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="8 8" vertical={false} stroke="#E2E8F0" />
                    <XAxis dataKey="name" stroke="#94A3B8" fontSize={12} fontWeight="bold" tickLine={false} axisLine={false} dy={10} />
                    <YAxis stroke="#94A3B8" fontSize={12} fontWeight="bold" tickLine={false} axisLine={false} tickFormatter={(v) => `R$${v / 1000}k`} dx={-10} />
                    <Tooltip contentStyle={{ borderRadius: "0.5rem", border: "1px solid #e2e8f0", boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.05)", padding: "0.75rem", fontWeight: "500" }} />
                    <Area type="monotone" dataKey="revenue" name="Receita" stroke="#0d9488" strokeWidth={3} fillOpacity={1} fill="url(#colorRevenue)" />
                    <Area type="monotone" dataKey="expenses" name="Despesas" stroke="#f43f5e" strokeWidth={3} fillOpacity={1} fill="url(#colorExpenses)" />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-slate-400">
                  <p className="font-medium">Nenhuma transação registrada ainda.</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="border border-slate-200 shadow-sm bg-slate-900 text-white relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-32 h-32 bg-teal-500/5 rounded-full -mr-16 -mt-16 blur-2xl group-hover:scale-150 transition-transform duration-700" />
          <CardHeader className="relative z-10 border-b border-white/10 pb-4">
            <CardTitle className="text-lg font-bold flex items-center gap-2">
              <PieChart className="w-5 h-5 text-teal-400" />
              Resumo Mensal
            </CardTitle>
          </CardHeader>
          <CardContent className="relative z-10 p-6 space-y-6">
            <div className="space-y-6 mt-2">
              <div className="space-y-3">
                <div className="flex justify-between items-end">
                  <span className="font-semibold text-sm opacity-90">Receitas Pagas</span>
                  <span className="text-xs font-bold">R$ {totalReceita.toLocaleString('pt-BR')}</span>
                </div>
                <div className="w-full bg-white/10 rounded-full h-2 overflow-hidden">
                  <motion.div initial={{ width: 0 }} animate={{ width: totalReceita > 0 ? '100%' : '0%' }} transition={{ duration: 1 }} className="h-full rounded-full shadow-sm bg-teal-400" />
                </div>
              </div>
              <div className="space-y-3">
                <div className="flex justify-between items-end">
                  <span className="font-semibold text-sm opacity-90">Despesas Pagas</span>
                  <span className="text-xs font-bold">R$ {totalDespesa.toLocaleString('pt-BR')}</span>
                </div>
                <div className="w-full bg-white/10 rounded-full h-2 overflow-hidden">
                  <motion.div initial={{ width: 0 }} animate={{ width: totalReceita > 0 ? `${(totalDespesa / Math.max(totalReceita, 1)) * 100}%` : '0%' }} transition={{ duration: 1, delay: 0.2 }} className="h-full rounded-full shadow-sm bg-rose-400" />
                </div>
              </div>
            </div>

            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }} className="mt-8 p-6 bg-white/10 rounded-2xl border border-white/10 text-center shadow-inner relative overflow-hidden">
              <div className="relative z-10">
                <div className="text-[10px] font-bold uppercase tracking-widest opacity-60 mb-1">Lucro Líquido Esperado</div>
                <div className="text-3xl font-bold">R$ {lucro.toLocaleString('pt-BR')}</div>
              </div>
              <div className="absolute inset-0 bg-gradient-to-br from-teal-500/10 to-transparent pointer-events-none" />
            </motion.div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2 px-2">
          <Calendar className="w-5 h-5 text-teal-600" />
          Transações Recentes
        </h3>
        <Card className="border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Data</th>
                  <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Descrição</th>
                  <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Categoria</th>
                  <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Método</th>
                  <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">Valor</th>
                  <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-center">Status</th>
                  <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider text-center">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {transactions.slice(0, 10).map((tx) => {
                  const anyTx = tx as any;
                  const apt = anyTx.appointment;
                  const conv = anyTx.conversions?.[0];
                  const leadId = conv?.lead_id;
                  const leadName = conv?.lead?.name || apt?.patient?.name || anyTx.patient?.name;
                  const leadPhone = conv?.lead?.phone || apt?.patient?.phone || anyTx.patient?.phone;
                  const ticketId = apt?.ticket_id;
                  const aptTime = apt?.time ? String(apt.time).substring(0, 5) : null;
                  const txTime = tx.created_at ? format(new Date(tx.created_at), 'HH:mm') : null;
                  const hasInfo = leadName || leadPhone || ticketId || aptTime || txTime;
                  const openLead = () => {
                    if (!leadId) return;
                    sessionStorage.setItem('open_lead_id', leadId);
                    window.dispatchEvent(new CustomEvent('app-navigate', { detail: { tab: 'ai-secretary' } }));
                  };
                  return (
                  <tr key={tx.id} className="hover:bg-slate-50/80 transition-colors group">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <div className="flex flex-col">
                          <span className="text-sm font-medium text-slate-600">
                            {tx.date ? format(parseISO(tx.date), 'dd/MM/yyyy') : '-'}
                          </span>
                          {txTime && (
                            <span className="text-[10px] font-medium text-slate-400 flex items-center gap-1 mt-0.5">
                              <Clock className="w-2.5 h-2.5" /> {txTime}
                            </span>
                          )}
                        </div>
                        {hasInfo && (
                          <div className="relative group/tip">
                            <Info className="w-3.5 h-3.5 text-slate-300 hover:text-teal-500 transition-colors cursor-help" />
                            <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-1.5 hidden group-hover/tip:block z-50 pointer-events-none">
                              <div className="bg-slate-800 text-white text-xs rounded-lg px-3 py-2 shadow-xl whitespace-nowrap space-y-1">
                                {txTime && (
                                  <div className="flex items-center gap-1.5">
                                    <Clock className="w-3 h-3 text-slate-300" />
                                    <span className="font-medium">Registrado às {txTime}</span>
                                  </div>
                                )}
                                {aptTime && (
                                  <div className="flex items-center gap-1.5">
                                    <Clock className="w-3 h-3 text-slate-300" />
                                    <span className="font-medium">Consulta {aptTime}</span>
                                  </div>
                                )}
                                {leadName && (
                                  <div className="flex items-center gap-1.5">
                                    <User className="w-3 h-3 text-slate-300" />
                                    <span className="font-medium">{leadName}</span>
                                  </div>
                                )}
                                {leadPhone && (
                                  <div className="flex items-center gap-1.5">
                                    <Phone className="w-3 h-3 text-slate-300" />
                                    <span className="font-medium">{leadPhone}</span>
                                  </div>
                                )}
                                {ticketId && (
                                  <div className="flex items-center gap-1.5">
                                    <Hash className="w-3 h-3 text-slate-300" />
                                    <span className="font-mono text-[10px] text-slate-300">{ticketId.substring(0, 8)}</span>
                                  </div>
                                )}
                                <div className="absolute left-1/2 -translate-x-1/2 top-full w-0 h-0 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent border-t-slate-800" />
                              </div>
                            </div>
                          </div>
                        )}
                        {leadId && (
                          <button
                            onClick={openLead}
                            title="Abrir conversa do lead"
                            className="p-1 text-slate-300 hover:text-violet-600 hover:bg-violet-50 rounded transition-all"
                          >
                            <ArrowUpRight className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col">
                        <span className="text-sm font-bold text-slate-900 leading-tight">{tx.description}</span>
                        {tx.type === 'receita' ? (
                          <span className="text-[10px] font-bold text-emerald-600 uppercase flex items-center gap-1 mt-1">
                            <ArrowUp className="w-2.5 h-2.5" /> Receita
                          </span>
                        ) : (
                          <span className="text-[10px] font-bold text-rose-500 uppercase flex items-center gap-1 mt-1">
                            <ArrowDown className="w-2.5 h-2.5" /> Despesa
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-500 font-medium">
                      {tx.category || '-'}
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-500 font-medium capitalize">
                      {tx.payment_method || '-'}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <span className={cn("text-sm font-bold", tx.type === 'receita' ? "text-emerald-600" : "text-rose-500")}>
                        {tx.type === 'receita' ? '+' : '-'} R$ {Number(tx.amount).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <span className={cn(
                        "text-[10px] font-bold px-2 py-1 rounded-full uppercase tracking-tighter shadow-sm border",
                        tx.status === 'pago' ? "bg-emerald-50 text-emerald-700 border-emerald-100" :
                        tx.status === 'pendente' ? "bg-amber-50 text-amber-700 border-amber-100" :
                        "bg-slate-100 text-slate-600 border-slate-200"
                      )}>
                        {tx.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <div className="flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => openEditModal(tx)} className="p-1.5 text-slate-400 hover:text-teal-600 hover:bg-teal-50 rounded-md transition-all">
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button onClick={() => { setSelectedTx(tx); setShowDeleteConfirm(true); }} className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-md transition-all">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {transactions.length === 0 && (
            <div className="p-12 text-center">
              <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4">
                <Wallet className="w-8 h-8 text-slate-300" />
              </div>
              <p className="text-slate-400 font-medium">Nenhuma transação encontrada.</p>
            </div>
          )}
        </Card>
      </div>

      {/* Transaction Modal */}
      <AnimatePresence>
        {showModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowModal(false)}>
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between p-6 border-b border-slate-100">
                <h3 className="text-lg font-bold text-slate-900">{selectedTx ? 'Editar Transação' : 'Nova Transação'}</h3>
                <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
              </div>
              <div className="p-6 space-y-4">
                <div className="flex gap-2 p-1 bg-slate-100 rounded-lg">
                  <button onClick={() => setFormData(p => ({ ...p, type: 'receita' }))} className={cn("flex-1 py-2 text-xs font-bold rounded-md transition-all", formData.type === 'receita' ? "bg-white text-emerald-600 shadow-sm" : "text-slate-500 hover:text-slate-700")}>RECEITA</button>
                  <button onClick={() => setFormData(p => ({ ...p, type: 'despesa' }))} className={cn("flex-1 py-2 text-xs font-bold rounded-md transition-all", formData.type === 'despesa' ? "bg-white text-rose-500 shadow-sm" : "text-slate-500 hover:text-slate-700")}>DESPESA</button>
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Valor *</label>
                    <MoneyInput
                      value={Number(formData.amount) || 0}
                      onChange={v => setFormData(p => ({ ...p, amount: String(v) }))}
                    />
                  </div>
                  <div>
                    <CustomDatePicker
                      label="Data"
                      value={formData.date}
                      onChange={v => setFormData(p => ({ ...p, date: v }))}
                      align="left"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Descrição *</label>
                  <input type="text" value={formData.description} onChange={e => setFormData(p => ({ ...p, description: e.target.value }))} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-200 font-medium text-sm" placeholder="Ex: Consulta Dr. João ou Material de Limpeza" />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Categoria</label>
                    <input type="text" value={formData.category} onChange={e => setFormData(p => ({ ...p, category: e.target.value }))} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-200 font-medium text-sm" placeholder="Ex: Saúde, Aluguel" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Método</label>
                    <select value={formData.payment_method} onChange={e => setFormData(p => ({ ...p, payment_method: e.target.value as any }))} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-200 font-medium text-sm">
                      <option value="pix">PIX</option>
                      <option value="cartao">Cartão</option>
                      <option value="dinheiro">Dinheiro</option>
                      <option value="plano">Plano de Saúde</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Status</label>
                  <select value={formData.status} onChange={e => setFormData(p => ({ ...p, status: e.target.value as any }))} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-200 font-medium text-sm">
                    <option value="pago text-emerald-600">Pago / Recebido</option>
                    <option value="pendente text-amber-600">Pendente</option>
                    <option value="cancelado text-slate-400">Cancelado</option>
                  </select>
                </div>
              </div>
              <div className="flex gap-3 p-6 border-t border-slate-100 bg-slate-50">
                <Button variant="outline" className="flex-1" onClick={() => setShowModal(false)}>Cancelar</Button>
                <Button className={cn("flex-1", formData.type === 'receita' ? "bg-teal-600 hover:bg-teal-700" : "bg-rose-500 hover:bg-rose-600")} onClick={handleSubmit} disabled={!formData.amount || !formData.description || submitting}>
                  {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : selectedTx ? <Edit2 className="w-4 h-4 mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
                  {selectedTx ? 'Atualizar' : 'Salvar'}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {showDeleteConfirm && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4" onClick={() => setShowDeleteConfirm(false)}>
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="bg-white rounded-xl shadow-xl w-full max-w-sm overflow-hidden" onClick={e => e.stopPropagation()}>
              <div className="p-6 text-center">
                <div className="w-12 h-12 bg-rose-50 rounded-full flex items-center justify-center mx-auto mb-4"><AlertCircle className="w-6 h-6 text-rose-600" /></div>
                <h3 className="text-xl font-bold text-slate-900 mb-2">Excluir Transação</h3>
                <p className="text-slate-500">Tem certeza que deseja excluir esta transação? Esta ação não pode ser desfeita.</p>
                {selectedTx && (
                  <div className="mt-4 p-3 bg-slate-50 rounded-lg text-sm text-left border border-slate-100">
                    <p className="font-semibold text-slate-700">{selectedTx.description}</p>
                    <p className={cn("font-bold text-xs", selectedTx.type === 'receita' ? "text-emerald-600" : "text-rose-500")}>
                      R$ {Number(selectedTx.amount).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </p>
                  </div>
                )}
              </div>
              <div className="flex gap-3 p-6 border-t border-slate-100 bg-slate-50">
                <Button variant="outline" className="flex-1" onClick={() => setShowDeleteConfirm(false)}>Cancelar</Button>
                <Button variant="destructive" className="flex-1" onClick={handleDelete} disabled={submitting}>
                  {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Trash2 className="w-4 h-4 mr-2" />}
                  Excluir
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
