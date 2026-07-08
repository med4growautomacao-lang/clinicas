import React, { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { cn } from "@/src/lib/utils";
import { Loader2, Building2, Users, CalendarCheck, Trophy, Wallet, Megaphone, ArrowUp, ArrowDown } from "lucide-react";

interface ClinicMetricRow {
  clinicId: string;
  clinicName: string;
  logoUrl: string | null;
  isActive: boolean;
  category: string | null;
  leads: number;
  appointments: number;
  sales: number;
  lost: number;
  revenue: number;
  investment: number;
}

type PeriodId = "this_month" | "last_7" | "last_30" | "last_month" | "last_90";

const PERIODS: { id: PeriodId; label: string }[] = [
  { id: "this_month", label: "Este mês" },
  { id: "last_month", label: "Mês passado" },
  { id: "last_7", label: "7 dias" },
  { id: "last_30", label: "30 dias" },
  { id: "last_90", label: "90 dias" },
];

function toISODate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function periodRange(id: PeriodId): { from: string; to: string } {
  const now = new Date();
  if (id === "this_month") {
    return { from: toISODate(new Date(now.getFullYear(), now.getMonth(), 1)), to: toISODate(now) };
  }
  if (id === "last_month") {
    return {
      from: toISODate(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
      to: toISODate(new Date(now.getFullYear(), now.getMonth(), 0)),
    };
  }
  const days = id === "last_7" ? 7 : id === "last_30" ? 30 : 90;
  const from = new Date(now);
  from.setDate(from.getDate() - (days - 1));
  return { from: toISODate(from), to: toISODate(now) };
}

function formatBRL(v: number) {
  return v.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 0,
    maximumFractionDigits: Math.abs(v) >= 1000 || v === 0 ? 0 : 2,
  });
}

type SortKey = "leads" | "appointments" | "sales" | "lost" | "conversion" | "revenue" | "investment" | "roas";

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "leads", label: "Leads" },
  { key: "appointments", label: "Agendamentos" },
  { key: "sales", label: "Ganhos" },
  { key: "lost", label: "Perdidos" },
  { key: "conversion", label: "Conversão" },
  { key: "revenue", label: "Faturamento" },
  { key: "investment", label: "Investimento" },
  { key: "roas", label: "ROAS" },
];

function metricValue(r: ClinicMetricRow, key: SortKey): number {
  if (key === "conversion") return r.leads > 0 ? r.sales / r.leads : 0;
  if (key === "roas") return r.investment > 0 ? r.revenue / r.investment : 0;
  return r[key];
}

