import React, { useEffect, useState } from "react";
import { Loader2, Save, Check, X, Clock, CalendarClock, Power } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { supabase } from "../lib/supabase";

// Painel Super Admin › Configurações › (Investimento) — agendamento da sincronização automática
// de investimento (Meta + Google) em TODAS as clínicas. Config em system_settings
// ('ad_spend_sync_config'); escrita via RPC set_ad_spend_sync_config (super-admin). O trabalho é
// feito pela edge spend-sync-cron (pg_cron a cada 15 min, que decide se "está na hora").

type Config = {
  enabled: boolean;
  every_hours: number;
  run_hour_sp: number;
  lookback_days: number;
  platforms: string[];
  batch_size: number;
};

const DEFAULT: Config = { enabled: false, every_hours: 24, run_hour_sp: 5, lookback_days: 1, platforms: ["meta_ads", "google_ads"], batch_size: 300 };

const EVERY_OPTIONS = [
  { h: 24, label: "1× por dia" },
  { h: 12, label: "A cada 12h" },
  { h: 6, label: "A cada 6h" },
  { h: 3, label: "A cada 3h" },
  { h: 1, label: "A cada 1h" },
];
const LOOKBACK_OPTIONS = [
  { d: 1, label: "Ontem + hoje" },
  { d: 3, label: "Últimos 3 dias" },
  { d: 7, label: "Últimos 7 dias" },
];

