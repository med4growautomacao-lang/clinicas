import React, { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { Check, ChevronDown, FileText, Loader2 } from "lucide-react";

// Configuração dos RELATÓRIOS AUTOMÁTICOS por clínica (aba Configurações da org).
// Quem envia é o WhatsApp da ORGANIZAÇÃO (card acima). Aqui a org define, por
// clínica: destinatários (números), cadência (diário/semanal), dia/hora, tipo e
// janela. Persistido em report_settings; o cron run_scheduled_reports lê daqui.

interface RowSettings {
  clinic_id: string;
  recipients: string;        // no formulário: números separados por vírgula
  schedule_enabled: boolean;
  cadence: "daily" | "weekly";
  send_weekday: number;
  send_hour: number;
  kind: "completo" | "geral" | "ia" | "humano";
  period_days: number;
}

const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const KINDS = [
  { value: "completo", label: "Completo" },
  { value: "geral", label: "Somente Geral" },
  { value: "ia", label: "Somente IA" },
  { value: "humano", label: "Somente Humano" },
];

const DEFAULT_ROW = (clinicId: string): RowSettings => ({
  clinic_id: clinicId, recipients: "", schedule_enabled: false,
  cadence: "weekly", send_weekday: 1, send_hour: 8, kind: "completo", period_days: 7,
});

export function OrgReportSettings({ clinics, canManage }: {
  clinics: { id: string; name: string }[];
  canManage: boolean;
}) {
  const [rows, setRows] = useState<Record<string, RowSettings>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (clinics.length === 0) { setLoading(false); return; }
    const { data } = await supabase
      .from("report_settings")
      .select("*")
      .in("clinic_id", clinics.map((c) => c.id));
    const map: Record<string, RowSettings> = {};
    clinics.forEach((c) => { map[c.id] = DEFAULT_ROW(c.id); });
    (data || []).forEach((r: any) => {
      map[r.clinic_id] = {
        clinic_id: r.clinic_id,
        recipients: (r.recipients || []).join(", "),
        schedule_enabled: !!r.schedule_enabled,
        cadence: r.cadence, send_weekday: r.send_weekday, send_hour: r.send_hour,
        kind: r.kind, period_days: r.period_days,
      };
    });
    setRows(map);
    setLoading(false);
  }, [clinics]);

  useEffect(() => { load(); }, [load]);

  const save = async (clinicId: string) => {
    const r = rows[clinicId];
    if (!r) return;
    setSavingId(clinicId);
    try {
      const recipients = r.recipients.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
      const { error } = await supabase.from("report_settings").upsert({
        clinic_id: clinicId,
        recipients,
        schedule_enabled: r.schedule_enabled,
        cadence: r.cadence,
        send_weekday: r.send_weekday,
        send_hour: r.send_hour,
        kind: r.kind,
        period_days: r.period_days,
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
      setSavedId(clinicId);
      setTimeout(() => setSavedId((id) => (id === clinicId ? null : id)), 2000);
    } catch (e) {
      console.error("report_settings save error:", e);
      alert("Não foi possível salvar. Verifique sua permissão e tente novamente.");
    } finally {
      setSavingId(null);
    }
  };

  const set = (clinicId: string, patch: Partial<RowSettings>) =>
    setRows((prev) => ({ ...prev, [clinicId]: { ...(prev[clinicId] ?? DEFAULT_ROW(clinicId)), ...patch } }));

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-6 flex items-center gap-3">
        <Loader2 className="w-4 h-4 animate-spin text-teal-600" />
        <span className="text-sm text-slate-500">Carregando relatórios automáticos...</span>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-3">
        <div className="w-8 h-8 bg-teal-50 rounded-lg flex items-center justify-center">
          <FileText className="w-4 h-4 text-teal-600" />
        </div>
        <div>
          <p className="text-sm font-bold text-slate-800">Relatórios automáticos</p>
          <p className="text-xs text-slate-400">Enviados pelo WhatsApp da organização aos destinatários de cada clínica</p>
        </div>
      </div>

      <div className="divide-y divide-slate-100">
        {clinics.map((c) => {
          const r = rows[c.id] ?? DEFAULT_ROW(c.id);
          const isOpen = openId === c.id;
          const summary = r.schedule_enabled
            ? `${r.cadence === "daily" ? "Diário" : WEEKDAYS[r.send_weekday]} às ${String(r.send_hour).padStart(2, "0")}h`
            : "Desativado";
          return (
            <div key={c.id}>
              <button
                onClick={() => setOpenId(isOpen ? null : c.id)}
                className="w-full flex items-center justify-between px-6 py-3.5 hover:bg-slate-50 transition-colors text-left"
              >
                <span className="text-sm font-bold text-slate-700">{c.name}</span>
                <span className="flex items-center gap-2 text-xs font-semibold">
                  <span className={r.schedule_enabled ? "text-emerald-600" : "text-slate-400"}>{summary}</span>
                  <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                </span>
              </button>

              {isOpen && (
                <div className="px-6 pb-5 space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                      Destinatários (números com DDD, separados por vírgula)
                    </label>
                    <input
                      type="text"
                      disabled={!canManage}
                      value={r.recipients}
                      onChange={(e) => set(c.id, { recipients: e.target.value })}
                      placeholder="Ex: 47 99999-8888, 11 98888-7777"
                      className="w-full px-3.5 py-2 border border-slate-200 rounded-xl text-sm text-slate-700 placeholder:text-slate-400 focus:ring-2 focus:ring-teal-100 focus:border-teal-400 outline-none transition-all disabled:bg-slate-50"
                    />
                  </div>

                  <div className="flex flex-wrap items-end gap-3">
                    <label className="flex items-center gap-2 pb-2 cursor-pointer">
                      <input
                        type="checkbox"
                        disabled={!canManage}
                        checked={r.schedule_enabled}
                        onChange={(e) => set(c.id, { schedule_enabled: e.target.checked })}
                        className="w-4 h-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                      />
                      <span className="text-xs font-bold text-slate-600">Envio automático</span>
                    </label>

                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-400 uppercase">Cadência</label>
                      <select
                        disabled={!canManage}
                        value={r.cadence}
                        onChange={(e) => set(c.id, { cadence: e.target.value as any })}
                        className="block px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 bg-white"
                      >
                        <option value="weekly">Semanal</option>
                        <option value="daily">Diário</option>
                      </select>
                    </div>

                    {r.cadence === "weekly" && (
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-slate-400 uppercase">Dia</label>
                        <select
                          disabled={!canManage}
                          value={r.send_weekday}
                          onChange={(e) => set(c.id, { send_weekday: Number(e.target.value) })}
                          className="block px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 bg-white"
                        >
                          {WEEKDAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
                        </select>
                      </div>
                    )}

                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-400 uppercase">Hora</label>
                      <select
                        disabled={!canManage}
                        value={r.send_hour}
                        onChange={(e) => set(c.id, { send_hour: Number(e.target.value) })}
                        className="block px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 bg-white"
                      >
                        {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")}h</option>)}
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-400 uppercase">Tipo</label>
                      <select
                        disabled={!canManage}
                        value={r.kind}
                        onChange={(e) => set(c.id, { kind: e.target.value as any })}
                        className="block px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 bg-white"
                      >
                        {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-400 uppercase">Janela</label>
                      <select
                        disabled={!canManage}
                        value={r.period_days}
                        onChange={(e) => set(c.id, { period_days: Number(e.target.value) })}
                        className="block px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 bg-white"
                      >
                        <option value={1}>Último dia</option>
                        <option value={7}>Últimos 7 dias</option>
                        <option value={14}>Últimos 14 dias</option>
                        <option value={30}>Últimos 30 dias</option>
                      </select>
                    </div>

                    {canManage && (
                      <button
                        onClick={() => save(c.id)}
                        disabled={savingId === c.id}
                        className="flex items-center gap-1.5 px-4 py-2 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl transition-all"
                      >
                        {savingId === c.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : savedId === c.id ? <Check className="w-3.5 h-3.5" /> : null}
                        {savedId === c.id ? "Salvo!" : "Salvar"}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
