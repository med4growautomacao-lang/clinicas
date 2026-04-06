import React, { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import {
    Palette,
    Bot,
    Building2,
    Bell,
    Lock,
    Globe,
    Camera,
    Check,
    Info,
    Volume2,
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
} from "lucide-react";
import { cn } from "@/src/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { useSettings, Clinic, AIConfig, WhatsappInstance } from "../hooks/useSupabase";
import { supabase } from "../lib/supabase";
import MetaLogo from "../assets/logos/Logo Metaads.png";
import GoogleLogo from "../assets/logos/Logo Googleads.png";
import WhatsappLogo from "../assets/logos/Logo Whatsapp.png";

export function Settings() {
    const { clinic, aiConfig, whatsapp, loading, updateClinic, updateAI, updateWhatsapp } = useSettings();
    const [activeTab, setActiveTab] = useState<"branding" | "ai" | "clinic" | "integrations">("branding");
    
    // Local states for editing
    const [localClinic, setLocalClinic] = useState<Partial<Clinic>>({});
    const [localAI, setLocalAI] = useState<Partial<AIConfig>>({});
    const [localWA, setLocalWA] = useState<Partial<WhatsappInstance>>({});
    const [saving, setSaving] = useState(false);
    const [connecting, setConnecting] = useState(false);

    useEffect(() => {
        console.log('Settings: Auth values changed - WhatsApp:', !!whatsapp, 'Has QR:', !!whatsapp?.qr_code, 'Status:', whatsapp?.status);
        if (clinic && Object.keys(localClinic).length === 0) setLocalClinic(clinic);
        if (aiConfig && Object.keys(localAI).length === 0) setLocalAI(aiConfig);
        if (whatsapp) {
            console.log('Settings: Synchronizing localWA with WhatsApp from server');
            setLocalWA(whatsapp);
        }
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
            if (activeTab === 'branding' || activeTab === 'clinic') {
                await updateClinic(localClinic);
            } else if (activeTab === 'ai') {
                await updateAI(localAI);
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

    useEffect(() => {
        let interval: any;
        
        if (whatsapp?.status === 'connecting' || whatsapp?.status === 'qr_pending') {
            // Envia o primeiro sinal imediatamente
            const sendSignal = async () => {
                if (!clinic?.id) return;
                console.log('Enviando sinal de keep-alive para WhatsApp Bridge...');
                await supabase.functions.invoke('whatsapp-bridge', {
                    body: { clinic_id: clinic.id }
                });
            };

            sendSignal();
            
            // Define o intervalo de 15 segundos
            interval = setInterval(sendSignal, 15000);
        }

        return () => {
            if (interval) clearInterval(interval);
        };
    }, [whatsapp?.status, clinic?.id]);

    const handleWhatsappConnect = async () => {
        if (!clinic?.id) return;
        setConnecting(true);
        try {
            // Primeiro avisamos o banco que estamos tentando conectar
            await updateWhatsapp({ status: 'connecting', qr_code: undefined });
            
            // O useEffect acima cuidará de chamar a Bridge a cada 15 segundos
            // Mas chamamos uma vez aqui para ser instantâneo no primeiro clique
            await supabase.functions.invoke('whatsapp-bridge', {
                body: { clinic_id: clinic.id }
            });
        } catch (error: any) {
            console.error('Erro ao conectar WhatsApp:', error);
            alert('Erro ao iniciar conexão: ' + error.message);
        } finally {
            setConnecting(false);
        }
    };

    const handleWhatsappCancel = async () => {
        if (!clinic?.id) return;
        try {
            await updateWhatsapp({ status: 'disconnected', qr_code: null });
            console.log('Conexão cancelada pelo usuário.');
        } catch (error) {
            console.error('Erro ao cancelar conexão:', error);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="w-8 h-8 text-teal-600 animate-spin" />
            </div>
        );
    }

    const tabs = [
        { id: "branding", label: "Branding", icon: Palette, color: "text-teal-600" },
        { id: "ai", label: "Comercial", icon: Bot, color: "text-teal-600" },
        { id: "clinic", label: "Dados da Clínica", icon: Building2, color: "text-emerald-600" },
        { id: "integrations", label: "Integrações", icon: Plug, color: "text-violet-600" },
    ];

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
                                onClick={() => setActiveTab(tab.id as any)}
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
                        {activeTab === "branding" && (
                            <BrandingSettings 
                                data={localClinic} 
                                onChange={(updates) => setLocalClinic(prev => ({ ...prev, ...updates }))} 
                            />
                        )}
                        {activeTab === "ai" && (
                            <AISettings 
                                data={localAI} 
                                onChange={(updates) => setLocalAI(prev => ({ ...prev, ...updates }))} 
                            />
                        )}
                        {activeTab === "clinic" && (
                            <ClinicSettings 
                                data={localClinic} 
                                onChange={(updates) => setLocalClinic(prev => ({ ...prev, ...updates }))} 
                            />
                        )}
                        {activeTab === "integrations" && (
                            <IntegrationSettings 
                                data={localWA} 
                                onChange={(updates) => setLocalWA(prev => ({ ...prev, ...updates }))} 
                                clinicData={localClinic}
                                onClinicChange={(updates) => setLocalClinic(prev => ({ ...prev, ...updates }))}
                                onConnect={handleWhatsappConnect}
                                onCancel={handleWhatsappCancel}
                                connecting={connecting}
                            />
                        )}
                    </motion.div>
                </AnimatePresence>
            </div>

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

function AISettings({ data, onChange }: { data: Partial<AIConfig>, onChange: (updates: Partial<AIConfig>) => void }) {
    const getStyleLabel = (style: string) => {
        switch(style) {
            case 'tecnica': return 'Técnica & Precisa';
            case 'objetiva': return 'Objetiva';
            case 'cordial': return 'Cordial & Informativa';
            default: return style;
        }
    };

    const getSpeedLabel = (speed: string) => {
        switch(speed) {
            case 'instantanea': return 'Instantânea';
            case 'cadenciada': return 'Cadenciada (Natural)';
            default: return speed;
        }
    };

    return (
        <Card className="border border-slate-200 shadow-sm max-w-3xl mx-auto">
            <CardHeader className="bg-slate-50 border-b border-slate-200 pb-6 px-8">
                <div className="flex items-center gap-6">
                    <div className="w-16 h-16 bg-teal-600 rounded-xl flex items-center justify-center shadow-sm">
                        <Bot className="w-8 h-8 text-white" />
                    </div>
                    <div>
                        <CardTitle className="text-2xl font-bold text-slate-900">Configuracoes do Comercial</CardTitle>
                        <p className="text-slate-500 font-medium">Configure o comportamento da automacao comercial.</p>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="p-8 space-y-8">
                <div className="space-y-4">
                    <div className="flex justify-between items-end">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                            <Volume2 className="w-4 h-4" /> Tom de Voz
                        </label>
                        <span className="text-teal-600 font-semibold">{data.tone && data.tone > 50 ? 'Casual' : 'Formal'} (Nível: {data.tone})</span>
                    </div>
                    <input 
                        type="range" 
                        className="w-full accent-teal-600 h-2 rounded-full bg-slate-100" 
                        min="0" max="100" 
                        value={data.tone || 70}
                        onChange={(e) => onChange({ tone: parseInt(e.target.value) })}
                    />
                    <div className="flex justify-between text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                        <span>Formal</span>
                        <span>Casual</span>
                    </div>
                </div>

                <div className="grid gap-6 md:grid-cols-2">
                    <div className="space-y-3">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Estilo de Resposta</label>
                        <select 
                            className="w-full px-4 py-2 border border-slate-200 rounded-lg font-medium text-slate-700 bg-white"
                            value={data.response_style || 'cordial'}
                            onChange={(e) => onChange({ response_style: e.target.value as any })}
                        >
                            <option value="tecnica">Técnica & Precisa</option>
                            <option value="objetiva">Objetiva</option>
                            <option value="cordial">Cordial & Informativa</option>
                        </select>
                    </div>
                    <div className="space-y-3">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Velocidade de Resposta</label>
                        <select 
                            className="w-full px-4 py-2 border border-slate-200 rounded-lg font-medium text-slate-700 bg-white"
                            value={data.response_speed || 'instantanea'}
                            onChange={(e) => onChange({ response_speed: e.target.value as any })}
                        >
                            <option value="instantanea">Instantânea</option>
                            <option value="cadenciada">Cadenciada (Natural)</option>
                        </select>
                    </div>
                </div>

                <div className="space-y-3">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                        <Info className="w-4 h-4 text-teal-600" />
                        Instrucoes do Comercial
                    </label>
                    <textarea 
                        className="w-full px-4 py-3 border border-slate-200 rounded-lg font-medium text-slate-700 h-48 text-sm bg-slate-50/30 focus:bg-white focus:ring-2 focus:ring-teal-100 transition-all"
                        value={data.prompt || ''}
                        onChange={(e) => onChange({ prompt: e.target.value })}
                        placeholder="Instrucoes avancadas para o comportamento do Comercial..."
                    />
                    <p className="text-[10px] text-slate-400 font-medium leading-relaxed">
                        Este é o prompt base que define a personalidade e as regras principais do seu agente Comercial. 
                        Use para definir como ele deve se comportar, o que pode ou não falar.
                    </p>
                </div>

                <div className="space-y-3">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Bio / Apresentação Curta</label>
                    <textarea 
                        className="w-full px-4 py-2 border border-slate-200 rounded-lg font-medium text-slate-700 h-24"
                        value={data.bio_text || ''}
                        onChange={(e) => onChange({ bio_text: e.target.value })}
                        placeholder="Ex: Olá! Sou o Comercial da clínica..."
                    />
                </div>


                <div className="flex items-center justify-between p-5 bg-slate-50 rounded-2xl border border-slate-200 transition-all hover:bg-slate-100/50">
                    <div className="flex gap-4">
                        <div className={cn(
                            "w-10 h-10 rounded-xl flex items-center justify-center transition-all",
                            data.auto_schedule ? "bg-teal-600 shadow-md" : "bg-slate-200"
                        )}>
                            <Bot className={cn("w-5 h-5", data.auto_schedule ? "text-white" : "text-slate-500")} />
                        </div>
                        <div>
                            <p className="font-bold text-slate-900 text-sm">Agendamento Automático</p>
                            <p className="text-slate-500 font-medium text-xs mt-0.5">Permitir que a IA agende consultas diretamente.</p>
                        </div>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                        <input 
                            type="checkbox" 
                            className="sr-only peer"
                            checked={data.auto_schedule || false}
                            onChange={(e) => onChange({ auto_schedule: e.target.checked })}
                        />
                        <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-teal-100 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-teal-600"></div>
                    </label>
                </div>
            </CardContent>
        </Card>
    );
}

function ClinicSettings({ data, onChange }: { data: Partial<Clinic>, onChange: (updates: Partial<Clinic>) => void }) {
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

                <div className="mt-8 p-4 bg-rose-50 rounded-lg border border-rose-100 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <div className="p-2 bg-white rounded-lg text-rose-500 shadow-sm">
                            <Trash2 className="w-5 h-5" />
                        </div>
                        <div>
                            <p className="font-bold text-slate-700">Zona de Perigo</p>
                            <p className="text-xs font-medium text-slate-400">Apagar todos os dados da clínica permanentemente.</p>
                        </div>
                    </div>
                    <Button variant="outline" className="text-rose-500 hover:bg-rose-100 border-rose-200">Apagar Clínica</Button>
                </div>
            </CardContent>
        </Card>
    );
}

function IntegrationSettings({ data, onChange, clinicData, onClinicChange, onConnect, onCancel, connecting }: {
    data: Partial<WhatsappInstance>,
    onChange: (updates: Partial<WhatsappInstance>) => void,
    clinicData: Partial<Clinic>,
    onClinicChange: (updates: Partial<Clinic>) => void,
    onConnect: () => void,
    onCancel: () => void,
    connecting: boolean
}) {
    const { clinic, refetch, systemSettings } = useSettings();
    const [groupName, setGroupName] = useState('Informativos do Agente IA');
    const [participants, setParticipants] = useState<{ name: string; phone: string }[]>([{ name: '', phone: '' }]);
    const [creatingGroup, setCreatingGroup] = useState(false);
    const [groupResult, setGroupResult] = useState<'success' | 'error' | null>(null);
    const [showScripts, setShowScripts] = useState(false);
    const [activeIntTab, setActiveIntTab] = useState<'whatsapp' | 'meta' | 'google'>('whatsapp');

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
            <div className="flex bg-slate-100 p-1 rounded-lg w-full sm:w-fit shadow-sm border border-slate-200">
                <button
                    onClick={() => setActiveIntTab('whatsapp')}
                    className={cn(
                        "flex items-center gap-2 px-5 py-2 text-sm font-semibold rounded-md transition-all",
                        activeIntTab === 'whatsapp' ? "bg-emerald-600 text-white shadow-sm" : "text-slate-500 hover:text-slate-900 hover:bg-slate-50"
                    )}
                >
                    <MessageCircle className="w-4 h-4" /> WhatsApp
                </button>
                <button
                    onClick={() => setActiveIntTab('meta')}
                    className={cn(
                        "flex items-center gap-2 px-5 py-2 text-sm font-semibold rounded-md transition-all",
                        activeIntTab === 'meta' ? "bg-blue-600 text-white shadow-sm" : "text-slate-500 hover:text-slate-900 hover:bg-slate-50"
                    )}
                >
                    <img src={MetaLogo} alt="Meta" className={cn("w-4 h-4 object-contain filter transition-all", activeIntTab === 'meta' ? 'brightness-0 invert' : 'brightness-0 opacity-50')} /> Meta Ads
                </button>
                <button
                    onClick={() => setActiveIntTab('google')}
                    className={cn(
                        "flex items-center gap-2 px-5 py-2 text-sm font-semibold rounded-md transition-all",
                        activeIntTab === 'google' ? "bg-amber-500 text-white shadow-sm" : "text-slate-500 hover:text-slate-900 hover:bg-slate-50"
                    )}
                >
                    <img src={GoogleLogo} alt="Google" className={cn("w-4 h-4 object-contain filter transition-all", activeIntTab === 'google' ? 'brightness-0 invert' : 'brightness-0 opacity-50')} /> Google Ads
                </button>
            </div>

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
                                    data.status === 'connecting' ? 'bg-blue-500' :
                                    data.status === 'qr_pending' ? 'bg-amber-500' : 'bg-slate-300'
                                }`} />
                                <span className={`text-xs font-bold uppercase ${
                                    data.status === 'connected' ? 'text-emerald-600' : 
                                    data.status === 'connecting' ? 'text-blue-600' :
                                    data.status === 'qr_pending' ? 'text-amber-600' : 'text-slate-500'
                                }`}>
                                    {data.status === 'connected' ? 'Conectado' : 
                                     data.status === 'connecting' ? 'Conectando...' :
                                     data.status === 'qr_pending' ? 'Aguardando QR' : 'Desconectado'}
                                </span>
                            </div>
                        </div>

                        <div className="bg-slate-50 border border-slate-100 rounded-2xl p-5 space-y-4 shadow-sm">
                            <div className="space-y-2">
                                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">ID da API (Instance Name)</label>
                                <input
                                    type="text"
                                    value={data.api_id || ''}
                                    readOnly
                                    onChange={(e) => onChange({ api_id: e.target.value })}
                                    placeholder="Ex: clinica-whatsapp-01"
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
                        {(data.status === "disconnected" || data.status === "qr_pending" || data.status === "connecting" || !data.status) && (
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
                                        <Button 
                                            onClick={onConnect} 
                                            disabled={connecting || data.status === 'qr_pending' || data.status === 'connecting'}
                                            className="bg-gradient-to-r from-teal-600 to-teal-500 hover:from-teal-700 hover:to-teal-600 text-white gap-2 h-12 px-10 font-bold shadow-xl shadow-teal-500/20 transition-all active:scale-[0.98] disabled:opacity-50 rounded-xl"
                                        >
                                            {(connecting || data.status === 'connecting') ? <Loader2 className="w-5 h-5 animate-spin" /> : <Wifi className="w-5 h-5" />}
                                            {(connecting || data.status === 'connecting') ? 'Processando...' : (data.status === 'qr_pending' ? 'Aguardando QR Code...' : 'Conectar Agora')}
                                        </Button>

                                        {(data.status === 'qr_pending' || data.status === 'connecting') && (
                                            <Button 
                                                variant="outline"
                                                onClick={onCancel}
                                                className="text-slate-500 border-slate-200 hover:bg-slate-100 h-12 px-6 font-bold flex items-center gap-2"
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
                                            <p className="text-sm font-medium text-emerald-600">{data.phone_number || 'Sessão ativa'}</p>
                                        </div>
                                    </div>
                                    <Button 
                                        variant="outline" 
                                        onClick={() => onChange({ status: 'disconnected' })}
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
                </CardContent>
            </Card>
                </div>
            )}

            {/* Google Ads & Links */}
            {activeIntTab === 'google' && (
                <div className="space-y-6">
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
                            {/* Webhook */}
                            <div className="space-y-3 p-5 bg-slate-50 border border-slate-100 rounded-2xl relative overflow-hidden group/item">
                                <div className="absolute top-0 left-0 w-1 h-full bg-blue-500"></div>
                                <label className="text-xs font-bold text-slate-700 flex items-center gap-2">
                                    <Globe className="w-4 h-4 text-blue-500" />
                                    Endereço Webhook <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded-md text-[9px] uppercase tracking-wider ml-2">LP / Forms</span>
                                </label>
                                <p className="text-[12px] text-slate-500 font-medium leading-relaxed max-w-2xl">
                                    Utilize este endereço no formulário da sua Landing Page para capturar os leads diretamente no sistema.
                                </p>
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
                                        <Copy className="w-4 h-4" /> Copiar Link
                                    </Button>
                                </div>
                            </div>

                            {/* Botão WA */}
                            <div className="space-y-3 p-5 bg-emerald-50/50 border border-emerald-100 rounded-2xl relative overflow-hidden group/item">
                                <div className="absolute top-0 left-0 w-1 h-full bg-emerald-500"></div>
                                <label className="text-xs font-bold text-slate-700 flex items-center gap-2">
                                    <MessageCircle className="w-4 h-4 text-emerald-500" />
                                    URL do WhatsApp <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-md text-[9px] uppercase tracking-wider ml-2">Direto</span>
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
    return script;
})()}
                                    </pre>
                                    <div className="absolute top-12 right-6 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                                        <Button 
                                            vari                                            onClick={(e) => {
                                                const script = systemSettings?.global_tracking_script || '<!-- Script Global não configurado no banco system_settings -->';
                                                const finalScript = script.replace(/{{WA_PRE_MSG}}/g, clinicData.wa_pre_msg || 'Olá! Vim do site.')
                                                                          .replace(/{{PHONE}}/g, clinicData.phone ? clinicData.phone.replace(/\D/g, '') : 'SEUNUMERO');
                                                
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
