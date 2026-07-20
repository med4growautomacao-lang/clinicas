// Aba "Canais & Templates" — configuração do canal oficial + engenharia de templates + histórico.
// Identidade visual do app (cards brancos, tabs teal, CustomDropdown, badges soft).

import React, { useMemo, useState } from "react";
import { cn } from "@/src/lib/utils";
import { supabase } from "../../lib/supabase";
import { useToast } from "../ui/toast";
import { logSystemError } from "../../hooks/useSupabase";
import { CustomDropdown } from "../CustomDropdown";
import {
  CheckCircle2, Clock, XCircle, Unplug, Loader2, PlugZap, Code2, RefreshCw,
  Settings2, History, Plus, Smartphone, FileText,
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
  { value: "pt_BR", label: "Português (Brasil)" },
  { value: "en_US", label: "Inglês (EUA)" },
  { value: "es_ES", label: "Espanhol" },
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

  const subTabs = [
    { id: "config" as const, label: "Configuração", icon: Settings2 },
    { id: "history" as const, label: "Histórico de Disparos", icon: History },
  ];

  return (
    <div className="space-y-6">
      {/* Cabeçalho da aba */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-teal-50 flex items-center justify-center">
            <Smartphone className="w-5 h-5 text-teal-600" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-900 leading-tight">Canais de Disparo</h3>
            <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">{clinicName || "—"}</p>
          </div>
          <div className="flex items-center gap-2 sm:ml-2">
            <Badge tone="emerald" icon={CheckCircle2} label="Aprovados" value={counts.approved} />
            <Badge tone="amber" icon={Clock} label="Análise" value={counts.pending} />
            <Badge tone="rose" icon={XCircle} label="Erros" value={counts.rejected} />
          </div>
        </div>

        <div className="flex bg-white p-1 rounded-lg w-fit shadow-sm border border-slate-200">
          {subTabs.map((t) => {
            const Icon = t.icon;
            const isActive = subTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setSubTab(t.id)}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-md transition-all",
                  isActive ? "bg-teal-600 text-white shadow-sm" : "text-slate-500 hover:text-slate-900 hover:bg-slate-50"
                )}
              >
                <Icon className={cn("w-4 h-4", isActive ? "text-white" : "text-teal-500")} />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {subTab === "config" ? (
        <div className="space-y-6">
          <ConnectionStation clinicId={clinicId} channels={channels} reload={reload} showToast={showToast} />
          <TemplateEngineer clinicId={clinicId} reload={reload} showToast={showToast} />
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-bold text-slate-700">Seus templates</h4>
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

/* ───────────────────────────── Card genérico ───────────────────────────── */
function Card({ icon: Icon, title, subtitle, children, action }: { icon: any; title: string; subtitle?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-teal-50 flex items-center justify-center">
            <Icon className="w-4 h-4 text-teal-600" />
          </div>
          <div>
            <p className="text-sm font-bold text-slate-800">{title}</p>
            {subtitle && <p className="text-xs text-slate-400">{subtitle}</p>}
          </div>
        </div>
        {action}
      </div>
      <div className="p-6">{children}</div>
    </section>
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
    <Card icon={PlugZap} title="Estação de Conexão" subtitle="Remetentes oficiais desta clínica">
      {channels.length > 0 && (
        <div className="space-y-3 mb-5">
          {channels.map((c) => (
            <div key={c.id} className="flex flex-col md:flex-row md:items-center gap-4 md:gap-8 rounded-xl border border-slate-100 bg-slate-50/60 px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-emerald-50 flex items-center justify-center">
                  <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                </div>
                <Meta label="Canal identificado" value={(c.label || "Meta Tester")} />
              </div>
              <Meta label="WABA (número)" value={c.phone_display || "—"} accent />
              <Meta label="Phone Number ID" value={c.phone_number_id} mono />
              <button
                onClick={() => disconnect(c.id)}
                className="md:ml-auto flex items-center gap-2 px-4 py-2 rounded-xl border border-rose-200 text-rose-600 hover:bg-rose-50 text-xs font-bold transition-all"
              >
                <Unplug className="w-3.5 h-3.5" /> Desconectar
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Input label="Identificação (opcional)" value={label} onChange={setLabel} placeholder="Ex.: Meta Tester" />
        <Input label="Número (DDD + número)" value={phoneDisplay} onChange={setPhoneDisplay} placeholder="Ex.: 15551940324" />
        <Input label="Phone Number ID" value={phoneNumberId} onChange={setPhoneNumberId} placeholder="Do Gerenciador do WhatsApp" mono />
      </div>
      <button
        onClick={connect}
        disabled={busy}
        className="mt-4 flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-40 transition-all shadow-sm"
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Conectar canal
      </button>
    </Card>
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
    <Card icon={Code2} title="Engenharia de Template" subtitle="Crie e envie para aprovação da Meta">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-4">
          <Input label="Identificação interna" value={name} onChange={setName} placeholder="Ex.: boas_vindas" />
          <CustomDropdown label="Idioma oficial Meta" value={language} onChange={setLanguage} options={LANGS} />
          <CustomDropdown label="Categoria comercial" value={category} onChange={setCategory} options={CATEGORIES} />
          <button
            onClick={submit}
            disabled={busy}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-40 transition-all shadow-sm"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} Solicitar aprovação
          </button>
        </div>
        <div>
          <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Payload (estrutura da mensagem)</label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Construa o corpo da mensagem oficial aqui…"
            rows={9}
            className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 resize-none leading-relaxed"
          />
          <p className="text-[11px] text-slate-400 mt-1.5 ml-1">O nome é normalizado para minúsculas/underscore automaticamente (regra da Meta).</p>
        </div>
      </div>
    </Card>
  );
}

/* ─────────────────────────── Sincronizar status ───────────────────────────── */
function SyncButton({
  clinicId, reload, showToast,
}: { clinicId: string; reload: () => void; showToast: (m: string, k?: any) => void }) {
  const [busy, setBusy] = useState(false);
  const sync = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("meta-cloud-api", { body: { action: "sync_templates", clinic_id: clinicId } });
      if (error || !data?.ok) showToast(data?.detail || "Falha ao sincronizar status.", "error");
      else { showToast(`Status sincronizado (${data.updated} atualizados).`, "success"); reload(); }
    } finally { setBusy(false); }
  };
  return (
    <button
      onClick={sync}
      disabled={busy}
      className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-40 transition-all"
    >
      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Sincronizar status
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

const TONE: Record<string, { head: string; dot: string; ring: string }> = {
  emerald: { head: "text-emerald-600", dot: "bg-emerald-500", ring: "border-emerald-100" },
  amber: { head: "text-amber-600", dot: "bg-amber-500", ring: "border-amber-100" },
  rose: { head: "text-rose-600", dot: "bg-rose-500", ring: "border-rose-100" },
};

function Column({ tone, icon: Icon, title, items }: { tone: string; icon: any; title: string; items: MetaTemplate[] }) {
  const t = TONE[tone];
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className={cn("px-4 py-3 border-b flex items-center justify-between", t.ring)}>
        <span className={cn("flex items-center gap-2 text-xs font-bold uppercase tracking-widest", t.head)}>
          <Icon className="w-3.5 h-3.5" /> {title}
        </span>
        <span className="text-sm font-black text-slate-700">{items.length}</span>
      </div>
      <div className="p-3 space-y-2 min-h-[64px]">
        {items.length === 0 && <p className="text-[11px] text-slate-400 py-3 text-center">Nenhum template.</p>}
        {items.map((tpl) => (
          <div key={tpl.id} className="rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2.5">
            <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-600">
              <FileText className="w-3 h-3 text-slate-400" /> {tpl.name} <span className="text-slate-400 font-medium">· {tpl.language}</span>
            </div>
            <p className="text-xs text-slate-500 mt-1 line-clamp-2">{tpl.body_text || "—"}</p>
            {tpl.status === "REJECTED" && tpl.rejected_reason && (
              <p className="text-[10px] text-rose-500 mt-1">Motivo: {tpl.rejected_reason}</p>
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
    sent: "bg-sky-50 text-sky-700 border-sky-200",
    delivered: "bg-blue-50 text-blue-700 border-blue-200",
    read: "bg-emerald-50 text-emerald-700 border-emerald-200",
    failed: "bg-rose-50 text-rose-700 border-rose-200",
  };
  const statusLabel: Record<string, string> = { sent: "Enviado", delivered: "Entregue", read: "Lido", failed: "Falhou" };
  return (
    <Card icon={History} title="Histórico de Disparos" subtitle="Últimos 100 envios">
      {sends.length === 0 ? (
        <p className="text-sm text-slate-400 py-8 text-center">Nenhum disparo ainda.</p>
      ) : (
        <div className="overflow-x-auto -mx-2">
          <table className="w-full text-left min-w-[520px]">
            <thead>
              <tr className="text-[10px] font-bold uppercase tracking-widest text-slate-400 border-b border-slate-100">
                <th className="py-2.5 px-2">Template</th>
                <th className="py-2.5 px-2">Destino</th>
                <th className="py-2.5 px-2">Status</th>
                <th className="py-2.5 px-2">Quando</th>
              </tr>
            </thead>
            <tbody>
              {sends.map((s) => (
                <tr key={s.id} className="border-b border-slate-50 text-sm hover:bg-slate-50/50">
                  <td className="py-2.5 px-2 font-semibold text-slate-700">{s.template_name || "—"}</td>
                  <td className="py-2.5 px-2 text-slate-500">{s.to_phone}</td>
                  <td className="py-2.5 px-2">
                    <span className={cn("inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold border", tone[s.status] || "bg-slate-50 text-slate-600 border-slate-200")}>
                      {statusLabel[s.status] || s.status}
                    </span>
                  </td>
                  <td className="py-2.5 px-2 text-slate-400 text-xs">{new Date(s.created_at).toLocaleString("pt-BR")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/* ───────────────────────────── UI helpers ───────────────────────────── */
function Badge({ tone, icon: Icon, label, value }: { tone: string; icon: any; label: string; value: number }) {
  const cls: Record<string, string> = {
    emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
    amber: "bg-amber-50 text-amber-700 border-amber-200",
    rose: "bg-rose-50 text-rose-700 border-rose-200",
  };
  return (
    <span className={cn("flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[10px] font-bold uppercase tracking-wider", cls[tone])}>
      <Icon className="w-3 h-3" /> {label} {value}
    </span>
  );
}

function Meta({ label, value, accent, mono }: { label: string; value: string; accent?: boolean; mono?: boolean }) {
  return (
    <div>
      <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">{label}</p>
      <p className={cn("text-sm font-bold", accent ? "text-teal-600" : "text-slate-700", mono && "font-mono text-xs")}>{value}</p>
    </div>
  );
}

function Input({
  label, value, onChange, placeholder, mono,
}: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean }) {
  return (
    <div>
      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 ml-1">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(
          "w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500",
          mono && "font-mono text-xs"
        )}
      />
    </div>
  );
}
