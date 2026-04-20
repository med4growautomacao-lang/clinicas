import React from 'react';
import { Stethoscope } from 'lucide-react';

export function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-slate-50 py-16 px-6">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-3 mb-10">
          <div className="w-9 h-9 bg-teal-600 rounded-xl flex items-center justify-center">
            <Stethoscope className="w-5 h-5 text-white" />
          </div>
          <span className="text-lg font-black text-slate-900">MedDesk</span>
        </div>

        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-10 space-y-8">
          <div>
            <h1 className="text-3xl font-black text-slate-900 mb-2">Política de Privacidade</h1>
            <p className="text-sm text-slate-400">Última atualização: abril de 2026</p>
          </div>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-slate-800">1. Quem somos</h2>
            <p className="text-slate-600 leading-relaxed text-sm">
              O MedDesk é uma plataforma de gestão para clínicas médicas e odontológicas, desenvolvida pela Med4Grow Automações. Nosso objetivo é automatizar e otimizar a operação de clínicas por meio de ferramentas de inteligência artificial, CRM, marketing e gestão financeira.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-slate-800">2. Quais dados coletamos</h2>
            <ul className="text-slate-600 text-sm leading-relaxed space-y-2 list-disc list-inside">
              <li>Dados de cadastro: nome, e-mail e senha dos usuários da plataforma</li>
              <li>Dados operacionais: leads, pacientes, agendamentos e mensagens gerenciados pela clínica</li>
              <li>Dados de uso: interações com a plataforma para fins de melhoria do serviço</li>
              <li>Dados de integração: informações provenientes de WhatsApp, Meta Ads e Google Ads quando conectados</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-slate-800">3. Como usamos os dados</h2>
            <ul className="text-slate-600 text-sm leading-relaxed space-y-2 list-disc list-inside">
              <li>Prestação dos serviços contratados na plataforma</li>
              <li>Automação de atendimento via IA no WhatsApp</li>
              <li>Geração de relatórios e análises para a clínica</li>
              <li>Melhoria contínua das funcionalidades do sistema</li>
              <li>Comunicação sobre atualizações e novidades do produto</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-slate-800">4. Compartilhamento de dados</h2>
            <p className="text-slate-600 leading-relaxed text-sm">
              Não vendemos nem compartilhamos seus dados com terceiros para fins publicitários. Os dados podem ser compartilhados apenas com prestadores de serviços essenciais (infraestrutura de nuvem, processamento de pagamentos) e somente na medida necessária para a operação da plataforma.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-slate-800">5. Armazenamento e segurança</h2>
            <p className="text-slate-600 leading-relaxed text-sm">
              Todos os dados são armazenados com criptografia em infraestrutura segura (Supabase / AWS). Aplicamos boas práticas de segurança, incluindo autenticação protegida e controle de acesso por perfil de usuário.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-slate-800">6. Seus direitos (LGPD)</h2>
            <p className="text-slate-600 leading-relaxed text-sm">
              Em conformidade com a Lei Geral de Proteção de Dados (Lei 13.709/2018), você tem direito a acessar, corrigir, exportar ou solicitar a exclusão dos seus dados a qualquer momento. Para exercer esses direitos, entre em contato conosco pelo e-mail abaixo.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-slate-800">7. Contato</h2>
            <p className="text-slate-600 leading-relaxed text-sm">
              Dúvidas sobre esta política podem ser enviadas para: <a href="mailto:contato@med4grow.com.br" className="text-teal-600 hover:underline">contato@med4grow.com.br</a>
            </p>
          </section>
        </div>

        <p className="text-center text-xs text-slate-400 mt-8">
          © {new Date().getFullYear()} MedDesk · Med4Grow Automações
        </p>
      </div>
    </div>
  );
}
