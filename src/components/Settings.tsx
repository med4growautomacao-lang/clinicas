import React, { useState, useEffect, useMemo, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import {
    Palette,
    Building2,
    Bell,
    Lock,
    Globe,
    Camera,
    Check,
    Trash2,
    CloudUpload,
    Plug,
    MessageCircle,
    QrCode,
    Wifi,
    WifiOff,
    RefreshCw,
    Shield,
    ExternalLink,
    Copy,
    CheckCircle2,
    AlertTriangle,
    Smartphone,
    Loader2,
    X,
    Plus,
    UserCircle,
    Clock,
    DollarSign,
    ClipboardList,
    Edit2,
    ToggleLeft,
    ToggleRight,
    Package,
    FileText,
    Maximize2,
} from "lucide-react";
import { cn } from "@/src/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { useSettings, useProtocols, Protocol, useProducts, Product, ProductAttribute, useQuoteImages, Clinic, AIConfig, WhatsappInstance } from "../hooks/useSupabase";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import { useToast } from "./ui/toast";
import { MoneyInput } from "./ui/money-input";
import { QuoteDocument, formatValidade, useImageDataUrl } from "./QuoteDocument";
import { ProductionOrderDocument } from "./ProductionOrderDocument";
import MetaLogo from "../assets/logos/Logo Metaads.png";
import GoogleLogo from "../assets/logos/Logo Googleads.png";
import WhatsappLogo from "../assets/logos/Logo Whatsapp.png";

// Formata um numero +55DDDXXXXXXXX(X) para "+55 (DD) XXXXX-XXXX" exibivel
function formatBrazilianPhone(raw?: string | null): string {
    if (!raw) return '';
    const d = String(raw).replace(/\D/g, '');
    if (d.length === 13 && d.startsWith('55')) return `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`;
    if (d.length === 12 && d.startsWith('55')) return `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4, 8)}-${d.slice(8)}`;
    if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
    if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return raw;
}

export function Settings() {
    const { userRole } = useAuth();
    const showToast = useToast();
    const { clinic, aiConfig, whatsapp, loading, updateClinic, updateAI, updateWhatsapp, generateConnectToken } = useSettings();
    const [activeTab, setActiveTab] = useState<"clinic" | "integrations" | "protocols" | "products">(() => (localStorage.getItem('settingsTab') as any) || "clinic");
    const [activeIntTab, setActiveIntTab] = useState<'whatsapp' | 'meta' | 'google'>(() => (localStorage.getItem('settingsIntTab') as any) || 'whatsapp');
    
    // Local states for editing
    const [localClinic, setLocalClinic] = useState<Partial<Clinic>>({});
    const [localAI, setLocalAI] = useState<Partial<AIConfig>>({});
    const [localWA, setLocalWA] = useState<Partial<WhatsappInstance>>({});
    const [saving, setSaving] = useState(false);
    const [connecting, setConnecting] = useState(false);
    const [linkCopied, setLinkCopied] = useState(false);

    // Protocols
    const { data: protocols, create: createProtocol, update: updateProtocol, remove: removeProtocol } = useProtocols();
    const [protocolModal, setProtocolModal] = useState<{ open: boolean; item: Partial<Protocol> | null }>({ open: false, item: null });
    const [savingProtocol, setSavingProtocol] = useState(false);

    // Produtos (catalogo generico e personalizavel)
    const { data: products, create: createProduct, update: updateProduct, remove: removeProduct } = useProducts();
    const [productModal, setProductModal] = useState<{ open: boolean; item: Partial<Product> | null }>({ open: false, item: null });
    const [savingProduct, setSavingProduct] = useState(false);

    // Modelo padrao do orcamento (pre-preenche o modal do Kanban)
    const [quoteTplOpen, setQuoteTplOpen] = useState(false);
    // Modelo da ordem de producao
    const [poTplOpen, setPoTplOpen] = useState(false);

    // Banco de fotos enviadas com o orcamento
    const { data: quoteImages, upload: uploadQuoteImage, toggleSend: toggleQuoteImage, remove: removeQuoteImage } = useQuoteImages();
    const quoteImgInputRef = useRef<HTMLInputElement>(null);
    const [uploadingImg, setUploadingImg] = useState(false);
    const handleQuoteImageUpload = async (files: FileList | null) => {
        if (!files || !files.length) return;
        setUploadingImg(true);
        for (const f of Array.from(files)) {
            if (f.type.startsWith('image/')) await uploadQuoteImage(f);
        }
        setUploadingImg(false);
        if (quoteImgInputRef.current) quoteImgInputRef.current.value = '';
    };

    const loadedClinicId = useRef<string | null>(null);

    useEffect(() => {
        // Reseta dados locais sempre que a clínica mudar (troca de visualização pelo org-admin)
        const clinicChanged = clinic && clinic.id !== loadedClinicId.current;
        if (clinic && (clinicChanged || Object.keys(localClinic).length === 0)) {
            setLocalClinic(clinic);
            loadedClinicId.current = clinic.id;
        }
        if (aiConfig && (clinicChanged || Object.keys(localAI).length === 0)) setLocalAI(aiConfig);
        if (whatsapp) setLocalWA(whatsapp);
    }, [clinic, aiConfig, whatsapp]);

    const hasChanges = useMemo(() => {
        if (!clinic || !aiConfig) return false;
        const isDifferent = (a: any, b: any) => JSON.stringify(a) !== JSON.stringify(b);
        return isDifferent(clinic, localClinic) || 
               isDifferent(aiConfig, localAI) || 
               (whatsapp && isDifferent(whatsapp, localWA));
    }, [clinic, aiConfig, whatsapp, localClinic, localAI, localWA]);

    const handleDiscard = () => {
        if (clinic) setLocalClinic(clinic);
        if (aiConfig) setLocalAI(aiConfig);
        if (whatsapp) setLocalWA(whatsapp);
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            if (activeTab === 'clinic') {
                await Promise.all([updateClinic(localClinic), updateAI(localAI)]);
            } else if (activeTab === 'integrations') {
                // Salva tanto WhatsApp quanto as novas configurações do Meta no Clinic
                await Promise.all([
                    updateWhatsapp(localWA),
                    updateClinic(localClinic)
                ]);
            }
        } finally {
            setSaving(false);
        }
    };

    // Timeout total da tentativa. O cron de zombie recovery limpa em 3min;
    // aqui o frontend so reseta o spinner de "Aguardando QR..." apos 2min.
    const ATTEMPT_TIMEOUT_MS = 120_000;
    const attemptStartRef = useRef<number | null>(null);

    useEffect(() => {
        let timeoutId: any;
        if (whatsapp?.status === 'connecting') {
            if (!attemptStartRef.current) attemptStartRef.current = Date.now();
            const elapsed = Date.now() - attemptStartRef.current;
            const remaining = Math.max(0, ATTEMPT_TIMEOUT_MS - elapsed);
            timeoutId = setTimeout(async () => {
                attemptStartRef.current = null;
                try {
                    await supabase.functions.invoke('whatsapp-orchestrator', {
                        body: { action: 'cancel', clinic_id: clinic?.id },
                    });
                } catch (err) {
                    console.error('Erro ao cancelar conexão por timeout:', err);
                }
            }, remaining);
        } else {
            attemptStartRef.current = null;
        }
        return () => { if (timeoutId) clearTimeout(timeoutId); };
    }, [whatsapp?.status, clinic?.id]);

    const handleWhatsappConnect = async () => {
        if (!clinic?.id) return;
        setConnecting(true);
        try {
            const { data, error } = await supabase.functions.invoke('whatsapp-orchestrator', {
                body: { action: 'start', clinic_id: clinic.id },
            });
            if (error) throw error;
            if (data && data.success === false) throw new Error(data.error || 'Falha ao iniciar conexão');
        } catch (error: any) {
            console.error('Erro ao conectar WhatsApp:', error);
            showToast('Erro ao iniciar conexão: ' + (error.message || error), 'error');
        } finally {
            setConnecting(false);
        }
    };

    const handleWhatsappCancel = async () => {
        if (!clinic?.id) return;
        try {
            await supabase.functions.invoke('whatsapp-orchestrator', {
                body: { action: 'cancel', clinic_id: clinic.id },
            });
        } catch (error) {
            console.error('Erro ao cancelar conexão:', error);
        }
    };

    const handleWhatsappDisconnect = async () => {
        if (!clinic?.id) return;
        try {
            await supabase.functions.invoke('whatsapp-orchestrator', {
                body: { action: 'disconnect', clinic_id: clinic.id },
            });
        } catch (error) {
            console.error('Erro ao desconectar:', error);
        }
    };

    const handleCopyLink = async () => {
        let token = whatsapp?.connect_token;
        if (!token) {
            token = await generateConnectToken() ?? undefined;
        }
        if (!token) return;
        const url = `${window.location.origin}/connect?token=${token}`;
        try {
            await navigator.clipboard.writeText(url);
            setLinkCopied(true);
            setTimeout(() => setLinkCopied(false), 2500);
        } catch {
            // Fallback: prompt para copiar manualmente
            const input = document.createElement('input');
            input.value = url;
            document.body.appendChild(input);
            input.select();
            document.execCommand('copy');
            document.body.removeChild(input);
            setLinkCopied(true);
            setTimeout(() => setLinkCopied(false), 2500);
        }
    };

    const [connectLink, setConnectLink] = useState<string | null>(null);

    const handleShowLink = async () => {
        let token = whatsapp?.connect_token;
        if (!token) {
            token = await generateConnectToken() ?? undefined;
        }
        if (!token) return;
        setConnectLink(`${window.location.origin}/connect?token=${token}`);
    };

    const isSecretaria = userRole === 'secretaria';
    const isVendedor = userRole === 'vendedor';
    const restrictedIntegrations = isSecretaria || isVendedor;

    useEffect(() => {
        if (restrictedIntegrations && (activeIntTab === 'meta' || activeIntTab === 'google')) {
            setActiveIntTab('whatsapp');
            localStorage.setItem('settingsIntTab', 'whatsapp');
        }
    }, [restrictedIntegrations, activeIntTab]);

    // "Produtos" deixou de ser aba (virou card dentro de "Dados da Clínica").
    // Redireciona qualquer settingsTab='products' antigo do localStorage.
    useEffect(() => {
        if (activeTab === 'products') {
            setActiveTab('clinic');
            localStorage.setItem('settingsTab', 'clinic');
        }
    }, [activeTab]);

    // Deep-link vindo do banner global (WhatsApp desconectado): leva direto
    // para Integracoes > WhatsApp.
    useEffect(() => {
        const handler = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            if (detail?.tab === 'integrations') {
                setActiveTab('integrations');
                localStorage.setItem('settingsTab', 'integrations');
            }
            if (detail?.intTab) {
                setActiveIntTab(detail.intTab);
                localStorage.setItem('settingsIntTab', detail.intTab);
            }
        };
        window.addEventListener('settings-deeplink', handler);
        return () => window.removeEventListener('settings-deeplink', handler);
    }, []);

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="w-8 h-8 text-teal-600 animate-spin" />
            </div>
        );
    }

    const tabs = [
        { id: "clinic", label: "Dados da Clínica", icon: Building2, color: "text-emerald-600" },
        { id: "integrations", label: "Integrações", icon: Plug, color: "text-violet-600" },
    ];

    const handleSaveProtocol = async () => {
        if (!protocolModal.item?.name?.trim()) return;
        setSavingProtocol(true);
        if (protocolModal.item.id) {
            await updateProtocol(protocolModal.item.id, {
                name: protocolModal.item.name,
                description: protocolModal.item.description ?? null,
                price: protocolModal.item.price ?? null,
                is_active: protocolModal.item.is_active ?? true,
            });
        } else {
            await createProtocol({
                name: protocolModal.item.name,
                description: protocolModal.item.description ?? null,
                price: protocolModal.item.price ?? null,
                is_active: true,
            });
        }
        setSavingProtocol(false);
        setProtocolModal({ open: false, item: null });
    };

    const handleSaveProduct = async () => {
        const item = productModal.item;
        if (!item?.name?.trim()) return;
        setSavingProduct(true);
        // Descarta campos extras totalmente vazios
        const cleanAttrs = (item.attributes ?? []).filter(a => (a.label?.trim() || a.value?.trim()));
        const payload = {
            name: item.name.trim(),
            description: item.description?.trim() || null,
            unit: 'm²',
            unit_price: item.unit_price ?? 0,
            attributes: cleanAttrs,
            is_active: item.is_active ?? true,
            charge_by_area: true,
        };
        if (item.id) {
            await updateProduct(item.id, payload);
        } else {
            await createProduct(payload);
        }
        setSavingProduct(false);
        setProductModal({ open: false, item: null });
    };

    // Edicao dos campos personalizados (attributes) dentro do modal de produto
    const addProductAttr = () => setProductModal(prev => prev.item
        ? { ...prev, item: { ...prev.item, attributes: [...(prev.item.attributes ?? []), { label: '', value: '' }] } }
        : prev);
    const updateProductAttr = (i: number, field: keyof ProductAttribute, val: string) => setProductModal(prev => prev.item
        ? { ...prev, item: { ...prev.item, attributes: (prev.item.attributes ?? []).map((a, idx) => idx === i ? { ...a, [field]: val } : a) } }
        : prev);
    const removeProductAttr = (i: number) => setProductModal(prev => prev.item
        ? { ...prev, item: { ...prev.item, attributes: (prev.item.attributes ?? []).filter((_, idx) => idx !== i) } }
        : prev);

    return (
        <div className="space-y-8 h-full flex flex-col">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 px-1">
                <motion.div
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                >
                    <h2 className="text-3xl font-bold tracking-tight text-slate-900">
                        Configurações <span className="text-teal-600">do Sistema</span>
                    </h2>
                    <p className="text-slate-500 font-medium text-base">
                        Personalize o ambiente e o comportamento do sistema.
                    </p>
                </motion.div>

                <div className="flex bg-white p-1 rounded-lg w-fit shadow-sm border border-slate-200">
                    {tabs.map((tab) => {
                        const Icon = tab.icon;
                        const isActive = activeTab === tab.id;
                        return (
                            <button
                                key={tab.id}
                                onClick={() => { setActiveTab(tab.id as any); localStorage.setItem('settingsTab', tab.id); }}
                                className={cn(
                                    "flex items-center gap-2 px-5 py-2 text-sm font-semibold rounded-md transition-all",
                                    isActive
                                        ? "bg-teal-600 text-white shadow-sm"
                                        : "text-slate-500 hover:text-slate-900 hover:bg-slate-50"
                                )}
                            >
                                <Icon className={cn("w-4 h-4", isActive ? "text-white" : tab.color)} />
                                {tab.label}
                            </button>
                        );
                    })}
                </div>
            </div>

            {activeTab === "integrations" && (
                <div className="flex bg-slate-50 p-1 rounded-xl w-fit shadow-sm border border-slate-200/60">
                    <button
                        onClick={() => { setActiveIntTab('whatsapp'); localStorage.setItem('settingsIntTab', 'whatsapp'); }}
                        className={cn(
                            "flex items-center gap-2.5 px-6 py-2 text-sm font-bold rounded-lg transition-all duration-200",
                            activeIntTab === 'whatsapp'
                                ? "bg-teal-600 text-white shadow-md shadow-teal-100"
                                : "text-slate-500 hover:text-slate-900 hover:bg-white"
                        )}
                    >
                        <MessageCircle className={cn("w-4 h-4", activeIntTab === 'whatsapp' ? "text-white" : "text-emerald-500")} />
                        WhatsApp
                    </button>
                    {!restrictedIntegrations && (
                        <button
                            onClick={() => { setActiveIntTab('meta'); localStorage.setItem('settingsIntTab', 'meta'); }}
                            className={cn(
                                "flex items-center gap-2.5 px-6 py-2 text-sm font-bold rounded-lg transition-all duration-200",
                                activeIntTab === 'meta'
                                    ? "bg-teal-600 text-white shadow-md shadow-teal-100"
                                    : "text-slate-500 hover:text-slate-900 hover:bg-white"
                            )}
                        >
                            <img src={MetaLogo} alt="Meta" className={cn("w-4 h-4 object-contain filter transition-all", activeIntTab === 'meta' ? 'brightness-0 invert' : 'brightness-100 opacity-60')} />
                            Meta Ads
                        </button>
                    )}
                    {!restrictedIntegrations && (
                        <button
                            onClick={() => { setActiveIntTab('google'); localStorage.setItem('settingsIntTab', 'google'); }}
                            className={cn(
                                "flex items-center gap-2.5 px-6 py-2 text-sm font-bold rounded-lg transition-all duration-200",
                                activeIntTab === 'google'
                                    ? "bg-teal-600 text-white shadow-md shadow-teal-100"
                                    : "text-slate-500 hover:text-slate-900 hover:bg-white"
                            )}
                        >
                            <img src={GoogleLogo} alt="Google" className={cn("w-4 h-4 object-contain filter transition-all", activeIntTab === 'google' ? 'brightness-0 invert' : 'brightness-100 opacity-60')} />
                            Google Ads
                        </button>
                    )}
                </div>
            )}

            <div className="flex-1 overflow-y-auto pr-2 pb-8 custom-scrollbar">
                <AnimatePresence mode="wait">
                    <motion.div
                        key={activeTab}
                        initial={{ opacity: 0, scale: 0.98 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.98 }}
                        transition={{ duration: 0.2 }}
                        className="space-y-6"
                    >

                        {activeTab === "clinic" && (
                            <>
                            <ClinicSettings
                                data={localClinic}
                                onChange={(updates) => setLocalClinic(prev => ({ ...prev, ...updates }))}
                            />
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto">
                                <Card className="border border-slate-200 shadow-sm">
                                    <CardHeader>
                                        <CardTitle className="text-lg font-bold text-slate-900 flex items-center gap-2">
                                            <Clock className="w-5 h-5 text-teal-600" />
                                            SLA e Expediente
                                        </CardTitle>
                                    </CardHeader>
                                    <CardContent className="space-y-4">
                                        <div className="space-y-1.5">
                                            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider pl-1">Tempo de resposta (SLA)</label>
                                            <div className="flex items-center gap-2">
                                                <input
                                                    type="number"
                                                    min={1}
                                                    value={(localAI as any).sla_minutes ?? 120}
                                                    onChange={(e) => setLocalAI(prev => ({ ...prev, sla_minutes: Number(e.target.value) }))}
                                                    className="w-24 px-3 py-2 border border-slate-200 rounded-lg font-medium focus:ring-2 focus:ring-teal-100 focus:border-teal-600 outline-none text-sm"
                                                />
                                                <span className="text-sm text-slate-500 font-medium">minutos</span>
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-3">
                                            <div className="space-y-1.5">
                                                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider pl-1">Início do expediente</label>
                                                <input
                                                    type="time"
                                                    value={(localAI as any).business_hours?.start ?? '08:00'}
                                                    onChange={(e) => setLocalAI(prev => ({ ...prev, business_hours: { ...((prev as any).business_hours ?? { end: '18:00', days: [1,2,3,4,5] }), start: e.target.value } }))}
                                                    className="w-full px-3 py-2 border border-slate-200 rounded-lg font-medium focus:ring-2 focus:ring-teal-100 focus:border-teal-600 outline-none text-sm"
                                                />
                                            </div>
                                            <div className="space-y-1.5">
                                                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider pl-1">Fim do expediente</label>
                                                <input
                                                    type="time"
                                                    value={(localAI as any).business_hours?.end ?? '18:00'}
                                                    onChange={(e) => setLocalAI(prev => ({ ...prev, business_hours: { ...((prev as any).business_hours ?? { start: '08:00', days: [1,2,3,4,5] }), end: e.target.value } }))}
                                                    className="w-full px-3 py-2 border border-slate-200 rounded-lg font-medium focus:ring-2 focus:ring-teal-100 focus:border-teal-600 outline-none text-sm"
                                                />
                                            </div>
                                        </div>
                                        <div className="space-y-1.5">
                                            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider pl-1">Dias de atendimento</label>
                                            <div className="flex gap-1.5 flex-wrap">
                                                {['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'].map((d, i) => {
                                                    const days: number[] = (localAI as any).business_hours?.days ?? [1,2,3,4,5];
                                                    const active = days.includes(i);
                                                    return (
                                                        <button
                                                            key={i}
                                                            type="button"
                                                            onClick={() => {
                                                                const newDays = active ? days.filter(x => x !== i) : [...days, i].sort();
                                                                setLocalAI(prev => ({ ...prev, business_hours: { ...((prev as any).business_hours ?? { start: '08:00', end: '18:00' }), days: newDays } }));
                                                            }}
                                                            className={cn(
                                                                "px-2.5 py-1 rounded text-xs font-bold border transition-all",
                                                                active ? "bg-teal-50 border-teal-600 text-teal-700" : "bg-white border-slate-200 text-slate-400 hover:border-teal-200"
                                                            )}
                                                        >{d}</button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                                <Card className="border border-slate-200 shadow-sm">
                                    <CardHeader>
                                        <CardTitle className="text-lg font-bold text-slate-900 flex items-center gap-2">
                                            <DollarSign className="w-5 h-5 text-teal-600" />
                                            Ticket Médio
                                        </CardTitle>
                                    </CardHeader>
                                    <CardContent>
                                        <div className="space-y-1.5">
                                            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider pl-1">Valor padrão por lead</label>
                                            <div className="flex items-center gap-2">
                                                <span className="text-sm font-bold text-slate-500">R$</span>
                                                <input
                                                    type="number"
                                                    min={0}
                                                    step={0.01}
                                                    value={(localAI as any).default_ticket_value ?? 0}
                                                    onChange={(e) => setLocalAI(prev => ({ ...prev, default_ticket_value: Number(e.target.value) }))}
                                                    className="w-36 px-3 py-2 border border-slate-200 rounded-lg font-medium focus:ring-2 focus:ring-teal-100 focus:border-teal-600 outline-none text-sm"
                                                    placeholder="0,00"
                                                />
                                            </div>
                                            <p className="text-xs text-slate-400 pl-1">Pré-preenchido automaticamente em novos leads.</p>
                                        </div>
                                    </CardContent>
                                </Card>
                            </div>
                            {!isSecretaria && <Card className="border border-slate-200 shadow-sm max-w-4xl mx-auto">
                                <CardHeader className="flex flex-row items-center justify-between">
                                    <CardTitle className="text-lg font-bold text-slate-900 flex items-center gap-2">
                                        <ClipboardList className="w-5 h-5 text-teal-600" />
                                        Protocolos de Atendimento
                                    </CardTitle>
                                    <Button onClick={() => setProtocolModal({ open: true, item: { name: '', description: '', price: null, is_active: true } })} className="gap-2">
                                        <Plus className="w-4 h-4" /> Novo Protocolo
                                    </Button>
                                </CardHeader>
                                <CardContent>
                                    {protocols.length === 0 ? (
                                        <div className="text-center py-12 text-slate-400">
                                            <ClipboardList className="w-10 h-10 mx-auto mb-3 opacity-30" />
                                            <p className="font-medium">Nenhum protocolo cadastrado</p>
                                            <p className="text-sm">Crie protocolos para vincular às consultas realizadas</p>
                                        </div>
                                    ) : (
                                        <div className="space-y-2">
                                            {protocols.map(p => (
                                                <div key={p.id} className="flex items-center justify-between p-3 rounded-xl border border-slate-100 hover:border-slate-200 bg-white transition-all group">
                                                    <div className="flex items-center gap-3 min-w-0">
                                                        <button onClick={() => updateProtocol(p.id, { is_active: !p.is_active })} className="shrink-0">
                                                            {p.is_active
                                                                ? <ToggleRight className="w-6 h-6 text-teal-500" />
                                                                : <ToggleLeft className="w-6 h-6 text-slate-300" />}
                                                        </button>
                                                        <div className="min-w-0">
                                                            <p className={cn("font-semibold text-sm truncate", !p.is_active && "text-slate-400 line-through")}>{p.name}</p>
                                                            {p.description && <p className="text-xs text-slate-400 truncate">{p.description}</p>}
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-3 shrink-0 ml-4">
                                                        {p.price != null && (
                                                            <span className="text-sm font-semibold text-emerald-600">
                                                                R$ {Number(p.price).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                                            </span>
                                                        )}
                                                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                            <button onClick={() => setProtocolModal({ open: true, item: { ...p } })} className="p-1.5 rounded-lg text-slate-400 hover:text-teal-600 hover:bg-teal-50 transition-colors"><Edit2 className="w-3.5 h-3.5" /></button>
                                                            <button onClick={() => removeProtocol(p.id)} className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </CardContent>
                            </Card>}
                            </>
                        )}
                        {activeTab === "integrations" && (
                            <IntegrationSettings
                                data={localWA}
                                onChange={(updates) => setLocalWA(prev => ({ ...prev, ...updates }))}
                                clinicData={localClinic}
                                onClinicChange={(updates) => setLocalClinic(prev => ({ ...prev, ...updates }))}
                                onSaveClinic={updateClinic}
                                onConnect={handleWhatsappConnect}
                                onCancel={handleWhatsappCancel}
                                onDisconnect={handleWhatsappDisconnect}
                                connecting={connecting}
                                onCopyLink={handleShowLink}
                                linkCopied={linkCopied}
                                activeIntTab={activeIntTab}
                            />
                        )}

                        {activeTab === "clinic" && !isSecretaria && (
                            <Card className="border border-slate-200 shadow-sm max-w-4xl mx-auto">
                                <CardHeader className="flex flex-row items-start justify-between gap-4">
                                    <div>
                                        <CardTitle className="text-lg font-bold text-slate-900 flex items-center gap-2">
                                            <Package className="w-5 h-5 text-teal-600" />
                                            Catálogo de Produtos
                                        </CardTitle>
                                        <p className="text-xs text-slate-400 mt-1 max-w-md">Cadastre produtos com unidade, valor e campos personalizados. No orçamento, basta escolher o produto e a quantidade — o total é calculado automaticamente.</p>
                                    </div>
                                    <Button onClick={() => setProductModal({ open: true, item: { name: '', description: '', unit: 'm²', unit_price: 0, attributes: [], is_active: true, charge_by_area: true } })} className="gap-2 shrink-0">
                                        <Plus className="w-4 h-4" /> Novo Produto
                                    </Button>
                                </CardHeader>
                                <CardContent>
                                    {products.length === 0 ? (
                                        <div className="text-center py-12 text-slate-400">
                                            <Package className="w-10 h-10 mx-auto mb-3 opacity-30" />
                                            <p className="font-medium">Nenhum produto cadastrado</p>
                                            <p className="text-sm">Crie produtos para orçar automaticamente por quantidade × valor</p>
                                        </div>
                                    ) : (
                                        <div className="space-y-2">
                                            {products.map(p => (
                                                <div key={p.id} className="flex items-center justify-between p-3 rounded-xl border border-slate-100 hover:border-slate-200 bg-white transition-all group">
                                                    <div className="flex items-center gap-3 min-w-0">
                                                        <button onClick={() => updateProduct(p.id, { is_active: !p.is_active })} className="shrink-0">
                                                            {p.is_active
                                                                ? <ToggleRight className="w-6 h-6 text-teal-500" />
                                                                : <ToggleLeft className="w-6 h-6 text-slate-300" />}
                                                        </button>
                                                        <div className="min-w-0">
                                                            <p className={cn("font-semibold text-sm truncate", !p.is_active && "text-slate-400 line-through")}>{p.name}</p>
                                                            <div className="flex items-center gap-1.5 flex-wrap mt-1">
                                                                {p.description && <span className="text-xs text-slate-400 truncate max-w-[200px]">{p.description}</span>}
                                                                {(p.attributes ?? []).slice(0, 4).map((a, i) => (
                                                                    <span key={i} className="text-[10px] font-medium bg-slate-50 border border-slate-100 text-slate-500 px-1.5 py-0.5 rounded">
                                                                        {a.label}{a.value ? `: ${a.value}` : ''}
                                                                    </span>
                                                                ))}
                                                                {(p.attributes?.length ?? 0) > 4 && <span className="text-[10px] text-slate-400">+{(p.attributes!.length - 4)}</span>}
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-3 shrink-0 ml-4">
                                                        <span className="text-sm font-semibold text-emerald-600 whitespace-nowrap">
                                                            R$ {Number(p.unit_price).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                                            <span className="text-xs font-normal text-slate-400"> /{p.unit}</span>
                                                        </span>
                                                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                            <button onClick={() => setProductModal({ open: true, item: { ...p, attributes: [...(p.attributes ?? [])] } })} className="p-1.5 rounded-lg text-slate-400 hover:text-teal-600 hover:bg-teal-50 transition-colors"><Edit2 className="w-3.5 h-3.5" /></button>
                                                            <button onClick={() => removeProduct(p.id)} className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        )}

                        {activeTab === "clinic" && !isSecretaria && (
                            <Card className="border border-slate-200 shadow-sm max-w-4xl mx-auto">
                                <CardHeader>
                                    <CardTitle className="text-lg font-bold text-slate-900 flex items-center gap-2">
                                        <FileText className="w-5 h-5 text-teal-600" />
                                        Configuração do Orçamento
                                    </CardTitle>
                                    <p className="text-xs text-slate-400 mt-1">Escolha o que fica disponível para seleção ao montar um orçamento no Kanban.</p>
                                </CardHeader>
                                <CardContent className="space-y-2">
                                    {[
                                        { key: 'quote_use_products' as const, label: 'Usar Produtos', desc: 'Itens do catálogo de produtos (unidade, valor e especificações).' },
                                        { key: 'quote_use_protocols' as const, label: 'Usar Protocolos', desc: 'Protocolos de atendimento (nome + valor).' },
                                    ].map(opt => {
                                        const on = (localClinic as any)[opt.key] !== false; // padrão: ligado
                                        return (
                                            <button
                                                key={opt.key}
                                                type="button"
                                                onClick={() => setLocalClinic(prev => ({ ...prev, [opt.key]: !on }))}
                                                className="w-full flex items-center justify-between gap-3 p-3 rounded-xl border border-slate-100 hover:border-slate-200 bg-white transition-all text-left"
                                            >
                                                <div className="min-w-0">
                                                    <p className="font-semibold text-sm text-slate-800">{opt.label}</p>
                                                    <p className="text-xs text-slate-400">{opt.desc}</p>
                                                </div>
                                                {on
                                                    ? <ToggleRight className="w-7 h-7 text-teal-500 shrink-0" />
                                                    : <ToggleLeft className="w-7 h-7 text-slate-300 shrink-0" />}
                                            </button>
                                        );
                                    })}
                                    <p className="text-[11px] text-slate-400 pt-1">Deixe pelo menos um marcado. Com os dois desmarcados, o orçamento usa entrada manual de valor.</p>

                                    {(() => {
                                        const on = (localClinic as any).quote_show_total !== false; // padrão: ligado
                                        return (
                                            <button
                                                type="button"
                                                onClick={() => setLocalClinic(prev => ({ ...prev, quote_show_total: !on }))}
                                                className="w-full flex items-center justify-between gap-3 p-3 rounded-xl border border-slate-100 hover:border-slate-200 bg-white transition-all text-left mt-2"
                                            >
                                                <div className="min-w-0">
                                                    <p className="font-semibold text-sm text-slate-800">Mostrar valor total</p>
                                                    <p className="text-xs text-slate-400">Mostra e envia o total da soma no orçamento (documento, mensagem e resumo). Desligado, some o total geral — os itens seguem com valor.</p>
                                                </div>
                                                {on
                                                    ? <ToggleRight className="w-7 h-7 text-teal-500 shrink-0" />
                                                    : <ToggleLeft className="w-7 h-7 text-slate-300 shrink-0" />}
                                            </button>
                                        );
                                    })()}

                                    <div className="pt-3 border-t border-slate-100 mt-2">
                                        <Button variant="outline" onClick={() => setQuoteTplOpen(true)} className="w-full gap-2">
                                            <FileText className="w-4 h-4 text-teal-600" /> Configurar modelo do orçamento
                                        </Button>
                                        <p className="text-[11px] text-slate-400 mt-2">Define a saudação, rodapé, validade, forma de pagamento e o formato que já vêm preenchidos no modal do Kanban.</p>
                                    </div>

                                    <div className="pt-4 border-t border-slate-100 mt-4">
                                        <div className="flex items-center justify-between gap-3 mb-2">
                                            <div>
                                                <label className="block text-sm font-bold text-slate-700">Fotos enviadas com o orçamento</label>
                                                <p className="text-[11px] text-slate-400 max-w-md">As fotos marcadas com ✓ vão junto no envio por WhatsApp (você ajusta por orçamento na hora do envio).</p>
                                            </div>
                                            <input ref={quoteImgInputRef} type="file" accept="image/*" multiple className="hidden" onChange={e => handleQuoteImageUpload(e.target.files)} />
                                            <Button variant="outline" onClick={() => quoteImgInputRef.current?.click()} disabled={uploadingImg} className="gap-2 shrink-0">
                                                {uploadingImg ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Adicionar fotos
                                            </Button>
                                        </div>
                                        {quoteImages.length === 0 ? (
                                            <p className="text-xs text-slate-400 bg-slate-50 border border-dashed border-slate-200 rounded-xl px-3 py-4 text-center">Nenhuma foto. Adicione fotos para enviar junto com o orçamento (ex.: modelos de tela, obras feitas).</p>
                                        ) : (
                                            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                                                {quoteImages.map(img => (
                                                    <div key={img.id} className="relative group rounded-xl overflow-hidden border border-slate-200 aspect-square bg-slate-100">
                                                        <img src={img.url} alt={img.name ?? ''} className={cn("w-full h-full object-cover transition-opacity", !img.send_by_default && "opacity-40")} />
                                                        <button
                                                            type="button"
                                                            onClick={() => toggleQuoteImage(img.id, !img.send_by_default)}
                                                            title={img.send_by_default ? 'Enviando — clique para não enviar' : 'Não enviando — clique para enviar'}
                                                            className={cn("absolute top-1 left-1 w-6 h-6 rounded-full flex items-center justify-center text-white shadow", img.send_by_default ? "bg-teal-600" : "bg-slate-400")}
                                                        >
                                                            {img.send_by_default ? <Check className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => removeQuoteImage(img)}
                                                            title="Remover"
                                                            className="absolute top-1 right-1 w-6 h-6 rounded-full bg-rose-600 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow"
                                                        >
                                                            <Trash2 className="w-3.5 h-3.5" />
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </CardContent>
                            </Card>
                        )}

                        {activeTab === "clinic" && !isSecretaria && (
                            <Card className="border border-slate-200 shadow-sm max-w-4xl mx-auto">
                                <CardHeader>
                                    <CardTitle className="text-lg font-bold text-slate-900 flex items-center gap-2">
                                        <Package className="w-5 h-5 text-teal-600" />
                                        Ordem de Produção
                                    </CardTitle>
                                    <p className="text-xs text-slate-400 mt-1">Documento interno para a produção, gerado a partir do orçamento do lead (botão no Editar do card).</p>
                                </CardHeader>
                                <CardContent>
                                    <Button variant="outline" onClick={() => setPoTplOpen(true)} className="w-full gap-2">
                                        <FileText className="w-4 h-4 text-teal-600" /> Configurar modelo da ordem de produção
                                    </Button>
                                    <p className="text-[11px] text-slate-400 mt-2">Define responsável, prazo de entrega, observações, se mostra preços e o formato padrão.</p>
                                </CardContent>
                            </Card>
                        )}

                    </motion.div>
                </AnimatePresence>
            </div>

            {/* Modal: Modelo da Ordem de Produção */}
            <AnimatePresence>
                {poTplOpen && (
                    <ProductionOrderTemplateModal
                        initial={(localClinic as any).production_order_template}
                        clinic={localClinic}
                        onClose={() => setPoTplOpen(false)}
                        onSave={async (tpl) => {
                            await updateClinic({ production_order_template: tpl });
                            setLocalClinic(prev => ({ ...prev, production_order_template: tpl }));
                            setPoTplOpen(false);
                        }}
                    />
                )}
            </AnimatePresence>

            {/* Modal: Modelo do Orçamento */}
            <AnimatePresence>
                {quoteTplOpen && (
                    <QuoteTemplateModal
                        initial={(localClinic as any).quote_template}
                        clinic={localClinic}
                        onClose={() => setQuoteTplOpen(false)}
                        onSave={async (tpl) => {
                            await updateClinic({ quote_template: tpl });
                            setLocalClinic(prev => ({ ...prev, quote_template: tpl }));
                            setQuoteTplOpen(false);
                        }}
                    />
                )}
            </AnimatePresence>

            {/* Modal: Produto */}
            <AnimatePresence>
                {productModal.open && productModal.item && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setProductModal({ open: false, item: null })}>
                        <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto custom-scrollbar" onClick={e => e.stopPropagation()}>
                            <div className="flex items-center justify-between">
                                <h3 className="font-bold text-slate-900 text-base">{productModal.item.id ? 'Editar Produto' : 'Novo Produto'}</h3>
                                <button onClick={() => setProductModal({ open: false, item: null })} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
                            </div>


                            <div className="space-y-3">
                                <div>
                                    <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">Nome *</label>
                                    <input
                                        type="text"
                                        placeholder="Ex: Tela Mosquiteira Fio 0,30"
                                        value={productModal.item.name ?? ''}
                                        onChange={e => setProductModal(prev => ({ ...prev, item: { ...prev.item!, name: e.target.value } }))}
                                        className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                                        autoFocus
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">Descrição</label>
                                    <input
                                        type="text"
                                        placeholder="Descrição opcional"
                                        value={productModal.item.description ?? ''}
                                        onChange={e => setProductModal(prev => ({ ...prev, item: { ...prev.item!, description: e.target.value } }))}
                                        className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">Valor por m²</label>
                                    <MoneyInput
                                        value={productModal.item.unit_price ?? 0}
                                        onChange={v => setProductModal(prev => ({ ...prev, item: { ...prev.item!, unit_price: v || 0 } }))}
                                    />
                                    <p className="text-[10px] text-slate-400 mt-1">Cobrado por m² (área = comprimento × altura). No orçamento o vendedor digita o comprimento e a altura. Crie um campo "altura" se quiser um valor padrão.</p>
                                </div>

                                <div className="pt-1">
                                    <div className="flex items-center justify-between mb-2">
                                        <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide">Campos personalizados</label>
                                        <button type="button" onClick={addProductAttr} className="text-xs font-bold text-teal-600 hover:text-teal-700 flex items-center gap-1">
                                            <Plus className="w-3.5 h-3.5" /> Adicionar campo
                                        </button>
                                    </div>
                                    {(productModal.item.attributes ?? []).length === 0 ? (
                                        <p className="text-xs text-slate-400 bg-slate-50 border border-dashed border-slate-200 rounded-xl px-3 py-3 text-center">
                                            Nenhum campo. Ex.: Fio, Malha, Material, Comprimento, Altura…
                                        </p>
                                    ) : (
                                        <div className="space-y-2">
                                            {(productModal.item.attributes ?? []).map((a, i) => (
                                                <div key={i} className="flex items-center gap-2">
                                                    <input
                                                        type="text"
                                                        placeholder="Rótulo (ex: Fio)"
                                                        value={a.label}
                                                        onChange={e => updateProductAttr(i, 'label', e.target.value)}
                                                        className="flex-1 min-w-0 border border-slate-200 rounded-lg px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                                                    />
                                                    <input
                                                        type="text"
                                                        placeholder="Valor (ex: 0,30 mm)"
                                                        value={a.value}
                                                        onChange={e => updateProductAttr(i, 'value', e.target.value)}
                                                        className="flex-1 min-w-0 border border-slate-200 rounded-lg px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                                                    />
                                                    <button type="button" onClick={() => removeProductAttr(i)} className="p-1.5 shrink-0 text-slate-300 hover:text-rose-500 transition-colors"><Trash2 className="w-4 h-4" /></button>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="flex gap-2 pt-2">
                                <Button variant="outline" className="flex-1" onClick={() => setProductModal({ open: false, item: null })}>Cancelar</Button>
                                <Button className="flex-1" onClick={handleSaveProduct} disabled={savingProduct || !productModal.item.name?.trim()}>
                                    {savingProduct ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Check className="w-4 h-4 mr-2" />}
                                    Salvar
                                </Button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Modal: Protocolo */}
            <AnimatePresence>
                {protocolModal.open && protocolModal.item && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setProtocolModal({ open: false, item: null })}>
                        <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4" onClick={e => e.stopPropagation()}>
                            <div className="flex items-center justify-between">
                                <h3 className="font-bold text-slate-900 text-base">{protocolModal.item.id ? 'Editar Protocolo' : 'Novo Protocolo'}</h3>
                                <button onClick={() => setProtocolModal({ open: false, item: null })} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
                            </div>
                            <div className="space-y-3">
                                <div>
                                    <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">Nome *</label>
                                    <input
                                        type="text"
                                        placeholder="Ex: Consulta de Avaliação"
                                        value={protocolModal.item.name ?? ''}
                                        onChange={e => setProtocolModal(prev => ({ ...prev, item: { ...prev.item!, name: e.target.value } }))}
                                        className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                                        autoFocus
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">Descrição</label>
                                    <input
                                        type="text"
                                        placeholder="Descrição opcional"
                                        value={protocolModal.item.description ?? ''}
                                        onChange={e => setProtocolModal(prev => ({ ...prev, item: { ...prev.item!, description: e.target.value } }))}
                                        className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">Valor padrão</label>
                                    <MoneyInput
                                        value={protocolModal.item.price ?? 0}
                                        onChange={v => setProtocolModal(prev => ({ ...prev, item: { ...prev.item!, price: v || null } }))}
                                    />
                                </div>
                            </div>
                            <div className="flex gap-2 pt-2">
                                <Button variant="outline" className="flex-1" onClick={() => setProtocolModal({ open: false, item: null })}>Cancelar</Button>
                                <Button className="flex-1" onClick={handleSaveProtocol} disabled={savingProtocol || !protocolModal.item.name?.trim()}>
                                    {savingProtocol ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Check className="w-4 h-4 mr-2" />}
                                    Salvar
                                </Button>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Modal: Link de Conexão WhatsApp */}
            {connectLink && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setConnectLink(null)}>
                    <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 p-6 space-y-4" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between">
                            <h3 className="text-base font-bold text-slate-900">Link de Conexão WhatsApp</h3>
                            <button onClick={() => setConnectLink(null)} className="text-slate-400 hover:text-slate-600">
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        <p className="text-sm text-slate-500">Envie este link para o responsável da clínica. A página atualizará o QR Code automaticamente.</p>
                        <div className="flex gap-2">
                            <input
                                readOnly
                                value={connectLink}
                                className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono text-slate-700 bg-slate-50 focus:outline-none"
                                onFocus={e => e.target.select()}
                            />
                            <button
                                onClick={() => {
                                    try { navigator.clipboard.writeText(connectLink); } catch {
                                        const inp = document.createElement('input');
                                        inp.value = connectLink;
                                        document.body.appendChild(inp);
                                        inp.select();
                                        document.execCommand('copy');
                                        document.body.removeChild(inp);
                                    }
                                    setLinkCopied(true);
                                    setTimeout(() => setLinkCopied(false), 2500);
                                }}
                                className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-sm font-bold flex items-center gap-2 transition-colors"
                            >
                                {linkCopied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                                {linkCopied ? 'Copiado!' : 'Copiar'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div className="pt-6 border-t border-slate-200 flex justify-end gap-3 bg-slate-50/80 backdrop-blur-md sticky bottom-0 z-20">
                <Button 
                    variant="outline" 
                    onClick={handleDiscard}
                    className="px-8 h-10" 
                    disabled={saving || !hasChanges}
                >
                    Descartar
                </Button>
                <Button 
                    onClick={handleSave} 
                    className="px-8 h-10 bg-teal-600 hover:bg-teal-700 transition-all font-semibold" 
                    disabled={saving || !hasChanges}
                >
                    {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                    {saving ? 'Salvando...' : 'Salvar Alterações'}
                </Button>
            </div>
        </div>
    );
}

// Modelo da Ordem de Produção (documento interno; pré-preenche o modal de gerar no Kanban).
type PoTemplate = NonNullable<Clinic['production_order_template']>;
function ProductionOrderTemplateModal({ initial, clinic, onClose, onSave }: {
    initial?: PoTemplate | null;
    clinic: Partial<Clinic>;
    onClose: () => void;
    onSave: (tpl: PoTemplate) => Promise<void>;
}) {
    const t = initial || {};
    const [responsavel, setResponsavel] = useState<string>(t.responsavel ?? '');
    const [prazo, setPrazo] = useState<string>(t.prazo ?? '');
    const [observacoes, setObservacoes] = useState<string>(t.observacoes ?? '');
    const [showPrices, setShowPrices] = useState<boolean>(t.show_prices ?? true);
    const [format, setFormat] = useState<'imagem' | 'pdf'>(t.format ?? 'pdf');
    const [saving, setSaving] = useState(false);
    const [expanded, setExpanded] = useState(false);

    const docRef = useRef<HTMLDivElement>(null);
    const previewWrapRef = useRef<HTMLDivElement>(null);
    const [scale, setScale] = useState(0.4);
    const [ph, setPh] = useState(520);

    const sampleDocProps = {
        clinicName: clinic.name ?? '',
        clinicLegalName: clinic.legal_name ?? null,
        clinicPhone: clinic.phone ?? null,
        clinicEmail: clinic.email ?? null,
        clinicInstagram: clinic.instagram ?? null,
        clinicAddress: clinic.address ?? null,
        clinicCnpj: clinic.cnpj ?? null,
        logoDataUrl: useImageDataUrl(clinic.logo_url),
        clientName: 'Cliente Exemplo',
        clientPhone: '(11) 90000-0000',
        cidade: 'Cidade Exemplo',
        vendedor: responsavel,
        number: '01234',
        dateStr: new Date().toLocaleDateString('pt-BR'),
        prazo,
        items: [
            { name: 'Alambrado 14-1.80-3', attrs: [{ label: 'malha', value: '3' }, { label: 'fio', value: '14' }, { label: 'altura', value: '1,80' }, { label: 'comprimento', value: '30' }], qty: '200 metros', value: 5400 },
            { name: 'Tela Mosquiteira', attrs: [{ label: 'malha', value: '2' }, { label: 'fio', value: '16' }], qty: '1 rolo', value: 150 },
        ],
        total: 5550,
        showPrices,
        observacoes,
        accent: clinic.primary_color || '#1d4ed8',
    };

    useEffect(() => {
        const el = docRef.current, wrap = previewWrapRef.current;
        if (!el || !wrap) return;
        const s = wrap.clientWidth / 794;
        setScale(s);
        setPh(Math.round(el.offsetHeight * s));
    }, [responsavel, prazo, observacoes, showPrices]);

    const handleSave = async () => {
        setSaving(true);
        await onSave({ responsavel, prazo, observacoes, show_prices: showPrices, format });
        setSaving(false);
    };

    const inputCls = "w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500";
    return (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl p-6 space-y-4 max-h-[90vh] overflow-y-auto custom-scrollbar" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between">
                    <h3 className="font-bold text-slate-900 text-base">Modelo da Ordem de Produção</h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
                </div>
                <p className="text-xs text-slate-400 -mt-2">Estes valores já vêm preenchidos ao gerar a ordem de produção de um lead (você ainda pode ajustar na hora).</p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">Vendedor / Responsável</label>
                                <input type="text" value={responsavel} onChange={e => setResponsavel(e.target.value)} className={inputCls} placeholder="Ex: João" />
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">Prazo de entrega</label>
                                <input type="text" value={prazo} onChange={e => setPrazo(e.target.value)} className={inputCls} placeholder="Ex: 15 dias" />
                            </div>
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">Observações de produção</label>
                            <textarea value={observacoes} onChange={e => setObservacoes(e.target.value)} rows={4} className={inputCls + " resize-none"} placeholder="Instruções para a produção…" />
                        </div>
                        <label className="flex items-center gap-2 text-sm font-medium text-slate-600 cursor-pointer select-none">
                            <input type="checkbox" checked={showPrices} onChange={e => setShowPrices(e.target.checked)} className="w-4 h-4 accent-teal-600" />
                            Mostrar preços/valores no documento
                        </label>
                        <div>
                            <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">Formato padrão</label>
                            <div className="flex bg-slate-100 rounded-xl p-1">
                                {(['imagem', 'pdf'] as const).map(f => (
                                    <button key={f} type="button" onClick={() => setFormat(f)} className={cn("flex-1 py-1.5 rounded-lg text-xs font-bold transition-all", format === f ? "bg-white text-teal-600 shadow-sm" : "text-slate-500 hover:text-slate-700")}>
                                        {f === 'imagem' ? 'Imagem' : 'PDF'}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div>
                        <div className="flex items-center justify-between mb-1.5">
                            <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide">Prévia</label>
                            <button type="button" onClick={() => setExpanded(true)} className="text-[11px] font-bold text-teal-600 hover:text-teal-700 flex items-center gap-1">
                                <Maximize2 className="w-3 h-3" /> Expandir
                            </button>
                        </div>
                        <div ref={previewWrapRef} style={{ height: ph }} className="relative w-full overflow-hidden border border-slate-200 rounded-xl bg-slate-100 cursor-zoom-in" onClick={() => setExpanded(true)}>
                            <div style={{ position: 'absolute', top: 0, left: 0, width: 794, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
                                <ProductionOrderDocument docRef={docRef} {...sampleDocProps} />
                            </div>
                        </div>
                        <p className="text-[10px] text-slate-400 mt-1">Prévia com dados de exemplo.</p>
                    </div>
                </div>

                <div className="flex gap-2 pt-2">
                    <Button variant="outline" className="flex-1" onClick={onClose}>Cancelar</Button>
                    <Button className="flex-1" onClick={handleSave} disabled={saving}>
                        {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Check className="w-4 h-4 mr-2" />}
                        Salvar modelo
                    </Button>
                </div>
            </motion.div>

            {expanded && (
                <div className="fixed inset-0 z-[60] bg-black/80 flex items-start justify-center overflow-auto p-4 sm:p-8" onClick={(e) => { e.stopPropagation(); setExpanded(false); }}>
                    <div className="relative my-auto" onClick={e => e.stopPropagation()}>
                        <button onClick={() => setExpanded(false)} className="absolute -top-3 -right-3 z-10 bg-white rounded-full p-1.5 shadow-lg text-slate-500 hover:text-slate-800"><X className="w-5 h-5" /></button>
                        <div className="bg-white rounded-lg shadow-2xl overflow-hidden">
                            <ProductionOrderDocument {...sampleDocProps} />
                        </div>
                    </div>
                </div>
            )}
        </motion.div>
    );
}

// Modelo padrao do orcamento: pre-preenche o modal do Kanban (etapa 2 / documento).
type QuoteTemplate = NonNullable<Clinic['quote_template']>;
function QuoteTemplateModal({ initial, clinic, onClose, onSave }: {
    initial?: QuoteTemplate | null;
    clinic: Partial<Clinic>;
    onClose: () => void;
    onSave: (tpl: QuoteTemplate) => Promise<void>;
}) {
    const t = initial || {};
    const [saudacao, setSaudacao] = useState<string>(t.saudacao ?? 'Olá {nome}! 👋');
    const [rodape, setRodape] = useState<string>(t.rodape ?? 'Qualquer dúvida, estou à disposição! 😊');
    const [validade, setValidade] = useState<string>(t.validade ?? '');
    const [pagamento, setPagamento] = useState<string>(t.pagamento ?? '');
    const [includeSpecs, setIncludeSpecs] = useState<boolean>(t.include_specs ?? true);
    const [format, setFormat] = useState<'texto' | 'imagem' | 'pdf'>(t.format ?? 'imagem');
    const [saving, setSaving] = useState(false);
    const [expanded, setExpanded] = useState(false);

    // Prévia (dados de exemplo). O documento pode usar transform scale à vontade — aqui não há captura.
    const docRef = useRef<HTMLDivElement>(null);
    const previewWrapRef = useRef<HTMLDivElement>(null);
    const [scale, setScale] = useState(0.4);
    const [ph, setPh] = useState(520);
    const sampleName = 'Cliente Exemplo';
    const saudPreview = saudacao.split('{nome}').join(sampleName).replace(/\s+([!?.,])/g, '$1');
    const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const sampleDocItems = [
        { name: 'Produto exemplo', description: null, specs: includeSpecs ? ['malha: 18', 'fio: 0,30 mm'] : [], qtyLine: '10 metro × R$ 27,00', value: 270 },
        { name: 'Instalação', description: null, specs: [], qtyLine: '1 serviço × R$ 150,00', value: 150 },
    ];
    const sampleTotal = 420;
    const sampleDocProps = {
        clinicName: clinic.name ?? '',
        clinicLegalName: clinic.legal_name ?? null,
        clinicPhone: clinic.phone ?? null,
        clinicEmail: clinic.email ?? null,
        clinicInstagram: clinic.instagram ?? null,
        clinicAddress: clinic.address ?? null,
        clinicCnpj: clinic.cnpj ?? null,
        logoDataUrl: useImageDataUrl(clinic.logo_url),
        clientName: sampleName,
        clientPhone: '(11) 90000-0000',
        number: '01234',
        dateStr: new Date().toLocaleDateString('pt-BR'),
        items: sampleDocItems,
        total: sampleTotal,
        showTotal: clinic.quote_show_total !== false,
        pagamento: pagamento.trim(),
        validade: validade.trim(),
        accent: clinic.primary_color || '#1d4ed8',
    };
    const showTotalSample = clinic.quote_show_total !== false;
    const sampleMessage = (() => {
        const p: string[] = [];
        if (saudPreview.trim()) { p.push(saudPreview.trim()); p.push(''); }
        p.push('*Orçamento*', '', '*Produto exemplo*');
        if (includeSpecs) p.push('malha: 18 | fio: 0,30 mm');
        p.push(`10 metro × ${brl(27)} = ${brl(270)}`, '', '*Instalação*', `1 serviço × ${brl(150)} = ${brl(150)}`);
        if (showTotalSample) p.push('', `*TOTAL: ${brl(sampleTotal)}*`);
        if (validade.trim()) p.push(`Validade: ${formatValidade(validade)}`);
        if (pagamento.trim()) p.push(`Pagamento: ${pagamento.trim()}`);
        if (rodape.trim()) { p.push(''); p.push(rodape.trim()); }
        return p.join('\n');
    })();

    useEffect(() => {
        if (format === 'texto') return;
        const el = docRef.current, wrap = previewWrapRef.current;
        if (!el || !wrap) return;
        const s = wrap.clientWidth / 794;
        setScale(s);
        setPh(Math.round(el.offsetHeight * s));
    }, [format, saudacao, rodape, validade, pagamento, includeSpecs]);

    const handleSave = async () => {
        setSaving(true);
        await onSave({ saudacao, rodape, validade, pagamento, include_specs: includeSpecs, format });
        setSaving(false);
    };

    const inputCls = "w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500";
    return (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl p-6 space-y-4 max-h-[90vh] overflow-y-auto custom-scrollbar" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between">
                    <h3 className="font-bold text-slate-900 text-base">Modelo do Orçamento</h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
                </div>
                <p className="text-xs text-slate-400 -mt-2">Estes valores já vêm preenchidos ao registrar um orçamento no Kanban (você ainda pode ajustar na hora).</p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    {/* Campos */}
                    <div className="space-y-3">
                        <div>
                            <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">Saudação</label>
                            <input type="text" value={saudacao} onChange={e => setSaudacao(e.target.value)} className={inputCls} placeholder="Olá {nome}! 👋" />
                            <p className="text-[10px] text-slate-400 mt-1"><span className="font-mono">{'{nome}'}</span> é trocado pelo primeiro nome do lead.</p>
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">Rodapé</label>
                            <input type="text" value={rodape} onChange={e => setRodape(e.target.value)} className={inputCls} placeholder="Qualquer dúvida, estou à disposição!" />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">Validade</label>
                                <input type="text" value={validade} onChange={e => setValidade(e.target.value)} className={inputCls} placeholder="Ex: 7 dias" />
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">Pagamento</label>
                                <input type="text" value={pagamento} onChange={e => setPagamento(e.target.value)} className={inputCls} placeholder="Ex: PIX ou cartão" />
                            </div>
                        </div>
                        <label className="flex items-center gap-2 text-sm font-medium text-slate-600 cursor-pointer select-none">
                            <input type="checkbox" checked={includeSpecs} onChange={e => setIncludeSpecs(e.target.checked)} className="w-4 h-4 accent-teal-600" />
                            Incluir especificações dos produtos por padrão
                        </label>
                        <div>
                            <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">Formato padrão de envio</label>
                            <div className="flex bg-slate-100 rounded-xl p-1">
                                {(['texto', 'imagem', 'pdf'] as const).map(f => (
                                    <button key={f} type="button" onClick={() => setFormat(f)} className={cn("flex-1 py-1.5 rounded-lg text-xs font-bold transition-all", format === f ? "bg-white text-teal-600 shadow-sm" : "text-slate-500 hover:text-slate-700")}>
                                        {f === 'texto' ? 'Texto' : f === 'imagem' ? 'Imagem' : 'PDF'}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Prévia */}
                    <div>
                        <div className="flex items-center justify-between mb-1.5">
                            <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide">Prévia</label>
                            <button type="button" onClick={() => setExpanded(true)} className="text-[11px] font-bold text-teal-600 hover:text-teal-700 flex items-center gap-1">
                                <Maximize2 className="w-3 h-3" /> Expandir
                            </button>
                        </div>
                        {format === 'texto' ? (
                            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-[13px] leading-relaxed whitespace-pre-wrap text-slate-700 max-h-[440px] overflow-y-auto">{sampleMessage}</div>
                        ) : (
                            <div ref={previewWrapRef} style={{ height: ph }} className="relative w-full overflow-hidden border border-slate-200 rounded-xl bg-slate-100 cursor-zoom-in" onClick={() => setExpanded(true)}>
                                <div style={{ position: 'absolute', top: 0, left: 0, width: 794, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
                                    <QuoteDocument docRef={docRef} {...sampleDocProps} />
                                </div>
                            </div>
                        )}
                        <p className="text-[10px] text-slate-400 mt-1">Prévia com dados de exemplo.</p>
                    </div>
                </div>

                <div className="flex gap-2 pt-2">
                    <Button variant="outline" className="flex-1" onClick={onClose}>Cancelar</Button>
                    <Button className="flex-1" onClick={handleSave} disabled={saving}>
                        {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Check className="w-4 h-4 mr-2" />}
                        Salvar modelo
                    </Button>
                </div>
            </motion.div>

            {expanded && (
                <div className="fixed inset-0 z-[60] bg-black/80 flex items-start justify-center overflow-auto p-4 sm:p-8" onClick={(e) => { e.stopPropagation(); setExpanded(false); }}>
                    <div className="relative my-auto" onClick={e => e.stopPropagation()}>
                        <button onClick={() => setExpanded(false)} className="absolute -top-3 -right-3 z-10 bg-white rounded-full p-1.5 shadow-lg text-slate-500 hover:text-slate-800"><X className="w-5 h-5" /></button>
                        {format === 'texto' ? (
                            <div className="bg-white rounded-2xl shadow-2xl p-8 w-[90vw] max-w-lg text-[15px] leading-relaxed whitespace-pre-wrap text-slate-700">{sampleMessage}</div>
                        ) : (
                            <div className="bg-white rounded-lg shadow-2xl overflow-hidden">
                                <QuoteDocument {...sampleDocProps} />
                            </div>
                        )}
                    </div>
                </div>
            )}
        </motion.div>
    );
}

function BrandingSettings({ data, onChange }: { data: Partial<Clinic>, onChange: (updates: Partial<Clinic>) => void }) {
    return (
        <div className="grid gap-8 md:grid-cols-2">
            <Card className="border border-slate-200 shadow-sm">
                <CardHeader>
                    <CardTitle className="text-lg font-bold text-slate-900 flex items-center gap-2">
                        <Palette className="w-5 h-5 text-teal-600" />
                        Paleta de Cores
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="space-y-3">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Cor Principal</label>
                        <div className="flex items-center gap-4">
                            <div className="w-14 h-14 rounded-lg shadow-sm border border-slate-200" style={{ backgroundColor: data.primary_color || '#0d9488' }} />
                            <input 
                                type="text" 
                                value={data.primary_color || '#0d9488'} 
                                onChange={(e) => onChange({ primary_color: e.target.value })}
                                className="flex-1 px-4 py-2 border border-slate-200 rounded-lg font-medium text-slate-700" 
                            />
                        </div>
                    </div>
                </CardContent>
            </Card>

            <Card className="border border-slate-200 shadow-sm">
                <CardHeader>
                    <CardTitle className="text-lg font-bold text-slate-900 flex items-center gap-2">
                        <Camera className="w-5 h-5 text-teal-600" />
                        Identidade Visual
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="p-6 border-2 border-dashed border-slate-200 rounded-xl flex flex-col items-center justify-center gap-4 hover:bg-slate-50 transition-colors group">
                        {data.logo_url ? (
                             <img src={data.logo_url} alt="Logo" className="h-16 object-contain" />
                        ) : (
                            <div className="w-16 h-16 bg-slate-100 rounded-lg flex items-center justify-center group-hover:scale-105 transition-transform">
                                <CloudUpload className="w-8 h-8 text-teal-600" />
                            </div>
                        )}
                        <div className="text-center">
                            <p className="font-bold text-slate-900">Enviar Logotipo</p>
                            <p className="text-xs font-medium text-slate-400 uppercase tracking-wider mt-1">URL da imagem (Por enquanto)</p>
                        </div>
                    </div>
                </CardContent>
            </Card>

        </div>
    );
}

function ClinicSettings({ data, onChange }: { data: Partial<Clinic>, onChange: (updates: Partial<Clinic>) => void }) {
    const { activeClinicId } = useAuth();
    const logoInputRef = useRef<HTMLInputElement>(null);
    const [uploadingLogo, setUploadingLogo] = useState(false);
    const handleLogoUpload = async (file: File | null) => {
        if (!file || !activeClinicId) return;
        setUploadingLogo(true);
        const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
        const path = `${activeClinicId}/logo/${crypto.randomUUID()}.${ext}`;
        const { error } = await supabase.storage.from('quotes').upload(path, file, { contentType: file.type || 'image/png', upsert: false });
        if (!error) {
            const { data: pub } = supabase.storage.from('quotes').getPublicUrl(path);
            onChange({ logo_url: pub.publicUrl });
        }
        setUploadingLogo(false);
        if (logoInputRef.current) logoInputRef.current.value = '';
    };
    return (
        <Card className="border border-slate-200 shadow-sm max-w-4xl mx-auto">
            <CardContent className="p-8">
                <div className="grid gap-8 md:grid-cols-2">
                    <div className="space-y-6">
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Nome da Clínica</label>
                            <input
                                type="text"
                                value={data.name || ''}
                                onChange={(e) => onChange({ name: e.target.value })}
                                className="w-full px-4 py-2 border border-slate-200 rounded-lg font-medium text-slate-700"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Nome completo da empresa</label>
                            <input
                                type="text"
                                value={data.legal_name || ''}
                                onChange={(e) => onChange({ legal_name: e.target.value })}
                                placeholder="Razão social — aparece no orçamento junto da logo"
                                className="w-full px-4 py-2 border border-slate-200 rounded-lg font-medium text-slate-700"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">CNPJ</label>
                            <input 
                                type="text" 
                                value={data.cnpj || ''} 
                                onChange={(e) => onChange({ cnpj: e.target.value })}
                                className="w-full px-4 py-2 border border-slate-200 rounded-lg font-medium text-slate-700" 
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Telefone de Contato</label>
                            <input
                                type="text"
                                value={data.phone || ''}
                                onChange={(e) => onChange({ phone: e.target.value })}
                                className="w-full px-4 py-2 border border-slate-200 rounded-lg font-medium text-slate-700"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">E-mail</label>
                            <input
                                type="text"
                                value={data.email || ''}
                                onChange={(e) => onChange({ email: e.target.value })}
                                placeholder="contato@suaclinica.com.br"
                                className="w-full px-4 py-2 border border-slate-200 rounded-lg font-medium text-slate-700"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Instagram</label>
                            <input
                                type="text"
                                value={data.instagram || ''}
                                onChange={(e) => onChange({ instagram: e.target.value })}
                                placeholder="@suaclinica"
                                className="w-full px-4 py-2 border border-slate-200 rounded-lg font-medium text-slate-700"
                            />
                        </div>
                    </div>
                    <div className="space-y-6">
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Endereço</label>
                            <textarea
                                value={data.address || ''}
                                onChange={(e) => onChange({ address: e.target.value })}
                                className="w-full px-4 py-2 border border-slate-200 rounded-lg font-medium text-slate-700 h-[210px]"
                            />
                        </div>
                    </div>
                </div>

                <div className="mt-8 pt-6 border-t border-slate-100">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Logo</label>
                    <p className="text-[11px] text-slate-400 mb-2.5">Aparece no cabeçalho do orçamento (imagem e PDF). Use PNG com fundo transparente para melhor resultado.</p>
                    <div className="flex items-center gap-4">
                        <div className="w-32 h-16 rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-center overflow-hidden shrink-0">
                            {data.logo_url
                                ? <img src={data.logo_url} alt="Logo" className="max-w-full max-h-full object-contain" />
                                : <span className="text-[10px] text-slate-400">sem logo</span>}
                        </div>
                        <input
                            ref={logoInputRef}
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => handleLogoUpload(e.target.files?.[0] ?? null)}
                        />
                        <Button
                            variant="outline"
                            onClick={() => logoInputRef.current?.click()}
                            disabled={uploadingLogo}
                            className="gap-2"
                        >
                            {uploadingLogo
                                ? <Loader2 className="w-4 h-4 animate-spin" />
                                : <CloudUpload className="w-4 h-4" />}
                            {data.logo_url ? 'Trocar logo' : 'Enviar logo'}
                        </Button>
                        {data.logo_url && (
                            <button
                                type="button"
                                onClick={() => onChange({ logo_url: null })}
                                className="text-xs font-semibold text-rose-500 hover:text-rose-700"
                            >
                                Remover
                            </button>
                        )}
                    </div>
                </div>

                <div className="mt-8 pt-6 border-t border-slate-100">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Cor da Clínica</label>
                    <p className="text-[11px] text-slate-400 mb-2.5">Usada no orçamento formal (imagem/PDF) e em destaques do sistema.</p>
                    <div className="flex items-center gap-3">
                        <input
                            type="color"
                            value={data.primary_color || '#0d9488'}
                            onChange={(e) => onChange({ primary_color: e.target.value })}
                            className="w-12 h-10 rounded-lg border border-slate-200 cursor-pointer bg-white p-1"
                        />
                        <input
                            type="text"
                            value={data.primary_color || '#0d9488'}
                            onChange={(e) => onChange({ primary_color: e.target.value })}
                            placeholder="#0d9488"
                            className="w-32 px-3 py-2 border border-slate-200 rounded-lg font-mono text-sm text-slate-700"
                        />
                    </div>
                </div>

            </CardContent>
        </Card>
    );
}

function RedirectLinkCard({ connectToken, redirectMessage, onMessageChange }: {
    connectToken?: string | null;
    redirectMessage?: string | null;
    onMessageChange: (v: string) => void;
}) {
    const [copied, setCopied] = useState(false);
    const [utmSource, setUtmSource]     = useState('');
    const [utmMedium, setUtmMedium]     = useState('');
    const [utmCampaign, setUtmCampaign] = useState('');

    const link = (() => {
        if (!connectToken) return '';
        const params = new URLSearchParams({ c: String(connectToken) });
        if (utmSource)   params.set('utm_source', utmSource);
        if (utmMedium)   params.set('utm_medium', utmMedium);
        if (utmCampaign) params.set('utm_campaign', utmCampaign);
        return `${window.location.origin}/r?${params.toString()}`;
    })();

    const copyLink = async () => {
        try { await navigator.clipboard.writeText(link); } catch {
            const inp = document.createElement('input');
            inp.value = link; document.body.appendChild(inp); inp.select();
            document.execCommand('copy'); document.body.removeChild(inp);
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
    };

    if (!connectToken) return null;

    return (
        <Card className="border border-violet-200 shadow-sm bg-white overflow-hidden">
            <CardHeader className="bg-violet-50 border-b border-violet-200 pb-5 px-8">
                <div className="flex items-center gap-4">
                    <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center shadow-sm border border-violet-200">
                        <ExternalLink className="w-5 h-5 text-violet-600" />
                    </div>
                    <div>
                        <CardTitle className="text-base font-bold text-slate-800">Link de Redirecionamento</CardTitle>
                        <p className="text-xs text-slate-500 mt-0.5">Rastreie cliques da bio, stories e anúncios direto no WhatsApp</p>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="p-6 space-y-5">
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
                        Lead verá: <span className="font-mono text-slate-500">{redirectMessage || 'Olá! Gostaria de mais informações.'} [Protocolo XXXXXXXX não apague essa mensagem]</span>
                    </p>
                </div>

                <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">UTMs</label>
                    <div className="grid grid-cols-3 gap-2">
                        {[
                            { label: 'utm_source', placeholder: 'instagram', value: utmSource, set: setUtmSource },
                            { label: 'utm_medium', placeholder: 'bio', value: utmMedium, set: setUtmMedium },
                            { label: 'utm_campaign', placeholder: 'promo-maio', value: utmCampaign, set: setUtmCampaign },
                        ].map(({ label, placeholder, value, set }) => (
                            <div key={label} className="space-y-1">
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{label}</p>
                                <input
                                    type="text"
                                    value={value}
                                    onChange={e => set(e.target.value)}
                                    placeholder={placeholder}
                                    className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-200"
                                />
                            </div>
                        ))}
                    </div>
                </div>

                <div className="flex items-center gap-2 p-3 bg-slate-50 border border-slate-200 rounded-xl">
                    <div className="flex-1 min-w-0">
                        <p className="text-xs font-mono text-slate-600 truncate">{link}</p>
                    </div>
                    <button
                        onClick={copyLink}
                        className="shrink-0 px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors"
                    >
                        {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        {copied ? 'Copiado!' : 'Copiar'}
                    </button>
                </div>

                <p className="text-[10px] text-slate-400 leading-relaxed">
                    Quando alguém clicar, abre o WhatsApp com mensagem pré-preenchida e o rastreamento é registrado automaticamente no lead.
                </p>
            </CardContent>
        </Card>
    );
}

function IntegrationSettings({ data, onChange, clinicData, onClinicChange, onSaveClinic, onConnect, onCancel, onDisconnect, connecting, onCopyLink, linkCopied, activeIntTab }: {
    data: Partial<WhatsappInstance>,
    onChange: (updates: Partial<WhatsappInstance>) => void,
    clinicData: Partial<Clinic>,
    onClinicChange: (updates: Partial<Clinic>) => void,
    onSaveClinic: (updates: Partial<Clinic>) => Promise<boolean>,
    onConnect: () => void,
    onCancel: () => void,
    onDisconnect: () => void,
    connecting: boolean,
    onCopyLink: () => void,
    linkCopied: boolean,
    activeIntTab: 'whatsapp' | 'meta' | 'google'
}) {
    const { clinic, refetch, systemSettings } = useSettings();
    const [groupName, setGroupName] = useState('Informativos do Agente IA');
    const [participants, setParticipants] = useState<{ name: string; phone: string }[]>([{ name: '', phone: '' }]);
    const [creatingGroup, setCreatingGroup] = useState(false);
    const [groupResult, setGroupResult] = useState<'success' | 'error' | null>(null);
    const [showScripts, setShowScripts] = useState(false);
    const [googleIdSaving, setGoogleIdSaving] = useState(false);
    const [googleIdSaved, setGoogleIdSaved] = useState(false);

    const addParticipant = () => setParticipants(p => [...p, { name: '', phone: '' }]);
    const removeParticipant = (i: number) => setParticipants(p => p.filter((_, idx) => idx !== i));
    const updateParticipant = (i: number, field: 'name' | 'phone', value: string) =>
        setParticipants(p => p.map((item, idx) => idx === i ? { ...item, [field]: value } : item));

    const invokeGroup = async (action: 'create_group' | 'add_participants') => {
        if (!clinic?.id) return;
        setCreatingGroup(true);
        setGroupResult(null);
        try {
            const { error } = await supabase.functions.invoke('whatsapp-bridge', {
                body: {
                    action,
                    clinic_id: clinic.id,
                    group_name: groupName,
                    group_id: clinic.notification_group_id,
                    participants: participants.filter(p => p.phone.trim()),
                },
            });
            setGroupResult(error ? 'error' : 'success');
            if (!error) {
                await refetch();
                if (action === 'add_participants') setParticipants([{ name: '', phone: '' }]);
            }
        } catch {
            setGroupResult('error');
        } finally {
            setCreatingGroup(false);
        }
    };
    const handleCreateGroup = () => invokeGroup('create_group');

    return (
        <div className="max-w-4xl mx-auto space-y-6">

            {activeIntTab === 'whatsapp' && (
                <div className="space-y-6">
                    <Card className="border border-emerald-200 shadow-sm bg-white overflow-hidden">
                        <CardHeader className="bg-emerald-100 border-b border-emerald-200 pb-6 px-8">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-4">
                                    <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center shadow-sm border border-emerald-200">
                                        <MessageCircle className="w-6 h-6 text-emerald-600" />
                                    </div>
                                    <div>
                                        <CardTitle className="text-xl font-bold text-slate-800">WhatsApp Business API</CardTitle>
                                    </div>
                                </div>
                                <div className={cn(
                                    "flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold border bg-white",
                                    data.status === "connected" 
                                        ? "text-emerald-700 border-emerald-300 shadow-sm" 
                                        : "bg-slate-100 text-slate-500 border-slate-200"
                                )}>
                                    {data.status === "connected" ? (
                                        <><Wifi className="w-3.5 h-3.5" /> Conectado</>
                                    ) : (
                                        <><WifiOff className="w-3.5 h-3.5" /> Desconectado</>
                                    )}
                                </div>
                            </div>
                        </CardHeader>

                        <CardContent className="p-8 space-y-8">
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Status da Conexão</label>
                            <div className="flex items-center gap-2">
                                <div className={`w-2 h-2 rounded-full animate-pulse ${
                                    data.status === 'connected' ? 'bg-emerald-500' :
                                    (data.status === 'connecting' && data.qr_code) ? 'bg-amber-500' :
                                    data.status === 'connecting' ? 'bg-blue-500' : 'bg-slate-300'
                                }`} />
                                <span className={`text-xs font-bold uppercase ${
                                    data.status === 'connected' ? 'text-emerald-600' :
                                    (data.status === 'connecting' && data.qr_code) ? 'text-amber-600' :
                                    data.status === 'connecting' ? 'text-blue-600' : 'text-slate-500'
                                }`}>
                                    {data.status === 'connected' ? 'Conectado' :
                                     (data.status === 'connecting' && data.qr_code) ? 'Aguardando QR' :
                                     data.status === 'connecting' ? 'Conectando...' : 'Desconectado'}
                                </span>
                            </div>
                        </div>

                        <div className="bg-slate-50 border border-slate-100 rounded-2xl p-5 space-y-4 shadow-sm">
                            <div className="space-y-2">
                                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Número Conectado</label>
                                <input
                                    type="text"
                                    value={formatBrazilianPhone(data.phone_number)}
                                    readOnly
                                    placeholder={data.status === 'connected' ? 'Sem número detectado' : 'Aguardando conexão'}
                                    className="w-full px-4 py-3 border border-slate-200 rounded-xl font-medium text-slate-600 text-sm bg-slate-100/50 cursor-not-allowed outline-none select-all"
                                />
                            </div>

                            <div className="space-y-2">
                                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                                    <Lock className="w-3.5 h-3.5" /> Token da API UaZapi
                                </label>
                                <div className="relative">
                                    <input
                                        type="password"
                                        value={data.api_token || ''}
                                        readOnly
                                        onChange={(e) => onChange({ api_token: e.target.value })}
                                        placeholder="Seu token de autenticação"
                                        className="w-full px-4 py-3 border border-slate-200 rounded-xl font-medium text-slate-600 text-sm bg-slate-100/50 cursor-not-allowed outline-none select-all font-mono tracking-tight"
                                    />
                                </div>
                                <p className="text-[10px] text-slate-400 pl-1">Este token garante com segurança a comunicação server-to-server com o n8n.</p>
                            </div>
                        </div>
                    </div>

                    <div className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-inner">
                        {(data.status === "disconnected" || data.status === "connecting" || !data.status) && (
                            <div className="p-10 flex flex-col items-center gap-6 bg-slate-50/50">
                                {data.qr_code ? (
                                    <div className="relative group">
                                        <div className="absolute -inset-4 bg-gradient-to-tr from-teal-500/10 to-teal-500/5 rounded-3xl blur-xl group-hover:blur-2xl transition-all opacity-0 group-hover:opacity-100"></div>
                                        <motion.div 
                                            key={data.qr_code}
                                            initial={{ opacity: 0, scale: 0.9, y: 10 }}
                                            animate={{ opacity: 1, scale: 1, y: 0 }}
                                            className="relative p-6 bg-white rounded-3xl border border-teal-100 shadow-2xl shadow-teal-500/10"
                                        >
                                            <div className="absolute inset-0 bg-gradient-to-tr from-teal-50 to-white rounded-3xl pointer-events-none" />
                                            <img 
                                                src={data.qr_code.startsWith('data:') ? data.qr_code : `data:image/png;base64,${data.qr_code}`} 
                                                alt="WhatsApp QR Code" 
                                                className="w-52 h-52 rounded-xl relative z-10 mx-auto border border-slate-100"
                                            />
                                            <div className="mt-4 text-center">
                                                <p className="text-sm font-bold text-teal-600">Escaneie o QR Code</p>
                                                <p className="text-[10px] text-slate-400">Aguardando leitura pelo WhatsApp...</p>
                                            </div>
                                        </motion.div>
                                    </div>
                                ) : data.status === 'connecting' ? (
                                    <div className="flex flex-col items-center gap-4">
                                        <Loader2 className="w-12 h-12 text-teal-600 animate-spin" />
                                        <p className="text-sm font-medium text-slate-500">Iniciando sessão...</p>
                                    </div>
                                ) : (
                                    <QrCode className="w-12 h-12 text-slate-300" />
                                )}
                                
                                <div className="flex flex-col items-center gap-4 text-center">
                                    <p className="text-slate-500 font-bold">
                                        {data.qr_code ? 'QR Code Gerado!' : (data.status === 'connecting' ? 'Conectando à API...' : 'Pronto para conectar?')}
                                    </p>
                                    <p className="text-slate-400 font-medium text-sm max-w-xs transition-all">
                                        {data.qr_code 
                                            ? 'Abra o WhatsApp > Dispositivos Conectados > Conectar um dispositivo.' 
                                            : data.status === 'connecting' 
                                            ? 'Estamos preparando sua instância no servidor. Isso pode levar alguns segundos.'
                                            : 'A conexão será processada via n8n. Certifique-se de que o fluxo esteja ativo.'}
                                    </p>
                                    
                                    <div className="flex flex-col sm:flex-row items-center gap-3">
                                        {(data.status === "disconnected" || !data.status) && (
                                            <Button 
                                                onClick={onConnect} 
                                                disabled={connecting}
                                                className="bg-gradient-to-r from-teal-600 to-teal-500 hover:from-teal-700 hover:to-teal-600 text-white gap-2 h-12 px-10 font-bold shadow-xl shadow-teal-500/20 transition-all active:scale-[0.98] disabled:opacity-50 rounded-xl"
                                            >
                                                {connecting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Wifi className="w-5 h-5" />}
                                                {connecting ? 'Processando...' : 'Conectar Agora'}
                                            </Button>
                                        )}

                                        {data.status === 'connecting' && (
                                            <Button
                                                onClick={onConnect}
                                                disabled={true}
                                                className="bg-slate-100 text-slate-400 gap-2 h-12 px-10 font-bold rounded-xl cursor-not-allowed"
                                            >
                                                <Loader2 className="w-5 h-5 animate-spin" />
                                                Aguardando QR Code...
                                            </Button>
                                        )}
                                        
                                        <Button
                                            variant="outline"
                                            onClick={onCopyLink}
                                            className="text-teal-600 border-teal-200 hover:bg-teal-50 h-12 px-6 font-bold flex items-center gap-2 rounded-xl"
                                        >
                                            {linkCopied ? <CheckCircle2 className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                                            {linkCopied ? 'Link copiado!' : 'Copiar Link para Clínica'}
                                        </Button>

                                        {data.status === 'connecting' && (
                                            <Button
                                                variant="ghost"
                                                onClick={onCancel}
                                                className="text-slate-400 hover:text-rose-500 h-12 px-6 font-bold flex items-center gap-2"
                                            >
                                                <X className="w-4 h-4" /> Cancelar
                                            </Button>
                                        )}
                                    </div>
                                    
                                    {(data.qr_code || data.status === 'connecting') && (
                                        <p className="text-[10px] text-slate-300 flex items-center gap-1 mt-2">
                                            <RefreshCw className="w-3 h-3 animate-spin" />
                                            Atualizando status em tempo real...
                                        </p>
                                    )}
                                </div>
                            </div>
                        )}

                        {data.status === "connected" && (
                            <div className="p-8 bg-emerald-50/50">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-4">
                                        <div className="w-14 h-14 bg-emerald-100 rounded-xl flex items-center justify-center">
                                            <CheckCircle2 className="w-7 h-7 text-emerald-600" />
                                        </div>
                                        <div>
                                            <p className="text-lg font-bold text-slate-900">WhatsApp Conectado</p>
                                            <p className="text-sm font-medium text-emerald-600">{formatBrazilianPhone(data.phone_number) || 'Sessão ativa'}</p>
                                        </div>
                                    </div>
                                    <Button
                                        variant="outline"
                                        onClick={onDisconnect}
                                        className="text-rose-500 border-rose-200 hover:bg-rose-50 gap-2"
                                    >
                                        <WifiOff className="w-4 h-4" /> Desconectar
                                    </Button>
                                </div>
                            </div>
                        )}
                    </div>
                </CardContent>
            </Card>

            <RedirectLinkCard connectToken={data.connect_token} redirectMessage={data.redirect_message} onMessageChange={(v) => onChange({ redirect_message: v })} />
                </div>
            )}

            {/* Meta Ads Settings */}
            {activeIntTab === 'meta' && (
                <div className="space-y-6">
                    <Card className="border border-blue-200 shadow-sm bg-white overflow-hidden">
                        <CardHeader className="bg-blue-100 border-b border-blue-200 pb-6 px-8">
                            <div className="flex items-center gap-4">
                                <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center shadow-sm border border-blue-200 p-2">
                                    <img src={MetaLogo} alt="Meta" className="w-full h-full object-contain opacity-90" />
                                </div>
                                <div>
                                    <CardTitle className="text-xl font-bold text-slate-800">Rastreamento Meta Ads</CardTitle>
                                </div>
                            </div>
                        </CardHeader>
                <CardContent className="p-8 grid gap-6 md:grid-cols-2">
                    <div className="space-y-2 md:col-span-2 group/input">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                            <Lock className="w-3.5 h-3.5 text-blue-500" /> Token de Acesso (CAPI)
                        </label>
                        <div className="relative">
                            <input
                                type="password"
                                value={clinicData.meta_token || ''}
                                onChange={(e) => onClinicChange({ meta_token: e.target.value })}
                                placeholder="EAA... seu access token"
                                className="w-full pl-4 pr-10 py-3 border border-slate-200 rounded-xl font-medium text-slate-700 text-sm placeholder:text-slate-300 focus:ring-4 focus:ring-blue-100 focus:border-blue-400 outline-none transition-all shadow-sm hover:border-blue-200"
                            />
                            <div className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-300 group-focus-within/input:text-blue-500 transition-colors">
                                <Shield className="w-4 h-4" />
                            </div>
                        </div>
                        <p className="text-[10px] text-slate-400 font-medium leading-relaxed pl-1">
                            O token de acesso é gerado no Gerenciador de Negócios e permite o envio de conversões via API com máxima segurança.
                        </p>
                    </div>

                    <div className="space-y-2 group/input">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                            ID da Conta de Anúncios
                        </label>
                        <input
                            type="text"
                            value={clinicData.meta_ad_account_id || ''}
                            onChange={(e) => onClinicChange({ meta_ad_account_id: e.target.value })}
                            placeholder="act_123456789"
                            className="w-full px-4 py-3 border border-slate-200 rounded-xl font-medium text-slate-700 text-sm placeholder:text-slate-300 focus:ring-4 focus:ring-blue-100 focus:border-blue-400 outline-none transition-all shadow-sm hover:border-blue-200"
                        />
                    </div>

                    <div className="space-y-2 group/input">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                            ID do Pixel
                        </label>
                        <input
                            type="text"
                            value={clinicData.meta_pixel_id || ''}
                            onChange={(e) => onClinicChange({ meta_pixel_id: e.target.value })}
                            placeholder="Ex: 123456789012345"
                            className="w-full px-4 py-3 border border-slate-200 rounded-xl font-medium text-slate-700 text-sm placeholder:text-slate-300 focus:ring-4 focus:ring-blue-100 focus:border-blue-400 outline-none transition-all shadow-sm hover:border-blue-200"
                        />
                    </div>

                    <div className="space-y-2 md:col-span-2 group/input">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                            ID do Formulário Nativo
                        </label>
                        <input
                            type="text"
                            value={clinicData.meta_forms_id || ''}
                            onChange={(e) => onClinicChange({ meta_forms_id: e.target.value })}
                            placeholder="Ex: 123456789012345"
                            className="w-full px-4 py-3 border border-slate-200 rounded-xl font-medium text-slate-700 text-sm placeholder:text-slate-300 focus:ring-4 focus:ring-blue-100 focus:border-blue-400 outline-none transition-all shadow-sm hover:border-blue-200"
                        />
                        <p className="text-[10px] text-slate-400 font-medium leading-relaxed pl-1">
                            ID do formulário nativo do Meta (Lead Ads / Instant Forms) usado para vincular os leads capturados a esta clínica.
                        </p>
                    </div>
                </CardContent>
            </Card>
                </div>
            )}

            {/* Google Ads & Links */}
            {activeIntTab === 'google' && (
                <div className="space-y-6">
                    {/* Conta Google Ads — card independente com save próprio */}
                    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                        <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-100 bg-slate-50">
                            <div className="w-9 h-9 bg-white rounded-xl flex items-center justify-center shadow-sm border border-slate-200 p-1.5">
                                <img src={GoogleLogo} alt="Google" className="w-full h-full object-contain opacity-90" />
                            </div>
                            <div>
                                <p className="text-sm font-bold text-slate-800">Conta Google Ads</p>
                                <p className="text-[11px] text-slate-400 font-medium">Vinculação da conta da clínica</p>
                            </div>
                        </div>
                        <div className="p-6 space-y-4">
                            <div className="space-y-2">
                                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">ID da Conta Google Ads</label>
                                <input
                                    type="text"
                                    value={clinicData.google_ad_account_id || ''}
                                    onChange={(e) => onClinicChange({ google_ad_account_id: e.target.value })}
                                    placeholder="Ex: 1234567890"
                                    className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm font-medium text-slate-700 placeholder:text-slate-400 focus:ring-2 focus:ring-amber-100 focus:border-amber-400 outline-none transition-all"
                                />
                                <p className="text-[11px] text-slate-400 font-medium">
                                    Insira apenas os números, sem traços. Ex: <span className="font-bold text-slate-500">1234567890</span>
                                </p>
                            </div>
                            <button
                                onClick={async () => {
                                    setGoogleIdSaving(true);
                                    await onSaveClinic({ google_ad_account_id: clinicData.google_ad_account_id || null });
                                    setGoogleIdSaving(false);
                                    setGoogleIdSaved(true);
                                    setTimeout(() => setGoogleIdSaved(false), 2500);
                                }}
                                disabled={googleIdSaving}
                                className="flex items-center gap-2 px-5 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white text-sm font-bold rounded-xl transition-all shadow-sm"
                            >
                                {googleIdSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                                {googleIdSaved ? 'Salvo!' : 'Salvar'}
                            </button>
                        </div>
                    </div>

                    <Card className="border border-amber-200 shadow-sm bg-white overflow-hidden">
                        <CardHeader className="bg-amber-100 border-b border-amber-200 pb-6 px-8">
                            <div className="flex items-center gap-4">
                                <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center shadow-sm border border-amber-200 p-2">
                                    <img src={GoogleLogo} alt="Google" className="w-full h-full object-contain opacity-90" />
                                </div>
                                <div>
                                    <CardTitle className="text-xl font-bold text-slate-800">Rastreamento Google Ads</CardTitle>
                                </div>
                            </div>
                        </CardHeader>
                <CardContent className="p-8 space-y-8">
                    {/* Mensagem Padrão WA */}
                    <div className="space-y-3 group/input">
                        <label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                            Mensagem Padrão de Início de Conversa
                        </label>
                        <input
                            type="text"
                            value={clinicData.wa_pre_msg || ''}
                            onChange={(e) => onClinicChange({ wa_pre_msg: e.target.value })}
                            placeholder="Olá! Gostaria de agendar uma consulta. Como funcionam os horários?"
                            className="w-full px-4 py-3 border border-slate-200 rounded-xl font-medium text-slate-700 text-sm placeholder:text-slate-400 focus:ring-4 focus:ring-amber-100 focus:border-amber-400 outline-none transition-all shadow-sm hover:border-amber-200"
                        />
                        <p className="text-[12px] text-slate-400 font-medium leading-relaxed">
                            Esta mensagem será preenchida automaticamente quando o paciente clicar no botão de WhatsApp da sua página.
                        </p>
                    </div>
                    {!showScripts ? (
                        <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="pt-4"
                        >
                            <Button 
                                onClick={() => setShowScripts(true)}
                                className="w-full bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-white shadow-lg shadow-amber-500/20 py-7 text-[15px] font-bold tracking-wide rounded-xl border border-white/20 transition-all active:scale-[0.98] group relative overflow-hidden"
                            >
                                <div className="absolute inset-0 bg-white/20 w-1/2 -skew-x-12 -translate-x-[150%] group-hover:translate-x-[250%] transition-transform duration-1000 ease-in-out" />
                                <CheckCircle2 className="w-5 h-5 mr-2 opacity-90" />
                                Validar Configuração e Gerar Código de Integração
                            </Button>
                        </motion.div>
                    ) : (
                        <motion.div 
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="space-y-8"
                        >
                            {/* Webhook e Formulários */}
                            <div className="space-y-4 p-5 bg-slate-50 border border-slate-100 rounded-2xl relative overflow-hidden group/item">
                                <div className="absolute top-0 left-0 w-1 h-full bg-blue-500"></div>
                                <label className="text-xs font-bold text-slate-700 flex items-center gap-2">
                                    <Globe className="w-4 h-4 text-blue-500" />
                                    Integração de Formulários e Webhook <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded-md text-[9px] uppercase tracking-wider ml-2">LP / Forms</span>
                                </label>
                                <p className="text-[12px] text-slate-500 font-medium leading-relaxed max-w-3xl">
                                    Utilize este endereço de Webhook e siga o padrão exato de nomenclatura ao criar os formulários na sua Landing Page para capturar os leads diretamente no sistema.
                                </p>
                                
                                {/* URL Webhook */}
                                <div className="flex flex-col sm:flex-row gap-3 pt-1">
                                    <div className="flex-1 px-4 py-3 bg-[#0d1117] border border-slate-800 rounded-xl flex items-center shadow-inner overflow-x-auto custom-scrollbar">
                                        <code className="text-[13px] font-mono text-blue-400 whitespace-nowrap">
                                            {systemSettings?.webhook_lead_catch_url || "https://webhook.med4growautomacao.com.br/webhook/clinica/forms_tracking"}
                                        </code>
                                    </div>
                                    <Button 
                                        variant="outline" 
                                        onClick={(e) => {
                                            const url = systemSettings?.webhook_lead_catch_url || "https://webhook.med4growautomacao.com.br/webhook/clinica/forms_tracking";
                                            navigator.clipboard.writeText(url);
                                            const btn = e.currentTarget;
                                            const orig = btn.innerHTML;
                                            btn.innerHTML = '<svg class="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg> Copiado!';
                                            btn.classList.add('bg-blue-600', 'text-white', 'border-blue-600');
                                            btn.classList.remove('bg-white', 'text-slate-700');
                                            setTimeout(() => {
                                                btn.innerHTML = orig;
                                                btn.classList.remove('bg-blue-600', 'text-white', 'border-blue-600');
                                                btn.classList.add('bg-white', 'text-slate-700');
                                            }, 2000);
                                        }}
                                        className="bg-white border-slate-200 text-slate-700 hover:bg-slate-50 gap-2 shrink-0 h-10 sm:h-auto rounded-xl shadow-sm transition-all font-bold"
                                    >
                                        <Copy className="w-4 h-4" /> Copiar Link Webhook
                                    </Button>
                                </div>

                                {/* Campos Padronizados */}
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
                                    <div className="p-3.5 bg-white border border-slate-200 rounded-xl shadow-sm hover:border-blue-300 transition-colors cursor-pointer group/copy"
                                         onClick={(e) => {
                                             const template = systemSettings?.form_default_name || 'formulario {{CLINIC_NAME}} {{PHONE}}';
                                             const text = template.replace(/{{CLINIC_NAME}}/g, clinicData.name || 'clinica vaz')
                                                                  .replace(/{{PHONE}}/g, clinicData.phone?.replace(/\D/g, '') || '5521973603891')
                                                                  .toLowerCase();
                                             navigator.clipboard.writeText(text);
                                             const icon = e.currentTarget.querySelector('svg');
                                             if (icon) {
                                                 icon.classList.add('text-blue-500');
                                                 setTimeout(() => icon.classList.remove('text-blue-500'), 1500);
                                             }
                                         }}>
                                        <p className="text-[10px] uppercase tracking-wider font-bold text-slate-400 mb-1.5 flex justify-between items-center">
                                            Nome do Formulário
                                            <Copy className="w-3.5 h-3.5 text-slate-300 transition-colors" />
                                        </p>
                                        <code className="text-xs font-mono text-slate-700 font-bold truncate block">
                                            {(() => {
                                                const template = systemSettings?.form_default_name || 'formulario {{CLINIC_NAME}} {{PHONE}}';
                                                return template.replace(/{{CLINIC_NAME}}/g, clinicData.name || 'clinica vaz')
                                                               .replace(/{{PHONE}}/g, clinicData.phone?.replace(/\D/g, '') || '5521973603891')
                                                               .toLowerCase();
                                            })()}
                                        </code>
                                    </div>
                                    
                                    <div className="p-3.5 bg-white border border-slate-200 rounded-xl shadow-sm hover:border-blue-300 transition-colors cursor-pointer group/copy"
                                         onClick={(e) => {
                                             navigator.clipboard.writeText(systemSettings?.form_default_label_name || "Nome completo");
                                             const icon = e.currentTarget.querySelector('svg');
                                             if (icon) {
                                                 icon.classList.add('text-blue-500');
                                                 setTimeout(() => icon.classList.remove('text-blue-500'), 1500);
                                             }
                                         }}>
                                        <p className="text-[10px] uppercase tracking-wider font-bold text-slate-400 mb-1.5 flex justify-between items-center">
                                            Rótulo (Label) do Nome
                                            <Copy className="w-3.5 h-3.5 text-slate-300 transition-colors" />
                                        </p>
                                        <code className="text-xs font-mono text-slate-700 font-bold block">
                                            {systemSettings?.form_default_label_name || "Nome completo"}
                                        </code>
                                    </div>

                                    <div className="p-3.5 bg-white border border-slate-200 rounded-xl shadow-sm hover:border-blue-300 transition-colors cursor-pointer group/copy"
                                         onClick={(e) => {
                                             navigator.clipboard.writeText(systemSettings?.form_default_label_phone || "WhatsApp com DDD");
                                             const icon = e.currentTarget.querySelector('svg');
                                             if (icon) {
                                                 icon.classList.add('text-blue-500');
                                                 setTimeout(() => icon.classList.remove('text-blue-500'), 1500);
                                             }
                                         }}>
                                        <p className="text-[10px] uppercase tracking-wider font-bold text-slate-400 mb-1.5 flex justify-between items-center">
                                            Rótulo (Label) do Número
                                            <Copy className="w-3.5 h-3.5 text-slate-300 transition-colors" />
                                        </p>
                                        <code className="text-xs font-mono text-slate-700 font-bold block">
                                            {systemSettings?.form_default_label_phone || "WhatsApp com DDD"}
                                        </code>
                                    </div>
                                </div>
                            </div>

                            {/* Botão WA */}
                            <div className="space-y-3 p-5 bg-emerald-50/50 border border-emerald-100 rounded-2xl relative overflow-hidden group/item">
                                <div className="absolute top-0 left-0 w-1 h-full bg-emerald-500"></div>
                                <label className="text-xs font-bold text-slate-700 flex items-center gap-2">
                                    <MessageCircle className="w-4 h-4 text-emerald-500" />
                                    URL para botão whatsapp <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-md text-[9px] uppercase tracking-wider ml-2">Direto</span>
                                </label>
                                <p className="text-[12px] text-slate-500 font-medium leading-relaxed max-w-2xl">
                                    Utilize este link no botão de "Enviar Mensagem" da sua Landing Page.
                                </p>
                                <div className="flex flex-col sm:flex-row gap-3 pt-1">
                                    <div className="flex-1 px-4 py-3 bg-[#0d1117] border border-slate-800 rounded-xl flex items-center shadow-inner overflow-x-auto custom-scrollbar">
                                        <code className="text-[13px] font-mono text-emerald-400 whitespace-nowrap">
                                            {(systemSettings?.whatsapp_button_template || "https://wa.me/{{PHONE}}")
                                              .replace(/{{PHONE}}/g, clinicData.phone?.replace(/\D/g, '') || 'NUMERO')}
                                        </code>
                                    </div>
                                    <Button 
                                        variant="outline" 
                                        onClick={(e) => {
                                            const waLink = (systemSettings?.whatsapp_button_template || "https://wa.me/{{PHONE}}")
                                                           .replace(/{{PHONE}}/g, clinicData.phone?.replace(/\D/g, '') || 'NUMERO');
                                            navigator.clipboard.writeText(waLink);
                                            const btn = e.currentTarget;
                                            const orig = btn.innerHTML;
                                            btn.innerHTML = '<svg class="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg> Copiado!';
                                            btn.classList.add('bg-emerald-600', 'text-white', 'border-emerald-600');
                                            btn.classList.remove('bg-white', 'text-slate-700');
                                            setTimeout(() => {
                                                btn.innerHTML = orig;
                                                btn.classList.remove('bg-emerald-600', 'text-white', 'border-emerald-600');
                                                btn.classList.add('bg-white', 'text-slate-700');
                                            }, 2000);
                                        }}
                                        className="bg-white border-emerald-200 text-slate-700 hover:bg-emerald-50 gap-2 shrink-0 h-10 sm:h-auto rounded-xl shadow-sm transition-all font-bold"
                                    >
                                        <Copy className="w-4 h-4" /> Copiar Link
                                    </Button>
                                </div>
                            </div>

                            {/* Botão Flutuante WhatsApp */}
                            <div className="space-y-3 p-5 bg-slate-50 border border-slate-100 rounded-2xl relative overflow-hidden group/item">
                                <div className="absolute top-0 left-0 w-1 h-full bg-emerald-500"></div>
                                <label className="text-xs font-bold text-slate-700 flex items-center gap-2">
                                    <MessageCircle className="w-4 h-4 text-emerald-500" />
                                    Script para adicionar botão Flutuante de whatsapp <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-md text-[9px] uppercase tracking-wider ml-2">Elemento Visual</span>
                                </label>
                                <p className="text-[12px] text-slate-500 font-medium leading-relaxed max-w-3xl">
                                    Copie este código e insira no <strong>Footer/Body</strong> do seu site para exibir o ícone do WhatsApp no canto da tela.
                                </p>
                                <div className="relative group mt-3 rounded-xl overflow-hidden border border-slate-800 bg-[#0d1117] shadow-xl">
                                    <div className="bg-[#161b22] px-4 py-2.5 flex items-center justify-between border-b border-slate-800">
                                        <div className="flex gap-1.5">
                                            <div className="w-3 h-3 rounded-full bg-rose-500/80"></div>
                                            <div className="w-3 h-3 rounded-full bg-amber-500/80"></div>
                                            <div className="w-3 h-3 rounded-full bg-emerald-500/80"></div>
                                        </div>
                                        <div className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">whatsapp_float.html</div>
                                        <div className="w-10"></div>
                                    </div>
                                    <pre className="p-5 text-slate-300 text-[12px] font-mono overflow-x-auto whitespace-pre-wrap max-h-[350px] custom-scrollbar leading-relaxed">
{(() => {
    let script = systemSettings?.floating_whatsapp_button || '<!-- Botão flutuante não configurado no banco system_settings -->';
    script = script.replace(/{{PHONE}}/g, clinicData.phone ? clinicData.phone.replace(/\D/g, '') : 'SEUNUMERO');
    return script;
})()}
                                    </pre>
                                    <div className="absolute top-12 right-6 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                                        <Button 
                                            variant="outline"
                                            onClick={(e) => {
                                                const script = systemSettings?.floating_whatsapp_button || '<!-- Botão flutuante não configurado no banco system_settings -->';
                                                const finalScript = script.replace(/{{PHONE}}/g, clinicData.phone ? clinicData.phone.replace(/\D/g, '') : 'SEUNUMERO');
                                                
                                                navigator.clipboard.writeText(finalScript);
                                                const btn = e.currentTarget;
                                                const orig = btn.innerHTML;
                                                btn.innerHTML = '<svg class="w-4 h-4 mr-2 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg> Copiado!';
                                                btn.classList.add('bg-emerald-500', 'border-emerald-500');
                                                btn.classList.remove('bg-white/10', 'border-white/20');
                                                setTimeout(() => {
                                                    btn.innerHTML = orig;
                                                    btn.classList.remove('bg-emerald-500', 'border-emerald-500');
                                                    btn.classList.add('bg-white/10', 'border-white/20');
                                                }, 2000);
                                            }}
                                            className="bg-white/10 hover:bg-white/20 border border-white/20 text-white backdrop-blur-md transition-all shadow-lg shadow-black/20 font-bold px-4 h-10 rounded-lg"
                                        >
                                            <Copy className="w-4 h-4 mr-2" /> Copiar Código
                                        </Button>
                                    </div>
                                </div>
                            </div>

                            {/* Script Global Navstracking */}
                            <div className="space-y-3 p-5 bg-slate-50 border border-slate-100 rounded-2xl relative overflow-hidden group/item">
                                <div className="absolute top-0 left-0 w-1 h-full bg-slate-400"></div>
                                <label className="text-xs font-bold text-slate-700 flex items-center gap-2">
                                    <Shield className="w-4 h-4 text-slate-500" />
                                    Script Global de Rastreamento <span className="px-2 py-0.5 bg-slate-200 text-slate-600 rounded-md text-[9px] uppercase tracking-wider ml-2">Navstracking Core v1.0</span>
                                </label>
                                <p className="text-[12px] text-slate-500 font-medium leading-relaxed max-w-3xl">
                                    Copie este código e insira no <strong>Header/Body</strong> de todas as suas Landing Pages (Elementor, Wordpress, etc). Ele blinda as UTMs, GCLID e captura magicamente os cliques injetando a sua mensagem padrão.
                                </p>
                                <div className="relative group mt-3 rounded-xl overflow-hidden border border-slate-800 bg-[#0d1117] shadow-xl">
                                    {/* Mac OS Window Header */}
                                    <div className="bg-[#161b22] px-4 py-2.5 flex items-center justify-between border-b border-slate-800">
                                        <div className="flex gap-1.5">
                                            <div className="w-3 h-3 rounded-full bg-rose-500/80"></div>
                                            <div className="w-3 h-3 rounded-full bg-amber-500/80"></div>
                                            <div className="w-3 h-3 rounded-full bg-emerald-500/80"></div>
                                        </div>
                                        <div className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">navstracking.js</div>
                                        <div className="w-10"></div>
                                    </div>
                                    <pre className="p-5 text-slate-300 text-[12px] font-mono overflow-x-auto whitespace-pre-wrap max-h-[350px] custom-scrollbar leading-relaxed">
{(() => {
    let script = systemSettings?.global_tracking_script || '<!-- Script Global não configurado no banco system_settings -->';
    script = script.replace(/{{WA_PRE_MSG}}/g, clinicData.wa_pre_msg || 'Olá! Vim do site.');
    script = script.replace(/{{PHONE}}/g, clinicData.phone ? clinicData.phone.replace(/\D/g, '') : 'SEUNUMERO');
    script = script.replace(/{{CLINIC_ID}}/g, clinicData.id || '');
    return script;
})()}
                                    </pre>
                                    <div className="absolute top-12 right-6 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                                        <Button
                                            variant="ghost"
                                            onClick={(e) => {
                                                const script = systemSettings?.global_tracking_script || '<!-- Script Global não configurado no banco system_settings -->';
                                                const finalScript = script.replace(/{{WA_PRE_MSG}}/g, clinicData.wa_pre_msg || 'Olá! Vim do site.')
                                                                          .replace(/{{PHONE}}/g, clinicData.phone ? clinicData.phone.replace(/\D/g, '') : 'SEUNUMERO')
                                                                          .replace(/{{CLINIC_ID}}/g, clinicData.id || '');
                                                
                                                navigator.clipboard.writeText(finalScript);
                                                const btn = e.currentTarget;
                                                const orig = btn.innerHTML;
                                                btn.innerHTML = '<svg class="w-4 h-4 mr-2 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg> Copiado!';
                                                btn.classList.add('bg-emerald-500', 'border-emerald-500');
                                                btn.classList.remove('bg-white/10', 'border-white/20');
                                                setTimeout(() => {
                                                    btn.innerHTML = orig;
                                                    btn.classList.remove('bg-emerald-500', 'border-emerald-500');
                                                    btn.classList.add('bg-white/10', 'border-white/20');
                                                }, 2000);
                                            }}
                                            className="bg-white/10 hover:bg-white/20 border border-white/20 text-white backdrop-blur-md transition-all shadow-lg shadow-black/20 font-bold px-4 h-10 rounded-lg"
                                        >
                                            <Copy className="w-4 h-4 mr-2" /> Copiar Script
                                        </Button>
                                    </div>
                                </div>
                            </div>


                        </motion.div>
                    )}
                </CardContent>
            </Card>
                </div>
            )}


            {/* Grupo de Notificação */}
            {activeIntTab === 'whatsapp' && (
                <div className="space-y-6">
                    <Card className="border border-emerald-200 shadow-sm bg-white overflow-hidden">
                        <CardHeader className="bg-emerald-100 border-b border-emerald-200 pb-6 px-8">
                            <div className="flex items-center gap-4">
                                <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center shadow-sm border border-emerald-200">
                                    <Bell className="w-6 h-6 text-emerald-600" />
                                </div>
                                <div>
                                    <CardTitle className="text-xl font-bold text-slate-800">Grupo de Notificações</CardTitle>
                                </div>
                            </div>
                        </CardHeader>
                <CardContent className="p-8 space-y-6">
                    {clinic?.notification_group_id ? (
                        <div className="flex items-center gap-3 px-4 py-3 bg-white border border-slate-200 rounded-lg">
                            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                            <div className="flex-1 min-w-0">
                                <p className="text-xs font-bold text-slate-700">Grupo ativo</p>
                                <p className="text-[11px] text-slate-400 font-mono truncate">{clinic.notification_group_id}</p>
                            </div>
                        </div>
                    ) : (
                        /* Sem grupo — criar */
                        <div className="grid gap-6">
                            <div className="space-y-2 group/input">
                                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                                    <Bell className="w-3.5 h-3.5 text-teal-500" /> Nome do Grupo
                                </label>
                                <input type="text" value={groupName} onChange={e => setGroupName(e.target.value)} placeholder="Informativos do Agente IA"
                                    className="w-full px-4 py-3 border border-slate-200 rounded-xl font-medium text-slate-700 text-sm placeholder:text-slate-300 focus:ring-4 focus:ring-teal-100 focus:border-teal-400 outline-none transition-all shadow-sm hover:border-teal-200" />
                            </div>

                            <div className="space-y-3 p-5 bg-slate-50 border border-slate-100 rounded-2xl">
                                <div className="flex items-center justify-between">
                                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                                        <UserCircle className="w-4 h-4 text-slate-400" /> Participantes
                                    </label>
                                    <Button variant="outline" size="sm" onClick={addParticipant} className="bg-white text-teal-600 border-teal-200 hover:bg-teal-50 gap-1 h-8 text-xs font-bold shadow-sm rounded-lg">
                                        <Plus className="w-3.5 h-3.5" /> Adicionar Pessoal
                                    </Button>
                                </div>
                                <div className="space-y-3 mt-2">
                                    {participants.map((p, i) => (
                                        <div key={i} className="flex gap-2 items-center relative group/person">
                                            <div className="flex-1">
                                                <input type="text" value={p.name} onChange={e => updateParticipant(i, 'name', e.target.value)} placeholder="Nome"
                                                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-medium text-slate-700 placeholder:text-slate-300 focus:ring-2 focus:ring-teal-100 focus:border-teal-300 outline-none shadow-sm transition-all" />
                                            </div>
                                            <div className="flex-1">
                                                <input type="text" value={p.phone} onChange={e => updateParticipant(i, 'phone', e.target.value)} placeholder="Telefone (5511999999999)"
                                                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-medium text-slate-700 placeholder:text-slate-300 focus:ring-2 focus:ring-teal-100 focus:border-teal-300 outline-none shadow-sm transition-all" />
                                            </div>
                                            {participants.length > 1 && (
                                                <button onClick={() => removeParticipant(i)} className="text-slate-300 hover:text-rose-500 transition-colors p-2 bg-white border border-slate-100 shadow-sm rounded-lg hover:border-rose-200"><X className="w-4 h-4" /></button>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="flex items-center gap-4 mt-2">
                                <Button onClick={handleCreateGroup} disabled={creatingGroup || !groupName.trim()}
                                    className="bg-gradient-to-r from-teal-600 to-teal-500 hover:from-teal-700 hover:to-teal-600 text-white gap-2 h-12 px-10 font-bold shadow-xl shadow-teal-500/20 transition-all active:scale-[0.98] disabled:opacity-50 rounded-xl border border-teal-400/50">
                                    {creatingGroup ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bell className="w-4 h-4" />}
                                    {creatingGroup ? 'Criando Grupo...' : 'Criar Grupo Agora'}
                                </Button>
                                {groupResult === 'success' && <span className="text-sm font-bold text-emerald-600 flex items-center gap-1 bg-emerald-50 px-3 py-2 rounded-lg border border-emerald-100"><CheckCircle2 className="w-4 h-4" /> Sucesso!</span>}
                                {groupResult === 'error' && <span className="text-sm font-bold text-rose-600 flex items-center gap-1 bg-rose-50 px-3 py-2 rounded-lg border border-rose-100"><X className="w-4 h-4" /> Erro na criação</span>}
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>
                </div>
            )}
        </div>
    );
}