export function OrgMetrics() {
  const [rows, setRows] = useState<ClinicMetricRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<PeriodId>("this_month");
  const [showInactive, setShowInactive] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("leads");
  const [sortDesc, setSortDesc] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { from, to } = periodRange(period);
    const { data, error } = await supabase.rpc("get_org_clinics_metrics", {
      p_date_from: from,
      p_date_to: to,
    });
    if (!error && Array.isArray(data)) {
      setRows((data as any[]).map(r => ({
        clinicId: r.clinicId,
        clinicName: r.clinicName,
        logoUrl: r.logoUrl,
        isActive: r.isActive !== false,
        category: r.category,
        leads: Number(r.leads || 0),
        appointments: Number(r.appointments || 0),
        sales: Number(r.sales || 0),
        lost: Number(r.lost || 0),
        revenue: Number(r.revenue || 0),
        investment: Number(r.investment || 0),
      })));
    }
    setLoading(false);
  }, [period]);

  useEffect(() => { load(); }, [load]);

  const visible = useMemo(
    () => rows.filter(r => showInactive || r.isActive),
    [rows, showInactive]
  );

  const sorted = useMemo(() => {
    const list = [...visible];
    list.sort((a, b) => {
      const diff = metricValue(a, sortKey) - metricValue(b, sortKey);
      if (diff !== 0) return sortDesc ? -diff : diff;
      return a.clinicName.localeCompare(b.clinicName);
    });
    return list;
  }, [visible, sortKey, sortDesc]);

  const totals = useMemo(() => {
    const t = visible.reduce(
      (acc, r) => ({
        leads: acc.leads + r.leads,
        appointments: acc.appointments + r.appointments,
        sales: acc.sales + r.sales,
        lost: acc.lost + r.lost,
        revenue: acc.revenue + r.revenue,
        investment: acc.investment + r.investment,
      }),
      { leads: 0, appointments: 0, sales: 0, lost: 0, revenue: 0, investment: 0 }
    );
    return { ...t, roas: t.investment > 0 ? t.revenue / t.investment : 0 };
  }, [visible]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDesc(d => !d);
    else { setSortKey(key); setSortDesc(true); }
  };

  const summaryCards = [
    { label: "Leads", value: totals.leads.toLocaleString("pt-BR"), Icon: Users, color: "text-violet-600 bg-violet-50" },
    { label: "Agendamentos", value: totals.appointments.toLocaleString("pt-BR"), Icon: CalendarCheck, color: "text-sky-600 bg-sky-50" },
    { label: "Ganhos", value: totals.sales.toLocaleString("pt-BR"), Icon: Trophy, color: "text-emerald-600 bg-emerald-50" },
    { label: "Faturamento", value: formatBRL(totals.revenue), Icon: Wallet, color: "text-teal-600 bg-teal-50" },
    { label: "Investimento", value: formatBRL(totals.investment), Icon: Megaphone, color: "text-amber-600 bg-amber-50" },
    { label: "ROAS", value: totals.investment > 0 ? `${totals.roas.toFixed(2)}x` : "—", Icon: Building2, color: "text-fuchsia-600 bg-fuchsia-50" },
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* Período + toggle inativas */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex bg-white p-1 rounded-xl border border-slate-200 gap-1 w-fit">
          {PERIODS.map(p => (
            <button
              key={p.id}
              onClick={() => setPeriod(p.id)}
              className={cn(
                "px-3.5 py-1.5 text-[11px] font-bold rounded-lg transition-all",
                period === p.id
                  ? "bg-violet-600 text-white shadow-sm"
                  : "text-slate-500 hover:text-slate-800 hover:bg-slate-50"
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowInactive(v => !v)}
          className={cn(
            "px-3 py-1.5 rounded-lg text-[10px] font-bold border transition-all",
            showInactive
              ? "bg-violet-600 text-white border-violet-600 shadow-sm"
              : "bg-white text-slate-600 border-slate-200 hover:border-violet-300"
          )}
        >
          {showInactive ? "Ocultar inativas" : "Mostrar inativas"}
        </button>
      </div>

      {/* Cards de totais */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {summaryCards.map(c => (
          <div key={c.label} className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <div className={cn("w-7 h-7 rounded-lg flex items-center justify-center", c.color)}>
                <c.Icon className="w-3.5 h-3.5" />
              </div>
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">{c.label}</span>
            </div>
            <span className="text-xl font-black text-slate-900 truncate">{loading ? "…" : c.value}</span>
          </div>
        ))}
      </div>

      {/* Tabela por clínica */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 text-violet-500 animate-spin" />
          </div>
        ) : sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2 text-slate-400">
            <Building2 className="w-8 h-8" />
            <span className="text-xs font-bold">Nenhuma clínica encontrada</span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-5 py-3 text-[10px] font-black uppercase tracking-wider text-slate-400">Cliente</th>
                  {COLUMNS.map(col => (
                    <th key={col.key} className="px-4 py-3 text-right">
                      <button
                        onClick={() => toggleSort(col.key)}
                        className={cn(
                          "inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider transition-colors",
                          sortKey === col.key ? "text-violet-600" : "text-slate-400 hover:text-slate-600"
                        )}
                      >
                        {col.label}
                        {sortKey === col.key && (sortDesc ? <ArrowDown className="w-3 h-3" /> : <ArrowUp className="w-3 h-3" />)}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map(r => {
                  const conversion = r.leads > 0 ? (r.sales / r.leads) * 100 : null;
                  const roas = r.investment > 0 ? r.revenue / r.investment : null;
                  return (
                    <tr key={r.clinicId} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60 transition-colors">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3 min-w-[180px]">
                          {r.logoUrl ? (
                            <img src={r.logoUrl} alt="" className="w-8 h-8 rounded-lg object-cover border border-slate-200" />
                          ) : (
                            <div className="w-8 h-8 rounded-lg bg-violet-50 border border-violet-100 flex items-center justify-center">
                              <Building2 className="w-4 h-4 text-violet-500" />
                            </div>
                          )}
                          <div className="flex flex-col">
                            <span className="text-xs font-bold text-slate-900">{r.clinicName}</span>
                            {!r.isActive && <span className="text-[9px] font-bold text-rose-500 uppercase">Inativa</span>}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right text-xs font-bold text-slate-700">{r.leads.toLocaleString("pt-BR")}</td>
                      <td className="px-4 py-3 text-right text-xs font-bold text-slate-700">{r.appointments.toLocaleString("pt-BR")}</td>
                      <td className="px-4 py-3 text-right text-xs font-bold text-emerald-600">{r.sales.toLocaleString("pt-BR")}</td>
                      <td className="px-4 py-3 text-right text-xs font-bold text-rose-500">{r.lost.toLocaleString("pt-BR")}</td>
                      <td className="px-4 py-3 text-right text-xs font-bold text-slate-700">
                        {conversion === null ? "—" : `${conversion.toFixed(1).replace(".", ",")}%`}
                      </td>
                      <td className="px-4 py-3 text-right text-xs font-bold text-slate-900">{formatBRL(r.revenue)}</td>
                      <td className="px-4 py-3 text-right text-xs font-bold text-slate-500">{formatBRL(r.investment)}</td>
                      <td className={cn(
                        "px-4 py-3 text-right text-xs font-black",
                        roas === null ? "text-slate-400" : roas >= 1 ? "text-emerald-600" : "text-rose-500"
                      )}>
                        {roas === null ? "—" : `${roas.toFixed(2).replace(".", ",")}x`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
