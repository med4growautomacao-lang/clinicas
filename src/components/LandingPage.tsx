import React, { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Stethoscope,
  Bot,
  BarChart3,
  Calendar,
  MessageSquare,
  Users,
  TrendingUp,
  Shield,
  ChevronRight,
  Check,
  Star,
  ArrowRight,
  Zap,
  Clock,
  DollarSign,
} from 'lucide-react';

const FEATURES = [
  {
    icon: Bot,
    color: 'bg-violet-50 text-violet-600',
    title: 'IA Secretária',
    desc: 'Atende leads no WhatsApp 24h, qualifica, agenda e move automaticamente pelo funil — sem intervenção humana.',
  },
  {
    icon: BarChart3,
    color: 'bg-teal-50 text-teal-600',
    title: 'Marketing Analytics',
    desc: 'Acompanhe ROI de Meta Ads e Google Ads em tempo real. Saiba exatamente quanto cada lead custa e converte.',
  },
  {
    icon: Calendar,
    color: 'bg-blue-50 text-blue-600',
    title: 'Agenda Inteligente',
    desc: 'Gestão completa de consultas com confirmação automática, lembretes e controle de presença.',
  },
  {
    icon: MessageSquare,
    color: 'bg-amber-50 text-amber-600',
    title: 'Funil de Leads',
    desc: 'Kanban visual para acompanhar cada lead da captação à conversão, com regras de automação personalizadas.',
  },
  {
    icon: DollarSign,
    color: 'bg-emerald-50 text-emerald-600',
    title: 'Financeiro',
    desc: 'Controle de receitas, despesas e fluxo de caixa com visão consolidada por clínica ou grupo.',
  },
  {
    icon: Users,
    color: 'bg-rose-50 text-rose-600',
    title: 'Prontuário Eletrônico',
    desc: 'Histórico completo dos pacientes, anotações clínicas e evolução do tratamento em um só lugar.',
  },
];

const STATS = [
  { value: '3x', label: 'mais conversões de leads' },
  { value: '80%', label: 'menos tempo em tarefas manuais' },
  { value: '24h', label: 'atendimento automatizado' },
  { value: '100%', label: 'visibilidade do funil' },
];

const PLANS = [
  {
    name: 'Essencial',
    price: 'R$ 297',
    period: '/mês',
    desc: 'Ideal para clínicas solo ou pequenas equipes.',
    features: ['1 clínica', 'IA Secretária', 'Funil de Leads', 'Agenda', 'Suporte via WhatsApp'],
    cta: 'Começar agora',
    highlight: false,
  },
  {
    name: 'Profissional',
    price: 'R$ 597',
    period: '/mês',
    desc: 'Para clínicas em crescimento que precisam de mais.',
    features: ['3 clínicas', 'Tudo do Essencial', 'Marketing Analytics', 'Financeiro', 'Prontuário Eletrônico', 'Suporte prioritário'],
    cta: 'Começar agora',
    highlight: true,
  },
  {
    name: 'Rede',
    price: 'Sob consulta',
    period: '',
    desc: 'Para grupos com múltiplas unidades e equipes.',
    features: ['Clínicas ilimitadas', 'Tudo do Profissional', 'Gestão de organização', 'Onboarding dedicado', 'SLA garantido'],
    cta: 'Falar com vendas',
    highlight: false,
  },
];

