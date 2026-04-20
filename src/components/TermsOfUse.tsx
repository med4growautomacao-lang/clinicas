import React from 'react';
import { Stethoscope } from 'lucide-react';

export function TermsOfUse() {
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
            <h1 className="text-3xl font-black text-slate-900 mb-2">Termos de Uso</h1>
            <p className="text-sm text-slate-400">Última atualização: abril de 2026</p>
          </div>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-slate-800">1. Aceitação dos termos</h2>
            <p className="text-slate-600 leading-relaxed text-sm">
              Ao acessar ou utilizar o MedDesk, você concorda com estes Termos de Uso. Caso não concorde com qualquer disposição, não utilize a plataforma.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-slate-800">2. Descrição do serviço</h2>
            <p className="text-slate-600 leading-relaxed text-sm">
              O MedDesk é uma plataforma SaaS (Software as a Service) voltada para gestão de clínicas. Inclui funcionalidades de CRM de leads, secretária com IA, agenda, financeiro, prontuário eletrônico e analytics de marketing.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-slate-800">3. Uso permitido</h2>
            <ul className="text-slate-600 text-sm leading-relaxed space-y-2 list-disc list-inside">
              <li>A plataforma é de uso exclusivo dos parceiros e clientes contratantes</li>
              <li>É proibido compartilhar credenciais de acesso com terceiros não autorizados</li>
              <li>É proibido utilizar a plataforma para fins ilícitos ou que violem direitos de terceiros</li>
              <li>É proibido realizar engenharia reversa, copiar ou reproduzir o sistema</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-slate-800">4. Responsabilidades do usuário</h2>
            <p className="text-slate-600 leading-relaxed text-sm">
              O usuário é responsável pela veracidade dos dados cadastrados, pela correta utilização das funcionalidades e pelo cumprimento das obrigações legais relacionadas ao tratamento de dados de pacientes e leads, incluindo as disposições da LGPD.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-slate-800">5. Disponibilidade do serviço</h2>
            <p className="text-slate-600 leading-relaxed text-sm">
              Nos esforçamos para manter a plataforma disponível 24 horas por dia, 7 dias por semana. No entanto, não garantimos disponibilidade ininterrupta, podendo ocorrer indisponibilidades por manutenção, atualizações ou falhas de infraestrutura.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-slate-800">6. Pagamento e cancelamento</h2>
            <p className="text-slate-600 leading-relaxed text-sm">
              As condições de pagamento são definidas no momento da contratação. O cancelamento pode ser solicitado a qualquer momento, com encerramento ao final do período vigente. Não há reembolso de períodos já pagos.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-slate-800">7. Limitação de responsabilidade</h2>
            <p className="text-slate-600 leading-relaxed text-sm">
              O MedDesk não se responsabiliza por decisões clínicas, financeiras ou administrativas tomadas com base nas informações exibidas na plataforma. O sistema é uma ferramenta de apoio à gestão e não substitui a responsabilidade do profissional de saúde.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-slate-800">8. Alterações nos termos</h2>
            <p className="text-slate-600 leading-relaxed text-sm">
              Estes termos podem ser atualizados a qualquer momento. Notificaremos os usuários sobre alterações relevantes. O uso continuado da plataforma após a publicação das alterações constitui aceite dos novos termos.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-bold text-slate-800">9. Contato</h2>
            <p className="text-slate-600 leading-relaxed text-sm">
              Dúvidas sobre estes termos podem ser enviadas para: <a href="mailto:contato@med4grow.com.br" className="text-teal-600 hover:underline">contato@med4grow.com.br</a>
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
