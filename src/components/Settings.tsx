import React, { useState } from "react";
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
} from "lucide-react";
import { cn } from "@/src/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

export function Settings() {
    const [activeTab, setActiveTab] = useState<"branding" | "ai" | "clinic" | "integrations">("branding");

    const tabs = [
        { id: "branding", label: "Branding", icon: Palette, color: "text-teal-600" },
        { id: "ai", label: "Assistente IA", icon: Bot, color: "text-teal-600" },
        { id: "clinic", label: "Dados da Clínica", icon: Building2, color: "text-emerald-600" },
        { id: "integrations", label: "Integrações", icon: Plug, color: "text-violet-600" },
    ];

    return (
        <div className="space-y-8 h-full flex flex-col">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
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
                        {activeTab === "branding" && <BrandingSettings />}
                        {activeTab === "ai" && <AISettings />}
                        {activeTab === "clinic" && <ClinicSettings />}
                        {activeTab === "integrations" && <IntegrationSettings />}
                    </motion.div>
                </AnimatePresence>
            </div>

            <div className="pt-6 border-t border-slate-200 flex justify-end gap-3 bg-slate-50/80 backdrop-blur-md sticky bottom-0 z-20">
                <Button variant="outline" className="px-8 h-10">
                    Descartar
                </Button>
                <Button className="px-8 h-10">
                    Salvar Alterações
                </Button>
            </div>
        </div>
    );
}

function BrandingSettings() {
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
                            <div className="w-14 h-14 rounded-lg bg-teal-600 shadow-sm border border-slate-200" />
                            <input type="text" value="#0d9488" className="flex-1 px-4 py-2 border border-slate-200 rounded-lg font-medium text-slate-700" />
                        </div>
                    </div>
                    <div className="space-y-3">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Cor Secundária</label>
                        <div className="flex items-center gap-4">
                            <div className="w-14 h-14 rounded-lg bg-slate-900 shadow-sm border border-slate-200" />
                            <input type="text" value="#0f172a" className="flex-1 px-4 py-2 border border-slate-200 rounded-lg font-medium text-slate-700" />
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
                        <div className="w-16 h-16 bg-slate-100 rounded-lg flex items-center justify-center group-hover:scale-105 transition-transform">
                            <CloudUpload className="w-8 h-8 text-teal-600" />
                        </div>
                        <div className="text-center">
                            <p className="font-bold text-slate-900">Enviar Logotipo</p>
                            <p className="text-xs font-medium text-slate-400 uppercase tracking-wider mt-1">PNG ou SVG (Máx 2MB)</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
                        <div className="p-1.5 bg-white rounded-md shadow-sm">
                            <Info className="w-4 h-4 text-teal-600" />
                        </div>
                        <p className="text-xs font-medium text-slate-600">O logo aparecerá no topo da barra lateral e em todos os relatórios.</p>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}

function AISettings() {
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
                        <span className="text-teal-600 font-semibold">Profissional & Cordial</span>
                    </div>
                    <input type="range" className="w-full accent-teal-600 h-2 rounded-full bg-slate-100" min="0" max="100" defaultValue="70" />
                    <div className="flex justify-between text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                        <span>Formal</span>
                        <span>Casual</span>
                    </div>
                </div>

                <div className="grid gap-6 md:grid-cols-2">
                    <div className="space-y-3">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Estilo de Resposta</label>
                        <select className="w-full px-4 py-2 border border-slate-200 rounded-lg font-medium text-slate-700 bg-white">
                            <option>Técnica & Precisa</option>
                            <option>Objetiva</option>
                            <option>Cordial & Informativa</option>
                        </select>
                    </div>
                    <div className="space-y-3">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Velocidade de Resposta</label>
                        <select className="w-full px-4 py-2 border border-slate-200 rounded-lg font-medium text-slate-700 bg-white">
                            <option>Instantânea</option>
                            <option>Cadenciada (Natural)</option>
                        </select>
                    </div>
                </div>

                <div className="p-4 bg-slate-50 rounded-lg border border-slate-200 flex gap-4">
                    <Info className="w-5 h-5 text-teal-600 shrink-0" />
                    <div>
                        <p className="font-bold text-slate-900 text-sm">Preview da Bio:</p>
                        <p className="text-slate-500 font-medium text-sm mt-1">
                            "Olá! Sou a assistente IA da clínica. Estou aqui para ajudá-lo com agendamentos, informações sobre procedimentos e dúvidas gerais."
                        </p>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}

