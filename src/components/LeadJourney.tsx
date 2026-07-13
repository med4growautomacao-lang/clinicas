import React, { useEffect, useState } from "react";
import { Route, Instagram, FileText, MousePointerClick, Loader2 } from "lucide-react";
import { supabase } from "../lib/supabase";
import { cn } from "@/src/lib/utils";

// Timeline dos pontos de contato do lead (multi-toque).
// Existe porque a tabela `leads` guarda só UMA atribuição (first-touch): o merge usa COALESCE, que
// mantém o primeiro e descarta os seguintes. Os toques vivem em lead_touchpoints, e os cliques
// anônimos são amarrados à pessoa pelo rast_id quando ela finalmente conversa.

interface Touchpoint {
    occurred_at: string;
    channel: string;
    source: string | null;
    campaign: string | null;
    adset: string | null;
    ad: string | null;
    detail: string | null;
    link_name: string | null;   // qual link do gerenciador trouxe o toque
    is_conversion: boolean;
}

const CHANNEL_LABEL: Record<string, string> = {
    link: 'Link de redirecionamento',
    meta_ads: 'Anúncio Meta (WhatsApp)',
    meta_forms: 'Formulário do Meta',
    site_forms: 'Formulário do site',
    whatsapp: 'WhatsApp',
};

// Com múltiplos links (bio, story, cartão), "veio de um link" não diz nada — o que importa é QUAL.
function titleOf(t: Touchpoint) {
    if (t.channel === 'link' && t.link_name) return t.link_name;
    return CHANNEL_LABEL[t.channel] || t.channel;
}

function channelIcon(t: Touchpoint) {
    if (t.channel === 'meta_forms' || t.channel === 'site_forms') return FileText;
    if (t.source === 'instagram') return Instagram;
    if (t.channel === 'meta_ads') return MousePointerClick;
    return MousePointerClick;
}

function fmt(iso: string) {
    return new Date(iso).toLocaleString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        day: '2-digit', month: '2-digit',
        hour: '2-digit', minute: '2-digit',
    });
}

export function LeadJourney({ leadId }: { leadId: string }) {
    const [data, setData] = useState<Touchpoint[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let alive = true;
        (async () => {
            setLoading(true);
            const { data: rows } = await supabase.rpc('get_lead_journey', { p_lead_id: leadId });
            if (!alive) return;
            setData((rows as Touchpoint[]) || []);
            setLoading(false);
        })();
        return () => { alive = false; };
    }, [leadId]);

    if (loading) {
        return (
            <div className="flex items-center justify-center py-4 text-slate-300">
                <Loader2 className="w-4 h-4 animate-spin" />
            </div>
        );
    }

    // Sem toques registrados não vale ocupar espaço no modal (lead antigo, ou entrada manual).
    if (data.length === 0) return null;

    return (
        <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
            <div className="flex items-center gap-1.5 mb-3 text-slate-500">
                <Route className="w-3.5 h-3.5" />
                <span className="text-[10px] font-bold uppercase tracking-wider">
                    Jornada · {data.length} {data.length === 1 ? 'contato' : 'contatos'}
                </span>
            </div>

            <ol className="space-y-0">
                {data.map((t, i) => {
                    const Icon = channelIcon(t);
                    const last = i === data.length - 1;
                    return (
                        <li key={i} className="flex gap-2.5">
                            {/* trilho da timeline */}
                            <div className="flex flex-col items-center">
                                <div className={cn(
                                    "w-5 h-5 rounded-full flex items-center justify-center shrink-0 border",
                                    t.is_conversion
                                        ? "bg-teal-100 border-teal-300 text-teal-700"
                                        : "bg-white border-slate-200 text-slate-400"
                                )}>
                                    <Icon className="w-2.5 h-2.5" />
                                </div>
                                {!last && <div className="w-px flex-1 bg-slate-200 my-0.5" />}
                            </div>

                            <div className={cn("min-w-0 flex-1", last ? "pb-0" : "pb-3")}>
                                <div className="flex items-baseline gap-2 flex-wrap">
                                    <span className="text-[11px] font-bold text-slate-700">
                                        {titleOf(t)}
                                    </span>
                                    <span className="text-[10px] text-slate-400">{fmt(t.occurred_at)}</span>
                                    {t.is_conversion && (
                                        <span className="px-1.5 py-0.5 rounded-full bg-teal-100 text-teal-700 text-[9px] font-bold uppercase tracking-wide">
                                            conversou
                                        </span>
                                    )}
                                </div>

                                {(t.campaign || t.ad || t.detail) && (
                                    <p className="text-[10px] text-slate-500 truncate mt-0.5">
                                        {[
                                            // quando o título já é o nome do link, o canal vira o subtítulo
                                            t.channel === 'link' && t.link_name ? CHANNEL_LABEL.link : null,
                                            t.campaign,
                                            t.ad,
                                            !t.campaign && !t.ad ? t.detail : null,
                                        ].filter(Boolean).join(' · ')}
                                    </p>
                                )}
                            </div>
                        </li>
                    );
                })}
            </ol>

            {data.filter(t => t.is_conversion).length === 0 && (
                <p className="text-[10px] text-slate-400 mt-2 pt-2 border-t border-slate-200">
                    Nenhum destes contatos virou conversa ainda.
                </p>
            )}
        </div>
    );
}
