import React, { useEffect, useState } from "react";
import { Loader2, Save, Check, X, KeyRound, Bot, Sparkles, Gauge, DollarSign } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { supabase } from "../lib/supabase";

// Painel Super Admin › Settings › "Modelo do Agente" — escolhe o LLM que RESPONDE no WhatsApp
// (edge ai-agent-worker). Config em system_settings id='agent_ai_config' via RPC set_agent_ai_config.
// As chaves de API sao as MESMAS do Vault da aba "IA de Mídia" (set_llm_secret) — aqui so mostramos
// o status e avisamos se faltar a chave do provider escolhido. Vale para TODAS as clinicas com IA.

type Provider = "gemini" | "anthropic" | "openai";
type Spec = { provider: Provider; model: string };
type Config = { provider: Provider; model: string; temperature: number; fallback: Spec | null };

const PROVIDER_LABEL: Record<Provider, string> = {
  gemini: "Google Gemini",
  anthropic: "Anthropic (Claude)",
  openai: "OpenAI",
};

// Opcoes curadas (provider+model). O "Atual" e o modelo que a Lorena usa hoje no n8n (paridade).
type Opt = { id: string; label: string; provider: Provider; model: string; hint: string; icon: typeof Bot; color: string };
const OPTIONS: Opt[] = [
  { id: "gemini-pro", label: "Gemini Pro (atual)", provider: "gemini", model: "gemini-3.1-pro-preview-customtools", hint: "O que a Lorena usa hoje. Bom raciocinio + tool-calling.", icon: Sparkles, color: "text-violet-600 bg-violet-50 border-violet-200" },
  { id: "gemini-flash", label: "Gemini Flash", provider: "gemini", model: "gemini-3.1-flash-lite", hint: "Mais rapido e barato. Conversas simples.", icon: DollarSign, color: "text-emerald-600 bg-emerald-50 border-emerald-200" },
  { id: "claude-sonnet", label: "Claude Sonnet 5", provider: "anthropic", model: "claude-sonnet-5", hint: "Equilibrio forte de qualidade e custo.", icon: Gauge, color: "text-teal-600 bg-teal-50 border-teal-200" },
  { id: "claude-opus", label: "Claude Opus 4.8", provider: "anthropic", model: "claude-opus-4-8", hint: "O mais capaz para casos dificeis.", icon: Bot, color: "text-amber-600 bg-amber-50 border-amber-200" },
];

const DEFAULT_CONFIG: Config = { provider: "gemini", model: "gemini-3.1-pro-preview-customtools", temperature: 0.6, fallback: null };

function optOf(spec: Spec): Opt | undefined {
  return OPTIONS.find((o) => o.provider === spec.provider && o.model === spec.model);
}

