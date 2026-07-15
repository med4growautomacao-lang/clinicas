import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { cn } from "@/src/lib/utils";
import { motion } from "framer-motion";
import {
  X, Loader2, Building2, KeyRound, LinkIcon, Plus, Trash2, Eye, EyeOff, Copy, Check,
  Globe, MessageCircle, Users, Phone, TrendingUp, Save, ExternalLink,
} from "lucide-react";

// Estrutura fixa dos acessos. Cada item vira um card {url, login, password, note}.
const ACCESS_FIELDS: { key: string; label: string; Icon: React.ElementType; color: string }[] = [
  { key: 'site', label: 'Site', Icon: Globe, color: 'text-sky-500' },
  { key: 'meta', label: 'Meta Business', Icon: MessageCircle, color: 'text-blue-600' },
  { key: 'instagram', label: 'Instagram', Icon: MessageCircle, color: 'text-pink-500' },
  { key: 'crm', label: 'CRM', Icon: Building2, color: 'text-violet-500' },
  { key: 'meta_ads', label: 'Conta de Anúncios Meta', Icon: TrendingUp, color: 'text-indigo-500' },
  { key: 'google_ads', label: 'Conta de Anúncios Google', Icon: TrendingUp, color: 'text-amber-500' },
];

type AccessEntry = { url?: string; login?: string; password?: string; note?: string };
type Responsible = { name?: string; role?: string; phone?: string; email?: string };
type PhoneEntry = { label?: string; number?: string };
type LinkEntry = { label?: string; url?: string };

interface ClinicInfoData {
  responsibles: Responsible[];
  extra_phones: PhoneEntry[];
  budget: { meta_estipulado?: number; google_estipulado?: number };
  access: Record<string, AccessEntry>;
  important_links: LinkEntry[];
  notes: string;
  spend: { meta: number; google: number };
  spend_month: string;
}

const EMPTY: ClinicInfoData = {
  responsibles: [], extra_phones: [], budget: {}, access: {}, important_links: [],
  notes: '', spend: { meta: 0, google: 0 }, spend_month: '',
};

