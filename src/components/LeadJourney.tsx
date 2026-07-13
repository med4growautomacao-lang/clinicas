import React, { useEffect, useState } from "react";
import { Route, Instagram, FileText, MousePointerClick, MessageCircle, Store, Loader2, Share2 } from "lucide-react";
import { supabase } from "../lib/supabase";
import { cn } from "@/src/lib/utils";

// Timeline dos pontos de contato do lead (multi-toque).
// Existe porque a tabela `leads` guarda UMA atribuição só. Os contatos vivem em lead_touchpoints,
// e os cliques anônimos são amarrados à pessoa pelo rast_id quando ela finalmente conversa.
//
// O ÚLTIMO toque é destacado: desde 13/07 a atribuição do lead é last-touch atômica, ou seja, é ele
// que define a origem/campanha que aparece nos painéis.

interface Touchpoint {
    occurred_at: string;
    channel: string;
    source: string | null;
    ad_platform: string | null;
    campaign: string | null;
    adset: string | null;
    ad: string | null;
    detail: string | null;
    link_name: string | null;
    is_conversion: boolean;
}

// Duas dimensões independentes:
//   CANAL  = por onde a pessoa falou (WhatsApp, formulário do site, formulário do Meta, balcão)
//   ORIGEM = o que a trouxe (anúncio Meta/Google, Instagram, ou orgânico)
// Antes estavam misturadas: "meta_ads" era gravado como canal, quando é origem — quem clica no
// anúncio e cai no WhatsApp tem canal=whatsapp + origem=meta_ads.
const CHANNEL_LABEL: Record<string, string> = {
    whatsapp: 'WhatsApp',
    site_forms: 'Formulário do site',
    meta_forms: 'Formulário do Meta',
    balcao: 'Balcão',
    manual: 'Cadastro manual',
};

// Origem nunca é "balcão": ou veio de anúncio (plataforma), ou é orgânico.
const SOURCE_LABEL: Record<string, string> = {
    instagram: 'Instagram',
    meta_ads: 'Meta Ads',
    google_ads: 'Google Ads',
};

// "Meta Ads" sozinho esconde metade da informação: o mesmo anúncio roda no Instagram, no Facebook e
// (desde pouco tempo) no Status do WhatsApp. O próprio WhatsApp diz de qual veio o clique.
const PLATFORM_LABEL: Record<string, string> = {
    instagram: 'Instagram',
    facebook: 'Facebook',
    whatsapp: 'Status',
};

// Com vários links (bio, story, cartão), "veio pelo WhatsApp" não diz nada — o que importa é por
// QUAL link ela passou.
function titleOf(t: Touchpoint) {
    if (t.link_name) return t.link_name;
    return CHANNEL_LABEL[t.channel] || t.channel;
}

function iconOf(t: Touchpoint) {
    if (t.channel === 'meta_forms' || t.channel === 'site_forms') return FileText;
    if (t.channel === 'balcao' || t.channel === 'manual') return Store;
    if (t.source === 'instagram' || t.ad_platform === 'instagram') return Instagram;
    if (t.source) return MousePointerClick;   // clique em anúncio
    return MessageCircle;                      // WhatsApp orgânico
}

function fmt(iso: string) {
    return new Date(iso).toLocaleString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        day: '2-digit', month: '2-digit', year: '2-digit',
        hour: '2-digit', minute: '2-digit',
    });
}