export function AgentAIPanel() {
  const [config, setConfig] = useState<Config>(DEFAULT_CONFIG);
  const [status, setStatus] = useState<Record<Provider, boolean>>({ gemini: false, anthropic: false, openai: false });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err" | "warn"; text: string } | null>(null);

  const load = async () => {
    setLoading(true);
    const [{ data: row }, { data: st }] = await Promise.all([
      supabase.from("system_settings").select("value").eq("id", "agent_ai_config").maybeSingle(),
      supabase.rpc("llm_secrets_status"),
    ]);
    if (row?.value) {
      try {
        const c = JSON.parse(row.value);
        setConfig({
          provider: c.provider ?? DEFAULT_CONFIG.provider,
          model: c.model ?? DEFAULT_CONFIG.model,
          temperature: Number(c.temperature ?? 0.6),
          fallback: c.fallback ?? null,
        });
      } catch { /* mantem default */ }
    }
    if (st) setStatus(st as Record<Provider, boolean>);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const flash = (kind: "ok" | "err" | "warn", text: string) => {
    setMsg({ kind, text });
    setTimeout(() => setMsg(null), kind === "warn" ? 7000 : 4000);
  };

  const pick = (o: Opt) => setConfig((prev) => ({ ...prev, provider: o.provider, model: o.model }));
  const pickFallback = (o: Opt | null) =>
    setConfig((prev) => ({ ...prev, fallback: o ? { provider: o.provider, model: o.model } : null }));

  const save = async () => {
    setSaving(true);
    const { error } = await supabase.rpc("set_agent_ai_config", { p_config: config });
    setSaving(false);
    if (error) { flash("err", `Erro ao salvar: ${error.message}`); return; }
    if (!status[config.provider]) {
      flash("warn", `Configuracao salva, mas nao ha chave de ${PROVIDER_LABEL[config.provider]} no Vault. Cadastre-a na aba "IA de Mídia" ou o agente nao respondera.`);
    } else {
      flash("ok", "Modelo do agente salvo.");
    }
  };

  const selected = optOf({ provider: config.provider, model: config.model });

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-10 flex items-center justify-center gap-3 text-slate-400">
        <Loader2 className="w-5 h-5 animate-spin" /> <span className="text-sm font-medium">Carregando modelo do agente…</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-black text-slate-900 flex items-center gap-2">
          Modelo do Agente IA
          <span className="text-[10px] font-black text-teal-700 bg-teal-50 border border-teal-200 rounded-md px-1.5 py-0.5 tracking-wider">GLOBAL</span>
        </h2>
        <p className="text-xs text-slate-500 mt-1">
          Qual LLM <b>responde</b> ao paciente no WhatsApp (edge <code>ai-agent</code>). Vale para todas as
          clinicas com IA. As chaves de API sao as mesmas da aba <b>IA de Mídia</b>.
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

      {/* Modelo principal */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-4">
        <span className="text-sm font-bold text-slate-700">Modelo principal</span>
        {selected === undefined && (
          <span className="ml-2 text-[10px] font-bold text-amber-600 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
            personalizado: {config.provider}/{config.model}
          </span>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {OPTIONS.map((o) => {
            const isSel = selected?.id === o.id;
            const Icon = o.icon;
            const needsKey = !status[o.provider];
            return (
              <button key={o.id} type="button" onClick={() => pick(o)}
                className={cn("text-left rounded-xl border p-3 transition-all relative",
                  isSel ? "border-teal-500 ring-2 ring-teal-500/20 bg-teal-50/40" : "border-slate-200 hover:border-slate-300 bg-white")}>
                {isSel && <Check className="w-4 h-4 text-teal-600 absolute top-2.5 right-2.5" />}
                <span className={cn("inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded border", o.color)}>
                  <Icon className="w-3 h-3" /> {o.label}
                </span>
                <p className="text-sm font-bold text-slate-800 mt-2">{PROVIDER_LABEL[o.provider]}</p>
                <p className="text-[11px] font-mono text-slate-500 truncate">{o.model}</p>
                <p className="text-[11px] text-slate-500 mt-1 leading-snug">{o.hint}</p>
                {needsKey && (
                  <p className="text-[10px] font-bold text-amber-600 mt-1.5 flex items-center gap-1">
                    <KeyRound className="w-3 h-3" /> sem chave no Vault
                  </p>
                )}
              </button>
            );
          })}
        </div>

        {/* Temperatura */}
        <div className="flex items-center gap-3 pt-1">
          <span className="text-sm font-bold text-slate-700 w-28">Temperatura</span>
          <input type="range" min={0} max={1} step={0.05} value={config.temperature}
            onChange={(e) => setConfig((p) => ({ ...p, temperature: Number(e.target.value) }))}
            className="flex-1 accent-teal-600" />
          <span className="text-sm font-mono text-slate-600 w-10 text-right">{config.temperature.toFixed(2)}</span>
        </div>

        {/* Fallback */}
        <div className="flex items-center gap-3">
          <span className="text-sm font-bold text-slate-700 w-28">Fallback</span>
          <select
            value={config.fallback ? (optOf(config.fallback)?.id ?? "") : ""}
            onChange={(e) => pickFallback(OPTIONS.find((o) => o.id === e.target.value) ?? null)}
            className="flex-1 px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500">
            <option value="">Nenhum (so tenta o principal)</option>
            {OPTIONS.filter((o) => !(o.provider === config.provider && o.model === config.model)).map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
        </div>
        <p className="text-[11px] text-slate-400">Se o modelo principal falhar (erro/indisponivel), o agente tenta o fallback antes de desistir.</p>

        <div className="flex justify-end pt-1">
          <button onClick={save} disabled={saving}
            className="bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white px-4 py-2 rounded-xl font-bold flex items-center gap-2 text-sm transition-colors shadow-sm">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Salvar
          </button>
        </div>
      </div>

      {/* Status das chaves (gerenciadas na aba IA de Mídia) */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs font-bold text-slate-600">Chaves no Vault:</span>
          {(["gemini", "anthropic"] as Provider[]).map((p) => (
            <span key={p} className={cn("inline-flex items-center gap-1 text-[11px] font-bold", status[p] ? "text-emerald-600" : "text-slate-400")}>
              {status[p] ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />} {PROVIDER_LABEL[p]}
            </span>
          ))}
          <span className="text-[11px] text-slate-400">Gerencie as chaves na aba “IA de Mídia”.</span>
        </div>
      </div>
    </div>
  );
}
