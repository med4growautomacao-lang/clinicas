// Aba "Canais & Templates" — configuração do canal oficial + engenharia de templates + histórico.
// Espelha a imagem 2: badges de status, Estação de Conexão, Engenharia de Template, cards por status.

import React, { useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { useToast } from "../ui/toast";
import { logSystemError } from "../../hooks/useSupabase";
import {
  CheckCircle2, Clock, XCircle, Unplug, Loader2, PlugZap, Code2, RefreshCw,
  Settings2, History, Plus, Smartphone,
} from "lucide-react";
import type { MetaChannel, MetaTemplate, MetaSend } from "./types";

interface Props {
  clinicId: string;
  clinicName: string;
  channels: MetaChannel[];
  templates: MetaTemplate[];
  sends: MetaSend[];
  reload: () => void;
}

const LANGS = [
  { code: "pt_BR", label: "Português (Brasil)" },
  { code: "en_US", label: "Inglês (EUA)" },
  { code: "es_ES", label: "Espanhol" },
];
const CATEGORIES = [
  { value: "MARKETING", label: "Marketing" },
  { value: "UTILITY", label: "Utilidade" },
  { value: "AUTHENTICATION", label: "Autenticação" },
];

function bucket(status: string): "APPROVED" | "REJECTED" | "PENDING" {
  if (status === "APPROVED") return "APPROVED";
  if (status === "REJECTED") return "REJECTED";
  return "PENDING";
}

export function CanaisTemplates({ clinicId, clinicName, channels, templates, sends, reload }: Props) {
  const showToast = useToast();
  const [subTab, setSubTab] = useState<"config" | "history">("config");

  const counts = useMemo(() => {
    let a = 0, p = 0, r = 0;
    for (const t of templates) {
      const b = bucket(t.status);
      if (b === "APPROVED") a++; else if (b === "REJECTED") r++; else p++;
    }
    return { approved: a, pending: p, rejected: r };
  }, [templates]);

  return (
    <div className="relative max-w-5xl mx-auto">
      {/* Cabeçalho */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-blue-600 to-cyan-500 flex items-center justify-center shadow-lg shadow-blue-500/20">
            <Smartphone className="w-6 h-6 text-white" />
          </div>
          <div>
            <h2 className="text-lg font-black tracking-tight">Canais de Disparo</h2>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{clinicName || "—"}</p>
          </div>
          <div className="flex items-center gap-2 ml-2">
            <Badge tone="emerald" icon={CheckCircle2} label="Aprovados" value={counts.approved} />
            <Badge tone="amber" icon={Clock} label="Análise" value={counts.pending} />
            <Badge tone="rose" icon={XCircle} label="Erros" value={counts.rejected} />
          </div>
        </div>

        <div className="inline-flex items-center gap-1 p-1 rounded-full bg-white/[0.04] border border-white/10 self-start">
          <SubTab active={subTab === "config"} onClick={() => setSubTab("config")} icon={Settings2} label="Configuração" />
          <SubTab active={subTab === "history"} onClick={() => setSubTab("history")} icon={History} label="Histórico de Disparos" />
        </div>
      </div>

      {subTab === "config" ? (
        <div className="space-y-6">
          <ConnectionStation clinicId={clinicId} channels={channels} reload={reload} showToast={showToast} />
          <TemplateEngineer clinicId={clinicId} reload={reload} showToast={showToast} />
          <div className="flex items-center justify-between px-1">
            <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Seus templates</span>
            <SyncButton clinicId={clinicId} reload={reload} showToast={showToast} />
          </div>
          <TemplateGallery templates={templates} />
        </div>
      ) : (
        <DispatchHistory sends={sends} />
      )}
    </div>
  );
}

/* ───────────────────────────── Estação de Conexão ───────────────────────────── */
function ConnectionStation({
  clinicId, channels, reload, showToast,
}: { clinicId: string; channels: MetaChannel[]; reload: () => void; showToast: (m: string, k?: any) => void }) {
  const [label, setLabel] = useState("");
  const [phoneDisplay, setPhoneDisplay] = useState("");
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [busy, setBusy] = useState(false);

  const connect = async () => {
    if (!phoneNumberId.trim()) { showToast("Informe o Phone Number ID.", "error"); return; }
    setBusy(true);
    try {
      const { error } = await supabase.from("meta_cloud_channels").insert({
        clinic_id: clinicId,
        label: label.trim() || null,
        phone_display: phoneDisplay.trim() || null,
        phone_number_id: phoneNumberId.trim(),
        status: "connected",
      });
      if (error) {
        showToast(error.code === "23505" ? "Este Phone Number ID já está conectado." : "Falha ao conectar o canal.", "error");
      } else {
        showToast("Canal conectado!", "success");
        setLabel(""); setPhoneDisplay(""); setPhoneNumberId("");
        reload();
      }
    } finally { setBusy(false); }
  };

  const disconnect = async (id: string) => {
    if (!window.confirm("Desconectar este canal? Ele deixará de aparecer como remetente.")) return;
    const { error } = await supabase.from("meta_cloud_channels").delete().eq("id", id);
    if (error) showToast("Falha ao desconectar.", "error");
    else { showToast("Canal desconectado.", "info"); reload(); }
  };

  return (
    <section className="rounded-3xl bg-[#0f1629]/70 border border-white/10 p-6">
      <SectionTitle icon={PlugZap} title="Estação de Conexão" />

      {channels.length > 0 && (
        <div className="space-y-3 mb-5">
          {channels.map((c) => (
            <div key={c.id} className="flex flex-col md:flex-row md:items-center gap-4 md:gap-8 rounded-2xl bg-white/[0.03] border border-white/10 px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/15 flex items-center justify-center">
                  <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                </div>
                <Meta label="Canal identificado" value={(c.label || "META TESTER").toUpperCase()} />
              </div>
              <Meta label="WABA oficial" value={c.phone_display || "—"} accent />
              <Meta label="Status API" value={c.phone_number_id} mono />
              <button
                onClick={() => disconnect(c.id)}
                className="md:ml-auto flex items-center gap-2 px-4 py-2 rounded-xl border border-rose-500/30 text-rose-400 hover:bg-rose-500/10 text-xs font-bold transition-all"
              >
                <Unplug className="w-3.5 h-3.5" /> Desconectar canal
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Formulário de conexão (só phone + phone_number_id, como pedido) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Input label="Identificação (opcional)" value={label} onChange={setLabel} placeholder="Ex.: Meta Tester" />
        <Input label="Número (DDD + número)" value={phoneDisplay} onChange={setPhoneDisplay} placeholder="Ex.: 15551940324" />
        <Input label="Phone Number ID" value={phoneNumberId} onChange={setPhoneNumberId} placeholder="Do Gerenciador do WhatsApp" mono />
      </div>
      <button
        onClick={connect}
        disabled={busy}
        className="mt-4 flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider text-white bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-500 hover:to-cyan-400 disabled:opacity-40 transition-all"
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Conectar canal
      </button>
    </section>
  );
}

/* ─────────────────────────── Engenharia de Template ─────────────────────────── */
function TemplateEngineer({
  clinicId, reload, showToast,
}: { clinicId: string; reload: () => void; showToast: (m: string, k?: any) => void }) {
  const [name, setName] = useState("");
  const [language, setLanguage] = useState("pt_BR");
  const [category, setCategory] = useState("MARKETING");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim() || !content.trim()) { showToast("Preencha identificação e payload do template.", "error"); return; }
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("meta-cloud-api", {
        body: { action: "create_template", clinic_id: clinicId, name, language, category, content },
      });
      if (error) {
        showToast("Falha ao solicitar aprovação (erro de função).", "error");
        logSystemError("META_CLOUD_CREATE_INVOKE_FAIL", "Falha ao invocar create_template", clinicId, { error: error.message }, "warn");
      } else if (!data?.ok) {
        showToast(data?.detail || "A Meta recusou a criação do template.", "error");
      } else {
        showToast("Template enviado para aprovação!", "success");
        setName(""); setContent("");
        reload();
      }
    } catch (e: any) {
      showToast("Erro inesperado.", "error");
      logSystemError("META_CLOUD_CREATE_FAIL", "Exceção ao criar template", clinicId, { error: e?.message ?? String(e) }, "warn");
    } finally { setBusy(false); }
  };

  return (
    <section className="rounded-3xl bg-[#0f1629]/70 border border-white/10 p-6">
      <SectionTitle icon={Code2} title="Engenharia de Template" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-4">
          <Input label="Identificação interna" value={name} onChange={setName} placeholder="Ex.: boas_vindas" />
          <Select label="Idioma oficial Meta" value={language} onChange={setLanguage} options={LANGS.map((l) => ({ value: l.code, label: l.label }))} />
          <Select label="Categoria comercial" value={category} onChange={setCategory} options={CATEGORIES} />
          <button
            onClick={submit}
            disabled={busy}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-xs font-bold uppercase tracking-wider text-white bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-500 hover:to-cyan-400 disabled:opacity-40 transition-all"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} Solicitar aprovação
          </button>
        </div>
        <div>
          <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2 block">Payload (estrutura da mensagem)</label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Construa o corpo da mensagem oficial aqui…"
            rows={9}
            className="w-full bg-white/[0.03] border border-white/10 rounded-2xl px-4 py-3 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-cyan-500/50 resize-none leading-relaxed"
          />
          <p className="text-[10px] text-slate-600 mt-1.5">O nome é normalizado para minúsculas/underscore automaticamente (regra da Meta).</p>
        </div>
      </div>
    </section>
  );
}

function SyncButton({
  clinicId, reload, showToast,
}: { clinicId: string; reload: () => void; showToast: (m: string, k?: any) => void }) {
  const [busy, setBusy] = useState(false);
  const sync = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("meta-cloud-api", {
        body: { action: "sync_templates", clinic_id: clinicId },
      });
      if (error || !data?.ok) showToast(data?.detail || "Falha ao sincronizar status.", "error");
      else { showToast(`Status sincronizado (${data.updated} atualizados).`, "success"); reload(); }
    } finally { setBusy(false); }
  };
  return (
    <button
      onClick={sync}
      disabled={busy}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 text-[10px] font-bold uppercase tracking-wider text-slate-300 hover:bg-white/5 disabled:opacity-40 transition-all"
    >
      {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} Sincronizar status
    </button>
  );
}

/* ─────────────────────────── Galeria de templates ───────────────────────────── */
function TemplateGallery({ templates }: { templates: MetaTemplate[] }) {
  const groups = useMemo(() => {
    const g = { APPROVED: [] as MetaTemplate[], PENDING: [] as MetaTemplate[], REJECTED: [] as MetaTemplate[] };
    for (const t of templates) g[bucket(t.status)].push(t);
    return g;
  }, [templates]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
      <Column tone="emerald" icon={CheckCircle2} title="Disponíveis" items={groups.APPROVED} />
      <Column tone="amber" icon={Clock} title="Análise Meta" items={groups.PENDING} />
      <Column tone="rose" icon={XCircle} title="Recusados" items={groups.REJECTED} />
    </div>
  );
}

function Column({ tone, icon: Icon, title, items }: { tone: string; icon: any; title: string; items: MetaTemplate[] }) {
  const toneCls: Record<string, string> = {
    emerald: "text-emerald-400 border-emerald-500/20",
    amber: "text-amber-400 border-amber-500/20",
    rose: "text-rose-400 border-rose-500/20",
  };
  return (
    <div className={`rounded-2xl bg-white/[0.02] border ${toneCls[tone]} p-4`}>
      <div className={`flex items-center justify-between mb-3 ${toneCls[tone].split(" ")[0]}`}>
        <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest"><Icon className="w-3.5 h-3.5" /> {title}</span>
        <span className="text-sm font-black">{items.length}</span>
      </div>
      <div className="space-y-2">
        {items.length === 0 && <p className="text-[11px] text-slate-600 py-2">Nenhum template.</p>}
        {items.map((t) => (
          <div key={t.id} className="rounded-xl bg-white/[0.03] border border-white/5 px-3 py-2.5">
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
              <Code2 className="w-3 h-3" /> {t.name} · {t.language}
            </div>
            <p className="text-xs text-slate-400 mt-1 line-clamp-2">{t.body_text || "—"}</p>
            {t.status === "REJECTED" && t.rejected_reason && (
              <p className="text-[10px] text-rose-400/80 mt-1">Motivo: {t.rejected_reason}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────── Histórico de disparos ──────────────────────────── */
function DispatchHistory({ sends }: { sends: MetaSend[] }) {
  const tone: Record<string, string> = {
    sent: "bg-sky-500/15 text-sky-400",
    delivered: "bg-blue-500/15 text-blue-400",
    read: "bg-emerald-500/15 text-emerald-400",
    failed: "bg-rose-500/15 text-rose-400",
  };
  const statusLabel: Record<string, string> = { sent: "Enviado", delivered: "Entregue", read: "Lido", failed: "Falhou" };
  return (
    <section className="rounded-3xl bg-[#0f1629]/70 border border-white/10 p-6">
      <SectionTitle icon={History} title="Histórico de Disparos" />
      {sends.length === 0 ? (
        <p className="text-sm text-slate-500 py-6 text-center">Nenhum disparo ainda.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[10px] font-bold uppercase tracking-widest text-slate-500 border-b border-white/10">
                <th className="py-2 pr-4">Template</th>
                <th className="py-2 pr-4">Destino</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Quando</th>
              </tr>
            </thead>
            <tbody>
              {sends.map((s) => (
                <tr key={s.id} className="border-b border-white/5 text-sm">
                  <td className="py-2.5 pr-4 font-semibold text-slate-200">{s.template_name || "—"}</td>
                  <td className="py-2.5 pr-4 text-slate-400">{s.to_phone}</td>
                  <td className="py-2.5 pr-4">
                    <span className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold ${tone[s.status] || "bg-slate-500/15 text-slate-400"}`}>
                      {statusLabel[s.status] || s.status}
                    </span>
                  </td>
                  <td className="py-2.5 pr-4 text-slate-500 text-xs">{new Date(s.created_at).toLocaleString("pt-BR")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* ───────────────────────────── UI helpers ───────────────────────────── */
function Badge({ tone, icon: Icon, label, value }: { tone: string; icon: any; label: string; value: number }) {
  const cls: Record<string, string> = {
    emerald: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    amber: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    rose: "bg-rose-500/10 text-rose-400 border-rose-500/20",
  };
  return (
    <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[10px] font-bold uppercase tracking-wider ${cls[tone]}`}>
      <Icon className="w-3 h-3" /> {label} {value}
    </span>
  );
}

function SubTab({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: any; label: string }) {
  return (
    <button
      onClick={onClick}
      className={
        "flex items-center gap-1.5 px-4 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wider transition-all " +
        (active ? "bg-gradient-to-r from-blue-600 to-cyan-500 text-white" : "text-slate-400 hover:text-slate-200")
      }
    >
      <Icon className="w-3 h-3" /> {label}
    </button>
  );
}

function SectionTitle({ icon: Icon, title }: { icon: any; title: string }) {
  return (
    <div className="flex items-center gap-2 mb-5">
      <Icon className="w-4 h-4 text-cyan-400" />
      <span className="text-[11px] font-bold uppercase tracking-widest text-slate-300">{title}</span>
    </div>
  );
}

function Meta({ label, value, accent, mono }: { label: string; value: string; accent?: boolean; mono?: boolean }) {
  return (
    <div>
      <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500">{label}</p>
      <p className={`text-sm font-bold ${accent ? "text-cyan-400" : "text-slate-200"} ${mono ? "font-mono text-xs" : ""}`}>{value}</p>
    </div>
  );
}

function Input({
  label, value, onChange, placeholder, mono,
}: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean }) {
  return (
    <div>
      <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1.5 block">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full bg-white/[0.03] border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-cyan-500/50 ${mono ? "font-mono text-xs" : ""}`}
      />
    </div>
  );
}

function Select({
  label, value, onChange, options,
}: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div>
      <label className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1.5 block">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-white/[0.03] border border-white/10 rounded-xl px-3.5 py-2.5 text-sm font-semibold text-slate-100 focus:outline-none focus:border-cyan-500/50 appearance-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-[#0f1629]">{o.label}</option>
        ))}
      </select>
    </div>
  );
}
