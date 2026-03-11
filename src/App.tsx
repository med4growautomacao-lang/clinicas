import React, { useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { Dashboard } from './components/Dashboard';
import { AISecretary } from './components/AISecretary';
import { Finance } from './components/Finance';
import { Appointments } from './components/Appointments';
import { MedicalRecords } from './components/MedicalRecords';
import { DoctorsManagement } from './components/DoctorsManagement';
import { Settings } from './components/Settings';
import { motion, AnimatePresence } from 'framer-motion';

import { AuthProvider, useAuth } from './contexts/AuthContext';

function AppContent() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const { clinicName, userRole } = useAuth();

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
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
