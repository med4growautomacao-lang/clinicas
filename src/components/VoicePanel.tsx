import React, { useEffect, useState } from "react";
import { Loader2, Save, Check, X, KeyRound, Mic, ShieldCheck, Trash2 } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { supabase } from "../lib/supabase";

// Painel Super Admin › Settings › "Voz do Agente" — resposta em ÁUDIO (ElevenLabs) quando o
// paciente manda áudio no WhatsApp. Config em system_settings id='elevenlabs_config' via RPC
// set_elevenlabs_config; chave no Vault (set_llm_secret 'elevenlabs'). O worker do agente tem
// FALLBACK automático para texto se estiver desligado, sem chave/voice_id, ou se o TTS falhar
// (ex.: acabou o crédito) — o paciente nunca fica sem resposta.

interface Cfg { enabled: boolean; voice_id: string; model_id: string }
const DEFAULT_CFG: Cfg = { enabled: false, voice_id: "", model_id: "eleven_multilingual_v2" };

export function VoicePanel() {
  const [config, setConfig] = useState<Cfg>(DEFAULT_CFG);
  const [hasKey, setHasKey] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingKey, setSavingKey] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err" | "warn"; text: string } | null>(null);

  const load = async () => {
    setLoading(true);
    const [{ data: row }, { data: st }] = await Promise.all([
      supabase.from("system_settings").select("value").eq("id", "elevenlabs_config").maybeSingle(),
      supabase.rpc("llm_secrets_status"),
    ]);
    if (row?.value) {
      try {
        const c = JSON.parse(row.value);
        setConfig({ enabled: !!c.enabled, voice_id: c.voice_id ?? "", model_id: c.model_id ?? "eleven_multilingual_v2" });
      } catch { /* default */ }
    }
    if (st) setHasKey(!!(st as any).elevenlabs);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const flash = (kind: "ok" | "err" | "warn", text: string) => {
    setMsg({ kind, text });
    setTimeout(() => setMsg(null), kind === "warn" ? 7000 : 4000);
  };

  const saveConfig = async () => {
    setSaving(true);
    const { error } = await supabase.rpc("set_elevenlabs_config", { p_config: config });
    setSaving(false);
    if (error) { flash("err", `Erro ao salvar: ${error.message}`); return; }
    if (config.enabled && !hasKey) flash("warn", "Salvo, mas sem chave do ElevenLabs no Vault — o agente vai responder em TEXTO até você cadastrar a chave abaixo.");
    else if (config.enabled && !config.voice_id.trim()) flash("warn", "Salvo, mas sem voice_id — sem uma voz escolhida o agente responde em texto.");
    else flash("ok", "Configuração de voz salva.");
  };

  const saveKey = async () => {
    const value = keyInput.trim();
    if (value.length < 8) { flash("err", "Chave muito curta."); return; }
    setSavingKey(true);
    const { error } = await supabase.rpc("set_llm_secret", { p_provider: "elevenlabs", p_value: value });
    setSavingKey(false);
    if (error) { flash("err", `Erro ao salvar chave: ${error.message}`); return; }
    setKeyInput("");
    setHasKey(true);
    flash("ok", "Chave ElevenLabs salva.");
  };

  const removeKey = async () => {
    setSavingKey(true);
    const { error } = await supabase.rpc("delete_llm_secret", { p_provider: "elevenlabs" });
    setSavingKey(false);
    if (error) { flash("err", `Erro ao remover chave: ${error.message}`); return; }
    setHasKey(false);
    flash("ok", "Chave ElevenLabs removida.");
  };

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-10 flex items-center justify-center gap-3 text-slate-400">
        <Loader2 className="w-5 h-5 animate-spin" /> <span className="text-sm font-medium">Carregando config de voz…</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-black text-slate-900 flex items-center gap-2">
          <Mic className="w-4 h-4 text-violet-500" /> Voz do Agente (ElevenLabs)
          <span className="text-[10px] font-black text-teal-700 bg-teal-50 border border-teal-200 rounded-md px-1.5 py-0.5 tracking-wider">GLOBAL</span>
        </h2>
        <p className="text-xs text-slate-500 mt-1">
          Quando <b>ligado</b>, o agente responde em <b>áudio</b> ao paciente que mandar áudio no WhatsApp.
          Se estiver desligado, sem chave, sem voz escolhida, ou se o áudio falhar (ex.: acabou o crédito),
          ele responde em <b>texto</b> automaticamente — o paciente nunca fica sem resposta.
        </p>
      </div>

      {msg && (
        <div className={cn(
          "flex items-start gap-2 px-3 py-2.5 rounded-xl text-sm font-medium border",
          msg.kind === "ok" ? "bg-emerald-50 border-emerald-200 text-emerald-700"
            : msg.kind === "warn" ? "bg-amber-50 border-amber-200 text-amber-700"
            : "bg-rose-50 border-rose-200 text-rose-700"
        )}>
          {msg.kind === "ok" ? <Check className="w-4 h-4 shrink-0 mt-0.5" /> : msg.kind === "warn" ? <KeyRound className="w-4 h-4 shrink-0 mt-0.5" /> : <X className="w-4 h-4 shrink-0 mt-0.5" />} {msg.text}
        </div>
      )}

      {/* Config */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-4">
        <label className="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" checked={config.enabled}
            onChange={(e) => setConfig((c) => ({ ...c, enabled: e.target.checked }))}
            className="w-5 h-5 accent-teal-600" />
          <span className="text-sm font-bold text-slate-700">Responder em voz quando o paciente mandar áudio</span>
        </label>

        <div>
          <label className="text-xs font-bold text-slate-600">Voice ID (ElevenLabs)</label>
          <input type="text" value={config.voice_id}
            onChange={(e) => setConfig((c) => ({ ...c, voice_id: e.target.value }))}
            placeholder="ex.: 21m00Tcm4TlvDq8ikWAM"
            className="mt-1 w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500" />
          <p className="text-[11px] text-slate-400 mt-1">O ID da voz que você escolheu no painel do ElevenLabs (aba Voices).</p>
        </div>

        <div>
          <label className="text-xs font-bold text-slate-600">Modelo</label>
          <input type="text" value={config.model_id}
            onChange={(e) => setConfig((c) => ({ ...c, model_id: e.target.value }))}
            placeholder="eleven_multilingual_v2"
            className="mt-1 w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500" />
          <p className="text-[11px] text-slate-400 mt-1">Padrão <code>eleven_multilingual_v2</code> (bom para português). Deixe assim se não souber.</p>
        </div>

        <div className="flex justify-end">
          <button onClick={saveConfig} disabled={saving}
            className="bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white px-4 py-2 rounded-xl font-bold flex items-center gap-2 text-sm transition-colors shadow-sm">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Salvar
          </button>
        </div>
      </div>

      {/* Chave */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-3">
        <div>
          <h3 className="text-sm font-black text-slate-900 flex items-center gap-2"><KeyRound className="w-4 h-4 text-slate-400" /> Chave de API do ElevenLabs</h3>
          <p className="text-xs text-slate-500 mt-1 flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
            Guardada criptografada no Vault. Não é exibida de volta, só o status.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <span className={cn("inline-flex items-center gap-1 text-[11px] font-bold w-32 shrink-0", hasKey ? "text-emerald-600" : "text-slate-400")}>
            {hasKey ? <><Check className="w-3 h-3" /> configurada</> : <><X className="w-3 h-3" /> não configurada</>}
          </span>
          <input type="password" value={keyInput} onChange={(e) => setKeyInput(e.target.value)}
            placeholder={hasKey ? "Substituir chave…" : "Colar chave de API…"} autoComplete="off"
            className="flex-1 px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500" />
          <div className="flex gap-2">
            <button onClick={saveKey} disabled={savingKey || keyInput.trim().length < 8}
              className="bg-slate-800 hover:bg-slate-900 disabled:opacity-40 text-white px-3 py-2 rounded-xl font-bold flex items-center gap-1.5 text-sm transition-colors">
              {savingKey ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Salvar
            </button>
            {hasKey && (
              <button onClick={removeKey} disabled={savingKey} title="Remover chave"
                className="bg-white hover:bg-rose-50 border border-slate-200 hover:border-rose-200 text-rose-600 px-3 py-2 rounded-xl font-bold flex items-center transition-colors disabled:opacity-40">
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