export function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false);

  const goToApp = () => { window.location.href = '/app'; };

  return (
    <div className="min-h-screen bg-white font-sans text-slate-900 overflow-x-hidden">

      {/* Navbar */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-md border-b border-slate-100">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-teal-600 rounded-lg flex items-center justify-center">
              <Stethoscope className="w-5 h-5 text-white" />
            </div>
            <span className="text-lg font-black text-slate-900">MedDesk</span>
          </div>
          <nav className="hidden md:flex items-center gap-8">
            <a href="#funcionalidades" className="text-sm font-medium text-slate-500 hover:text-teal-600 transition-colors">Funcionalidades</a>
            <a href="#planos" className="text-sm font-medium text-slate-500 hover:text-teal-600 transition-colors">Planos</a>
            <a href="#contato" className="text-sm font-medium text-slate-500 hover:text-teal-600 transition-colors">Contato</a>
          </nav>
          <button
            onClick={goToApp}
            className="hidden md:flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-bold rounded-xl transition-all shadow-sm shadow-teal-100"
          >
            Acessar painel <ArrowRight className="w-4 h-4" />
          </button>
          <button className="md:hidden p-2 text-slate-500" onClick={() => setMenuOpen(v => !v)}>
            <div className="space-y-1.5">
              <span className="block w-5 h-0.5 bg-current" />
              <span className="block w-5 h-0.5 bg-current" />
              <span className="block w-5 h-0.5 bg-current" />
            </div>
          </button>
        </div>
        {menuOpen && (
          <div className="md:hidden bg-white border-t border-slate-100 px-6 py-4 space-y-3">
            <a href="#funcionalidades" className="block text-sm font-medium text-slate-600">Funcionalidades</a>
            <a href="#planos" className="block text-sm font-medium text-slate-600">Planos</a>
            <a href="#contato" className="block text-sm font-medium text-slate-600">Contato</a>
            <button onClick={goToApp} className="w-full py-2.5 bg-teal-600 text-white text-sm font-bold rounded-xl">Acessar painel</button>
          </div>
        )}
      </header>

      {/* Hero */}
      <section className="pt-32 pb-24 px-6 relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(13,148,136,0.07),transparent_60%)] pointer-events-none" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom_left,rgba(13,148,136,0.04),transparent_60%)] pointer-events-none" />
        <div className="max-w-4xl mx-auto text-center relative z-10">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-teal-50 border border-teal-100 rounded-full text-teal-700 text-xs font-bold mb-8">
              <Zap className="w-3.5 h-3.5" /> Plataforma completa para clínicas
            </div>
            <h1 className="text-5xl md:text-6xl font-black text-slate-900 leading-tight tracking-tight mb-6">
              Sua clínica no<br />
              <span className="text-teal-600">piloto automático</span>
            </h1>
            <p className="text-xl text-slate-500 font-medium max-w-2xl mx-auto mb-10 leading-relaxed">
              IA que atende, qualifica e agenda leads pelo WhatsApp. Analytics de marketing em tempo real. Gestão financeira e de prontuários. Tudo integrado.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <button
                onClick={goToApp}
                className="flex items-center gap-2 px-8 py-4 bg-teal-600 hover:bg-teal-700 text-white font-bold rounded-2xl text-base transition-all shadow-xl shadow-teal-100 hover:shadow-teal-200 hover:-translate-y-0.5"
              >
                Começar gratuitamente <ChevronRight className="w-5 h-5" />
              </button>
              <a href="#funcionalidades" className="flex items-center gap-2 px-8 py-4 bg-white border border-slate-200 hover:border-teal-200 text-slate-700 font-bold rounded-2xl text-base transition-all hover:-translate-y-0.5">
                Ver funcionalidades
              </a>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Stats */}
      <section className="py-16 px-6 bg-slate-50 border-y border-slate-100">
        <div className="max-w-5xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8">
          {STATS.map((s, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
              className="text-center"
            >
              <p className="text-4xl font-black text-teal-600 mb-1">{s.value}</p>
              <p className="text-sm text-slate-500 font-medium">{s.label}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section id="funcionalidades" className="py-24 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-black text-slate-900 mb-4">Tudo que sua clínica precisa</h2>
            <p className="text-lg text-slate-500 font-medium max-w-xl mx-auto">Uma plataforma completa, sem precisar de 10 ferramentas diferentes.</p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {FEATURES.map((f, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.08 }}
                className="p-6 bg-white border border-slate-100 rounded-2xl hover:shadow-lg hover:border-teal-100 transition-all group"
              >
                <div className={`w-11 h-11 rounded-xl flex items-center justify-center mb-4 ${f.color}`}>
                  <f.icon className="w-5 h-5" />
                </div>
                <h3 className="text-base font-black text-slate-900 mb-2">{f.title}</h3>
                <p className="text-sm text-slate-500 leading-relaxed">{f.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* IA highlight */}
      <section className="py-24 px-6 bg-gradient-to-br from-teal-600 to-teal-700 relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.08),transparent_60%)] pointer-events-none" />
        <div className="max-w-5xl mx-auto relative z-10">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-white/10 rounded-full text-white/80 text-xs font-bold mb-6">
                <Bot className="w-3.5 h-3.5" /> IA Secretária
              </div>
              <h2 className="text-3xl md:text-4xl font-black text-white mb-5 leading-tight">
                Nunca perca um lead por demora no atendimento
              </h2>
              <p className="text-teal-100 text-lg leading-relaxed mb-8">
                Nossa IA responde em segundos, qualifica o lead, envia orçamento e agenda a consulta — tudo pelo WhatsApp, sem nenhuma interação humana necessária.
              </p>
              <ul className="space-y-3">
                {['Atendimento 24h nos 7 dias', 'Move leads automaticamente no funil', 'Envio de mensagens personalizadas', 'Modo teste para validar respostas'].map((item, i) => (
                  <li key={i} className="flex items-center gap-3 text-white font-medium text-sm">
                    <div className="w-5 h-5 bg-white/20 rounded-full flex items-center justify-center flex-shrink-0">
                      <Check className="w-3 h-3 text-white" />
                    </div>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="bg-white/10 backdrop-blur rounded-2xl p-6 border border-white/20">
              <div className="space-y-3">
                {[
                  { side: 'left', msg: 'Olá! Vi o anúncio de vocês. Quanto custa uma consulta?', time: '14:32' },
                  { side: 'right', msg: 'Olá! Que bom que entrou em contato 😊 A consulta é R$150. Você tem preferência de horário?', time: '14:32', ai: true },
                  { side: 'left', msg: 'Manhã, de preferência.', time: '14:33' },
                  { side: 'right', msg: 'Perfeito! Temos disponibilidade amanhã às 9h ou quinta às 10h. Qual prefere?', time: '14:33', ai: true },
                ].map((m, i) => (
                  <div key={i} className={`flex ${m.side === 'right' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] px-4 py-2.5 rounded-2xl text-sm ${m.side === 'right' ? 'bg-white text-slate-800' : 'bg-white/20 text-white'}`}>
                      <p className="font-medium">{m.msg}</p>
                      <div className={`flex items-center gap-1.5 mt-1 ${m.side === 'right' ? 'justify-end' : ''}`}>
                        {m.ai && <span className="text-[10px] font-bold text-teal-500">IA</span>}
                        <span className={`text-[10px] ${m.side === 'right' ? 'text-slate-400' : 'text-white/50'}`}>{m.time}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Planos */}
      <section id="planos" className="py-24 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-black text-slate-900 mb-4">Planos simples e transparentes</h2>
            <p className="text-lg text-slate-500 font-medium">Sem taxa de setup. Cancele quando quiser.</p>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {PLANS.map((p, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className={`relative p-7 rounded-2xl border flex flex-col ${p.highlight ? 'bg-teal-600 border-teal-600 shadow-2xl shadow-teal-200 scale-105' : 'bg-white border-slate-200'}`}
              >
                {p.highlight && (
                  <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                    <span className="px-3 py-1 bg-amber-400 text-amber-900 text-xs font-black rounded-full flex items-center gap-1">
                      <Star className="w-3 h-3 fill-current" /> Mais popular
                    </span>
                  </div>
                )}
                <div className="mb-6">
                  <h3 className={`text-lg font-black mb-1 ${p.highlight ? 'text-white' : 'text-slate-900'}`}>{p.name}</h3>
                  <p className={`text-xs font-medium mb-4 ${p.highlight ? 'text-teal-100' : 'text-slate-500'}`}>{p.desc}</p>
                  <div className="flex items-end gap-1">
                    <span className={`text-3xl font-black ${p.highlight ? 'text-white' : 'text-slate-900'}`}>{p.price}</span>
                    {p.period && <span className={`text-sm font-medium mb-1 ${p.highlight ? 'text-teal-200' : 'text-slate-400'}`}>{p.period}</span>}
                  </div>
                </div>
                <ul className="space-y-2.5 mb-8 flex-1">
                  {p.features.map((f, j) => (
                    <li key={j} className={`flex items-center gap-2.5 text-sm font-medium ${p.highlight ? 'text-teal-50' : 'text-slate-600'}`}>
                      <Check className={`w-4 h-4 flex-shrink-0 ${p.highlight ? 'text-teal-200' : 'text-teal-500'}`} />
                      {f}
                    </li>
                  ))}
                </ul>
                <button
                  onClick={goToApp}
                  className={`w-full py-3 rounded-xl font-bold text-sm transition-all ${p.highlight ? 'bg-white text-teal-700 hover:bg-teal-50' : 'bg-teal-600 hover:bg-teal-700 text-white'}`}
                >
                  {p.cta}
                </button>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA final */}
      <section id="contato" className="py-24 px-6 bg-slate-50 border-t border-slate-100">
        <div className="max-w-2xl mx-auto text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <div className="w-16 h-16 bg-teal-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg shadow-teal-100">
              <Stethoscope className="w-9 h-9 text-white" />
            </div>
            <h2 className="text-3xl md:text-4xl font-black text-slate-900 mb-4">Pronto para automatizar sua clínica?</h2>
            <p className="text-lg text-slate-500 font-medium mb-8">Entre em contato e veja como o MedDesk pode transformar sua operação.</p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <button
                onClick={goToApp}
                className="flex items-center gap-2 px-8 py-4 bg-teal-600 hover:bg-teal-700 text-white font-bold rounded-2xl text-base transition-all shadow-xl shadow-teal-100"
              >
                Acessar o painel <ArrowRight className="w-5 h-5" />
              </button>
              <a
                href="https://wa.me/5500000000000"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-8 py-4 bg-white border border-slate-200 hover:border-teal-200 text-slate-700 font-bold rounded-2xl text-base transition-all"
              >
                Falar no WhatsApp
              </a>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 px-6 border-t border-slate-100">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-teal-600 rounded-md flex items-center justify-center">
              <Stethoscope className="w-4 h-4 text-white" />
            </div>
            <span className="text-sm font-black text-slate-700">MedDesk</span>
          </div>
          <p className="text-xs text-slate-400">© {new Date().getFullYear()} MedDesk. Todos os direitos reservados.</p>
          <div className="flex items-center gap-6">
            <a href="https://med4growautomacao.com.br/politicas" target="_blank" rel="noopener noreferrer" className="text-xs text-slate-400 hover:text-teal-600 transition-colors">Políticas de Privacidade</a>
            <a href="https://med4growautomacao.com.br/termos" target="_blank" rel="noopener noreferrer" className="text-xs text-slate-400 hover:text-teal-600 transition-colors">Termos de Uso</a>
          </div>
        </div>
      </footer>

    </div>
  );
}
