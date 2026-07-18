import React, { useEffect, useState } from "react";
import { Loader2, Save, KeyRound, Check, X, Trash2, Mic, Image as ImageIcon, ShieldCheck, DollarSign, Gauge, Sparkles } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { supabase } from "../lib/supabase";

// Painel Super Admin › Settings › "IA de Mídia" — escolhe qual LLM transcreve o
// ÁUDIO e qual descreve a IMAGEM recebida (usado pela edge wa-inbound), e gerencia
// as chaves de API (guardadas no Vault; write-only — nunca exibidas de volta).
//
// A escolha é por TIER (3 opções por tipo): econômica / custo-benefício / avançada.
// Cada tier é um par provider+model fixo. Config: system_settings id='media_ai_config'
// via RPC set_media_ai_config. Chaves: set_llm_secret / delete_llm_secret /
// llm_secrets_status (Vault).

type Provider = "gemini" | "anthropic" | "openai";
type Spec = { provider: Provider; model: string };
type Config = { audio: Spec; image: Spec };
type TierId = "economica" | "custo" | "avancada";

type Tier = { id: TierId; provider: Provider; model: string; hint: string };

const PROVIDER_LABEL: Record<Provider, string> = {
  gemini: "Google Gemini",
  anthropic: "Anthropic (Claude)",
  openai: "OpenAI",
};

const TIER_META: Record<TierId, { label: string; icon: typeof DollarSign; color: string }> = {
  economica: { label: "Econômica", icon: DollarSign, color: "text-emerald-600 bg-emerald-50 border-emerald-200" },
  custo:     { label: "Custo-benefício", icon: Gauge, color: "text-teal-600 bg-teal-50 border-teal-200" },
  avancada:  { label: "Avançada", icon: Sparkles, color: "text-violet-600 bg-violet-50 border-violet-200" },
};

// 3 opções por tipo. Áudio: Claude não transcreve áudio → Gemini/OpenAI.
const TIERS: Record<"audio" | "image", Tier[]> = {
  audio: [
    { id: "economica", provider: "gemini", model: "gemini-2.0-flash",        hint: "Mais barata. Transcreve nativo, rápida." },
    { id: "custo",     provider: "openai", model: "gpt-4o-mini-transcribe",  hint: "Boa precisão por baixo custo." },
    { id: "avancada",  provider: "openai", model: "gpt-4o-transcribe",       hint: "Máxima precisão de transcrição." },
  ],
  image: [
    { id: "economica", provider: "gemini",    model: "gemini-2.0-flash",  hint: "Mais barata. Descrição/OCR rápida." },
    { id: "custo",     provider: "anthropic", model: "claude-haiku-4-5",  hint: "Ótima leitura de documento/exame." },
    { id: "avancada",  provider: "anthropic", model: "claude-sonnet-4-6", hint: "Visão mais capaz p/ casos difíceis." },
  ],
};

const DEFAULT_CONFIG: Config = {
  audio: { provider: "gemini", model: "gemini-2.0-flash" },
  image: { provider: "anthropic", model: "claude-haiku-4-5" },
};

// tier atualmente selecionado (match exato provider+model), ou null se personalizado
function currentTier(which: "audio" | "image", spec: Spec): TierId | null {
  const t = TIERS[which].find(t => t.provider === spec.provider && t.model === spec.model);
  return t ? t.id : null;
}

