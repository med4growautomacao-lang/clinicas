import React, { useState } from "react";
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
} from "lucide-react";
import { cn } from "@/src/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { LeadKanban } from "./LeadKanban";
import { ServiceDashboard } from "./ServiceDashboard";

export function AISecretary() {
  const [activeTab, setActiveTab] = useState<"chats" | "leads" | "dashboard" | "config">("chats");

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
        <div className="flex bg-white p-1 rounded-lg w-fit shadow-sm border border-slate-200">
          <button
            onClick={() => setActiveTab("chats")}
            className={cn(
              "px-6 py-2 text-sm font-semibold rounded-md transition-all",
              activeTab === "chats"
                ? "bg-teal-600 text-white shadow-sm"
                : "text-slate-500 hover:text-slate-900 hover:bg-slate-50",
            )}
          >
            Atendimentos
          </button>
          <button
            onClick={() => setActiveTab("leads")}
            className={cn(
              "px-6 py-2 text-sm font-semibold rounded-md transition-all",
              activeTab === "leads"
                ? "bg-teal-600 text-white shadow-sm"
                : "text-slate-500 hover:text-slate-900 hover:bg-slate-50",
            )}
          >
            Funil de Leads
          </button>
          <button
            onClick={() => setActiveTab("dashboard")}
            className={cn(
              "px-6 py-2 text-sm font-semibold rounded-md transition-all",
              activeTab === "dashboard"
                ? "bg-teal-600 text-white shadow-sm"
                : "text-slate-500 hover:text-slate-900 hover:bg-slate-50",
            )}
          >
            Dashboard
          </button>
          <button
            onClick={() => setActiveTab("config")}
            className={cn(
              "px-6 py-2 text-sm font-semibold rounded-md transition-all",
              activeTab === "config"
                ? "bg-teal-600 text-white shadow-sm"
                : "text-slate-500 hover:text-slate-900 hover:bg-slate-50",
            )}
          >
            Configurações
          </button>
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
          {activeTab === "config" && <ConfigView />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function ChatsView() {
  const [chatMessages] = useState([
    { role: "user", content: "Olá! Gostaria de agendar uma consulta para a próxima semana.", time: "10:40" },
    { role: "assistant", content: "Olá, Maria! Com certeza. Temos os seguintes horários disponíveis na próxima semana:\n\n📅 Terça-feira (14/05) às 14:00\n📅 Quinta-feira (16/05) às 10:00\n\nQual desses horários é mais conveniente para você?", time: "10:41" },
    { role: "human", content: "Oi Maria, sou o atendente Carlos. Vi que você tem preferência por passar com o Dr. Roberto, confere?", time: "10:42" }
  ]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-8 h-full min-h-[600px]">
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
          {[
            { name: "Maria Silva", msg: "Oi Maria, sou o atendente...", time: "10:42", unread: false, initials: "MS", color: "bg-blue-100", isHuman: true },
            { name: "João Pedro", msg: "Qual o valor da consulta?", time: "10:15", unread: false, initials: "JP", color: "bg-yellow-100" },
            { name: "Ana Costa", msg: "Obrigada, confirmado.", time: "09:30", unread: false, initials: "AC", color: "bg-pink-100" },
            { name: "Lucas Ferreira", msg: "Pode ser na terça?", time: "Ontem", unread: false, initials: "LF", color: "bg-indigo-100" },
            { name: "Carla Souza", msg: "Obrigada Clara!", time: "Ontem", unread: false, initials: "CS", color: "bg-emerald-100" },
          ].map((chat, i) => (
            <motion.div
              key={i}
              whileHover={{ x: 2 }}
              className={cn(
                "p-3 rounded-lg cursor-pointer transition-all border",
                i === 0
                  ? "bg-teal-50 border-teal-100 shadow-sm"
                  : "border-transparent hover:bg-slate-50"
              )}
            >
              <div className="flex items-center gap-3">
                <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center font-bold text-slate-700", chat.color)}>
                  {chat.initials}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-center mb-0.5">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="font-bold text-sm text-slate-900 truncate">
                        {chat.name}
                      </span>
                      {chat.isHuman && (
                        <span title="Atendimento Humano" className="text-xs">👤</span>
                      )}
                    </div>
                    <span className="text-[10px] font-medium text-slate-400">{chat.time}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <p className="text-xs text-slate-500 truncate pr-4">
                      {chat.msg}
                    </p>
                    {chat.unread && (
                      <span className="w-2 h-2 rounded-full bg-teal-600 shadow-sm"></span>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </CardContent>
      </Card>

      <Card className="col-span-2 flex flex-col border border-slate-200 shadow-sm bg-white overflow-hidden relative">
        <CardHeader className="border-b border-slate-100 py-4 flex flex-row items-center justify-between px-6 bg-white shrink-0">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-lg bg-teal-50 flex items-center justify-center border border-teal-100">
              <User className="w-6 h-6 text-teal-700" />
            </div>
            <div>
              <CardTitle className="text-lg font-bold text-slate-900">Maria Silva</CardTitle>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-sm"></span>
                <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider">
                  Sistema Ativo
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold text-slate-400 uppercase bg-slate-100 px-2 py-1 rounded">Modo Inteligente</span>
          </div>
        </CardHeader>

        <CardContent className="flex-1 overflow-y-auto p-6 space-y-6 bg-slate-50/20">
          <div className="flex justify-center">
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 bg-white px-3 py-1 rounded-md border border-slate-100 shadow-sm">
              Hoje • 10:40
            </span>
          </div>

          {chatMessages.map((msg, i) => (
            <motion.div 
              key={i}
              initial={{ opacity: 0, y: 10 }} 
              animate={{ opacity: 1, y: 0 }} 
              className={cn(
                "flex gap-4 max-w-[85%]",
                msg.role === "user" ? "" : "ml-auto flex-row-reverse"
              )}
            >
              <div className={cn(
                "w-8 h-8 rounded-lg shadow-sm flex-shrink-0 flex items-center justify-center",
                msg.role === "assistant" ? "bg-teal-600 shadow-md" : 
                msg.role === "human" ? "bg-slate-800 shadow-md" : "bg-white border border-slate-200"
              )}>
                {msg.role === "assistant" ? (
                  <Bot className="w-5 h-5 text-white" />
                ) : msg.role === "human" ? (
                  <User className="w-4 h-4 text-white" />
                ) : (
                  <User className="w-4 h-4 text-slate-400" />
                )}
              </div>
              <div className={cn(
                "p-4 rounded-xl shadow-sm relative",
                msg.role === "assistant" 
                  ? "bg-teal-600 text-white rounded-tr-none" 
                  : msg.role === "human"
                    ? "bg-slate-800 text-white rounded-tr-none"
                    : "bg-white border border-slate-200 text-slate-700 rounded-tl-none"
              )}>
                <p className="text-sm font-medium leading-relaxed whitespace-pre-wrap">
                  {msg.content}
                </p>
                <div className="flex items-center justify-between gap-4 mt-1">
                  {msg.role === "human" && (
                    <span className="text-[8px] font-black uppercase text-slate-400">Atendimento Humano</span>
                  )}
                  <span className={cn(
                    "text-[9px] block opacity-60 font-bold uppercase ml-auto",
                    (msg.role === "assistant" || msg.role === "human") ? "text-white text-right" : "text-slate-400"
                  )}>
                    {msg.time}
                  </span>
                </div>
              </div>
            </motion.div>
          ))}
        </CardContent>
      </Card>


    </div>
  );
}

function ConfigView() {
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
              defaultValue="Assistente IA"
              className="w-full px-4 py-2 border border-slate-200 rounded-lg font-medium focus:ring-2 focus:ring-teal-100 focus:border-teal-600 outline-none transition-all"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider pl-1">
              Tom de Voz
            </label>
            <div className="grid grid-cols-2 gap-2">
              {["Profissional", "Cordial", "Direto", "Informativo"].map(tone => (
                <button
                  key={tone}
                  className={cn(
                    "px-4 py-2 rounded-lg border font-semibold text-xs transition-all",
                    tone === "Profissional" ? "bg-teal-50 border-teal-600 text-teal-700" : "bg-white border-slate-200 text-slate-500 hover:border-teal-200"
                  )}
                >
                  {tone}
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
              className="w-full p-4 border border-slate-200 rounded-lg font-medium focus:ring-2 focus:ring-teal-100 focus:border-teal-600 outline-none transition-all resize-none"
              defaultValue="Você é a assistente IA da Clínica Médica. Seu objetivo é realizar agendamentos de forma eficiente e cordial. Seja clara sobre disponibilidades e confirme todos os dados necessários para o cadastro do paciente."
            />
          </div>
          <Button className="w-full bg-teal-600 hover:bg-teal-700 text-white py-6">
            Salvar Configurações
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
                  Automação de Agenda
                </p>
                <p className="text-[10px] font-semibold text-slate-500 uppercase pt-0.5">
                  Confirmar agendamentos automaticamente
                </p>
              </div>
              <div className="w-12 h-6 bg-teal-600 rounded-full relative cursor-pointer">
                <div className="w-4 h-4 bg-white rounded-full absolute right-1 top-1 shadow-sm"></div>
              </div>
            </div>

            <div className="flex items-center justify-between p-4 rounded-xl bg-slate-50 border border-slate-100">
              <div className="pr-4">
                <p className="text-sm font-bold text-slate-900">
                  Transbordo Humano
                </p>
                <p className="text-[10px] font-semibold text-slate-500 uppercase pt-0.5">
                  Alertar equipe se houver dúvidas
                </p>
              </div>
              <div className="w-12 h-6 bg-slate-200 rounded-full relative cursor-pointer">
                <div className="w-4 h-4 bg-white rounded-full absolute left-1 top-1 shadow-sm"></div>
              </div>
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
