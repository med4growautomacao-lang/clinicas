import React, { useEffect, useState } from "react";
import { Loader2, Save, KeyRound, Check, X, Trash2, ShieldCheck } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { supabase } from "../lib/supabase";

// Painel Super Admin › Settings › "Google Ads" — credenciais OAuth do MCC (client_id,
// client_secret, refresh_token) usadas pela edge google-spend-sync para puxar o gasto diário.
//
// MESMO padrão das chaves de LLM: guardadas CRIPTOGRAFADAS no Vault; nunca exibidas de volta
// (só o status). Escrita via set_google_ads_secret (super-admin); a edge lê via
// get_google_ads_secret (service_role). NÃO usar system_settings — SELECT é público e vazaria
// o refresh_token, que dá acesso total às contas de anúncio de todas as clínicas.

type Field = "client_id" | "client_secret" | "refresh_token";

const FIELD_META: Record<Field, { label: string; hint: string }> = {
  client_id:     { label: "Client ID",     hint: "Ex.: 813014031630-xxxx.apps.googleusercontent.com" },
  client_secret: { label: "Client Secret", hint: "Segredo do app OAuth no Google Cloud" },
  refresh_token: { label: "Refresh Token", hint: "Gerado 1x pelo OAuth Playground (começa com 1//)" },
};
const FIELDS: Field[] = ["client_id", "client_secret", "refresh_token"];

export function GoogleAdsSecretsPanel() {
  const [status, setStatus] = useState<Record<Field, boolean>>({ client_id: false, client_secret: false, refresh_token: false });
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState<Record<Field, string>>({ client_id: "", client_secret: "", refresh_token: "" });
  const [saving, setSaving] = useState<Field | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const load = async () => {
    setLoading(true);
    const { data: st } = await supabase.rpc("google_ads_secrets_status");
    if (st) setStatus(st as Record<Field, boolean>);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const flash = (kind: "ok" | "err", text: string) => {
    setMsg({ kind, text });
    setTimeout(() => setMsg(null), 4000);
  };

  const saveField = async (field: Field) => {
    const value = input[field].trim();
    if (value.length < 8) { flash("err", "Valor muito curto."); return; }
    setSaving(field);
    const { error } = await supabase.rpc("set_google_ads_secret", { p_key: field, p_value: value });
    setSaving(null);
    if (error) { flash("err", `Erro ao salvar: ${error.message}`); return; }
    setInput(prev => ({ ...prev, [field]: "" }));
    setStatus(prev => ({ ...prev, [field]: true }));
    flash("ok", `${FIELD_META[field].label} salvo.`);
  };

  const removeField = async (field: Field) => {
    setSaving(field);
    const { error } = await supabase.rpc("delete_google_ads_secret", { p_key: field });
    setSaving(null);
    if (error) { flash("err", `Erro ao remover: ${error.message}`); return; }
    setStatus(prev => ({ ...prev, [field]: false }));
    flash("ok", `${FIELD_META[field].label} removido.`);
  };

  const allSet = FIELDS.every(f => status[f]);

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-10 flex items-center justify-center gap-3 text-slate-400">
        <Loader2 className="w-5 h-5 animate-spin" /> <span className="text-sm font-medium">Carregando credenciais do Google Ads…</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-black text-slate-900 flex items-center gap-2">
          Google Ads — OAuth do MCC
          <span className="text-[10px] font-black text-teal-700 bg-teal-50 border border-teal-200 rounded-md px-1.5 py-0.5 tracking-wider">GLOBAL</span>
        </h2>
        <p className="text-xs text-slate-500 mt-1">
          Credenciais OAuth do MCC usadas pela sincronização de <b>investimento</b> do Google Ads (botão em Marketing).
          Valem para todas as clínicas. O <b>developer-token</b> e o <b>ID da conta</b> ficam por clínica (em Configurações).
          {allSet
            ? <span className="text-emerald-600 font-semibold"> Tudo configurado — a sincronização do Google já pode rodar.</span>
            : <span className="text-amber-600 font-semibold"> Enquanto os 3 não estiverem preenchidos, o Google é pulado na sincronização.</span>}
        </p>
      </div>

      {msg && (
        <div className={cn(
          "flex items-start gap-2 px-3 py-2.5 rounded-xl text-sm font-medium border",
          msg.kind === "ok" ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-rose-50 border-rose-200 text-rose-700"
        )}>
          {msg.kind === "ok" ? <Check className="w-4 h-4 shrink-0 mt-0.5" /> : <X className="w-4 h-4 shrink-0 mt-0.5" />} {msg.text}
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-4">
        <div>
          <h3 className="text-sm font-black text-slate-900 flex items-center gap-2"><KeyRound className="w-4 h-4 text-slate-400" /> Credenciais OAuth</h3>
          <p className="text-xs text-slate-500 mt-1 flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
            Guardadas criptografadas no Vault do Supabase. Não são exibidas de volta — só o status.
          </p>
        </div>
        {FIELDS.map(field => {
          const isSet = status[field];
          return (
            <div key={field} className="rounded-xl border border-slate-200 bg-slate-50/50 p-3 flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="w-44 shrink-0">
                <span className="text-sm font-bold text-slate-700">{FIELD_META[field].label}</span>
                <span className={cn(
                  "mt-1 inline-flex items-center gap-1 text-[11px] font-bold",
                  isSet ? "text-emerald-600" : "text-slate-400"
                )}>
                  {isSet ? <><Check className="w-3 h-3" /> configurado</> : <><X className="w-3 h-3" /> não configurado</>}
                </span>
              </div>
              <div className="flex-1">
                <input
                  type="password"
                  value={input[field]}
                  onChange={e => setInput(prev => ({ ...prev, [field]: e.target.value }))}
                  placeholder={isSet ? "Substituir…" : "Colar valor…"}
                  autoComplete="off"
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
                />
                <p className="text-[11px] text-slate-400 mt-1">{FIELD_META[field].hint}</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => saveField(field)}
                  disabled={saving === field || input[field].trim().length < 8}
                  className="bg-slate-800 hover:bg-slate-900 disabled:opacity-40 text-white px-3 py-2 rounded-xl font-bold flex items-center gap-1.5 text-sm transition-colors"
                >
                  {saving === field ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Salvar
                </button>
                {isSet && (
                  <button
                    onClick={() => removeField(field)}
                    disabled={saving === field}
                    title="Remover"
                    className="bg-white hover:bg-rose-50 border border-slate-200 hover:border-rose-200 text-rose-600 px-3 py-2 rounded-xl font-bold flex items-center transition-colors disabled:opacity-40"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
