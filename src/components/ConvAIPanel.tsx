import React, { useEffect, useState } from "react";
import {
  Loader2, Save, Check, X, Sparkles, Gauge, DollarSign, Power, Eye, Zap,
  KeyRound, ShieldCheck, Brain,
} from "lucide-react";
import { cn } from "@/src/lib/utils";
import { supabase } from "../lib/supabase";

// Painel Super Admin › System Settings › "IA de Conversas" — o MOTOR do analista
// que lê as conversas, move a etapa do funil e sugere as vendas.
//
// Aqui mora SÓ o motor (modelo, temperatura, janela, custo, prompts do SISTEMA e o
// kill-switch). O comportamento de cada cliente (ligar, limiar, manual aprendido)
// fica na tela da clínica, em Comercial › Configurações IA › Análise de Conversas.
//
// Config: system_settings id='conv_ai_config', escrita pela RPC set_conv_ai_config
// (super-admin, merge parcial — salvar um campo não pode zerar os outros).
// Chaves de API: as MESMAS do Vault usadas pela IA de Mídia (set_llm_secret).

type Provider = "anthropic" | "openai" | "gemini";

interface LearnCfg {
  provider: Provider;
  model: string;
  temperature: number;
  every_n_decisions: number;
  bootstrap_sample: number;
}

interface Cfg {
  mode: "off" | "shadow" | "active";
  provider: Provider;
  model: string;
  temperature: number;
  max_output_tokens: number;
  max_messages: number;
  debounce_minutes: number;
  batch_size: number;
  daily_cap_per_clinic: number;
  min_confidence_stage: number;
  min_confidence_sale: number;
  learn: LearnCfg;
  system_prompt: string;
  bootstrap_prompt: string;
  learn_prompt: string;
}

const PROVIDER_LABEL: Record<Provider, string> = {
  anthropic: "Anthropic (Claude)",
  openai: "OpenAI",
  gemini: "Google Gemini",
};