export function SpendSyncConfigPanel() {
  const [cfg, setCfg] = useState<Config>(DEFAULT);
  const [lastRun, setLastRun] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const load = async () => {
    setLoading(true);
    const [{ data: c }, { data: s }] = await Promise.all([
      supabase.from("system_settings").select("value").eq("id", "ad_spend_sync_config").maybeSingle(),
      supabase.from("system_settings").select("value").eq("id", "ad_spend_sync_state").maybeSingle(),
    ]);
    if (c?.value) { try { setCfg({ ...DEFAULT, ...JSON.parse(c.value) }); } catch { /* default */ } }
    if (s?.value) { try { setLastRun(JSON.parse(s.value)?.last_run_at ?? null); } catch { /* — */ } }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const flash = (kind: "ok" | "err", text: string) => { setMsg({ kind, text }); setTimeout(() => setMsg(null), 4000); };

  const save = async () => {
    setSaving(true);
    const { error } = await supabase.rpc("set_ad_spend_sync_config", { p_config: cfg });
    setSaving(false);
    if (error) { flash("err", `Erro ao salvar: ${error.message}`); return; }
    flash("ok", "Configuração salva.");
  };

  const togglePlatform = (p: string) =>
    setCfg(prev => ({ ...prev, platforms: prev.platforms.includes(p) ? prev.platforms.filter(x => x !== p) : [...prev.platforms, p] }));

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-10 flex items-center justify-center gap-3 text-slate-400">
        <Loader2 className="w-5 h-5 animate-spin" /> <span className="text-sm font-medium">Carregando agendamento…</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-black text-slate-900 flex items-center gap-2">
          Sincronização automática de investimento
          <span className="text-[10px] font-black text-teal-700 bg-teal-50 border border-teal-200 rounded-md px-1.5 py-0.5 tracking-wider">GLOBAL</span>
        </h2>
        <p className="text-xs text-slate-500 mt-1">
          Puxa o gasto de <b>Meta</b> e <b>Google Ads</b> de todas as clínicas automaticamente e grava em Marketing.
          Substitui os fluxos do n8n. Contas com token inválido são registradas na Central de Erros e não travam as demais.
          {lastRun && <> Última rodada completa: <b>{new Date(lastRun).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</b>.</>}
        </p>
      </div>

      {msg && (
        <div className={cn("flex items-start gap-2 px-3 py-2.5 rounded-xl text-sm font-medium border",
          msg.kind === "ok" ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-rose-50 border-rose-200 text-rose-700")}>
          {msg.kind === "ok" ? <Check className="w-4 h-4 shrink-0 mt-0.5" /> : <X className="w-4 h-4 shrink-0 mt-0.5" />} {msg.text}
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-5">
        {/* Liga/desliga */}
        <button
          onClick={() => setCfg(prev => ({ ...prev, enabled: !prev.enabled }))}
          className={cn("w-full flex items-center justify-between rounded-xl border p-3 transition-all",
            cfg.enabled ? "border-emerald-300 bg-emerald-50/50" : "border-slate-200 bg-white")}
        >
          <span className="flex items-center gap-2 text-sm font-bold text-slate-700">
            <Power className={cn("w-4 h-4", cfg.enabled ? "text-emerald-600" : "text-slate-400")} />
            {cfg.enabled ? "Ativada" : "Desativada"}
          </span>
          <span className={cn("relative w-10 h-6 rounded-full transition-colors", cfg.enabled ? "bg-emerald-500" : "bg-slate-300")}>
            <span className={cn("absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform", cfg.enabled && "translate-x-4")} />
          </span>
        </button>

        {/* Cadência */}
        <div>
          <label className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5 mb-2"><Clock className="w-3.5 h-3.5" /> Frequência</label>
          <div className="flex flex-wrap gap-2">
            {EVERY_OPTIONS.map(o => (
              <button key={o.h} onClick={() => setCfg(prev => ({ ...prev, every_hours: o.h }))}
                className={cn("px-3 py-1.5 rounded-xl border text-[11px] font-bold transition-all",
                  cfg.every_hours === o.h ? "border-teal-500 bg-teal-50 text-teal-700" : "border-slate-200 text-slate-500 hover:border-slate-300")}>
                {o.label}
              </button>
            ))}
          </div>
        </div>

        {/* Horário fixo (só relevante em 1×/dia) */}
        {cfg.every_hours >= 24 && (
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5 mb-2"><Clock className="w-3.5 h-3.5" /> Horário da rodada (horário de Brasília)</label>
            <select
              value={cfg.run_hour_sp}
              onChange={e => setCfg(prev => ({ ...prev, run_hour_sp: Number(e.target.value) }))}
              className="px-3 py-2 border border-slate-200 rounded-xl text-sm font-medium text-slate-700 focus:ring-2 focus:ring-teal-100 focus:border-teal-400 outline-none"
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>
              ))}
            </select>
            <p className="text-[11px] text-slate-400 mt-1">Recomendado de madrugada (ex.: 05:00) — o dia anterior já fechou, então o gasto de ontem entra completo.</p>
          </div>
        )}

        {/* Lookback */}
        <div>
          <label className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5 mb-2"><CalendarClock className="w-3.5 h-3.5" /> Dias re-sincronizados por rodada</label>
          <div className="flex flex-wrap gap-2">
            {LOOKBACK_OPTIONS.map(o => (
              <button key={o.d} onClick={() => setCfg(prev => ({ ...prev, lookback_days: o.d }))}
                className={cn("px-3 py-1.5 rounded-xl border text-[11px] font-bold transition-all",
                  cfg.lookback_days === o.d ? "border-teal-500 bg-teal-50 text-teal-700" : "border-slate-200 text-slate-500 hover:border-slate-300")}>
                {o.label}
              </button>
            ))}
          </div>
        </div>

        {/* Plataformas */}
        <div>
          <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">Plataformas</label>
          <div className="flex gap-2">
            {[{ id: "meta_ads", label: "Meta Ads" }, { id: "google_ads", label: "Google Ads" }].map(p => (
              <button key={p.id} onClick={() => togglePlatform(p.id)}
                className={cn("px-3 py-1.5 rounded-xl border text-[11px] font-bold transition-all flex items-center gap-1.5",
                  cfg.platforms.includes(p.id) ? "border-teal-500 bg-teal-50 text-teal-700" : "border-slate-200 text-slate-400 hover:border-slate-300")}>
                {cfg.platforms.includes(p.id) && <Check className="w-3 h-3" />} {p.label}
              </button>
            ))}
          </div>
        </div>

        {cfg.every_hours < 24 && cfg.platforms.includes("google_ads") && (
          <p className="text-[11px] text-amber-600 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
            ⚠️ Rodadas mais frequentes que 1×/dia no Google exigem <b>Standard access</b> no developer token (Basic = 15.000 operações/dia).
          </p>
        )}

        <div className="flex justify-end pt-1">
          <button onClick={save} disabled={saving}
            className="bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white px-4 py-2 rounded-xl font-bold flex items-center gap-2 text-sm transition-colors shadow-sm">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Salvar agendamento
          </button>
        </div>
      </div>
    </div>
  );
}
