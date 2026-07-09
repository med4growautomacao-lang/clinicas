import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Sidebar } from './components/Sidebar';
import { Dashboard } from './components/Dashboard';
import { AISecretary } from './components/AISecretary';
import { Finance } from './components/Finance';
import { Appointments } from './components/Appointments';
import { MedicalRecords } from './components/MedicalRecords';
import { DoctorsManagement } from './components/DoctorsManagement';
import { Settings } from './components/Settings';
import SuperAdmin from './components/SuperAdmin';
import { MarketingAnalytics } from './components/MarketingAnalytics';
import { OrgAdmin } from './components/OrgAdmin';
import { UserProfile } from './components/UserProfile';
import { TeamManagement } from './components/TeamManagement';
import { Production } from './components/production/Production';
import { AIAssistant } from './components/AIAssistant';

import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ToastProvider } from './components/ui/toast';
import { Login } from './components/Login';
import { ConnectPage } from './components/ConnectPage';
import { WhatsAppStatusBanner } from './components/WhatsAppStatusBanner';
import { RedirectPage } from './components/RedirectPage';
import { LandingPage } from './components/LandingPage';
import { PrivacyPolicy } from './components/PrivacyPolicy';
import { TermsOfUse } from './components/TermsOfUse';
import { Loader2 } from 'lucide-react';

function AppContent() {
  const [activeTab, setActiveTab] = useState(() => localStorage.getItem('activeTab') || 'dashboard');
  // Abas já visitadas — componentes ficam montados em memória após a primeira visita
  const [visitedTabs, setVisitedTabs] = useState<Set<string>>(() => {
    const saved = localStorage.getItem('activeTab');
    return new Set(saved ? ['dashboard', saved] : ['dashboard']);
  });
  const { user, loading, userRole, activeClinicId } = useAuth();
  const prevClinicRef = useRef(activeClinicId);

  // Reseta abas visitadas ao trocar de clínica
  useEffect(() => {
    if (prevClinicRef.current && prevClinicRef.current !== activeClinicId) {
      setVisitedTabs(new Set(['dashboard']));
      setActiveTab('dashboard');
      localStorage.setItem('activeTab', 'dashboard');
    }
    prevClinicRef.current = activeClinicId;
  }, [activeClinicId]);

  const handleSetActiveTab = useCallback((tab: string) => {
    setActiveTab(tab);
    setVisitedTabs(prev => new Set([...prev, tab]));
    localStorage.setItem('activeTab', tab);
  }, []);

  // Redireciona usuários org sem clínica ativa para a aba Organização
  useEffect(() => {
    const isOrgUser = ['org_owner', 'org_admin', 'org_team'].includes(userRole);
    if (!loading && isOrgUser && !activeClinicId) {
      handleSetActiveTab('org-admin');
    }
  }, [loading, userRole, activeClinicId, handleSetActiveTab]);

  // Permite navegação cross-component via evento global
  // Ex: from Finance: window.dispatchEvent(new CustomEvent('app-navigate', { detail: { tab: 'ai-secretary' } }))
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.tab) handleSetActiveTab(detail.tab);
    };
    window.addEventListener('app-navigate', handler);
    return () => window.removeEventListener('app-navigate', handler);
  }, [handleSetActiveTab]);

  // Redireciona se o role atual não tem acesso à aba ativa
  useEffect(() => {
    if (loading) return;
    const ROLE_ALLOWED_TABS: Record<string, string[]> = {
      medico: ['appointments', 'medical-records', 'profile'],
      vendedor: ['dashboard', 'marketing', 'ai-secretary', 'finance', 'settings', 'profile'],
    };
    const allowed = ROLE_ALLOWED_TABS[userRole];
    if (allowed && !allowed.includes(activeTab)) {
      handleSetActiveTab(allowed[0]);
    }
  }, [loading, userRole, activeTab, handleSetActiveTab]);

  if (loading) {
    return (
      <div className="h-screen bg-slate-50 flex flex-col items-center justify-center gap-4">
        <Loader2 className="w-10 h-10 text-teal-600 animate-spin" />
        <p className="text-slate-500 font-bold uppercase tracking-widest text-[10px]">Carregando Ambiente...</p>
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  const tabs = [
    { id: 'dashboard',       el: <Dashboard /> },
    { id: 'ai-secretary',    el: <AISecretary /> },
    { id: 'finance',         el: <Finance /> },
    { id: 'appointments',    el: <Appointments isActive={activeTab === 'appointments'} /> },
    { id: 'medical-records', el: <MedicalRecords /> },
    { id: 'doctors',         el: <DoctorsManagement /> },
    { id: 'settings',        el: <Settings /> },
    { id: 'marketing',       el: <MarketingAnalytics /> },
    { id: 'super-admin',     el: <SuperAdmin /> },
    { id: 'org-admin',       el: <OrgAdmin onEnterClinic={() => handleSetActiveTab('dashboard')} /> },
    { id: 'profile',         el: <UserProfile /> },
    { id: 'team',            el: <TeamManagement /> },
    { id: 'production',      el: <Production /> },
  ];

  return (
    <div className="flex h-screen bg-slate-50 font-sans text-slate-900 overflow-hidden">
      <Sidebar activeTab={activeTab} setActiveTab={handleSetActiveTab} />

      <main className="flex-1 min-w-0 overflow-y-auto relative">
        <div className="absolute top-0 right-0 w-full h-full bg-[radial-gradient(circle_at_top_right,rgba(13,148,136,0.03),transparent_50%)] pointer-events-none" />

        <WhatsAppStatusBanner
          userRole={userRole}
          onReconnect={() => {
            localStorage.setItem('settingsTab', 'integrations');
            localStorage.setItem('settingsIntTab', 'whatsapp');
            handleSetActiveTab('settings');
            window.dispatchEvent(new CustomEvent('settings-deeplink', {
              detail: { tab: 'integrations', intTab: 'whatsapp' },
            }));
          }}
        />

        <div className="w-full h-full p-8 relative z-10">
          {tabs.map(({ id, el }) =>
            visitedTabs.has(id) ? (
              <div key={id} className="h-full" style={{ display: activeTab === id ? 'block' : 'none' }}>
                {el}
              </div>
            ) : null
          )}
        </div>
      </main>

      <AIAssistant />
    </div>
  );
}

export default function App() {
  const path = window.location.pathname;
  if (path === '/connect') return <ConnectPage />;
  if (path === '/r') return <RedirectPage />;
  if (path === '/' || path === '/landing') return <LandingPage />;
  if (path === '/politicas') return <PrivacyPolicy />;
  if (path === '/termos') return <TermsOfUse />;
  return (
    <AuthProvider>
      <ToastProvider>
        <AppContent />
      </ToastProvider>
    </AuthProvider>
  );
}