// Modelos por provedor. A ordem é econômica → avançada; o de análise roda em TODA
// conversa com mensagem nova, então o default é o mais barato que dá conta.
const MODELS: Record<Provider, Array<{ id: string; label: string; hint: string }>> = {
  anthropic: [
    { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", hint: "Mais barato. Padrão para a análise." },
    { id: "claude-sonnet-5", label: "Claude Sonnet 5", hint: "Equilibrado. Bom para o aprendizado." },
    { id: "claude-opus-4-8", label: "Claude Opus 4.8", hint: "Mais capaz e mais caro." },
  ],
  openai: [
    { id: "gpt-5-mini", label: "GPT-5 mini", hint: "Econômico." },
    { id: "gpt-5", label: "GPT-5", hint: "Mais capaz." },
  ],
  gemini: [
    { id: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash Lite", hint: "Mais barato." },
    { id: "gemini-3.1-flash", label: "Gemini 3.1 Flash", hint: "Equilibrado." },
  ],
};

const MODE_META = {
  off:    { label: "Desligado", icon: Power, hint: "Ninguém é analisado. Kill-switch.", cls: "border-slate-300 bg-slate-50 text-slate-600" },
  shadow: { label: "Observação", icon: Eye, hint: "Analisa e registra, mas NÃO move card nem cria sugestão de venda.", cls: "border-amber-300 bg-amber-50 text-amber-700" },
  active: { label: "Ativo", icon: Zap, hint: "Move a etapa comum sozinho e manda a venda para o vendedor decidir.", cls: "border-emerald-300 bg-emerald-50 text-emerald-700" },
} as const;

const DEFAULTS: Cfg = {
  mode: "shadow",
  provider: "anthropic",
  model: "claude-haiku-4-5",
  temperature: 0.1,
  max_output_tokens: 1200,
  max_messages: 40,
  debounce_minutes: 3,
  batch_size: 25,
  daily_cap_per_clinic: 300,
  min_confidence_stage: 0.75,
  min_confidence_sale: 0.7,
  learn: { provider: "anthropic", model: "claude-sonnet-5", temperature: 0.3, every_n_decisions: 15, bootstrap_sample: 60 },
  system_prompt: "",
  bootstrap_prompt: "",
  learn_prompt: "",
};

const inputCls = "w-full px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 text-sm";

// A geração Opus 4.7+ da Anthropic (Opus 4.8, Sonnet 5) REMOVEU o parâmetro
// temperature: mandar o campo devolve 400. As edges já omitem o campo nesses
// modelos; aqui o controle some para não prometer o que não existe.
const semTemperatura = (model: string) => /^claude-(opus-4-[78]|sonnet-5|fable-5|mythos-5)/.test(model);

export function ConvAIPanel() {
  const [cfg, setCfg] = useState<Cfg>(DEFAULTS);
  const [keyStatus, setKeyStatus] = useState<Record<Provider, boolean>>({ anthropic: false, openai: false, gemini: false });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err" | "warn"; text: string } | null>(null);
  const [showPrompts, setShowPrompts] = useState(false);

  useEffect(() => {
    (async () => {
      const [{ data: row }, { data: st }] = await Promise.all([
        supabase.from("system_settings").select("value").eq("id", "conv_ai_config").maybeSingle(),
        supabase.rpc("llm_secrets_status"),
      ]);
      if (row?.value) {
        try {
          const parsed = JSON.parse(row.value);
          setCfg({ ...DEFAULTS, ...parsed, learn: { ...DEFAULTS.learn, ...(parsed.learn ?? {}) } });
        } catch { /* mantém default */ }
      }
      if (st) setKeyStatus(st as Record<Provider, boolean>);
      setLoading(false);
    })();
  }, []);

  const flash = (kind: "ok" | "err" | "warn", text: string) => {
    setMsg({ kind, text });
    setTimeout(() => setMsg(null), kind === "warn" ? 7000 : 4000);
  };

  const set = <K extends keyof Cfg>(k: K, v: Cfg[K]) => setCfg(c => ({ ...c, [k]: v }));
  const setLearn = <K extends keyof LearnCfg>(k: K, v: LearnCfg[K]) =>
    setCfg(c => ({ ...c, learn: { ...c.learn, [k]: v } }));

  const pickProvider = (p: Provider) => setCfg(c => ({ ...c, provider: p, model: MODELS[p][0].id }));
  const pickLearnProvider = (p: Provider) =>
    setCfg(c => ({ ...c, learn: { ...c.learn, provider: p, model: MODELS[p][Math.min(1, MODELS[p].length - 1)].id } }));

  const save = async () => {
    setSaving(true);
    const { error } = await supabase.rpc("set_conv_ai_config", { p_config: cfg });
    setSaving(false);
    if (error) { flash("err", `Erro ao salvar: ${error.message}`); return; }
    const faltando = [...new Set<Provider>([cfg.provider, cfg.learn.provider])].filter(p => !keyStatus[p]);
    if (faltando.length) {
      flash("warn", `Configuração salva. Sem chave no Vault para ${faltando.map(p => PROVIDER_LABEL[p]).join(" e ")}: a análise vai falhar até cadastrar a chave na aba IA de Mídia.`);
    } else if (cfg.mode === "active") {
      flash("ok", "Configuração salva. Motor ATIVO: as clínicas habilitadas passam a ter a etapa movida pela IA.");
    } else {
      flash("ok", "Configuração salva.");
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-10 flex items-center justify-center gap-3 text-slate-400">
        <Loader2 className="w-5 h-5 animate-spin" /> <span className="text-sm font-medium">Carregando o motor de análise…</span>
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-4xl">
      <div>
        <h2 className="text-sm font-black text-slate-900 flex items-center gap-2">
          IA de Conversas (analista de funil)
          <span className="text-[10px] font-black text-teal-700 bg-teal-50 border border-teal-200 rounded-md px-1.5 py-0.5 tracking-wider">GLOBAL</span>
        </h2>
        <p className="text-xs text-slate-500 mt-1">
          O analista lê as conversas e decide a <b>etapa do funil</b> (move sozinho) e a <b>venda</b>
          {" "}(sempre vai para o vendedor confirmar). Aqui fica só o motor. Ligar por cliente, limiar e o
          manual aprendido ficam em <b>Comercial › Configurações IA › Análise de Conversas</b>, na clínica.
        </p>
      </div>

      {msg && (
        <div className={cn(
          "flex items-start gap-2 px-3 py-2.5 rounded-xl text-sm font-medium border",
          msg.kind === "ok" ? "bg-emerald-50 border-emerald-200 text-emerald-700"
            : msg.kind === "warn" ? "bg-amber-50 border-amber-200 text-amber-700"
            : "bg-rose-50 border-rose-200 text-rose-700"
        )}>
          {msg.kind === "ok" ? <Check className="w-4 h-4 shrink-0 mt-0.5" />
            : msg.kind === "warn" ? <KeyRound className="w-4 h-4 shrink-0 mt-0.5" />
            : <X className="w-4 h-4 shrink-0 mt-0.5" />} {msg.text}
        </div>
      )}

      {/* Kill-switch */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
        <h3 className="text-sm font-black text-slate-900 mb-3">Estado do motor</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          {(["off", "shadow", "active"] as const).map(m => {
            const meta = MODE_META[m];
            const Icon = meta.icon;
            const sel = cfg.mode === m;
            return (
              <button key={m} type="button" onClick={() => set("mode", m)}
                className={cn("text-left rounded-xl border p-3 transition-all relative",
                  sel ? cn(meta.cls, "ring-2 ring-offset-1 ring-current/20") : "border-slate-200 hover:border-slate-300 bg-white")}>
                {sel && <Check className="w-4 h-4 absolute top-2.5 right-2.5" />}
                <span className="inline-flex items-center gap-1.5 text-sm font-bold">
                  <Icon className="w-4 h-4" /> {meta.label}
                </span>
                <p className="text-[11px] text-slate-500 mt-1.5 leading-snug">{meta.hint}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Modelo de análise */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-4">
        <div>
          <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
            <Gauge className="w-4 h-4 text-teal-600" /> Modelo da análise
          </h3>
          <p className="text-xs text-slate-500 mt-1">Roda em toda conversa com mensagem nova. É o custo recorrente.</p>
        </div>

        <div className="flex flex-wrap gap-2">
          {(Object.keys(MODELS) as Provider[]).map(p => (
            <button key={p} type="button" onClick={() => pickProvider(p)}
              className={cn("px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors flex items-center gap-1.5",
                cfg.provider === p ? "bg-teal-50 text-teal-700 border-teal-200" : "bg-white text-slate-400 border-slate-200")}>
              {PROVIDER_LABEL[p]}
              {!keyStatus[p] && <KeyRound className="w-3 h-3 text-amber-500" />}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="sm:col-span-2">
            <label className="block text-xs font-bold text-slate-600 mb-1.5">Modelo</label>
            <select value={cfg.model} onChange={e => set("model", e.target.value)} className={inputCls}>
              {MODELS[cfg.provider].map(m => (
                <option key={m.id} value={m.id}>{m.label} — {m.hint}</option>
              ))}
              {!MODELS[cfg.provider].some(m => m.id === cfg.model) && (
                <option value={cfg.model}>{cfg.model} (personalizado)</option>
              )}
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1.5">
              Temperatura{" "}
              {semTemperatura(cfg.model)
                ? <span className="font-mono text-slate-400">n/d</span>
                : <span className="font-mono text-teal-600">{cfg.temperature.toFixed(2)}</span>}
            </label>
            {semTemperatura(cfg.model) ? (
              <p className="text-[11px] text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5 mt-1 leading-snug">
                Este modelo não aceita temperatura (a Anthropic removeu o parâmetro na geração
                Opus 4.7 em diante). A análise roda sem ela.
              </p>
            ) : (
              <>
                <input type="range" min={0} max={1} step={0.05} value={cfg.temperature}
                  onChange={e => set("temperature", parseFloat(e.target.value))}
                  className="w-full accent-teal-600 mt-2.5" />
                <p className="text-[10px] text-slate-400 mt-1">Baixa = decisão estável. Recomendado 0,1.</p>
              </>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1.5">Tokens de saída</label>
            <input type="number" min={200} max={4000} value={cfg.max_output_tokens}
              onChange={e => set("max_output_tokens", parseInt(e.target.value) || 1200)} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1.5">Mensagens lidas</label>
            <input type="number" min={10} max={120} value={cfg.max_messages}
              onChange={e => set("max_messages", parseInt(e.target.value) || 40)} className={inputCls} />
            <p className="text-[10px] text-slate-400 mt-1">Janela da conversa.</p>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1.5">Espera (min)</label>
            <input type="number" min={0} max={60} value={cfg.debounce_minutes}
              onChange={e => set("debounce_minutes", parseInt(e.target.value) || 0)} className={inputCls} />
            <p className="text-[10px] text-slate-400 mt-1">Só analisa conversa parada.</p>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1.5">Lote por rodada</label>
            <input type="number" min={1} max={200} value={cfg.batch_size}
              onChange={e => set("batch_size", parseInt(e.target.value) || 25)} className={inputCls} />
            <p className="text-[10px] text-slate-400 mt-1">Cron roda a cada 5 min.</p>
          </div>
        </div>
      </div>

      {/* Travas de custo e de confiança */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-4">
        <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
          <DollarSign className="w-4 h-4 text-emerald-600" /> Travas
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1.5">Teto diário por clínica</label>
            <input type="number" min={10} max={5000} value={cfg.daily_cap_per_clinic}
              onChange={e => set("daily_cap_per_clinic", parseInt(e.target.value) || 300)} className={inputCls} />
            <p className="text-[10px] text-slate-400 mt-1">Análises por dia. Estouro pausa a clínica até o dia seguinte.</p>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1.5">
              Confiança p/ mover etapa <span className="font-mono text-teal-600">{cfg.min_confidence_stage.toFixed(2)}</span>
            </label>
            <input type="range" min={0.3} max={1} step={0.05} value={cfg.min_confidence_stage}
              onChange={e => set("min_confidence_stage", parseFloat(e.target.value))}
              className="w-full accent-teal-600 mt-2.5" />
            <p className="text-[10px] text-slate-400 mt-1">Abaixo disso, não move e registra como descartada.</p>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1.5">
              Confiança p/ sugerir venda <span className="font-mono text-teal-600">{cfg.min_confidence_sale.toFixed(2)}</span>
            </label>
            <input type="range" min={0.3} max={1} step={0.05} value={cfg.min_confidence_sale}
              onChange={e => set("min_confidence_sale", parseFloat(e.target.value))}
              className="w-full accent-teal-600 mt-2.5" />
            <p className="text-[10px] text-slate-400 mt-1">Venda nunca é aplicada sozinha, sempre vai para o vendedor.</p>
          </div>
        </div>
      </div>

      {/* Aprendizado */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-4">
        <div>
          <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
            <Brain className="w-4 h-4 text-violet-600" /> Aprendizado (manual por cliente)
          </h3>
          <p className="text-xs text-slate-500 mt-1">
            Roda 1x/dia. Escreve a v1 do manual de cada cliente a partir das conversas históricas e reescreve
            conforme as decisões de venda e as correções de etapa. Modelo mais forte, poucas chamadas.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(MODELS) as Provider[]).map(p => (
            <button key={p} type="button" onClick={() => pickLearnProvider(p)}
              className={cn("px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors flex items-center gap-1.5",
                cfg.learn.provider === p ? "bg-violet-50 text-violet-700 border-violet-200" : "bg-white text-slate-400 border-slate-200")}>
              {PROVIDER_LABEL[p]}
              {!keyStatus[p] && <KeyRound className="w-3 h-3 text-amber-500" />}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <div className="sm:col-span-2">
            <label className="block text-xs font-bold text-slate-600 mb-1.5">Modelo</label>
            <select value={cfg.learn.model} onChange={e => setLearn("model", e.target.value)} className={inputCls}>
              {MODELS[cfg.learn.provider].map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
              {!MODELS[cfg.learn.provider].some(m => m.id === cfg.learn.model) && (
                <option value={cfg.learn.model}>{cfg.learn.model} (personalizado)</option>
              )}
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1.5">
              Temperatura{" "}
              {semTemperatura(cfg.learn.model)
                ? <span className="font-mono text-slate-400">n/d</span>
                : <span className="font-mono text-violet-600">{cfg.learn.temperature.toFixed(2)}</span>}
            </label>
            {semTemperatura(cfg.learn.model) ? (
              <p className="text-[10px] text-slate-400 mt-2 leading-snug">Este modelo não aceita temperatura.</p>
            ) : (
              <input type="range" min={0} max={1} step={0.05} value={cfg.learn.temperature}
                onChange={e => setLearn("temperature", parseFloat(e.target.value))}
                className="w-full accent-violet-600 mt-2.5" />
            )}
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1.5">Reescreve a cada</label>
            <input type="number" min={3} max={200} value={cfg.learn.every_n_decisions}
              onChange={e => setLearn("every_n_decisions", parseInt(e.target.value) || 15)} className={inputCls} />
            <p className="text-[10px] text-slate-400 mt-1">decisões humanas.</p>
          </div>
        </div>
        <div className="sm:w-1/4">
          <label className="block text-xs font-bold text-slate-600 mb-1.5">Amostra do bootstrap</label>
          <input type="number" min={10} max={200} value={cfg.learn.bootstrap_sample}
            onChange={e => setLearn("bootstrap_sample", parseInt(e.target.value) || 60)} className={inputCls} />
          <p className="text-[10px] text-slate-400 mt-1">Atendimentos históricos lidos para escrever a v1.</p>
        </div>
      </div>

      {/* Prompts do sistema */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-4">
        <button type="button" onClick={() => setShowPrompts(v => !v)} className="w-full flex items-center justify-between">
          <span className="text-sm font-black text-slate-900 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-amber-500" /> Prompts do sistema
          </span>
          <span className="text-xs font-bold text-teal-600">{showPrompts ? "ocultar" : "mostrar"}</span>
        </button>
        <p className="text-xs text-slate-500 -mt-2">
          Estes são <b>compartilhados por todas as clínicas</b>: definem COMO a IA analisa. O QUE ela sabe de cada
          cliente vem do manual aprendido, que fica na clínica. Mexer aqui muda o comportamento de todo mundo.
        </p>
        {showPrompts && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1.5">Análise (etapa + venda)</label>
              <textarea value={cfg.system_prompt} onChange={e => set("system_prompt", e.target.value)}
                className={cn(inputCls, "h-64 resize-y font-mono text-xs")} />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1.5">Bootstrap (escreve a v1 pelo histórico)</label>
              <textarea value={cfg.bootstrap_prompt} onChange={e => set("bootstrap_prompt", e.target.value)}
                className={cn(inputCls, "h-40 resize-y font-mono text-xs")} />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1.5">Aprendizado (reescreve com as decisões)</label>
              <textarea value={cfg.learn_prompt} onChange={e => set("learn_prompt", e.target.value)}
                className={cn(inputCls, "h-40 resize-y font-mono text-xs")} />
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 pb-2">
        <p className="text-[11px] text-slate-400 flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
          As chaves de API são as mesmas do Vault, cadastradas na aba <b>IA de Mídia</b>.
        </p>
        <button onClick={save} disabled={saving}
          className="bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white px-4 py-2 rounded-xl font-bold flex items-center gap-2 text-sm transition-colors shadow-sm shrink-0">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Salvar configuração
        </button>
      </div>
    </div>
  );
}