export function LeadJourney({ leadId, fallbackCampaign, fallbackAd }: {
    leadId: string;
    fallbackCampaign?: string | null;
    fallbackAd?: string | null;
}) {
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

    // Leads anteriores ao rastreio de jornada não têm toques. Ainda assim mostramos a campanha que
    // está gravada no lead — sem isto, remover o antigo bloco "UTMs capturadas" apagaria a
    // informação da tela para toda a base histórica.
    if (data.length === 0) {
        if (!fallbackCampaign && !fallbackAd) return null;
        return (
            <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                <div className="flex items-center gap-1.5 mb-2 text-slate-500">
                    <Share2 className="w-3.5 h-3.5" />
                    <span className="text-[10px] font-bold uppercase tracking-wider">Origem</span>
                </div>
                <p className="text-xs font-semibold text-slate-700 truncate" title={fallbackCampaign || fallbackAd || ''}>
                    {[fallbackCampaign, fallbackAd].filter(Boolean).join(' · ')}
                </p>
                <p className="text-[10px] text-slate-400 mt-1">
                    Lead anterior ao rastreio de jornada — sem histórico de contatos.
                </p>
            </div>
        );
    }

    return (
        <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-4">
            <div className="flex items-center gap-1.5 mb-3.5 text-slate-500">
                <Route className="w-3.5 h-3.5" />
                <span className="text-[10px] font-bold uppercase tracking-wider">
                    Jornada · {data.length} {data.length === 1 ? 'contato' : 'contatos'}
                </span>
            </div>

            <ol>
                {data.map((t, i) => {
                    const Icon = iconOf(t);
                    const isLast = i === data.length - 1;   // last-touch = a origem que vale hoje
                    return (
                        <li key={i} className="flex gap-3">
                            {/* trilho */}
                            <div className="flex flex-col items-center">
                                <div className={cn(
                                    "w-6 h-6 rounded-full flex items-center justify-center shrink-0 border",
                                    isLast
                                        ? "bg-teal-600 border-teal-600 text-white shadow-sm"
                                        : "bg-white border-slate-200 text-slate-400"
                                )}>
                                    <Icon className="w-3 h-3" />
                                </div>
                                {!isLast && <div className="w-px flex-1 bg-slate-200 my-1" />}
                            </div>

                            <div className={cn("min-w-0 flex-1", isLast ? "pb-0" : "pb-4")}>
                                <div className="flex items-baseline gap-2 flex-wrap">
                                    <span className={cn(
                                        "text-xs truncate",
                                        isLast ? "font-bold text-slate-900" : "font-medium text-slate-600"
                                    )}>
                                        {titleOf(t)}
                                    </span>

                                    {/* A origem é sempre mostrada: sem selo, "orgânico" seria confundido
                                        com falta de dado. Origem nula = orgânico, por definição. */}
                                    <span className={cn(
                                        "px-1.5 py-0.5 rounded-full text-[9px] font-bold",
                                        !t.source
                                            ? "bg-slate-100 text-slate-400"
                                            : isLast ? "bg-teal-100 text-teal-700" : "bg-slate-100 text-slate-500"
                                    )}>
                                        {t.source ? (SOURCE_LABEL[t.source] || t.source) : 'Orgânico'}
                                    </span>

                                    {/* Em qual plataforma o anúncio foi visto. Só existe para cliques
                                        captados a partir de 13/07 — antes disso o dado era descartado. */}
                                    {t.ad_platform && (
                                        <span className={cn(
                                            "px-1.5 py-0.5 rounded-full text-[9px] font-bold border",
                                            isLast
                                                ? "border-teal-200 text-teal-700"
                                                : "border-slate-200 text-slate-400"
                                        )}>
                                            {PLATFORM_LABEL[t.ad_platform] || t.ad_platform}
                                        </span>
                                    )}

                                    <span className={cn("text-[10px]", isLast ? "text-slate-600 font-semibold" : "text-slate-400")}>
                                        {fmt(t.occurred_at)}
                                    </span>

                                    {isLast && (
                                        <span className="px-1.5 py-0.5 rounded-full bg-slate-900 text-white text-[9px] font-bold uppercase tracking-wide">
                                            origem atual
                                        </span>
                                    )}
                                    {t.is_conversion && !isLast && (
                                        <span className="text-[9px] text-slate-400 font-semibold uppercase">conversou</span>
                                    )}
                                </div>

                                {(t.campaign || t.ad || t.detail) && (
                                    <p className={cn(
                                        "text-[10px] truncate mt-0.5",
                                        isLast ? "text-slate-600 font-medium" : "text-slate-400"
                                    )}>
                                        {[
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

            {data.length > 1 && (
                <p className="text-[10px] text-slate-400 mt-3 pt-2.5 border-t border-slate-200">
                    A origem do lead nos painéis é a do <span className="font-semibold text-slate-500">último contato</span>.
                </p>
            )}
        </div>
    );
}
