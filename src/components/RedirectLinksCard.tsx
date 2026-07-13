import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { ExternalLink, Copy, Check, Plus, Trash2, ToggleLeft, ToggleRight, Loader2 } from "lucide-react";
import { useRedirectLinks, RedirectLink } from "../hooks/useSupabase";
import { useToast } from "./ui/toast";

// Gerenciador de Links de Redirecionamento.
// Substitui o antigo card que só montava a URL em useState local (nada era salvo — por isso não
// havia como listar links ativos nem ter mais de um, e quem copiava o link sem preencher as UTMs
// gerava clique 'direto', sem origem).

const EMPTY_FORM = { name: '', utm_source: '', utm_medium: '', utm_campaign: '', lead_source: '' };

export function RedirectLinksCard({ connectToken, redirectMessage, onMessageChange }: {
    connectToken?: string | null;
    redirectMessage?: string | null;
    onMessageChange: (v: string) => void;
}) {
    const { data: links, loading, create, update, archive } = useRedirectLinks();
    const showToast = useToast();

    const [copiedId, setCopiedId] = useState<string | null>(null);
    const [adding, setAdding] = useState(false);
    const [saving, setSaving] = useState(false);
    const [form, setForm] = useState(EMPTY_FORM);

    const urlFor = (code: string) => `${window.location.origin}/r?l=${code}`;

    const copy = async (id: string, url: string) => {
        try { await navigator.clipboard.writeText(url); } catch {
            const inp = document.createElement('input');
            inp.value = url; document.body.appendChild(inp); inp.select();
            document.execCommand('copy'); document.body.removeChild(inp);
        }
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 2500);
    };

    const submit = async () => {
        if (!form.name.trim()) return;
        setSaving(true);
        const row = await create({
            name: form.name.trim(),
            utm_source: form.utm_source.trim() || null,
            utm_medium: form.utm_medium.trim() || null,
            utm_campaign: form.utm_campaign.trim() || null,
            lead_source: form.lead_source || null,
        });
        setSaving(false);
        if (!row) { showToast('Não foi possível criar o link', 'error'); return; }
        setForm(EMPTY_FORM);
        setAdding(false);
    };

    const originLabel = (l: RedirectLink) =>
        l.lead_source === 'instagram' ? 'Instagram'
            : l.lead_source === 'meta_ads' ? 'Meta Ads'
                : l.lead_source === 'google_ads' ? 'Google Ads'
                    : 'Orgânico';

    if (!connectToken) return null;

    const ativos = links.filter(l => !l.archived_at);
    const arquivados = links.filter(l => l.archived_at);

    return (
        <Card className="border border-violet-200 shadow-sm bg-white overflow-hidden">
            <CardHeader className="bg-violet-50 border-b border-violet-200 pb-5 px-8">
                <div className="flex items-center gap-4">
                    <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center shadow-sm border border-violet-200">
                        <ExternalLink className="w-5 h-5 text-violet-600" />
                    </div>
                    <div>
                        <CardTitle className="text-base font-bold text-slate-800">Links de Redirecionamento</CardTitle>
                        <p className="text-xs text-slate-500 mt-0.5">Um link por canal (bio, stories, anúncio) — veja quantos leads cada um gerou</p>
                    </div>
                </div>
            </CardHeader>

            <CardContent className="p-6 space-y-6">
                <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Mensagem pré-preenchida</label>
                    <input
                        type="text"
                        value={redirectMessage || ''}
                        onChange={e => onMessageChange(e.target.value)}
                        placeholder="Olá! Gostaria de mais informações."
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-200"
                    />
                    <p className="text-[10px] text-slate-400">
                        Lead verá: <span className="font-mono text-slate-500">{redirectMessage || 'Olá! Gostaria de mais informações.'} [Protocolo 123456 não apague essa mensagem]</span>
                    </p>
                </div>

                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Seus links</label>
                        {!adding && (
                            <button
                                onClick={() => setAdding(true)}
                                className="px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors"
                            >
                                <Plus className="w-3.5 h-3.5" /> Novo link
                            </button>
                        )}
                    </div>

                    {adding && (
                        <div className="p-4 border border-violet-200 bg-violet-50/50 rounded-xl space-y-3">
                            <div className="space-y-1">
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Apelido do link</p>
                                <input
                                    autoFocus
                                    type="text"
                                    value={form.name}
                                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                                    placeholder="Ex: Bio do Instagram"
                                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-200"
                                />
                            </div>

                            <div className="space-y-1">
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Origem gravada no lead</p>
                                <select
                                    value={form.lead_source}
                                    onChange={e => setForm(f => ({ ...f, lead_source: e.target.value }))}
                                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-violet-200"
                                >
                                    <option value="">Orgânico (sem origem)</option>
                                    <option value="instagram">Instagram</option>
                                    <option value="meta_ads">Meta Ads</option>
                                    <option value="google_ads">Google Ads</option>
                                </select>
                                <p className="text-[10px] text-slate-400">É assim que o lead aparecerá no Kanban e nos painéis.</p>
                            </div>

                            <div className="grid grid-cols-3 gap-2">
                                {([
                                    { key: 'utm_source' as const, label: 'utm_source', ph: 'instagram' },
                                    { key: 'utm_medium' as const, label: 'utm_medium', ph: 'bio' },
                                    { key: 'utm_campaign' as const, label: 'utm_campaign', ph: 'promo-julho' },
                                ]).map(({ key, label, ph }) => (
                                    <div key={key} className="space-y-1">
                                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{label}</p>
                                        <input
                                            type="text"
                                            value={form[key]}
                                            onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                                            placeholder={ph}
                                            className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-200"
                                        />
                                    </div>
                                ))}
                            </div>

                            <div className="flex items-center gap-2 pt-1">
                                <Button
                                    onClick={submit}
                                    disabled={!form.name.trim() || saving}
                                    className="bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold"
                                >
                                    {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Criar link'}
                                </Button>
                                <Button
                                    variant="ghost"
                                    className="text-slate-500 text-xs"
                                    onClick={() => { setAdding(false); setForm(EMPTY_FORM); }}
                                >
                                    Cancelar
                                </Button>
                            </div>
                        </div>
                    )}

                    {loading ? (
                        <div className="flex items-center justify-center py-8 text-slate-400">
                            <Loader2 className="w-5 h-5 animate-spin" />
                        </div>
                    ) : ativos.length === 0 && !adding ? (
                        <div className="p-6 text-center border border-dashed border-slate-200 rounded-xl">
                            <p className="text-sm text-slate-500">Nenhum link ainda.</p>
                            <p className="text-xs text-slate-400 mt-1">Crie um link por canal e descubra qual traz mais leads.</p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {ativos.map(l => (
                                <div key={l.id} className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <p className="text-sm font-bold text-slate-800 truncate">{l.name}</p>
                                                <span className="shrink-0 px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 text-[10px] font-bold">
                                                    {originLabel(l)}
                                                </span>
                                                {!l.active && (
                                                    <span className="shrink-0 px-2 py-0.5 rounded-full bg-slate-200 text-slate-600 text-[10px] font-bold">Pausado</span>
                                                )}
                                            </div>
                                            <p className="text-xs font-mono text-slate-500 truncate mt-1">{urlFor(l.code)}</p>
                                        </div>

                                        <div className="flex items-center gap-1 shrink-0">
                                            <button
                                                onClick={() => copy(l.id, urlFor(l.code))}
                                                className="px-2.5 py-1.5 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors"
                                            >
                                                {copiedId === l.id ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                                                {copiedId === l.id ? 'Copiado!' : 'Copiar'}
                                            </button>
                                            <button
                                                onClick={() => update(l.id, { active: !l.active })}
                                                title={l.active ? 'Pausar link' : 'Reativar link'}
                                                className="p-1.5 text-slate-400 hover:text-slate-600 transition-colors"
                                            >
                                                {l.active ? <ToggleRight className="w-5 h-5" /> : <ToggleLeft className="w-5 h-5" />}
                                            </button>
                                            <button
                                                onClick={() => archive(l.id)}
                                                title="Arquivar link"
                                                className="p-1.5 text-slate-400 hover:text-red-500 transition-colors"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-6 border-t border-slate-200">
                                        {([
                                            { label: 'Cliques', value: l.cliques },
                                            { label: 'Leads', value: l.leads },
                                            { label: 'Conversões', value: l.conversoes },
                                        ]).map(({ label, value }) => (
                                            <div key={label} className="pt-2">
                                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{label}</p>
                                                <p className="text-lg font-bold text-slate-800 leading-tight">{value ?? 0}</p>
                                            </div>
                                        ))}
                                        {l.ultimo_clique && (
                                            <div className="pt-2 ml-auto text-right">
                                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Último clique</p>
                                                <p className="text-xs text-slate-600">{new Date(l.ultimo_clique).toLocaleDateString('pt-BR')}</p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {arquivados.length > 0 && (
                        <details className="pt-1">
                            <summary className="text-xs text-slate-400 cursor-pointer hover:text-slate-600">
                                {arquivados.length} link{arquivados.length > 1 ? 's' : ''} arquivado{arquivados.length > 1 ? 's' : ''}
                            </summary>
                            <div className="mt-2 space-y-1">
                                {arquivados.map(l => (
                                    <div key={l.id} className="flex items-center justify-between px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg">
                                        <p className="text-xs text-slate-500 truncate">{l.name}</p>
                                        <p className="text-[10px] text-slate-400 shrink-0 ml-3">{l.cliques} cliques · {l.leads} leads</p>
                                    </div>
                                ))}
                            </div>
                        </details>
                    )}
                </div>

                <p className="text-[10px] text-slate-400 leading-relaxed">
                    Ao clicar, o WhatsApp abre com a mensagem pré-preenchida e um protocolo. Quando a pessoa envia a mensagem,
                    a origem é gravada no lead automaticamente.
                </p>
            </CardContent>
        </Card>
    );
}
