import React, { useState, useEffect } from "react";
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
} from "lucide-react";
import { cn } from "@/src/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { useSettings, Clinic, AIConfig, WhatsappInstance } from "../hooks/useSupabase";
import { supabase } from "../lib/supabase";

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
        if (clinic) setLocalClinic(clinic);
        if (aiConfig) setLocalAI(aiConfig);
        if (whatsapp) setLocalWA(whatsapp);
    }, [clinic, aiConfig, whatsapp]);

    const handleSave = async () => {
        setSaving(true);
        try {
            if (activeTab === 'branding' || activeTab === 'clinic') {
                await updateClinic(localClinic);
            } else if (activeTab === 'ai') {
                await updateAI(localAI);
            } else if (activeTab === 'integrations') {
                await updateWhatsapp(localWA);
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

            alert('Solicitação de conexão iniciada! O sistema tentará conectar a cada 15s até que o QR Code seja lido.');
        } catch (error: any) {
            console.error('Erro ao conectar WhatsApp:', error);
            alert('Erro ao iniciar conexão: ' + error.message);
        } finally {
            setConnecting(false);
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
        { id: "ai", label: "Assistente IA", icon: Bot, color: "text-teal-600" },
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
                                onConnect={handleWhatsappConnect}
                                connecting={connecting}
                            />
                        )}
                    </motion.div>
                </AnimatePresence>
            </div>

            <div className="pt-6 border-t border-slate-200 flex justify-end gap-3 bg-slate-50/80 backdrop-blur-md sticky bottom-0 z-20">
                <Button variant="outline" className="px-8 h-10" disabled={saving}>
                    Descartar
                </Button>
                <Button onClick={handleSave} className="px-8 h-10 bg-teal-600 hover:bg-teal-700" disabled={saving}>
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
                        <CardTitle className="text-2xl font-bold text-slate-900">Assistente IA</CardTitle>
                        <p className="text-slate-500 font-medium">Configure o comportamento da assistente automática.</p>
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
                        Prompt Master / Regras da IA
                    </label>
                    <textarea 
                        className="w-full px-4 py-3 border border-slate-200 rounded-lg font-medium text-slate-700 h-48 text-sm bg-slate-50/30 focus:bg-white focus:ring-2 focus:ring-teal-100 transition-all"
                        value={data.prompt || ''}
                        onChange={(e) => onChange({ prompt: e.target.value })}
                        placeholder="Instruções avançadas para o comportamento da IA..."
                    />
                    <p className="text-[10px] text-slate-400 font-medium leading-relaxed">
                        Este é o prompt base que define a personalidade e as regras principais da sua assistente. 
                        Use para definir como ela deve se comportar, o que pode ou não falar.
                    </p>
                </div>

                <div className="space-y-3">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Bio / Apresentação Curta</label>
                    <textarea 
                        className="w-full px-4 py-2 border border-slate-200 rounded-lg font-medium text-slate-700 h-24"
                        value={data.bio_text || ''}
                        onChange={(e) => onChange({ bio_text: e.target.value })}
                        placeholder="Ex: Olá! Sou a assistente IA da clínica..."
                    />
                </div>

                <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg border border-slate-200">
                    <div className="flex gap-4">
                        <Bot className="w-5 h-5 text-teal-600 shrink-0" />
                        <div>
                            <p className="font-bold text-slate-900 text-sm">Agendamento Automático</p>
                            <p className="text-slate-500 font-medium text-xs mt-0.5">Permitir que a IA agende consultas diretamente.</p>
                        </div>
                    </div>
                    <input 
                        type="checkbox" 
                        className="w-5 h-5 accent-teal-600"
                        checked={data.auto_schedule || false}
                        onChange={(e) => onChange({ auto_schedule: e.target.checked })}
                    />
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

function IntegrationSettings({ data, onChange, onConnect, connecting }: { 
    data: Partial<WhatsappInstance>, 
    onChange: (updates: Partial<WhatsappInstance>) => void,
    onConnect: () => void,
    connecting: boolean
}) {
    const [simulating, setSimulating] = useState(false);

    return (
        <div className="max-w-4xl mx-auto space-y-6">
            <Card className="border border-slate-200 shadow-sm overflow-hidden">
                <CardHeader className="bg-gradient-to-r from-emerald-600 to-teal-600 pb-6 px-8">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-5">
                            <div className="w-14 h-14 bg-white/20 backdrop-blur-sm rounded-xl flex items-center justify-center shadow-lg">
                                <MessageCircle className="w-7 h-7 text-white" />
                            </div>
                            <div>
                                <CardTitle className="text-2xl font-bold text-white">WhatsApp Business</CardTitle>
                                <p className="text-white/80 font-medium text-sm">Integração simplificada via n8n Bridge</p>
                            </div>
                        </div>
                        <div className={cn(
                            "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold",
                            data.status === "connected" 
                                ? "bg-white/20 text-white" 
                                : "bg-white/10 text-white/60"
                        )}>
                            {data.status === "connected" ? (
                                <><Wifi className="w-4 h-4" /> Conectado</>
                            ) : (
                                <><WifiOff className="w-4 h-4" /> Desconectado</>
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

                        <div className="grid grid-cols-1 gap-4">
                            <div className="space-y-2">
                                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">ID da API (Instance Name)</label>
                                <input
                                    type="text"
                                    value={data.api_id || ''}
                                    onChange={(e) => onChange({ api_id: e.target.value })}
                                    placeholder="Ex: clinica-whatsapp-01"
                                    className="w-full px-4 py-2.5 border border-slate-200 rounded-lg font-medium text-slate-700 text-sm placeholder:text-slate-300 focus:ring-2 focus:ring-teal-100 focus:border-teal-300 outline-none transition-all"
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Token da API</label>
                            <input
                                type="password"
                                value={data.api_token || ''}
                                onChange={(e) => onChange({ api_token: e.target.value })}
                                placeholder="Seu token de autenticação (UaZapi)"
                                className="w-full px-4 py-2.5 border border-slate-200 rounded-lg font-medium text-slate-700 text-sm placeholder:text-slate-300 focus:ring-2 focus:ring-teal-100 focus:border-teal-300 outline-none transition-all"
                            />
                            <p className="text-[10px] text-slate-400">Este token será usado pelo n8n para gerenciar a instância.</p>
                        </div>
                    </div>

                    <div className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-inner">
                        {(data.status === "disconnected" || data.status === "qr_pending" || data.status === "connecting" || !data.status) && (
                            <div className="p-10 flex flex-col items-center gap-6 bg-slate-50/50">
                                {data.status === 'connecting' ? (
                                    <div className="flex flex-col items-center gap-4">
                                        <Loader2 className="w-12 h-12 text-teal-600 animate-spin" />
                                        <p className="text-sm font-medium text-slate-500">Iniciando sessão...</p>
                                    </div>
                                ) : data.qr_code ? (
                                    <div className="relative group">
                                        <div className="absolute -inset-4 bg-gradient-to-tr from-teal-500/10 to-teal-500/5 rounded-3xl blur-xl group-hover:blur-2xl transition-all opacity-0 group-hover:opacity-100"></div>
                                        <div className="relative p-6 bg-white rounded-2xl border border-teal-100 shadow-xl">
                                            <img 
                                                src={data.qr_code.startsWith('data:') ? data.qr_code : `data:image/png;base64,${data.qr_code}`} 
                                                alt="WhatsApp QR Code" 
                                                className="w-48 h-48 rounded-lg"
                                            />
                                            <div className="mt-4 text-center">
                                                <p className="text-sm font-bold text-teal-600">Escaneie o QR Code</p>
                                                <p className="text-[10px] text-slate-400">Aguardando leitura pelo WhatsApp...</p>
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <QrCode className="w-12 h-12 text-slate-300" />
                                )}
                                
                                <div className="flex flex-col items-center gap-4 text-center">
                                    <p className="text-slate-500 font-bold">
                                        {data.status === 'connecting' ? 'Conectando à API...' : (data.qr_code ? 'QR Code Gerado!' : 'Pronto para conectar?')}
                                    </p>
                                    <p className="text-slate-400 font-medium text-sm max-w-xs transition-all">
                                        {data.status === 'connecting' 
                                            ? 'Estamos preparando sua instância no servidor. Isso pode levar alguns segundos.'
                                            : (data.qr_code 
                                                ? 'Abra o WhatsApp > Dispositivos Conectados > Conectar um dispositivo.' 
                                                : 'A conexão será processada via n8n. Certifique-se de que o fluxo esteja ativo.')}
                                    </p>
                                    
                                    <div className="flex flex-col sm:flex-row items-center gap-3">
                                        <Button 
                                            onClick={onConnect} 
                                            disabled={connecting || data.status === 'qr_pending' || data.status === 'connecting'}
                                            className="bg-teal-600 hover:bg-teal-700 text-white gap-2 h-12 px-10 font-bold shadow-lg shadow-teal-100 transition-all active:scale-95 disabled:opacity-50"
                                        >
                                            {(connecting || data.status === 'connecting') ? <Loader2 className="w-5 h-5 animate-spin" /> : <Wifi className="w-4 h-4" />}
                                            {(connecting || data.status === 'connecting') ? 'Processando...' : (data.status === 'qr_pending' ? 'Aguardando QR Code...' : 'Conectar Agora')}
                                        </Button>

                                        {(data.status === 'qr_pending' || data.status === 'connecting') && (
                                            <Button 
                                                variant="outline"
                                                onClick={() => onChange({ status: 'disconnected', qr_code: undefined })}
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
    );
}