export function MediaAIPanel() {
  const [config, setConfig] = useState<Config>(DEFAULT_CONFIG);
  const [status, setStatus] = useState<Record<Provider, boolean>>({ gemini: false, anthropic: false, openai: false });
  const [loading, setLoading] = useState(true);
  const [savingCfg, setSavingCfg] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err" | "warn"; text: string } | null>(null);

  const [keyInput, setKeyInput] = useState<Record<Provider, string>>({ gemini: "", anthropic: "", openai: "" });
  const [savingKey, setSavingKey] = useState<Provider | null>(null);

  const load = async () => {
    setLoading(true);
    const [{ data: row }, { data: st }] = await Promise.all([
      supabase.from("system_settings").select("value").eq("id", "media_ai_config").maybeSingle(),
      supabase.rpc("llm_secrets_status"),
    ]);
    if (row?.value) {
      try {
        const c = JSON.parse(row.value);
        setConfig({ audio: c?.audio ?? DEFAULT_CONFIG.audio, image: c?.image ?? DEFAULT_CONFIG.image });
      } catch { /* mantém default */ }
    }
    if (st) setStatus(st as Record<Provider, boolean>);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const flash = (kind: "ok" | "err" | "warn", text: string) => {
    setMsg({ kind, text });
    setTimeout(() => setMsg(null), kind === "warn" ? 7000 : 4000);
  };

  const pickTier = (which: "audio" | "image", tier: Tier) =>
    setConfig(prev => ({ ...prev, [which]: { provider: tier.provider, model: tier.model } }));

  const saveConfig = async () => {
    setSavingCfg(true);
    const { error } = await supabase.rpc("set_media_ai_config", { p_config: config });
    setSavingCfg(false);
    if (error) { flash("err", `Erro ao salvar configuração: ${error.message}`); return; }
    // avisa (não bloqueia) se um provedor escolhido não tem chave no Vault
    const used = new Set<Provider>([config.audio.provider, config.image.provider]);
    const missing = [...used].filter(p => !status[p]);
    if (missing.length) {
      flash("warn", `Configuração salva. Sem chave no Vault para ${missing.map(p => PROVIDER_LABEL[p]).join(" e ")} — se não houver chave no servidor, a transcrição desse tipo ficará indisponível.`);
    } else {
      flash("ok", "Configuração salva.");
    }
  };

  const saveKey = async (provider: Provider) => {
    const value = keyInput[provider].trim();
    if (value.length < 8) { flash("err", "Chave muito curta."); return; }
    setSavingKey(provider);
    const { error } = await supabase.rpc("set_llm_secret", { p_provider: provider, p_value: value });
    setSavingKey(null);
    if (error) { flash("err", `Erro ao salvar chave: ${error.message}`); return; }
    setKeyInput(prev => ({ ...prev, [provider]: "" }));
    setStatus(prev => ({ ...prev, [provider]: true }));
    flash("ok", `Chave ${PROVIDER_LABEL[provider]} salva.`);
  };

  const removeKey = async (provider: Provider) => {
    setSavingKey(provider);
    const { error } = await supabase.rpc("delete_llm_secret", { p_provider: provider });
    setSavingKey(null);
    if (error) { flash("err", `Erro ao remover chave: ${error.message}`); return; }
    setStatus(prev => ({ ...prev, [provider]: false }));
    flash("ok", `Chave ${PROVIDER_LABEL[provider]} removida.`);
  };

  // provedores usados pela config atual → destaca quais chaves importam
  const usedProviders = new Set<Provider>([config.audio.provider, config.image.provider]);

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-10 flex items-center justify-center gap-3 text-slate-400">
        <Loader2 className="w-5 h-5 animate-spin" /> <span className="text-sm font-medium">Carregando configuração de IA de mídia…</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-black text-slate-900 flex items-center gap-2">
          IA de Mídia (transcrição)
          <span className="text-[10px] font-black text-teal-700 bg-teal-50 border border-teal-200 rounded-md px-1.5 py-0.5 tracking-wider">GLOBAL</span>
        </h2>
        <p className="text-xs text-slate-500 mt-1">
          Escolha qual LLM transcreve o <b>áudio</b> e qual descreve a <b>imagem</b> recebida no WhatsApp — a transcrição
          alimenta o Agente IA. Vale para todas as clínicas.
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

      {/* Seleção por tier */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-5">
        {(["audio", "image"] as const).map(which => {
          const selected = currentTier(which, config[which]);
          const Icon = which === "audio" ? Mic : ImageIcon;
          return (
            <div key={which}>
              <div className="flex items-center gap-2 mb-2.5">
                <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", which === "audio" ? "bg-violet-50 text-violet-600" : "bg-blue-50 text-blue-600")}>
                  <Icon className="w-4 h-4" />
                </div>
                <span className="text-sm font-bold text-slate-700">{which === "audio" ? "Áudio" : "Imagem"}</span>
                {selected === null && (
                  <span className="text-[10px] font-bold text-amber-600 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                    personalizado: {config[which].provider}/{config[which].model}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                {TIERS[which].map(tier => {
                  const meta = TIER_META[tier.id];
                  const isSel = selected === tier.id;
                  const needsKey = !status[tier.provider];
                  const TierIcon = meta.icon;
                  return (
                    <button
                      key={tier.id}
                      type="button"
                      onClick={() => pickTier(which, tier)}
                      className={cn(
                        "text-left rounded-xl border p-3 transition-all relative",
                        isSel ? "border-teal-500 ring-2 ring-teal-500/20 bg-teal-50/40" : "border-slate-200 hover:border-slate-300 bg-white"
                      )}
                    >
                      {isSel && <Check className="w-4 h-4 text-teal-600 absolute top-2.5 right-2.5" />}
                      <span className={cn("inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded border", meta.color)}>
                        <TierIcon className="w-3 h-3" /> {meta.label}
                      </span>
                      <p className="text-sm font-bold text-slate-800 mt-2">{PROVIDER_LABEL[tier.provider]}</p>
                      <p className="text-[11px] font-mono text-slate-500 truncate">{tier.model}</p>
                      <p className="text-[11px] text-slate-500 mt-1 leading-snug">{tier.hint}</p>
                      {needsKey && (
                        <p className="text-[10px] font-bold text-amber-600 mt-1.5 flex items-center gap-1">
                          <KeyRound className="w-3 h-3" /> sem chave no Vault
                        </p>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
        <div className="flex justify-end pt-1">
          <button
            onClick={saveConfig}
            disabled={savingCfg}
            className="bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white px-4 py-2 rounded-xl font-bold flex items-center gap-2 text-sm transition-colors shadow-sm"
          >
            {savingCfg ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Salvar configuração
          </button>
        </div>
      </div>

      {/* Chaves de API */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-4">
        <div>
          <h3 className="text-sm font-black text-slate-900 flex items-center gap-2"><KeyRound className="w-4 h-4 text-slate-400" /> Chaves de API</h3>
          <p className="text-xs text-slate-500 mt-1 flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
            Guardadas criptografadas no Vault do Supabase. Não são exibidas de volta — só o status.
          </p>
        </div>
        {(["gemini", "anthropic", "openai"] as Provider[]).map(provider => {
          const isSet = status[provider];
          const used = usedProviders.has(provider);
          return (
            <div key={provider} className={cn(
              "rounded-xl border p-3 flex flex-col sm:flex-row sm:items-center gap-3",
              used ? "border-slate-200 bg-slate-50/50" : "border-slate-100"
            )}>
              <div className="w-40 shrink-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-slate-700">{PROVIDER_LABEL[provider]}</span>
                  {used && <span className="text-[9px] font-black text-teal-700 bg-teal-50 border border-teal-200 rounded px-1 py-0.5 tracking-wider">EM USO</span>}
                </div>
                <span className={cn(
                  "mt-1 inline-flex items-center gap-1 text-[11px] font-bold",
                  isSet ? "text-emerald-600" : "text-slate-400"
                )}>
                  {isSet ? <><Check className="w-3 h-3" /> configurada</> : <><X className="w-3 h-3" /> não configurada</>}
                </span>
              </div>
              <input
                type="password"
                value={keyInput[provider]}
                onChange={e => setKeyInput(prev => ({ ...prev, [provider]: e.target.value }))}
                placeholder={isSet ? "Substituir chave…" : "Colar chave de API…"}
                autoComplete="off"
                className="flex-1 px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => saveKey(provider)}
                  disabled={savingKey === provider || keyInput[provider].trim().length < 8}
                  className="bg-slate-800 hover:bg-slate-900 disabled:opacity-40 text-white px-3 py-2 rounded-xl font-bold flex items-center gap-1.5 text-sm transition-colors"
                >
                  {savingKey === provider ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Salvar
                </button>
                {isSet && (
                  <button
                    onClick={() => removeKey(provider)}
                    disabled={savingKey === provider}
                    title="Remover chave"
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
