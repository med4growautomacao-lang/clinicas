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
  BellRing,
  UserCheck,
  Plus,
  Trash2,
  DollarSign,
  CheckSquare,
  MessageCircle,
  Info,
  Star,
} from "lucide-react";
import { cn } from "@/src/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { LeadKanban } from "./LeadKanban";
import { ServiceDashboard } from "./ServiceDashboard";
import { extractMessageText } from "./LeadChat";
import { useLeads, useChatMessages, useSettings, useFunnelStages, FunnelStage } from "../hooks/useSupabase";
import GoogleLogo from "../assets/logos/Logo Googleads.png";
import MetaLogo from "../assets/logos/Logo Metaads.png";
import SemOrigemLogo from "../assets/logos/Logo Sem origem.png";
import { format, parseISO, isToday, isYesterday, isSameDay } from "date-fns";
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
  const [isDirty, setIsDirty] = useState(false);
  const [localConfig, setLocalConfig] = useState<any>(null);
  const [showValidation, setShowValidation] = useState(false);
  const [missingTags, setMissingTags] = useState<string[]>([]);

  const setConfig = (updates: any) => { setLocalConfig((p: any) => ({ ...p, ...updates })); setIsDirty(true); };

  useEffect(() => {
    if (aiConfig) {
      setLocalConfig({ ...aiConfig });
      setIsDirty(false);
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

  if (loading || !localConfig) {
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
    setIsDirty(false);
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
            Confirmacao Comercial
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
              onClick={() => { const v = !localConfig.confirm_enabled; setLocalConfig({ ...localConfig, confirm_enabled: v }); updateAI({ ...localConfig, confirm_enabled: v }); }}
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
                onChange={(e) => setConfig({ confirm_lead_time: parseInt(e.target.value) || 0 })}
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
                  onClick={() => setConfig({ confirm_lead_time: shortcut.val })}
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
              onChange={(e) => setConfig({ confirm_message: e.target.value })}
              className="w-full p-4 border border-slate-200 rounded-lg font-medium focus:ring-2 focus:ring-teal-100 focus:border-teal-600 outline-none transition-all resize-none text-sm leading-relaxed"
              placeholder="Use {paciente}, {data} e {hora} para personalizar..."
            />
            <p className="text-[10px] text-slate-400 font-medium italic pl-1">
              Variáveis obrigatórias: {"{paciente}"}, {"{data}"} e {"{hora}"}.
            </p>
          </div>

          <Button
            onClick={handleSave}
            disabled={saving || !isDirty}
            className={cn("w-full py-6 transition-all", isDirty ? "bg-teal-600 hover:bg-teal-700 text-white" : "bg-slate-100 text-slate-400 cursor-default")}
          >
            {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : isDirty ? "Salvar Configuração de Confirmação" : "Configuração Salva ✓"}
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

function FollowupsView() {
  const { aiConfig, updateAI, loading } = useSettings();
  const [saving, setSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [localConfig, setLocalConfig] = useState<any>(null);

  const setConfig = (updates: any) => { setLocalConfig((p: any) => ({ ...p, ...updates })); setIsDirty(true); };

  useEffect(() => {
    if (aiConfig) {
      setLocalConfig({ ...aiConfig });
      setIsDirty(false);
    } else if (!loading) {
      setLocalConfig({
        followup_enabled: false,
        followup_message: "Olá {paciente}, percebi que ainda não finalizamos seu agendamento. Gostaria de continuar de onde paramos?",
        followup_delay: 1440,
      });
    }
  }, [aiConfig, loading]);

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
    setIsDirty(false);
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 h-full font-sans">
      <Card className="border border-slate-200 shadow-sm relative overflow-hidden">
        <div className="h-1.5 bg-teal-600 absolute top-0 left-0 right-0" />
        <CardHeader className="pb-4">
          <CardTitle className="text-xl font-bold text-slate-900 flex items-center gap-3">
            <BellRing className="w-6 h-6 text-teal-600" />
            Régua de Follow-up
          </CardTitle>
          <CardDescription className="text-slate-500 font-medium">
            Reengaje pacientes que pararam de responder sem agendar.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between p-4 rounded-xl bg-slate-50 border border-slate-100">
            <div>
              <p className="text-sm font-bold text-slate-900">Ativar Follow-up</p>
              <p className="text-[10px] font-semibold text-slate-500 uppercase pt-0.5">Disparo automático após inatividade</p>
            </div>
            <button
              onClick={() => { const v = !localConfig.followup_enabled; setLocalConfig({ ...localConfig, followup_enabled: v }); updateAI({ ...localConfig, followup_enabled: v }); }}
              className={cn(
                "w-12 h-6 rounded-full relative transition-all",
                localConfig.followup_enabled ? "bg-teal-600" : "bg-slate-300"
              )}
            >
              <div className={cn(
                "w-4 h-4 bg-white rounded-full absolute top-1 transition-all shadow-sm",
                localConfig.followup_enabled ? "right-1" : "left-1"
              )}></div>
            </button>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider pl-1 flex items-center gap-2">
              <Clock className="w-3 h-3" />
              Tempo de Espera (minutos)
            </label>
            <div className="flex items-center gap-4">
              <input
                type="number"
                value={localConfig.followup_delay || ""}
                onChange={(e) => setConfig({ followup_delay: parseInt(e.target.value) || 0 })}
                className="w-32 px-4 py-2 border border-slate-200 rounded-lg font-bold text-teal-700 focus:ring-2 focus:ring-teal-100 focus:border-teal-600 outline-none transition-all"
                placeholder="Ex: 1440"
              />
              <div className="flex-1 text-[10px] font-bold text-slate-400 uppercase leading-tight">
                {localConfig.followup_delay >= 60 
                  ? `${Math.floor(localConfig.followup_delay / 60)}h ${localConfig.followup_delay % 60}min de inatividade`
                  : `${localConfig.followup_delay} minutos de inatividade`
                }
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider pl-1 flex items-center gap-2">
              <Activity className="w-3 h-3" />
              Tentativas Máximas
            </label>
            <div className="flex items-center gap-4">
              <input
                type="number"
                min={1}
                max={10}
                value={localConfig.followup_max_attempts ?? 3}
                onChange={(e) => setConfig({ followup_max_attempts: parseInt(e.target.value) || 1 })}
                className="w-32 px-4 py-2 border border-slate-200 rounded-lg font-bold text-teal-700 focus:ring-2 focus:ring-teal-100 focus:border-teal-600 outline-none transition-all"
                placeholder="Ex: 3"
              />
              <div className="flex-1 text-[10px] font-bold text-slate-400 uppercase leading-tight">
                {localConfig.followup_max_attempts ?? 3} envio{(localConfig.followup_max_attempts ?? 3) !== 1 ? "s" : ""} por lead
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider pl-1 font-sans">
              Mensagem de Reengajamento
            </label>
            <textarea
              rows={5}
              value={localConfig.followup_message || ""}
              onChange={(e) => setConfig({ followup_message: e.target.value })}
              className="w-full p-4 border border-slate-200 rounded-lg font-medium focus:ring-2 focus:ring-teal-100 focus:border-teal-600 outline-none transition-all resize-none text-sm leading-relaxed"
              placeholder="Olá {paciente}, notamos que..."
            />
          </div>

          <Button
            onClick={handleSave}
            disabled={saving || !isDirty}
            className={cn("w-full py-6 transition-all", isDirty ? "bg-teal-600 hover:bg-teal-700 text-white shadow-lg shadow-teal-100" : "bg-slate-100 text-slate-400 cursor-default")}
          >
            {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : isDirty ? "Salvar Configuração de Follow-up" : "Configuração Salva ✓"}
          </Button>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-6">
        <div className="p-6 rounded-2xl bg-teal-50 border border-teal-100 relative overflow-hidden">
          <div className="relative z-10">
            <h4 className="text-sm font-bold text-teal-900 mb-2 flex items-center gap-2">
              <Bot className="w-4 h-4" />
              Como funciona o Follow-up?
            </h4>
            <p className="text-xs text-teal-700 leading-relaxed font-medium">
              Se um lead parar de responder durante uma conversa e não houver um agendamento marcado, a IA enviará esta mensagem automaticamente após o período definido. Isso ajuda a recuperar até 30% dos leads perdidos por esquecimento.
            </p>
          </div>
          <BellRing className="absolute -right-4 -bottom-4 w-24 h-24 text-teal-200/50 rotate-12" />
        </div>

        <Card className="border border-slate-100 shadow-sm bg-slate-50/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-bold text-slate-500 uppercase tracking-tighter flex items-center gap-2">
              <MessageSquare className="w-3 h-3" />
              Preview da Mensagem
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-2">
            <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 max-w-[85%] relative">
               <p className="text-sm text-slate-700 leading-relaxed font-medium">
                 {localConfig.followup_message ? localConfig.followup_message.replace(/{paciente}/g, "João") : ""}
               </p>
               <span className="text-[9px] text-slate-400 font-bold uppercase mt-2 block">10:45</span>
               <div className="absolute -left-2 top-4 w-4 h-4 bg-white border-l border-b border-slate-100 rotate-45" />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function WelcomeFollowupView() {
  const { aiConfig, updateAI, loading } = useSettings();
  const [saving, setSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [localConfig, setLocalConfig] = useState<any>(null);

  const setConfig = (updates: any) => { setLocalConfig((p: any) => ({ ...p, ...updates })); setIsDirty(true); };

  useEffect(() => {
    if (aiConfig) {
      setLocalConfig({ ...aiConfig });
      setIsDirty(false);
    } else if (!loading) {
      setLocalConfig({ welcome_message_enabled: false, welcome_message_text: '', welcome_message_delay: 5 });
    }
  }, [aiConfig, loading]);

  if (loading || !localConfig) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="w-8 h-8 text-teal-600 animate-spin" /></div>;
  }

  const handleSave = async () => {
    setSaving(true);
    await updateAI(localConfig);
    setSaving(false);
    setIsDirty(false);
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 h-full font-sans">
      <Card className="border border-slate-200 shadow-sm relative overflow-hidden">
        <div className="h-1.5 bg-teal-600 absolute top-0 left-0 right-0" />
        <CardHeader className="pb-4">
          <CardTitle className="text-xl font-bold text-slate-900 flex items-center gap-3">
            <MessageCircle className="w-6 h-6 text-teal-600" />
            Boas-vindas via Formulário
          </CardTitle>
          <CardDescription className="text-slate-500 font-medium">
            Mensagem automática ao primeiro contato do lead por formulário.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between p-4 rounded-xl bg-slate-50 border border-slate-100">
            <div>
              <p className="text-sm font-bold text-slate-900">Ativar Boas-vindas</p>
              <p className="text-[10px] font-semibold text-slate-500 uppercase pt-0.5">Disparo automático para leads de formulário</p>
            </div>
            <button
              onClick={() => { const v = !localConfig.welcome_message_enabled; setLocalConfig({ ...localConfig, welcome_message_enabled: v }); updateAI({ ...localConfig, welcome_message_enabled: v }); }}
              className={cn("w-12 h-6 rounded-full relative transition-all", localConfig.welcome_message_enabled ? "bg-teal-600" : "bg-slate-300")}
            >
              <div className={cn("w-4 h-4 bg-white rounded-full absolute top-1 transition-all shadow-sm", localConfig.welcome_message_enabled ? "right-1" : "left-1")} />
            </button>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider pl-1 flex items-center gap-2">
              <Clock className="w-3 h-3" />
              Aguardar antes de enviar (minutos)
            </label>
            <div className="flex items-center gap-4">
              <input
                type="number"
                min={0}
                value={localConfig.welcome_message_delay ?? 5}
                onChange={(e) => setConfig({ welcome_message_delay: parseInt(e.target.value) || 0 })}
                className="w-32 px-4 py-2 border border-slate-200 rounded-lg font-bold text-teal-700 focus:ring-2 focus:ring-teal-100 focus:border-teal-600 outline-none transition-all"
                placeholder="Ex: 5"
              />
              <div className="flex-1 text-[10px] font-bold text-slate-400 uppercase leading-tight">
                {localConfig.welcome_message_delay >= 60
                  ? `${Math.floor(localConfig.welcome_message_delay / 60)}h ${localConfig.welcome_message_delay % 60}min após o cadastro`
                  : `${localConfig.welcome_message_delay} minutos após o cadastro`}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider pl-1">
              Mensagem de Boas-vindas
            </label>
            <textarea
              rows={5}
              value={localConfig.welcome_message_text || ''}
              onChange={(e) => setConfig({ welcome_message_text: e.target.value })}
              className="w-full p-4 border border-slate-200 rounded-lg font-medium focus:ring-2 focus:ring-teal-100 focus:border-teal-600 outline-none transition-all resize-none text-sm leading-relaxed"
              placeholder="Olá {paciente}, recebemos seu contato e..."
            />
          </div>

          <Button
            onClick={handleSave}
            disabled={saving || !isDirty}
            className={cn("w-full py-6 transition-all", isDirty ? "bg-teal-600 hover:bg-teal-700 text-white shadow-lg shadow-teal-100" : "bg-slate-100 text-slate-400 cursor-default")}
          >
            {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : isDirty ? "Salvar Configuração de Boas-vindas" : "Configuração Salva ✓"}
          </Button>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-6">
        <div className="p-6 rounded-2xl bg-teal-50 border border-teal-100 relative overflow-hidden">
          <div className="relative z-10">
            <h4 className="text-sm font-bold text-teal-900 mb-2 flex items-center gap-2">
              <MessageCircle className="w-4 h-4" />
              Como funciona?
            </h4>
            <p className="text-xs text-teal-700 leading-relaxed font-medium">
              Quando um lead preenche um formulário, o sistema aguarda o tempo configurado e então envia automaticamente esta mensagem no WhatsApp, iniciando o contato comercial.
            </p>
          </div>
          <MessageCircle className="absolute -right-4 -bottom-4 w-24 h-24 text-teal-200/50 rotate-12" />
        </div>

        <Card className="border border-slate-100 shadow-sm bg-slate-50/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-bold text-slate-500 uppercase tracking-tighter flex items-center gap-2">
              <MessageSquare className="w-3 h-3" />
              Preview da Mensagem
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-2">
            <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 max-w-[85%] relative">
              <p className="text-sm text-slate-700 leading-relaxed font-medium">
                {localConfig.welcome_message_text ? localConfig.welcome_message_text.replace(/{paciente}/g, "João") : <span className="text-slate-400 italic">Nenhuma mensagem configurada</span>}
              </p>
              <span className="text-[9px] text-slate-400 font-bold uppercase mt-2 block">10:45</span>
              <div className="absolute -left-2 top-4 w-4 h-4 bg-white border-l border-b border-slate-100 rotate-45" />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function AllFollowupsView() {
  const [subTab, setSubTab] = useState<"welcome" | "reengagement" | "confirmation">("welcome");

  return (
    <div className="space-y-6 h-full flex flex-col">
      <div className="flex bg-white p-1 rounded-xl border border-slate-200 gap-1 w-fit">
        {[
          { id: "welcome", label: "Boas-vindas" },
          { id: "reengagement", label: "Reengajamento" },
          { id: "confirmation", label: "Confirmação" },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setSubTab(t.id as any)}
            className={cn(
              "px-5 py-2 text-xs font-bold rounded-lg transition-all",
              subTab === t.id
                ? "bg-teal-600 text-white shadow-sm"
                : "text-slate-500 hover:text-slate-800 hover:bg-slate-50"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <AnimatePresence mode="wait">
        <motion.div
          key={subTab}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.15 }}
          className="flex-1 min-h-0"
        >
          {subTab === "welcome" && <WelcomeFollowupView />}
          {subTab === "reengagement" && <FollowupsView />}
          {subTab === "confirmation" && <ConfirmationsView />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

interface HandoffRule {
  id: string;
  name: string;
  type: 'keyword';
  keywords?: string;
  move_to_stage?: string;
  action?: string;
  farewell_enabled?: boolean;
  farewell_message?: string;
  notification_message?: string;
}

const HANDOFF_ACTIONS = [
  { value: 'notify_human', label: 'Notificar Humano' },
  { value: 'pause_ai', label: 'Pausar IA' },
  { value: 'transfer', label: 'Transferir Atendimento' },
];

const RuleCard: React.FC<{
  rule: HandoffRule;
  funnelStages: FunnelStage[];
  onUpdate: (updates: Partial<HandoffRule>) => void;
  onRemove: () => void;
}> = ({ rule, funnelStages, onUpdate, onRemove }) => {
  return (
    <Card className="border border-slate-200 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 bg-slate-50 border-b border-slate-200">
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-teal-100 text-teal-700">
          Palavra do Lead
        </span>
        <button
          onClick={onRemove}
          className="text-slate-300 hover:text-red-500 transition-colors p-1"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      <CardContent className="p-5 space-y-5">
          {/* Keywords + stage row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Palavras-chave (separadas por vírgula)</label>
              <input
                type="text"
                value={rule.keywords || ''}
                onChange={e => onUpdate({ keywords: e.target.value })}
                placeholder="preço, valor, orçamento, quanto custa"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-teal-100 focus:border-teal-500 transition-all"
              />
              <p className="text-[10px] text-slate-400">Quando o lead mencionar estas palavras</p>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Mover para Etapa</label>
              <select
                value={rule.move_to_stage || ''}
                onChange={e => onUpdate({ move_to_stage: e.target.value })}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-teal-100 focus:border-teal-500 transition-all bg-white"
              >
                <option value="">Não mover</option>
                {funnelStages.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Action */}
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Ação</label>
            <select
              value={rule.action || 'notify_human'}
              onChange={e => onUpdate({ action: e.target.value })}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-teal-100 focus:border-teal-500 transition-all bg-white"
            >
              {HANDOFF_ACTIONS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
            </select>
          </div>

          {/* Farewell message (not for ai_phrase) */}
          {rule.type !== 'ai_phrase' && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id={`farewell-${rule.id}`}
                  checked={rule.farewell_enabled ?? true}
                  onChange={e => onUpdate({ farewell_enabled: e.target.checked })}
                  className="accent-teal-600 w-3.5 h-3.5"
                />
                <label htmlFor={`farewell-${rule.id}`} className="text-[10px] font-bold text-slate-400 uppercase tracking-wider cursor-pointer">
                  Mensagem de Despedida
                </label>
              </div>
              {(rule.farewell_enabled ?? true) && (
                <textarea
                  rows={2}
                  value={rule.farewell_message || ''}
                  onChange={e => onUpdate({ farewell_message: e.target.value })}
                  placeholder="Vou transferir você para nossa equipe. Em instantes alguém vai te atender!"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-teal-100 focus:border-teal-500 transition-all resize-none"
                />
              )}
            </div>
          )}

          {/* Notification message */}
          <div className="space-y-1">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
              <MessageSquare className="w-3 h-3" />
              Mensagem para Grupo de Notificação
            </label>
            <textarea
              rows={2}
              value={rule.notification_message || ''}
              onChange={e => onUpdate({ notification_message: e.target.value })}
              placeholder="🚨 Novo lead qualificado! Cliente solicitou atendimento humano."
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-teal-100 focus:border-teal-500 transition-all resize-none"
            />
            <p className="text-[10px] text-slate-400">Variáveis: {'{lead_name}'}, {'{lead_phone}'}, {'{trigger_keyword}'}</p>
          </div>
        </CardContent>
    </Card>
  );
}

function HandoffView() {
  const { aiConfig, updateAI, loading } = useSettings();
  const { data: funnelStages } = useFunnelStages();
  const [saving, setSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [rules, setRules] = useState<HandoffRule[]>([]);

  useEffect(() => {
    if (aiConfig) {
      setRules((aiConfig as any).handoff_rules || []);
      setIsDirty(false);
    } else if (!loading) {
      setRules([]);
    }
  }, [aiConfig, loading]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 text-teal-600 animate-spin" />
      </div>
    );
  }

  const handleSave = async () => {
    setSaving(true);
    await updateAI({ ...(aiConfig || {}), handoff_rules: rules } as any);
    setSaving(false);
    setIsDirty(false);
  };

  const addRule = () => {
    const id = crypto.randomUUID();
    setIsDirty(true);
    const newRule: HandoffRule = {
      id,
      name: '',
      type: 'keyword',
      keywords: '',
      move_to_stage: '',
      action: 'notify_human',
      farewell_enabled: true,
      farewell_message: 'Vou transferir você para nossa equipe. Em instantes alguém vai te atender!',
      notification_message: '🚨 Novo lead qualificado! Cliente solicitou atendimento humano.',
    };
    setRules(prev => [...prev, newRule]);
  };

  const removeRule = (id: string) => {
    setRules(prev => prev.filter(r => r.id !== id));
    setIsDirty(true);
  };

  const updateRule = (id: string, updates: Partial<HandoffRule>) => {
    setRules(prev => prev.map(r => r.id === id ? { ...r, ...updates } : r));
    setIsDirty(true);
  };

  return (
    <div className="space-y-5 font-sans">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <UserCheck className="w-5 h-5 text-amber-500" />
            Gatilhos de Handoff
          </h3>
          <p className="text-sm text-slate-500 mt-0.5">Configure quando a IA deve parar e transferir para o suporte humano</p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              {aiConfig?.handoff_enabled ? 'Ativo' : 'Inativo'}
            </span>
            <button
              onClick={() => updateAI({ ...(aiConfig || {}), handoff_enabled: !aiConfig?.handoff_enabled } as any)}
              className={cn(
                "w-10 h-5 rounded-full relative transition-all",
                aiConfig?.handoff_enabled ? "bg-amber-500" : "bg-slate-300"
              )}
            >
              <div className={cn(
                "w-3.5 h-3.5 bg-white rounded-full absolute top-[3px] transition-all shadow-sm",
                aiConfig?.handoff_enabled ? "right-[3px]" : "left-[3px]"
              )} />
            </button>
          </div>
          {rules.length === 0 && (
            <Button onClick={addRule} className="bg-amber-500 hover:bg-amber-600 text-white gap-2">
              <Plus className="w-4 h-4" />
              Adicionar Gatilho
            </Button>
          )}
        </div>
      </div>

      {rules.length === 0 ? (
        <div className="text-center py-16 text-slate-400 border-2 border-dashed border-slate-200 rounded-2xl">
          <UserCheck className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">Nenhum gatilho configurado</p>
          <p className="text-sm mt-1">Clique em "Adicionar Gatilho" para começar</p>
        </div>
      ) : (
        <>
          {rules.map(rule => (
            <RuleCard
              key={rule.id}
              rule={rule}
              funnelStages={funnelStages}
              onUpdate={(updates) => updateRule(rule.id, updates)}
              onRemove={() => removeRule(rule.id)}
            />
          ))}
          <Button
            onClick={handleSave}
            disabled={saving || !isDirty}
            className={cn("w-full py-6 transition-all", isDirty ? "bg-teal-600 hover:bg-teal-700 text-white shadow-lg shadow-teal-100" : "bg-slate-100 text-slate-400 cursor-default")}
          >
            {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : isDirty ? "Salvar Gatilhos" : "Gatilhos Salvos ✓"}
          </Button>
        </>
      )}

      <div className="flex flex-col gap-6 mt-2">
        <div className="p-6 rounded-2xl bg-amber-50 border border-amber-100 relative overflow-hidden">
          <div className="relative z-10">
            <h4 className="text-sm font-bold text-amber-900 mb-2 flex items-center gap-2">
              <UserCheck className="w-4 h-4" />
              Como funciona o Handoff?
            </h4>
            <p className="text-xs text-amber-800 leading-relaxed font-medium">
              Quando um dos gatilhos configurados é detectado na conversa, a IA pausa o atendimento e transfere o lead para um agente humano. A mensagem de despedida é enviada automaticamente ao lead e a equipe é notificada para dar sequência.
            </p>
          </div>
          <UserCheck className="absolute -right-4 -bottom-4 w-24 h-24 text-amber-200/50 rotate-12" />
        </div>

        {rules.length > 0 && rules.some((r: HandoffRule) => r.farewell_enabled && r.farewell_message) && (
          <Card className="border border-slate-100 shadow-sm bg-slate-50/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-bold text-slate-500 uppercase tracking-tighter flex items-center gap-2">
                <MessageSquare className="w-3 h-3" />
                Preview da Mensagem de Despedida
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-2">
              <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 max-w-[85%] relative">
                <p className="text-sm text-slate-700 leading-relaxed font-medium">
                  {rules.find((r: HandoffRule) => r.farewell_enabled && r.farewell_message)?.farewell_message?.replace(/{paciente}/g, 'João') ?? ''}
                </p>
                <span className="text-[9px] text-slate-400 font-bold uppercase mt-2 block">10:45</span>
                <div className="absolute -left-2 top-4 w-4 h-4 bg-white border-l border-b border-slate-100 rotate-45" />
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function FinishServiceView() {
  const { aiConfig, updateAI, loading } = useSettings();
  const [saving, setSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [localConfig, setLocalConfig] = useState<any>(null);

  const setConfig = (updates: any) => { setLocalConfig((p: any) => ({ ...p, ...updates })); setIsDirty(true); };

  useEffect(() => {
    if (aiConfig) {
      setLocalConfig({ ...aiConfig });
      setIsDirty(false);
    } else if (!loading) {
      setLocalConfig({
        finish_service_enabled: false,
        finish_service_message: "Atendimento finalizado com sucesso. Agradecemos o contato!"
      });
    }
  }, [aiConfig, loading]);

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
    setIsDirty(false);
  };

  return (
    <div className="space-y-8 font-sans">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <Card className="border border-slate-200 shadow-sm relative overflow-hidden">
          <div className="h-1.5 bg-teal-600 absolute top-0 left-0 right-0" />
          <CardHeader className="pb-4">
            <CardTitle className="text-xl font-bold text-slate-900 flex items-center gap-3">
              <ShieldCheck className="w-6 h-6 text-teal-600" />
              Encerramento de Atendimento
            </CardTitle>
            <CardDescription className="text-slate-500 font-medium">
              Configure uma mensagem automática para ser enviada quando você encerra um ticket.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between p-4 rounded-xl bg-slate-50 border border-slate-100">
              <div>
                <p className="text-sm font-bold text-slate-900">Ativar Mensagem de Encerramento</p>
                <p className="text-[10px] font-semibold text-slate-500 uppercase pt-0.5">Disparo automático ao finalizar</p>
              </div>
              <button
                onClick={() => { const v = !localConfig.finish_service_enabled; setLocalConfig({ ...localConfig, finish_service_enabled: v }); updateAI({ ...localConfig, finish_service_enabled: v }); }}
                className={cn(
                  "w-12 h-6 rounded-full relative transition-all",
                  localConfig.finish_service_enabled ? "bg-teal-600" : "bg-slate-300"
                )}
              >
                <div className={cn(
                  "w-4 h-4 bg-white rounded-full absolute top-1 transition-all shadow-sm",
                  localConfig.finish_service_enabled ? "right-1" : "left-1"
                )}></div>
              </button>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider pl-1 font-sans">
                Mensagem de Despedida
              </label>
              <textarea
                rows={5}
                value={localConfig.finish_service_message || ""}
                onChange={(e) => setConfig({ finish_service_message: e.target.value })}
                className="w-full p-4 border border-slate-200 rounded-lg font-medium focus:ring-2 focus:ring-teal-100 focus:border-teal-600 outline-none transition-all resize-none text-sm leading-relaxed"
                placeholder="Obrigado pelo contato! Se precisar de algo mais, estamos à disposição."
              />
            </div>

            <Button
              onClick={handleSave}
              disabled={saving || !isDirty}
              className={cn("w-full py-6 transition-all", isDirty ? "bg-teal-600 hover:bg-teal-700 text-white shadow-lg shadow-teal-100" : "bg-slate-100 text-slate-400 cursor-default")}
            >
              {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : isDirty ? "Salvar Configurações" : "Configuração Salva ✓"}
            </Button>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-6">
          <div className="p-6 rounded-2xl bg-teal-50 border border-teal-100 relative overflow-hidden">
            <div className="relative z-10">
              <h4 className="text-sm font-bold text-teal-900 mb-2 flex items-center gap-2">
                <Bot className="w-4 h-4" />
                Como funciona o Encerramento?
              </h4>
              <p className="text-xs text-teal-700 leading-relaxed font-medium">
                Ao resolver ou fechar o atendimento de um lead, a plataforma enviará essa mensagem para formalizar o término da conversa pelo WhatsApp, oferecendo uma experiência mais polida e profissional para o paciente.
              </p>
            </div>
            <CheckSquare className="absolute -right-4 -bottom-4 w-24 h-24 text-teal-200/50 rotate-12" />
          </div>

          <Card className="border border-slate-100 shadow-sm bg-slate-50/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-bold text-slate-500 uppercase tracking-tighter flex items-center gap-2">
                <MessageSquare className="w-3 h-3" />
                Preview da Mensagem
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-2">
              <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 max-w-[85%] relative">
                 <p className="text-sm text-slate-700 leading-relaxed font-medium">
                   {localConfig.finish_service_message || "Agradecemos o contato!"}
                 </p>
                 <span className="text-[9px] text-slate-400 font-bold uppercase mt-2 block">10:45</span>
                 <div className="absolute -left-2 top-4 w-4 h-4 bg-white border-l border-b border-slate-100 rotate-45" />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* CSAT / NPS */}
      <Card className="border border-slate-200 shadow-sm relative overflow-hidden">
        <div className="h-1.5 bg-indigo-500 absolute top-0 left-0 right-0" />
        <CardHeader className="pb-4">
          <CardTitle className="text-xl font-bold text-slate-900 flex items-center gap-3">
            <Star className="w-6 h-6 text-indigo-500" />
            Pesquisa de Satisfação (CSAT / NPS)
          </CardTitle>
          <CardDescription className="text-slate-500 font-medium">
            Envie automaticamente uma pesquisa após o encerramento para medir a experiência do paciente.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-6">
              <div className="flex items-center justify-between p-4 rounded-xl bg-slate-50 border border-slate-100">
                <div>
                  <p className="text-sm font-bold text-slate-900">Ativar Pesquisa de Satisfação</p>
                  <p className="text-[10px] font-semibold text-slate-500 uppercase pt-0.5">Envio automático pós-encerramento</p>
                </div>
                <button
                  onClick={() => { const v = !localConfig.csat_enabled; setLocalConfig({ ...localConfig, csat_enabled: v }); updateAI({ ...localConfig, csat_enabled: v }); }}
                  className={cn("w-12 h-6 rounded-full relative transition-all", localConfig.csat_enabled ? "bg-indigo-500" : "bg-slate-300")}
                >
                  <div className={cn("w-4 h-4 bg-white rounded-full absolute top-1 transition-all shadow-sm", localConfig.csat_enabled ? "right-1" : "left-1")}></div>
                </button>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider pl-1">Tipo de Pesquisa</label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { value: 'csat', label: 'CSAT', desc: '1 a 5 estrelas' },
                    { value: 'nps',  label: 'NPS',  desc: '0 a 10 pontos' },
                    { value: 'both', label: 'Ambos', desc: 'CSAT + NPS' },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setConfig({ csat_type: opt.value })}
                      className={cn(
                        "p-3 rounded-xl border-2 text-left transition-all",
                        (localConfig.csat_type ?? 'csat') === opt.value
                          ? "border-indigo-500 bg-indigo-50"
                          : "border-slate-200 bg-white hover:border-slate-300"
                      )}
                    >
                      <p className={cn("text-sm font-bold", (localConfig.csat_type ?? 'csat') === opt.value ? "text-indigo-700" : "text-slate-700")}>{opt.label}</p>
                      <p className="text-[10px] text-slate-500 font-medium">{opt.desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider pl-1">Mensagem de Introdução</label>
                <textarea
                  rows={3}
                  value={localConfig.csat_message || ""}
                  onChange={(e) => setConfig({ csat_message: e.target.value })}
                  className="w-full p-4 border border-slate-200 rounded-lg font-medium focus:ring-2 focus:ring-indigo-100 focus:border-indigo-500 outline-none transition-all resize-none text-sm leading-relaxed"
                  placeholder="Olá! Poderia avaliar nosso atendimento? Sua opinião é muito importante para nós."
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider pl-1">Aguardar antes de enviar</label>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    min={0}
                    max={10080}
                    value={localConfig.csat_delay_minutes ?? 120}
                    onChange={(e) => setConfig({ csat_delay_minutes: parseInt(e.target.value) || 0 })}
                    className="w-24 p-3 border border-slate-200 rounded-lg font-bold text-center focus:ring-2 focus:ring-indigo-100 focus:border-indigo-500 outline-none transition-all text-sm"
                  />
                  <span className="text-sm font-medium text-slate-500">minutos após o encerramento</span>
                </div>
              </div>

              <Button
                onClick={handleSave}
                disabled={saving || !isDirty}
                className={cn("w-full py-6 transition-all", isDirty ? "bg-indigo-500 hover:bg-indigo-600 text-white shadow-lg shadow-indigo-100" : "bg-slate-100 text-slate-400 cursor-default")}
              >
                {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : isDirty ? "Salvar Configurações" : "Configuração Salva ✓"}
              </Button>
            </div>

            <div className="flex flex-col gap-6">
              <div className="p-6 rounded-2xl bg-indigo-50 border border-indigo-100 relative overflow-hidden">
                <div className="relative z-10">
                  <h4 className="text-sm font-bold text-indigo-900 mb-2 flex items-center gap-2">
                    <Star className="w-4 h-4" />
                    Como funciona o CSAT / NPS?
                  </h4>
                  <p className="text-xs text-indigo-700 leading-relaxed font-medium">
                    Após o encerramento do atendimento, a plataforma aguarda o tempo configurado e envia automaticamente a pesquisa via WhatsApp. O paciente responde com um número, e a nota é registrada para acompanhamento.
                  </p>
                </div>
                <Star className="absolute -right-4 -bottom-4 w-24 h-24 text-indigo-200/50 rotate-12" />
              </div>

              <Card className="border border-slate-100 shadow-sm bg-slate-50/50">
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-bold text-slate-500 uppercase tracking-tighter flex items-center gap-2">
                    <MessageSquare className="w-3 h-3" />
                    Preview da Pesquisa
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-2 space-y-2">
                  <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 max-w-[85%] relative">
                    <p className="text-sm text-slate-700 leading-relaxed font-medium">
                      {localConfig.csat_message || "Olá! Poderia avaliar nosso atendimento?"}
                    </p>
                    {(localConfig.csat_type ?? 'csat') !== 'nps' && (
                      <p className="text-xs text-slate-500 mt-2">
                        Responda de 1 a 5:<br />1 ⭐ Muito ruim · 3 ⭐⭐⭐ Regular · 5 ⭐⭐⭐⭐⭐ Excelente
                      </p>
                    )}
                    {(localConfig.csat_type ?? 'csat') !== 'csat' && (
                      <p className="text-xs text-slate-500 mt-2">
                        Responda de 0 a 10:<br />0 Nada provável · 10 Extremamente provável
                      </p>
                    )}
                    <span className="text-[9px] text-slate-400 font-bold uppercase mt-2 block">10:47</span>
                    <div className="absolute -left-2 top-4 w-4 h-4 bg-white border-l border-b border-slate-100 rotate-45" />
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function AISecretary() {
  const [activeTab, setActiveTab] = useState<"chats" | "leads" | "dashboard" | "config" | "followups" | "handoff" | "finish_service">("chats");
  const { aiConfig, updateAI } = useSettings();

  return (
    <div className="space-y-8 h-full flex flex-col">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-3xl font-bold tracking-tight text-slate-900">
              Gestão <span className="text-teal-600">Comercial</span>
            </h2>
            <p className="text-slate-500 font-medium text-base">
              Gestão de conversas e automação comercial.
            </p>
          </div>
          {aiConfig && (
            <div className="flex items-center gap-3">
              {aiConfig.test_mode_enabled && (
                <span className="flex items-center gap-1 text-[10px] font-bold text-red-600 bg-red-50 border border-red-200 px-2 py-1 rounded-full">
                  <AlertTriangle className="w-3 h-3" />
                  IA Teste Ativo
                </span>
              )}
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                {aiConfig.auto_schedule ? 'Agente IA Ativo' : 'Agente IA Pausado'}
              </span>
              <button
                onClick={() => updateAI({ ...aiConfig, auto_schedule: !aiConfig.auto_schedule })}
                className={cn(
                  "w-12 h-6 rounded-full relative transition-all",
                  aiConfig.auto_schedule
                    ? (aiConfig.test_mode_enabled ? "bg-red-500" : "bg-teal-600")
                    : "bg-slate-300"
                )}
              >
                <div className={cn(
                  "w-4 h-4 bg-white rounded-full absolute top-1 transition-all shadow-sm",
                  aiConfig.auto_schedule ? "right-1" : "left-1"
                )} />
              </button>
            </div>
          )}
        </div>
        <div className="flex bg-slate-50 p-1.5 rounded-2xl border border-slate-200 overflow-x-auto scrollbar-hide gap-1 w-full min-w-0">
          {[
            { id: "chats", label: "Conversas" },
            { id: "leads", label: "Funil de Leads" },
            { id: "dashboard", label: "Dashboard" },
            { id: "followups", label: "Follow-up" },
            { id: "handoff", label: "Transbordo" },
            { id: "finish_service", label: "Encerramento" },
            { id: "config", label: "Configurações" }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={cn(
                "flex-1 px-3 py-2.5 text-xs sm:text-sm font-bold rounded-xl transition-all whitespace-nowrap text-center",
                activeTab === tab.id
                  ? "bg-white text-teal-700 shadow-md ring-1 ring-slate-200"
                  : "text-slate-600 hover:text-slate-900 hover:bg-white/50",
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
          {activeTab === "followups" && <AllFollowupsView />}
          {activeTab === "handoff" && <HandoffView />}
          {activeTab === "finish_service" && <FinishServiceView />}
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
  const { data: messages, loading: messagesLoading } = useChatMessages(selectedLeadId || undefined, selectedLead?.phone);

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
            Conversas
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
            leads.map((lead) => {
              const isMeta = !!lead.fb_campaign_name || lead.source === 'meta_ads';
              const isGoogle = !!lead.g_campaign_name || lead.source === 'google_ads';
              return (
              <motion.div
                key={lead.id}
                whileHover={{ x: 2 }}
                onClick={() => setSelectedLeadId(lead.id)}
                className={cn(
                  "p-3 rounded-lg cursor-pointer transition-all border",
                  selectedLeadId === lead.id
                    ? "bg-indigo-50 border-indigo-200 shadow-sm"
                    : isMeta ? "bg-blue-50/50 border-blue-100/60 hover:bg-blue-50"
                    : isGoogle ? "bg-emerald-50/50 border-emerald-100/60 hover:bg-emerald-50"
                    : "border-transparent hover:bg-slate-50"
                )}
              >
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center font-bold text-slate-700 bg-slate-100")}>
                      {lead.name[0]}
                    </div>
                    {isMeta && (
                      <img src={MetaLogo} alt="Meta" className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 border-white shadow-sm" />
                    )}
                    {isGoogle && !isMeta && (
                      <img src={GoogleLogo} alt="Google" className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 border-white shadow-sm" />
                    )}
                    {!isMeta && !isGoogle && (
                      <img src={SemOrigemLogo} alt="Sem Origem" className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 border-white shadow-sm opacity-60" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-center mb-0.5">
                      <span className="font-bold text-sm text-slate-900 truncate">
                        {lead.name}
                      </span>
                      <span className="text-[10px] font-medium text-slate-400">
                        {format(new Date(lead.last_message_at ?? lead.created_at), 'dd/MM')}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 truncate mb-1">
                      {lead.phone || 'Sem telefone'}
                    </p>
                    <div className="flex items-center justify-between gap-1">
                      <div className="flex gap-1">
                        {(() => {
                          const isAguardando = !!lead.last_outbound_at && (
                            !lead.last_message_at || parseISO(lead.last_outbound_at) > parseISO(lead.last_message_at)
                          );
                          const isPrecisaResponder = !!lead.last_message_at && (
                            !lead.last_outbound_at || parseISO(lead.last_message_at) > parseISO(lead.last_outbound_at)
                          );

                          if (isAguardando) return (
                            <span className="text-[8px] font-bold px-1 py-0.5 rounded bg-blue-50 text-blue-600 border border-blue-100 uppercase">
                              Aguardando Lead
                            </span>
                          );
                          if (isPrecisaResponder) return (
                            <span className="text-[8px] font-bold px-1 py-0.5 rounded bg-amber-50 text-amber-600 border border-amber-100 uppercase">
                              Responder Lead
                            </span>
                          );
                          return null;
                        })()}
                      </div>
                      <span className="text-[9px] font-bold text-slate-400">
                        {format(new Date(lead.last_message_at ?? lead.created_at), 'HH:mm')}
                      </span>
                    </div>
                  </div>
                </div>
              </motion.div>
              );
            })
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
                  
                  const currentDate = parseISO(msg.created_at);
                  const prevDate = i > 0 ? parseISO(messages[i - 1].created_at) : null;
                  const showDateSeparator = !prevDate || !isSameDay(currentDate, prevDate);

                  const getDateLabel = (date: Date) => {
                    if (isToday(date)) return 'Hoje';
                    if (isYesterday(date)) return 'Ontem';
                    return format(date, "d 'de' MMMM", { locale: ptBR });
                  };

                  return (
                    <React.Fragment key={msg.id || i}>
                      {showDateSeparator && (
                        <div className="flex justify-center my-8 sticky top-2 z-10 pointer-events-none">
                          <span className="bg-white/95 backdrop-blur-sm border border-slate-100 text-[10px] font-bold text-slate-500 uppercase tracking-widest px-4 py-1.5 rounded-full shadow-sm">
                            {getDateLabel(currentDate)}
                          </span>
                        </div>
                      )}
                      <div 
                        className={cn(
                          "flex gap-4 max-w-[85%] min-w-0",
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
                          {extractMessageText(msg.message)}
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
                  </React.Fragment>
                );
              })
            )
          }
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
  const [isDirty, setIsDirty] = useState(false);
  const [localConfig, setLocalConfig] = useState<any>(null);

  const setConfig = (updates: any) => {
    setLocalConfig((p: any) => ({ ...p, ...updates }));
    setIsDirty(true);
  };

  useEffect(() => {
    if (aiConfig) {
      setLocalConfig({ ...aiConfig });
      setIsDirty(false);
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
    setIsDirty(false);
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 h-full">
      <Card className="border border-slate-200 shadow-sm">
        <CardHeader className="pb-4">
          <CardTitle className="text-xl font-bold text-slate-900 flex items-center gap-3">
            <Bot className="w-6 h-6 text-teal-600" />
            Configuracoes do Comercial
          </CardTitle>
          <CardDescription className="text-slate-500 font-medium">
            Personalize as informacoes da clinica para orientar a automacao comercial.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider pl-1">
              Informações da Clínica
            </label>
            <textarea
              rows={8}
              value={localConfig.prompt || ""}
              onChange={(e) => setConfig({ prompt: e.target.value })}
              className="w-full p-4 border border-slate-200 rounded-lg font-medium focus:ring-2 focus:ring-teal-100 focus:border-teal-600 outline-none transition-all resize-none text-sm leading-relaxed"
              placeholder="Descreva aqui informações da clínica, especialidades, médicos, horários, localização e instruções para que a IA possa responder aos pacientes de forma correta..."
            />
          </div>
          <Button
            onClick={handleSave}
            disabled={saving || !isDirty}
            className={cn("w-full py-6 transition-all", isDirty ? "bg-teal-600 hover:bg-teal-700 text-white" : "bg-slate-100 text-slate-400 cursor-default")}
          >
            {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : isDirty ? "Salvar Configurações" : "Configurações Salvas ✓"}
          </Button>
        </CardContent>
      </Card>

      <div className="space-y-8">
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
                  value={localConfig.sla_minutes ?? 120}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setConfig({ sla_minutes: Number(e.target.value) })}
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
                  value={localConfig.business_hours?.start ?? '08:00'}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setConfig({ business_hours: { ...(localConfig.business_hours ?? { end: '18:00', days: [1,2,3,4,5] }), start: e.target.value } })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg font-medium focus:ring-2 focus:ring-teal-100 focus:border-teal-600 outline-none text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider pl-1">Fim do expediente</label>
                <input
                  type="time"
                  value={localConfig.business_hours?.end ?? '18:00'}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setConfig({ business_hours: { ...(localConfig.business_hours ?? { start: '08:00', days: [1,2,3,4,5] }), end: e.target.value } })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg font-medium focus:ring-2 focus:ring-teal-100 focus:border-teal-600 outline-none text-sm"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider pl-1">Dias de atendimento</label>
              <div className="flex gap-1.5 flex-wrap">
                {['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'].map((d, i) => {
                  const days: number[] = localConfig.business_hours?.days ?? [1,2,3,4,5];
                  const active = days.includes(i);
                  return (
                    <button
                      key={i}
                      onClick={() => {
                        const newDays = active ? days.filter(x => x !== i) : [...days, i].sort();
                        setConfig({ business_hours: { ...(localConfig.business_hours ?? { start: '08:00', end: '18:00' }), days: newDays } });
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
                  value={localConfig.default_ticket_value ?? 0}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setConfig({ default_ticket_value: Number(e.target.value) })}
                  className="w-36 px-3 py-2 border border-slate-200 rounded-lg font-medium focus:ring-2 focus:ring-teal-100 focus:border-teal-600 outline-none text-sm"
                  placeholder="0,00"
                />
              </div>
              <p className="text-xs text-slate-400 pl-1">Pré-preenchido automaticamente em novos leads.</p>
            </div>
          </CardContent>
        </Card>

        <Card className="border border-red-100 shadow-sm md:col-span-2">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-500" />
              Modo Teste IA
            </CardTitle>
            <CardDescription className="text-slate-500 font-medium">
              Restringe a IA a responder apenas para números autorizados. Ideal para testar antes de ativar em produção.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              {/* Toggle */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-bold text-slate-700">Ativar Modo Teste</p>
                  <p className="text-xs text-slate-400 mt-0.5">Quando ativo, a IA comercial também é ativada automaticamente.</p>
                </div>
                <button
                  onClick={() => {
                    const newVal = !localConfig.test_mode_enabled;
                    const updated = { ...localConfig, test_mode_enabled: newVal, ...(newVal ? { auto_schedule: true } : {}) };
                    setLocalConfig(updated);
                    setIsDirty(true);
                    updateAI(updated);
                  }}
                  className={cn(
                    "w-12 h-6 rounded-full relative transition-all flex-shrink-0",
                    localConfig.test_mode_enabled ? "bg-red-500" : "bg-slate-300"
                  )}
                >
                  <div className={cn(
                    "w-4 h-4 bg-white rounded-full absolute top-1 transition-all shadow-sm",
                    localConfig.test_mode_enabled ? "right-1" : "left-1"
                  )} />
                </button>
              </div>

              {/* Números Permitidos — sempre visível */}
              <div className="space-y-2 pt-2 border-t border-slate-100">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider pl-1">
                  Números Permitidos
                </label>
                <div className="space-y-2">
                  {(localConfig.test_numbers || []).map((num: string, idx: number) => (
                    <div key={idx} className="flex items-center gap-2">
                      <input
                        type="text"
                        value={num}
                        onChange={(e) => {
                          const nums = [...(localConfig.test_numbers || [])];
                          nums[idx] = e.target.value;
                          setConfig({ test_numbers: nums });
                        }}
                        placeholder="5511999990000"
                        className="flex-1 px-3 py-2 border border-slate-200 rounded-lg font-mono text-sm focus:ring-2 focus:ring-red-100 focus:border-red-400 outline-none"
                      />
                      <button
                        onClick={() => {
                          const nums = (localConfig.test_numbers || []).filter((_: string, i: number) => i !== idx);
                          setConfig({ test_numbers: nums });
                        }}
                        className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() => setConfig({ test_numbers: [...(localConfig.test_numbers || []), ''] })}
                    className="flex items-center gap-1.5 text-xs font-bold text-teal-600 hover:text-teal-700 px-1 py-1 transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                    Adicionar número
                  </button>
                </div>
                <p className="text-xs text-slate-400 pl-1">Formato internacional, sem espaços (ex: 5511999990000).</p>
              </div>

              {/* Frase de reinício — sempre visível */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider pl-1">
                  Frase de Reinício de Ciclo
                </label>
                <input
                  type="text"
                  value={localConfig.test_reset_phrase || ''}
                  onChange={(e) => setConfig({ test_reset_phrase: e.target.value })}
                  placeholder="ex: reiniciar teste"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg font-medium text-sm focus:ring-2 focus:ring-red-100 focus:border-red-400 outline-none"
                />
                <p className="text-xs text-slate-400 pl-1">Quando enviada por um número permitido, reinicia o ciclo da conversa.</p>
              </div>
            </div>
          </CardContent>
        </Card>

      </div>
    </div>
  );
}
