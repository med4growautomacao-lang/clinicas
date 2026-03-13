import React, { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "./ui/card";
import { Button } from "./ui/button";
import {
  Bot,
  Settings,
  MessageSquare,
  Activity,
  User,
  Send,
  ShieldCheck,
  Stethoscope,
  Clock,
  LayoutGrid,
  Loader2,
  AlertTriangle,
  X,
} from "lucide-react";
import { cn } from "@/src/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { LeadKanban } from "./LeadKanban";
import { ServiceDashboard } from "./ServiceDashboard";
import { useLeads, useChatMessages, useSettings } from "../hooks/useSupabase";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

function ValidationModal({ isOpen, onClose, missingTags }: { isOpen: boolean, onClose: () => void, missingTags: string[] }) {
  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.9, opacity: 0, y: 20 }}
          className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden border border-slate-200"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="h-2 bg-amber-500" />
          <div className="p-8">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center">
                <AlertTriangle className="w-6 h-6 text-amber-600" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-slate-900">Variáveis Faltando</h3>
                <p className="text-sm text-slate-500 font-medium">O template da mensagem está incompleto.</p>
              </div>
              <button 
                onClick={onClose}
                className="ml-auto p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-all"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 mb-8">
              <p className="text-sm text-slate-600 leading-relaxed font-medium">
                Para que a confirmação funcione corretamente, as seguintes variáveis precisam estar presentes no texto:
              </p>
              <div className="flex flex-wrap gap-2">
                {missingTags.map(tag => (
                  <span key={tag} className="px-3 py-1.5 bg-amber-50 border border-amber-100 rounded-lg text-amber-700 text-xs font-bold uppercase tracking-wider">
                    {tag}
                  </span>
                ))}
              </div>
            </div>

            <Button 
              onClick={onClose}
              className="w-full bg-amber-600 hover:bg-amber-700 text-white font-bold py-6 rounded-xl shadow-lg shadow-amber-200 transition-all active:scale-[0.98]"
            >
              Entendi, vou ajustar
            </Button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

