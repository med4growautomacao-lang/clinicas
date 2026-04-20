import React, { useState, useEffect } from 'react';
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
import { motion, AnimatePresence } from 'framer-motion';

import { AuthProvider, useAuth } from './contexts/AuthContext';
import { Login } from './components/Login';
import { ConnectPage } from './components/ConnectPage';
import { RedirectPage } from './components/RedirectPage';
import { LandingPage } from './components/LandingPage';
import { PrivacyPolicy } from './components/PrivacyPolicy';
import { TermsOfUse } from './components/TermsOfUse';
import { Loader2 } from 'lucide-react';

function AppContent() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const { user, loading, userRole, activeClinicId } = useAuth();

  // Redireciona org_admin sem clínica ativa para a aba Organização
  useEffect(() => {
    if (!loading && userRole === 'org_admin' && !activeClinicId) {
      setActiveTab('org-admin');
    }
  }, [loading, userRole, activeClinicId]);

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

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return <Dashboard />;
      case 'ai-secretary':
        return <AISecretary />;
      case 'finance':
        return <Finance />;
      case 'appointments':
        return <Appointments />;
      case 'medical-records':
        return <MedicalRecords />;
      case 'doctors':
        return <DoctorsManagement />;
      case 'settings':
        return <Settings />;
      case 'marketing':
        return <MarketingAnalytics />;
      case 'super-admin':
        return <SuperAdmin />;
      case 'org-admin':
        return <OrgAdmin onEnterClinic={() => setActiveTab('dashboard')} />;
      default:
        return (
          <div className="flex items-center justify-center h-full text-slate-500 font-medium italic">
            Módulo em desenvolvimento...
          </div>
        );
    }
  };

  return (
    <div className="flex h-screen bg-slate-50 font-sans text-slate-900 overflow-hidden">
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />

      <main className="flex-1 overflow-y-auto relative">
        {/* Professional Background Gradient */}
        <div className="absolute top-0 right-0 w-full h-full bg-[radial-gradient(circle_at_top_right,rgba(13,148,136,0.03),transparent_50%)] pointer-events-none" />

        <div className="max-w-7xl mx-auto h-full p-8 relative z-10">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3, type: "spring", stiffness: 100 }}
              className="h-full"
            >
              {renderContent()}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
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
      <AppContent />
    </AuthProvider>
  );
}