const fmtMoney = (n: number) =>
  (n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const parseMoney = (s: string): number => {
  const clean = s.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
  const n = parseFloat(clean);
  return isNaN(n) ? 0 : n;
};

interface Props {
  clinic: { id: string; name: string };
  canEdit: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

export function ClinicInfoModal({ clinic, canEdit, onClose, onSaved }: Props) {
  const [tab, setTab] = useState<'dados' | 'acessos' | 'links'>('dados');
  const [data, setData] = useState<ClinicInfoData>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedOk, setSavedOk] = useState(false);
  const [showPw, setShowPw] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState<string | null>(null);
  // Texto cru dos campos de verba enquanto o usuário digita (evita reformatar a cada tecla).
  const [budgetStr, setBudgetStr] = useState<{ meta_estipulado: string; google_estipulado: string }>({ meta_estipulado: '', google_estipulado: '' });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data: res, error: err } = await supabase.rpc('get_clinic_client_info', { p_clinic_id: clinic.id });
    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }
    const r = (res || {}) as any;
    const b = r.budget || {};
    setBudgetStr({
      meta_estipulado: b.meta_estipulado ? fmtMoney(b.meta_estipulado) : '',
      google_estipulado: b.google_estipulado ? fmtMoney(b.google_estipulado) : '',
    });
    setData({
      responsibles: Array.isArray(r.responsibles) ? r.responsibles : [],
      extra_phones: Array.isArray(r.extra_phones) ? r.extra_phones : [],
      budget: b,
      access: r.access || {},
      important_links: Array.isArray(r.important_links) ? r.important_links : [],
      notes: r.notes || '',
      spend: r.spend || { meta: 0, google: 0 },
      spend_month: r.spend_month || '',
    });
    setLoading(false);
  }, [clinic.id]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    setError(null);
    const { error: err } = await supabase.rpc('upsert_clinic_client_info', {
      p_clinic_id: clinic.id,
      p_data: {
        responsibles: data.responsibles,
        extra_phones: data.extra_phones,
        budget: data.budget,
        access: data.access,
        important_links: data.important_links,
        notes: data.notes,
      },
    });
    setSaving(false);
    if (err) { setError(err.message); return; }
    setSavedOk(true);
    onSaved?.();
    setTimeout(() => setSavedOk(false), 2000);
  };

  const copy = (val: string, id: string) => {
    navigator.clipboard.writeText(val);
    setCopied(id);
    setTimeout(() => setCopied(null), 1200);
  };

  const setAccess = (key: string, patch: Partial<AccessEntry>) =>
    setData(d => ({ ...d, access: { ...d.access, [key]: { ...d.access[key], ...patch } } }));

  const TABS = [
    { id: 'dados' as const, label: 'Dados do Cliente', Icon: Building2 },
    { id: 'acessos' as const, label: 'Acessos', Icon: KeyRound },
    { id: 'links' as const, label: 'Links & Observações', Icon: LinkIcon },
  ];

  const inputCls = "w-full px-3 py-2 rounded-lg border border-slate-200 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-violet-300 bg-white text-slate-700 disabled:bg-slate-50 disabled:text-slate-400";
  const monthLabel = data.spend_month
    ? new Date(data.spend_month + '-02').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
    : '';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[88vh] flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div>
            <h3 className="text-base font-black text-slate-900">Informações da Clínica</h3>
            <p className="text-xs text-slate-400 font-medium">{clinic.name}</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors">
            <X className="w-4 h-4 text-slate-500" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 px-4 pt-3 border-b border-slate-100">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-t-lg transition-colors border-b-2 -mb-px",
                tab === t.id ? "border-violet-600 text-violet-700" : "border-transparent text-slate-400 hover:text-slate-600"
              )}
            >
              <t.Icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 text-violet-500 animate-spin" />
            </div>
          ) : (
            <>
              {/* ── DADOS DO CLIENTE ── */}
              {tab === 'dados' && (
                <div className="space-y-6">
                  {/* Verba de tráfego */}
                  <section>
                    <h4 className="text-xs font-black text-slate-500 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                      <TrendingUp className="w-3.5 h-3.5 text-teal-500" /> Verba de Tráfego
                    </h4>
                    <div className="grid grid-cols-2 gap-3">
                      {([['meta', 'Meta', 'meta_estipulado'], ['google', 'Google', 'google_estipulado']] as const).map(([ch, label, bkey]) => {
                        const est = (data.budget as any)[bkey] || 0;
                        const inv = (data.spend as any)[ch] || 0;
                        const pct = est > 0 ? Math.min(100, Math.round((inv / est) * 100)) : 0;
                        return (
                          <div key={ch} className="p-3 rounded-xl border border-slate-200 bg-slate-50/50">
                            <div className="text-[11px] font-bold text-slate-600 mb-2">{label}</div>
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Verba estipulada</label>
                            <input
                              disabled={!canEdit}
                              inputMode="decimal"
                              value={budgetStr[bkey]}
                              placeholder="R$ 0,00"
                              onChange={e => {
                                const raw = e.target.value;
                                setBudgetStr(s => ({ ...s, [bkey]: raw }));
                                setData(d => ({ ...d, budget: { ...d.budget, [bkey]: parseMoney(raw) } }));
                              }}
                              onBlur={() => setBudgetStr(s => ({ ...s, [bkey]: est ? fmtMoney(est) : '' }))}
                              className={cn(inputCls, "mt-1 mb-2")}
                            />
                            <div className="flex items-baseline justify-between text-[11px]">
                              <span className="text-slate-400 font-medium">Investido {monthLabel && `(${monthLabel})`}</span>
                              <span className="font-black text-slate-700">{fmtMoney(inv)}</span>
                            </div>
                            <div className="mt-1.5 h-1.5 rounded-full bg-slate-200 overflow-hidden">
                              <div className={cn("h-full rounded-full", pct >= 100 ? "bg-rose-500" : "bg-teal-500")} style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <p className="text-[10px] text-slate-400 mt-2">O valor investido é somado automaticamente dos lançamentos de Marketing do mês corrente.</p>
                  </section>

                  {/* Responsáveis */}
                  <EditableList
                    title="Responsáveis e Cargos"
                    Icon={Users}
                    iconColor="text-violet-500"
                    items={data.responsibles}
                    canEdit={canEdit}
                    onChange={items => setData(d => ({ ...d, responsibles: items }))}
                    empty={{ name: '', role: '', phone: '', email: '' }}
                    fields={[
                      { key: 'name', placeholder: 'Nome', flex: 2 },
                      { key: 'role', placeholder: 'Cargo', flex: 2 },
                      { key: 'phone', placeholder: 'Telefone', flex: 2 },
                    ]}
                  />

                  {/* Telefones adicionais */}
                  <EditableList
                    title="Telefones Adicionais"
                    Icon={Phone}
                    iconColor="text-emerald-500"
                    items={data.extra_phones}
                    canEdit={canEdit}
                    onChange={items => setData(d => ({ ...d, extra_phones: items }))}
                    empty={{ label: '', number: '' }}
                    fields={[
                      { key: 'label', placeholder: 'Descrição (ex: Recepção)', flex: 2 },
                      { key: 'number', placeholder: 'Número', flex: 2 },
                    ]}
                  />
                </div>
              )}

              {/* ── ACESSOS ── */}
              {tab === 'acessos' && (
                <div className="space-y-3">
                  {ACCESS_FIELDS.map(f => {
                    const entry = data.access[f.key] || {};
                    const pwId = `pw-${f.key}`;
                    return (
                      <div key={f.key} className="p-3.5 rounded-xl border border-slate-200">
                        <div className="flex items-center gap-1.5 mb-2.5">
                          <f.Icon className={cn("w-4 h-4", f.color)} />
                          <span className="text-xs font-black text-slate-700">{f.label}</span>
                          {entry.url && (
                            <a href={entry.url.startsWith('http') ? entry.url : `https://${entry.url}`} target="_blank" rel="noreferrer"
                              className="ml-auto text-slate-400 hover:text-violet-600" title="Abrir">
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          )}
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <input disabled={!canEdit} value={entry.url || ''} placeholder="URL / link"
                            onChange={e => setAccess(f.key, { url: e.target.value })} className={cn(inputCls, "col-span-2")} />
                          <input disabled={!canEdit} value={entry.login || ''} placeholder="Login / usuário"
                            onChange={e => setAccess(f.key, { login: e.target.value })} className={inputCls} />
                          <div className="relative">
                            <input disabled={!canEdit} type={showPw[pwId] ? 'text' : 'password'} value={entry.password || ''} placeholder="Senha"
                              onChange={e => setAccess(f.key, { password: e.target.value })} className={cn(inputCls, "pr-16")} autoComplete="new-password" />
                            <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
                              {entry.password && (
                                <button type="button" onClick={() => copy(entry.password!, pwId)} className="p-1 text-slate-400 hover:text-violet-600" title="Copiar">
                                  {copied === pwId ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                                </button>
                              )}
                              <button type="button" onClick={() => setShowPw(s => ({ ...s, [pwId]: !s[pwId] }))} className="p-1 text-slate-400 hover:text-slate-600" title="Mostrar/ocultar">
                                {showPw[pwId] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                              </button>
                            </div>
                          </div>
                          <input disabled={!canEdit} value={entry.note || ''} placeholder="Observação (opcional)"
                            onChange={e => setAccess(f.key, { note: e.target.value })} className={cn(inputCls, "col-span-2")} />
                        </div>
                      </div>
                    );
                  })}
                  <p className="text-[10px] text-slate-400 flex items-center gap-1">
                    <KeyRound className="w-3 h-3" /> Senhas ficam visíveis apenas para gestores da organização.
                  </p>
                </div>
              )}

              {/* ── LINKS & OBSERVAÇÕES ── */}
              {tab === 'links' && (
                <div className="space-y-6">
                  <EditableList
                    title="Links Importantes"
                    Icon={LinkIcon}
                    iconColor="text-sky-500"
                    items={data.important_links}
                    canEdit={canEdit}
                    onChange={items => setData(d => ({ ...d, important_links: items }))}
                    empty={{ label: '', url: '' }}
                    fields={[
                      { key: 'label', placeholder: 'Descrição', flex: 2 },
                      { key: 'url', placeholder: 'https://...', flex: 3 },
                    ]}
                  />
                  <div>
                    <h4 className="text-xs font-black text-slate-500 uppercase tracking-widest mb-2">Observações</h4>
                    <textarea
                      disabled={!canEdit}
                      value={data.notes}
                      onChange={e => setData(d => ({ ...d, notes: e.target.value }))}
                      rows={5}
                      placeholder="Anotações gerais sobre o cliente..."
                      className={cn(inputCls, "resize-none")}
                    />
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {canEdit && (
          <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-slate-100">
            <span className="text-xs text-rose-500 font-medium">{error}</span>
            <button
              onClick={save}
              disabled={saving || loading}
              className="flex items-center gap-2 px-5 py-2.5 bg-violet-600 hover:bg-violet-700 disabled:bg-slate-100 disabled:text-slate-400 text-white rounded-xl font-black text-sm transition-all"
            >
              {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Salvando...</>
                : savedOk ? <><Check className="w-4 h-4" /> Salvo!</>
                : <><Save className="w-4 h-4" /> Salvar</>}
            </button>
          </div>
        )}
      </motion.div>
    </div>
  );
}

// Lista genérica de linhas editáveis (responsáveis, telefones, links).
function EditableList<T extends Record<string, any>>({
  title, Icon, iconColor, items, canEdit, onChange, empty, fields,
}: {
  title: string;
  Icon: React.ElementType;
  iconColor: string;
  items: T[];
  canEdit: boolean;
  onChange: (items: T[]) => void;
  empty: T;
  fields: { key: keyof T & string; placeholder: string; flex: number }[];
}) {
  const inputCls = "w-full px-3 py-2 rounded-lg border border-slate-200 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-violet-300 bg-white text-slate-700";
  return (
    <section>
      <div className="flex items-center justify-between mb-2.5">
        <h4 className="text-xs font-black text-slate-500 uppercase tracking-widest flex items-center gap-1.5">
          <Icon className={cn("w-3.5 h-3.5", iconColor)} /> {title}
        </h4>
        {canEdit && (
          <button
            onClick={() => onChange([...items, { ...empty }])}
            className="flex items-center gap-1 text-[11px] font-bold text-violet-600 hover:text-violet-700"
          >
            <Plus className="w-3.5 h-3.5" /> Adicionar
          </button>
        )}
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-slate-300 italic">Nenhum registro.</p>
      ) : (
        <div className="space-y-2">
          {items.map((item, i) => (
            <div key={i} className="flex items-center gap-2">
              {fields.map(f => (
                <input
                  key={f.key}
                  disabled={!canEdit}
                  value={item[f.key] || ''}
                  placeholder={f.placeholder}
                  onChange={e => {
                    const next = [...items];
                    next[i] = { ...next[i], [f.key]: e.target.value };
                    onChange(next);
                  }}
                  className={inputCls}
                  style={{ flex: f.flex }}
                />
              ))}
              {canEdit && (
                <button
                  onClick={() => onChange(items.filter((_, j) => j !== i))}
                  className="p-1.5 text-slate-300 hover:text-rose-500 transition-colors shrink-0"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