function ConfirmationsView() {
  const { aiConfig, updateAI, loading } = useSettings();
  const [saving, setSaving] = useState(false);
  const [localConfig, setLocalConfig] = useState<any>(null);
  const [showValidation, setShowValidation] = useState(false);
  const [missingTags, setMissingTags] = useState<string[]>([]);

  useEffect(() => {
    if (aiConfig) {
      setLocalConfig({ ...aiConfig });
    } else if (!loading) {
      // Initialize with defaults if config doesn't exist yet
      setLocalConfig({
        confirm_enabled: false,
        confirm_message: "Olá {paciente}, passando para confirmar sua consulta no dia {data} às {hora}. Podemos confirmar?",
        confirm_lead_time: 1440,
        response_style: 'cordial',
        response_speed: 'instantanea',
        tone: 3
      });
    }
  }, [aiConfig, loading]);

  if (loading || (!localConfig && aiConfig === undefined)) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 text-teal-600 animate-spin" />
      </div>
    );
  }

  const handleSave = async () => {
    const requiredTags = ['{paciente}', '{data}', '{hora}'];
    const missing = requiredTags.filter(tag => !localConfig.confirm_message.toLowerCase().includes(tag));

    if (missing.length > 0) {
      setMissingTags(missing);
      setShowValidation(true);
      return;
    }

    setSaving(true);
    await updateAI(localConfig);
    setSaving(false);
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 h-full">
      <ValidationModal 
        isOpen={showValidation} 
        onClose={() => setShowValidation(false)} 
        missingTags={missingTags} 
      />
      <Card className="border border-slate-200 shadow-sm relative overflow-hidden">
        <div className="h-1.5 bg-teal-600 absolute top-0 left-0 right-0" />
        <CardHeader className="pb-4">
          <CardTitle className="text-xl font-bold text-slate-900 flex items-center gap-3">
            <ShieldCheck className="w-6 h-6 text-teal-600" />
            Automação de Confirmação
          </CardTitle>
          <CardDescription className="text-slate-500 font-medium">
            Envie mensagens automáticas para evitar faltas e otimizar sua agenda.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between p-4 rounded-xl bg-slate-50 border border-slate-100">
            <div>
              <p className="text-sm font-bold text-slate-900">
                Disparar Confirmações
              </p>
              <p className="text-[10px] font-semibold text-slate-500 uppercase pt-0.5">
                Ativar envio automático via WhatsApp
              </p>
            </div>
            <button 
              onClick={() => setLocalConfig({ ...localConfig, confirm_enabled: !localConfig.confirm_enabled })}
              className={cn(
                "w-12 h-6 rounded-full relative transition-all",
                localConfig.confirm_enabled ? "bg-teal-600" : "bg-slate-300"
              )}
            >
              <div className={cn(
                "w-4 h-4 bg-white rounded-full absolute top-1 transition-all shadow-sm",
                localConfig.confirm_enabled ? "right-1" : "left-1"
              )}></div>
            </button>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider pl-1 flex items-center gap-2">
              <Clock className="w-3 h-3" />
              Antecedência do Disparo (em minutos)
            </label>
            <div className="flex items-center gap-4">
              <input
                type="number"
                value={localConfig.confirm_lead_time || ""}
                onChange={(e) => setLocalConfig({ ...localConfig, confirm_lead_time: parseInt(e.target.value) || 0 })}
                className="w-32 px-4 py-2 border border-slate-200 rounded-lg font-bold text-teal-700 focus:ring-2 focus:ring-teal-100 focus:border-teal-600 outline-none transition-all"
                placeholder="Ex: 1440"
              />
              <div className="flex-1 text-[10px] font-bold text-slate-400 uppercase leading-tight">
                {localConfig.confirm_lead_time >= 60 
                  ? `${Math.floor(localConfig.confirm_lead_time / 60)}h ${localConfig.confirm_lead_time % 60}min antes da consulta`
                  : `${localConfig.confirm_lead_time} minutos antes da consulta`
                }
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 mt-2">
              {[
                { val: 1440, label: '24h' },
                { val: 60, label: '1h' },
                { val: 30, label: '30m' }
              ].map(shortcut => (
                <button
                  key={shortcut.val}
                  type="button"
                  onClick={() => setLocalConfig({ ...localConfig, confirm_lead_time: shortcut.val })}
                  className="px-2 py-1.5 rounded-md border border-slate-100 bg-slate-50 text-[9px] font-bold text-slate-500 hover:bg-slate-100 transition-colors uppercase"
                >
                  Sugestão: {shortcut.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between items-center mb-1">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider pl-1">
                Template da Mensagem
              </label>
            </div>
            <textarea
              rows={5}
              value={localConfig.confirm_message || ""}
              onChange={(e) => setLocalConfig({ ...localConfig, confirm_message: e.target.value })}
              className="w-full p-4 border border-slate-200 rounded-lg font-medium focus:ring-2 focus:ring-teal-100 focus:border-teal-600 outline-none transition-all resize-none text-sm leading-relaxed"
              placeholder="Use {paciente}, {data} e {hora} para personalizar..."
            />
            <p className="text-[10px] text-slate-400 font-medium italic pl-1">
              Variáveis obrigatórias: {"{paciente}"}, {"{data}"} e {"{hora}"}.
            </p>
          </div>

          <Button 
            onClick={handleSave} 
            disabled={saving}
            className="w-full bg-teal-600 hover:bg-teal-700 text-white py-6"
          >
            {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : "Salvar Configuração de Confirmação"}
          </Button>
        </CardContent>
      </Card>

      <div className="space-y-8">
        <Card className="border border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <Activity className="w-5 h-5 text-teal-600" />
              Visualização (Preview)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="p-6 bg-slate-900 rounded-2xl shadow-xl border border-slate-800 relative">
               <div className="absolute top-0 left-1/2 -translate-x-1/2 w-16 h-1 bg-slate-700 rounded-b-lg" />
               <div className="space-y-4 pt-4">
                 <div className="bg-white/10 w-2/3 h-8 rounded-lg animate-pulse" />
                 <div className="bg-teal-600 text-white p-4 rounded-2xl rounded-tr-none text-sm font-medium shadow-lg">
                    {localConfig.confirm_message
                      .replace('{paciente}', 'João Silva')
                      .replace('{data}', '15/05')
                      .replace('{hora}', '14:30')}
                 </div>
                 <div className="bg-white/5 w-1/2 h-4 rounded-full ml-auto" />
               </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border border-slate-200 shadow-sm bg-teal-50/30">
          <CardContent className="p-6 space-y-4">
             <div className="flex items-center gap-3 text-teal-700">
               <ShieldCheck className="w-6 h-6" />
               <h4 className="font-bold text-sm">Como funciona?</h4>
             </div>
             <p className="text-xs text-slate-600 leading-relaxed font-medium">
                O sistema monitora seus agendamentos e dispara a mensagem configurada automaticamente no tempo de antecedência escolhido.
             </p>
             <ul className="space-y-2">
                {[
                  'Redução de até 30% em faltas',
                  'Atendimento 100% humanizado',
                  'Configuração simples e rápida'
                ].map((item, i) => (
                  <li key={i} className="flex items-center gap-2 text-[10px] font-bold text-teal-600 uppercase">
                    <div className="w-1 h-1 bg-teal-600 rounded-full" />
                    {item}
                  </li>
                ))}
             </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export function AISecretary() {
  const [activeTab, setActiveTab] = useState<"chats" | "leads" | "dashboard" | "config" | "confirmations">("chats");

  return (
    <div className="space-y-8 h-full flex flex-col">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-slate-900">
            Assistente <span className="text-teal-600">IA</span>
          </h2>
          <p className="text-slate-500 font-medium text-base">
            Gestão inteligente de agendamentos e pacientes.
          </p>
        </div>
        <div className="flex bg-white p-1 rounded-lg w-fit shadow-sm border border-slate-200 overflow-x-auto max-w-full">
          {[
            { id: "chats", label: "Atendimentos" },
            { id: "leads", label: "Funil de Leads" },
            { id: "dashboard", label: "Dashboard" },
            { id: "confirmations", label: "Confirmações" },
            { id: "config", label: "Configurações" }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={cn(
                "px-6 py-2 text-sm font-semibold rounded-md transition-all whitespace-nowrap",
                activeTab === tab.id
                  ? "bg-teal-600 text-white shadow-sm"
                  : "text-slate-500 hover:text-slate-900 hover:bg-slate-50",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.98 }}
          transition={{ duration: 0.2 }}
          className="flex-1 min-h-0"
        >
          {activeTab === "chats" && <ChatsView />}
          {activeTab === "leads" && <LeadKanban />}
          {activeTab === "dashboard" && <ServiceDashboard />}
          {activeTab === "confirmations" && <ConfirmationsView />}
          {activeTab === "config" && <ConfigView />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function ChatsView() {
  const { data: leads, loading: leadsLoading } = useLeads();
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const selectedLead = leads.find(l => l.id === selectedLeadId);
  const { data: messages, loading: messagesLoading } = useChatMessages(selectedLeadId || undefined);

  const scrollRef = React.useRef<HTMLDivElement>(null);

  // Solução Definitiva: MutationObserver para o scroll no ChatsView
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !selectedLeadId) return; // Só rola se tiver lead selecionado

    const scrollDown = () => {
      el.scrollTop = el.scrollHeight;
    };

    // Força o scroll na montagem ou na troca de contato
    scrollDown();

    const observer = new MutationObserver((mutations) => {
      scrollDown();
    });

    observer.observe(el, {
      childList: true,
      subtree: true,
      characterData: true
    });

    return () => {
      observer.disconnect();
    };
  }, [messagesLoading, selectedLeadId]); 

  // Auto-select first lead if none selected
  useEffect(() => {
    if (leads.length > 0 && !selectedLeadId) {
      setSelectedLeadId(leads[0].id);
    }
  }, [leads, selectedLeadId]);

  if (leadsLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 text-teal-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-8 h-full min-h-[600px]">
      {/* Sidebar: Leads List */}
      <Card className="col-span-1 flex flex-col border border-slate-200 shadow-sm bg-white overflow-hidden">
        <CardHeader className="bg-slate-50/50 pb-6 border-b border-slate-100">
          <CardTitle className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-teal-600" />
            Atendimentos
          </CardTitle>
          <div className="relative mt-4">
            <input
              type="text"
              placeholder="Buscar paciente..."
              className="w-full pl-10 pr-4 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-teal-100 transition-all font-medium placeholder:text-slate-400"
            />
            <User className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          </div>
        </CardHeader>
        <CardContent className="flex-1 overflow-y-auto p-2 space-y-1 mt-2">
          {leads.length === 0 ? (
            <div className="p-8 text-center text-slate-400">
              <p className="text-sm font-medium">Nenhum atendimento ativo no momento.</p>
            </div>
          ) : (
            leads.map((lead) => (
              <motion.div
                key={lead.id}
                whileHover={{ x: 2 }}
                onClick={() => setSelectedLeadId(lead.id)}
                className={cn(
                  "p-3 rounded-lg cursor-pointer transition-all border",
                  selectedLeadId === lead.id
                    ? "bg-teal-50 border-teal-100 shadow-sm"
                    : "border-transparent hover:bg-slate-50"
                )}
              >
                <div className="flex items-center gap-3">
                  <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center font-bold text-slate-700 bg-slate-100")}>
                    {lead.name[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-center mb-0.5">
                      <span className="font-bold text-sm text-slate-900 truncate">
                        {lead.name}
                      </span>
                      <span className="text-[10px] font-medium text-slate-400">
                        {format(new Date(lead.created_at), 'HH:mm')}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 truncate">
                      {lead.phone || 'Sem telefone'}
                    </p>
                  </div>
                </div>
              </motion.div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Main: Chat View */}
      <Card className="col-span-2 flex flex-col border border-slate-200 shadow-sm bg-white overflow-hidden relative">
        {!selectedLead ? (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-400 gap-4">
            <Bot className="w-12 h-12 opacity-20" />
            <p className="text-sm font-medium">Selecione um atendimento para visualizar a conversa.</p>
          </div>
        ) : (
          <>
            <CardHeader className="border-b border-slate-100 py-4 flex flex-row items-center justify-between px-6 bg-white shrink-0">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-lg bg-teal-50 flex items-center justify-center border border-teal-100">
                  <User className="w-6 h-6 text-teal-700" />
                </div>
                <div>
                  <CardTitle className="text-lg font-bold text-slate-900">{selectedLead.name}</CardTitle>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className={cn(
                      "w-2 h-2 rounded-full shadow-sm",
                      selectedLead.ai_enabled !== false ? "bg-emerald-500 animate-pulse" : "bg-slate-300"
                    )}></span>
                    <span className={cn(
                      "text-[10px] font-bold uppercase tracking-wider",
                      selectedLead.ai_enabled !== false ? "text-emerald-600" : "text-slate-500"
                    )}>
                      {selectedLead.ai_enabled !== false ? "Atendimento IA Ativo" : "IA Pausada (Atendimento Humano)"}
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={cn(
                  "text-[10px] font-bold uppercase px-2 py-1 rounded",
                  selectedLead.ai_enabled !== false 
                    ? "bg-emerald-50 text-emerald-600 border border-emerald-100" 
                    : "bg-slate-100 text-slate-500"
                )}>
                  {selectedLead.ai_enabled !== false ? "Modo Inteligente" : "Modo Manual"}
                </span>
              </div>
            </CardHeader>

            <CardContent 
              ref={scrollRef}
              className="flex-1 overflow-y-auto overflow-x-hidden p-6 space-y-6 bg-slate-50/20 custom-scrollbar"
            >
              {messagesLoading ? (
                <div className="flex items-center justify-center h-full">
                  <Loader2 className="w-6 h-6 text-teal-600 animate-spin" />
                </div>
              ) : messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-4 opacity-50">
                  <MessageSquare className="w-8 h-8" />
                  <p className="text-sm font-medium">Aguardando primeira mensagem...</p>
                </div>
              ) : (
                messages.map((msg, i) => {
                  const isOutbound = msg.direction === 'outbound';
                  const isAI = msg.sender === 'ai';
                  
                  return (
                    <div 
                      key={msg.id || i}
                      className={cn(
                        "flex gap-4 max-w-[85%] min-w-0", // Adicionado min-w-0 aqui
                        isOutbound ? "ml-auto flex-row-reverse" : ""
                      )}
                    >
                      <div className={cn(
                        "w-8 h-8 rounded-lg shadow-sm flex-shrink-0 flex items-center justify-center",
                        isAI ? "bg-teal-600 shadow-md" : 
                        (isOutbound ? "bg-slate-800 shadow-md" : "bg-white border border-slate-200")
                      )}>
                        {isAI ? (
                          <Bot className="w-5 h-5 text-white" />
                        ) : (
                          <User className={cn("w-4 h-4", isOutbound ? "text-white" : "text-slate-400")} />
                        )}
                      </div>
                  <div className={cn(
                    "px-4 py-3 rounded-2xl text-sm shadow-sm max-w-full overflow-hidden break-words",
                    isAI 
                      ? "bg-teal-600 text-white rounded-tr-none" 
                      : (isOutbound 
                          ? "bg-slate-800 text-white rounded-tr-none"
                          : "bg-white border border-slate-200 text-slate-700 rounded-tl-none")
                  )}>
                    <p className="text-sm font-medium leading-relaxed whitespace-pre-wrap break-words">
                          {typeof msg.message === 'object' 
                            ? (msg.message.content || msg.message.output || msg.message.text || JSON.stringify(msg.message)) 
                            : String(msg.message || '')
                          }
                        </p>
                        <div className="flex items-center justify-between gap-4 mt-1">
                          <span className={cn(
                            "text-[9px] block opacity-60 font-bold uppercase ml-auto",
                            isOutbound ? "text-white text-right" : "text-slate-400"
                          )}>
                            {format(new Date(msg.created_at), 'HH:mm')}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </CardContent>
          </>
        )}
      </Card>
    </div>
  );
}

function ConfigView() {
  const { aiConfig, updateAI, loading } = useSettings();
  const [saving, setSaving] = useState(false);
  const [localConfig, setLocalConfig] = useState<any>(null);

  useEffect(() => {
    if (aiConfig) {
      setLocalConfig({ ...aiConfig });
    }
  }, [aiConfig]);

  if (loading || !localConfig) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 text-teal-600 animate-spin" />
      </div>
    );
  }

  const handleSave = async () => {
    setSaving(true);
    await updateAI(localConfig);
    setSaving(false);
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 h-full">
      <Card className="border border-slate-200 shadow-sm">
        <CardHeader className="pb-4">
          <CardTitle className="text-xl font-bold text-slate-900 flex items-center gap-3">
            <Bot className="w-6 h-6 text-teal-600" />
            Configurações da Assistente
          </CardTitle>
          <CardDescription className="text-slate-500 font-medium">
            Personalize o comportamento e tom de voz da assistência automática.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider pl-1">
              Nome de Exibição
            </label>
            <input
              type="text"
              value={localConfig.name || ""}
              onChange={(e) => setLocalConfig({ ...localConfig, name: e.target.value })}
              className="w-full px-4 py-2 border border-slate-200 rounded-lg font-medium focus:ring-2 focus:ring-teal-100 focus:border-teal-600 outline-none transition-all"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider pl-1">
              Tom de Voz
            </label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { id: 'cordial', label: 'Cordial' },
                { id: 'objetiva', label: 'Objetiva' },
                { id: 'tecnica', label: 'Técnica' }
              ].map(tone => (
                <button
                  key={tone.id}
                  onClick={() => setLocalConfig({ ...localConfig, response_style: tone.id })}
                  className={cn(
                    "px-4 py-2 rounded-lg border font-semibold text-xs transition-all",
                    localConfig.response_style === tone.id 
                      ? "bg-teal-50 border-teal-600 text-teal-700" 
                      : "bg-white border-slate-200 text-slate-500 hover:border-teal-200"
                  )}
                >
                  {tone.label}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider pl-1">
              Instruções de Comportamento
            </label>
            <textarea
              rows={4}
              value={localConfig.prompt || ""}
              onChange={(e) => setLocalConfig({ ...localConfig, prompt: e.target.value })}
              className="w-full p-4 border border-slate-200 rounded-lg font-medium focus:ring-2 focus:ring-teal-100 focus:border-teal-600 outline-none transition-all resize-none text-sm leading-relaxed"
              placeholder="Descreva como a IA deve se comportar..."
            />
          </div>
          <Button 
            onClick={handleSave} 
            disabled={saving}
            className="w-full bg-teal-600 hover:bg-teal-700 text-white py-6"
          >
            {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : "Salvar Configurações"}
          </Button>
        </CardContent>
      </Card>

      <div className="space-y-8">
        <Card className="border border-slate-200 shadow-sm overflow-hidden">
          <div className="h-1.5 bg-teal-600" />
          <CardHeader>
            <CardTitle className="text-lg font-bold text-slate-900">Regras de Automação</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between p-4 rounded-xl bg-slate-50 border border-slate-100">
              <div className="pr-4">
                <p className="text-sm font-bold text-slate-900">
                  Atendimento Automático (IA)
                </p>
                <p className="text-[10px] font-semibold text-slate-500 uppercase pt-0.5">
                  Interruptor geral de respostas da inteligência artificial
                </p>
              </div>
              <button 
                onClick={() => setLocalConfig({ ...localConfig, auto_schedule: !localConfig.auto_schedule })}
                className={cn(
                  "w-12 h-6 rounded-full relative transition-all",
                  localConfig.auto_schedule ? "bg-teal-600" : "bg-slate-300"
                )}
              >
                <div className={cn(
                  "w-4 h-4 bg-white rounded-full absolute top-1 transition-all shadow-sm",
                  localConfig.auto_schedule ? "right-1" : "left-1"
                )}></div>
              </button>
            </div>
          </CardContent>
        </Card>

        <Card className="border border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <Activity className="w-5 h-5 text-teal-600" />
              Métricas de Sucesso
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="p-4 bg-slate-50 rounded-lg border border-slate-100">
              <div className="flex justify-between items-end mb-2 px-1">
                <span className="text-[10px] font-bold text-slate-500 uppercase">Tabela de Resolução</span>
                <span className="text-lg font-bold text-slate-900">92%</span>
              </div>
              <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: "92%" }}
                  transition={{ duration: 1 }}
                  className="bg-teal-600 h-full rounded-full"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 bg-slate-50 rounded-lg text-center border border-slate-100">
                <div className="text-xs font-semibold text-slate-500 uppercase">Conversas</div>
                <div className="text-2xl font-bold text-slate-900">100+</div>
                <div className="text-[10px] font-medium text-teal-600 uppercase">Atendidas</div>
              </div>
              <div className="p-4 bg-slate-50 rounded-lg text-center border border-slate-100">
                <div className="text-xs font-semibold text-slate-500 uppercase">Satisfação</div>
                <div className="text-2xl font-bold text-slate-900">4.9/5</div>
                <div className="text-[10px] font-medium text-teal-600 uppercase">Avaliação</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