function ClinicSettings() {
    return (
        <Card className="border border-slate-200 shadow-sm max-w-4xl mx-auto">
            <CardContent className="p-8">
                <div className="grid gap-8 md:grid-cols-2">
                    <div className="space-y-6">
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Nome da Clínica</label>
                            <input type="text" value="Clínica Médica Padrão" className="w-full px-4 py-2 border border-slate-200 rounded-lg font-medium text-slate-700" />
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">CNPJ</label>
                            <input type="text" value="12.345.678/0001-99" className="w-full px-4 py-2 border border-slate-200 rounded-lg font-medium text-slate-700" />
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Telefone de Contato</label>
                            <input type="text" value="(11) 98765-4321" className="w-full px-4 py-2 border border-slate-200 rounded-lg font-medium text-slate-700" />
                        </div>
                    </div>
                    <div className="space-y-6">
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Endereço</label>
                            <textarea className="w-full px-4 py-2 border border-slate-200 rounded-lg font-medium text-slate-700 h-[210px]" defaultValue="Rua da Saúde, 123 - Centro, São Paulo - SP" />
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

function IntegrationSettings() {
    const [apiUrl, setApiUrl] = useState("");
    const [apiToken, setApiToken] = useState("");
    const [connectionStatus, setConnectionStatus] = useState<"disconnected" | "loading" | "qr" | "connected">("disconnected");
    const [copied, setCopied] = useState(false);

    const handleConnect = () => {
        if (!apiUrl.trim() || !apiToken.trim()) return;
        setConnectionStatus("loading");
        setTimeout(() => setConnectionStatus("qr"), 1500);
    };

    const handleSimulateConnect = () => {
        setConnectionStatus("loading");
        setTimeout(() => setConnectionStatus("connected"), 2000);
    };

    const handleDisconnect = () => {
        setConnectionStatus("disconnected");
    };

    const handleCopyWebhook = () => {
        navigator.clipboard.writeText(`${apiUrl}/webhook/whatsapp`);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="max-w-4xl mx-auto space-y-6">
            {/* WhatsApp Integration Card */}
            <Card className="border border-slate-200 shadow-sm overflow-hidden">
                <CardHeader className="bg-gradient-to-r from-emerald-600 to-teal-600 pb-6 px-8">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-5">
                            <div className="w-14 h-14 bg-white/20 backdrop-blur-sm rounded-xl flex items-center justify-center shadow-lg">
                                <MessageCircle className="w-7 h-7 text-white" />
                            </div>
                            <div>
                                <CardTitle className="text-2xl font-bold text-white">WhatsApp Business</CardTitle>
                                <p className="text-white/80 font-medium text-sm">Integração via UaZapi API</p>
                            </div>
                        </div>
                        <div className={cn(
                            "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold",
                            connectionStatus === "connected" 
                                ? "bg-white/20 text-white" 
                                : "bg-white/10 text-white/60"
                        )}>
                            {connectionStatus === "connected" ? (
                                <><Wifi className="w-4 h-4" /> Conectado</>
                            ) : (
                                <><WifiOff className="w-4 h-4" /> Desconectado</>
                            )}
                        </div>
                    </div>
                </CardHeader>

                <CardContent className="p-8 space-y-8">
                    {/* API Configuration */}
                    <div className="space-y-4">
                        <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                            <Shield className="w-4 h-4 text-teal-600" />
                            Configuração da API
                        </h3>
                        <div className="grid gap-4 md:grid-cols-2">
                            <div className="space-y-2">
                                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">URL da Instância UaZapi</label>
                                <input
                                    type="text"
                                    value={apiUrl}
                                    onChange={(e) => setApiUrl(e.target.value)}
                                    placeholder="https://sua-instancia.uazapi.com"
                                    className="w-full px-4 py-2.5 border border-slate-200 rounded-lg font-medium text-slate-700 text-sm placeholder:text-slate-300 focus:ring-2 focus:ring-teal-100 focus:border-teal-300 outline-none transition-all"
                                    disabled={connectionStatus === "connected"}
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Token da API</label>
                                <input
                                    type="password"
                                    value={apiToken}
                                    onChange={(e) => setApiToken(e.target.value)}
                                    placeholder="Seu token de autenticação"
                                    className="w-full px-4 py-2.5 border border-slate-200 rounded-lg font-medium text-slate-700 text-sm placeholder:text-slate-300 focus:ring-2 focus:ring-teal-100 focus:border-teal-300 outline-none transition-all"
                                    disabled={connectionStatus === "connected"}
                                />
                            </div>
                        </div>
                    </div>

                    {/* Connection Area */}
                    <div className="border border-slate-200 rounded-xl overflow-hidden">
                        {connectionStatus === "disconnected" && (
                            <div className="p-10 flex flex-col items-center gap-6 bg-slate-50/50">
                                <div className="w-24 h-24 bg-slate-100 rounded-2xl flex items-center justify-center border border-slate-200">
                                    <QrCode className="w-12 h-12 text-slate-300" />
                                </div>
                                <div className="text-center space-y-2">
                                    <p className="font-bold text-slate-700 text-lg">Conectar WhatsApp</p>
                                    <p className="text-slate-400 font-medium text-sm max-w-sm">
                                        Configure sua URL e Token acima, depois clique em "Gerar QR Code" para vincular seu número.
                                    </p>
                                </div>
                                <Button 
                                    onClick={handleConnect}
                                    disabled={!apiUrl.trim() || !apiToken.trim()}
                                    className="px-8 py-5 gap-2 bg-emerald-600 hover:bg-emerald-700"
                                >
                                    <QrCode className="w-5 h-5" />
                                    Gerar QR Code
                                </Button>
                            </div>
                        )}

                        {connectionStatus === "loading" && (
                            <div className="p-10 flex flex-col items-center gap-6 bg-slate-50/50">
                                <motion.div
                                    animate={{ rotate: 360 }}
                                    transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                                >
                                    <RefreshCw className="w-12 h-12 text-teal-600" />
                                </motion.div>
                                <p className="font-bold text-slate-600">Conectando à instância...</p>
                            </div>
                        )}

                        {connectionStatus === "qr" && (
                            <div className="p-8 flex flex-col md:flex-row items-center gap-8">
                                <div className="relative">
                                    <div className="w-56 h-56 bg-white border-2 border-slate-200 rounded-xl p-4 flex items-center justify-center shadow-sm">
                                        {/* Simulated QR Code Pattern */}
                                        <div className="w-full h-full grid grid-cols-8 grid-rows-8 gap-0.5">
                                            {Array.from({ length: 64 }).map((_, i) => (
                                                <div
                                                    key={i}
                                                    className={cn(
                                                        "rounded-sm",
                                                        Math.random() > 0.4 ? "bg-slate-900" : "bg-white"
                                                    )}
                                                />
                                            ))}
                                        </div>
                                    </div>
                                    <motion.div 
                                        className="absolute -bottom-2 -right-2 w-10 h-10 bg-emerald-500 rounded-lg flex items-center justify-center shadow-lg"
                                        animate={{ scale: [1, 1.1, 1] }}
                                        transition={{ duration: 2, repeat: Infinity }}
                                    >
                                        <Smartphone className="w-5 h-5 text-white" />
                                    </motion.div>
                                </div>
                                <div className="flex-1 space-y-4">
                                    <h4 className="text-xl font-bold text-slate-900">Escaneie o QR Code</h4>
                                    <ol className="space-y-3 text-sm">
                                        <li className="flex gap-3">
                                            <span className="w-6 h-6 rounded-md bg-teal-50 text-teal-600 flex items-center justify-center font-bold text-xs shrink-0">1</span>
                                            <span className="text-slate-600 font-medium">Abra o <strong>WhatsApp Business</strong> no seu celular</span>
                                        </li>
                                        <li className="flex gap-3">
                                            <span className="w-6 h-6 rounded-md bg-teal-50 text-teal-600 flex items-center justify-center font-bold text-xs shrink-0">2</span>
                                            <span className="text-slate-600 font-medium">Toque em <strong>⋮ Menu → Aparelhos conectados</strong></span>
                                        </li>
                                        <li className="flex gap-3">
                                            <span className="w-6 h-6 rounded-md bg-teal-50 text-teal-600 flex items-center justify-center font-bold text-xs shrink-0">3</span>
                                            <span className="text-slate-600 font-medium">Toque em <strong>Conectar um aparelho</strong></span>
                                        </li>
                                        <li className="flex gap-3">
                                            <span className="w-6 h-6 rounded-md bg-teal-50 text-teal-600 flex items-center justify-center font-bold text-xs shrink-0">4</span>
                                            <span className="text-slate-600 font-medium">Aponte a câmera para o QR Code ao lado</span>
                                        </li>
                                    </ol>
                                    <div className="flex gap-3 pt-2">
                                        <Button onClick={handleSimulateConnect} className="gap-2 bg-emerald-600 hover:bg-emerald-700">
                                            <CheckCircle2 className="w-4 h-4" />
                                            Simular Conexão
                                        </Button>
                                        <Button variant="outline" onClick={() => setConnectionStatus("disconnected")} className="gap-2 text-slate-500">
                                            <RefreshCw className="w-4 h-4" />
                                            Novo QR Code
                                        </Button>
                                    </div>
                                    <div className="flex items-center gap-2 p-3 bg-amber-50 rounded-lg border border-amber-100">
                                        <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                                        <p className="text-xs font-medium text-amber-700">O QR Code expira em 60 segundos. Caso expire, gere um novo.</p>
                                    </div>
                                </div>
                            </div>
                        )}

                        {connectionStatus === "connected" && (
                            <div className="p-8 bg-emerald-50/50">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-4">
                                        <div className="w-14 h-14 bg-emerald-100 rounded-xl flex items-center justify-center">
                                            <CheckCircle2 className="w-7 h-7 text-emerald-600" />
                                        </div>
                                        <div>
                                            <p className="text-lg font-bold text-slate-900">WhatsApp Conectado</p>
                                            <p className="text-sm font-medium text-emerald-600">+55 (11) 98765-4321 • Sessão ativa</p>
                                        </div>
                                    </div>
                                    <Button 
                                        variant="outline" 
                                        onClick={handleDisconnect}
                                        className="text-rose-500 border-rose-200 hover:bg-rose-50 gap-2"
                                    >
                                        <WifiOff className="w-4 h-4" />
                                        Desconectar
                                    </Button>
                                </div>

                                {apiUrl && (
                                    <div className="mt-6 p-4 bg-white rounded-lg border border-slate-200 space-y-2">
                                        <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Webhook URL (para receber mensagens)</label>
                                        <div className="flex items-center gap-2">
                                            <code className="flex-1 px-3 py-2 bg-slate-50 rounded-md text-xs font-mono text-slate-600 border border-slate-100">
                                                {apiUrl}/webhook/whatsapp
                                            </code>
                                            <Button 
                                                variant="outline" 
                                                size="icon" 
                                                className="shrink-0"
                                                onClick={handleCopyWebhook}
                                            >
                                                {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4 text-slate-400" />}
                                            </Button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Info Banner */}
                    <div className="flex items-start gap-4 p-4 bg-slate-50 rounded-lg border border-slate-200">
                        <Info className="w-5 h-5 text-teal-600 shrink-0 mt-0.5" />
                        <div className="space-y-1">
                            <p className="font-bold text-slate-900 text-sm">Sobre a integração</p>
                            <p className="text-slate-500 font-medium text-xs">
                                A UaZapi permite conectar seu WhatsApp Business via QR Code. Todas as mensagens recebidas serão processadas pela Assistente IA automaticamente.
                                Recomendamos usar um número exclusivo para o atendimento da clínica.
                            </p>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
