import React, { useState, useEffect, useRef } from "react";
import {
  LayoutDashboard,
  Bot,
  CircleDollarSign,
  CalendarDays,
  ClipboardList,
  Users,
  Settings,
  Stethoscope,
  Building2,
  Activity,
  ShieldCheck,
  LogOut,
  BarChart3,
  ChevronDown,
  ChevronsUpDown,
} from "lucide-react";
import { cn } from "@/src/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth, UserRole } from "../contexts/AuthContext";
import { supabase } from "../lib/supabase";
import { matchesSearch } from "../lib/search";

// Logo removed for professional medicine icon

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

export function Sidebar({ activeTab, setActiveTab }: SidebarProps) {
  const { clinicName, userRole, signOut, profile, activeClinicId, setActiveClinicId, activeClinicName, setActiveClinicName, activeClinicCategory } = useAuth();
  const [clinics, setClinics] = useState<{ id: string; name: string }[]>([]);
  const [showClinicPicker, setShowClinicPicker] = useState(false);
  const [clinicPickerSearch, setClinicPickerSearch] = useState('');
  const pickerRef = useRef<HTMLDivElement>(null);

  // Carrega clínicas da org para o switcher
  // org_owner e org_admin veem todas; org_team e gestor_trafego veem apenas as atribuídas
  useEffect(() => {
    if (!['org_owner', 'org_admin', 'org_team'].includes(userRole) || !profile?.organization_id) return;
    const canSeeAll = userRole === 'org_owner' || userRole === 'org_admin';
    if (canSeeAll) {
      supabase
        .from('clinics')
        .select('id, name')
        .eq('organization_id', profile.organization_id)
        .order('name')
        .then(({ data }) => setClinics(data || []));
    } else if (profile.org_user_id) {
      // Buscar apenas clínicas atribuídas via org_clinic_assignments
      supabase
        .from('org_clinic_assignments')
        .select('clinic_id, clinics(id, name)')
        .eq('org_user_id', profile.org_user_id)
        .then(({ data }) => {
          const mapped = (data || [])
            .map((d: any) => d.clinics)
            .filter(Boolean)
            .sort((a: any, b: any) => a.name.localeCompare(b.name));
          setClinics(mapped);
        });
    }
  }, [userRole, profile?.organization_id, profile?.org_user_id]);

  // Fecha picker ao clicar fora
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node))
        setShowClinicPicker(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Org-admin com clínica ativa navega como gestor
  const isOrgUser = ['org_owner', 'org_admin', 'org_team'].includes(userRole);
  const effectiveRole = isOrgUser && activeClinicId ? 'gestor' : userRole;

  const isOutro = activeClinicCategory === 'outro';

  const allNavItems = [
    { id: "dashboard", label: "Visão Geral", icon: LayoutDashboard, color: "text-emerald-600", roles: ['gestor', 'medico_gestor', 'secretaria', 'vendedor'] },
    { id: "marketing", label: "Marketing", icon: BarChart3, color: "text-cyan-600", roles: ['gestor', 'medico_gestor', 'vendedor'] },
    { id: "ai-secretary", label: "Comercial", icon: Bot, color: "text-teal-600", roles: ['gestor', 'medico_gestor', 'secretaria', 'vendedor'] },
    { id: "appointments", label: "Agendamentos", icon: CalendarDays, color: "text-teal-700", roles: ['gestor', 'medico', 'medico_gestor', 'secretaria'], clinicOnly: true },
    { id: "medical-records", label: "Prontuários", icon: ClipboardList, color: "text-slate-700", roles: ['medico', 'medico_gestor'], clinicOnly: true },
    { id: "doctors", label: "Corpo Clínico", icon: Users, color: "text-emerald-800", roles: ['gestor', 'medico_gestor'], clinicOnly: true },
    { id: "team", label: "Equipe", icon: Users, color: "text-indigo-600", roles: ['gestor', 'medico_gestor'] },
    { id: "finance", label: "Financeiro", icon: CircleDollarSign, color: "text-emerald-700", roles: ['gestor', 'medico_gestor', 'secretaria', 'vendedor'] },
    { id: "settings", label: "Configurações", icon: Settings, color: "text-slate-500", roles: ['gestor', 'medico_gestor', 'secretaria', 'vendedor'] },
    { id: "super-admin", label: "Super Admin", icon: ShieldCheck, color: "text-orange-600", roles: ['super-admin'] },
    { id: "org-admin", label: "Organização", icon: Activity, color: "text-violet-600", roles: ['org_owner', 'org_admin', 'org_team'] },
  ];

  const navItems = allNavItems
    .filter(item => item.roles.includes(effectiveRole) || (item.id === 'org-admin' && isOrgUser))
    .filter(item => !(isOutro && item.clinicOnly));

  return (
    <div className="w-72 bg-white flex flex-col h-full border-r border-slate-200 shadow-sm z-10 transition-all duration-200">
      <div className="p-8 pb-4">
        <div className="flex items-center gap-3">
          <div className={cn("w-12 h-12 rounded-xl flex items-center justify-center text-white shadow-lg", isOutro ? "bg-slate-700 shadow-slate-200" : "bg-teal-600 shadow-teal-100")}>
            {isOutro ? <Building2 className="w-7 h-7" /> : <Stethoscope className="w-7 h-7" />}
          </div>
          <div className="flex flex-col">
            <span className="text-xl font-black text-slate-900 tracking-tight">{isOutro ? 'WakeDesk' : 'MedDesk'}</span>
            <span className="text-[10px] font-bold text-teal-600 uppercase tracking-widest -mt-1">{isOutro ? 'WAKEMARKETING' : 'MED4GROW'}</span>
          </div>
        </div>
      </div>

      <nav className="flex-1 px-3 space-y-1.5 mt-1 overflow-y-auto custom-scrollbar">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <motion.button
              key={item.id}
              whileHover={{ scale: 1.02, x: 4 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setActiveTab(item.id)}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200",
                isActive
                  ? "bg-teal-50 text-teal-900 border border-teal-100/50 shadow-sm"
                  : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
              )}
            >
              <div className={cn(
                "w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-300 shrink-0",
                isActive ? "bg-white shadow-sm" : "bg-slate-50"
              )}>
                <Icon className={cn("w-5 h-5", isActive ? item.color : "text-slate-300")} />
              </div>
              <span className="truncate">{item.label}</span>
            </motion.button>
          );
        })}
      </nav>

      {/* Banner de clínica ativa para org-admin */}
      {isOrgUser && activeClinicId && (
        <div className="mx-3 mb-2 p-3 bg-violet-50 border border-violet-200 rounded-xl">
          <p className="text-[9px] font-bold text-violet-500 uppercase tracking-widest mb-1">Visualizando clínica</p>

          {/* Switcher de clínica */}
          <div ref={pickerRef} className="relative">
            <button
              onClick={() => setShowClinicPicker(v => !v)}
              className="w-full flex items-center justify-between gap-1 text-xs font-bold text-violet-900 hover:bg-violet-100 rounded-lg px-1.5 py-1 transition-all"
            >
              <span className="truncate">{activeClinicName}</span>
              <ChevronsUpDown className="w-3.5 h-3.5 text-violet-400 shrink-0" />
            </button>

            <AnimatePresence>
              {showClinicPicker && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.12 }}
                  className="absolute bottom-full left-0 right-0 mb-1 bg-white border border-violet-200 rounded-xl shadow-lg z-50"
                >
                  <div className="p-2 border-b border-slate-100">
                    <input
                      autoFocus
                      type="text"
                      placeholder="Buscar clínica..."
                      value={clinicPickerSearch}
                      onChange={e => setClinicPickerSearch(e.target.value)}
                      className="w-full px-2 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-200"
                    />
                  </div>
                  <div className="py-1 max-h-44 overflow-y-auto custom-scrollbar">
                  {clinics.filter(c => matchesSearch(clinicPickerSearch, { name: c.name })).map(c => (
                    <button
                      key={c.id}
                      onClick={() => {
                        setActiveClinicId(c.id);
                        setActiveClinicName(c.name);
                        setShowClinicPicker(false);
                        setClinicPickerSearch('');
                      }}
                      className={cn(
                        "w-full text-left px-3 py-2 text-xs font-semibold transition-colors truncate",
                        c.id === activeClinicId
                          ? "bg-violet-50 text-violet-700"
                          : "text-slate-700 hover:bg-slate-50"
                      )}
                    >
                      {c.name}
                    </button>
                  ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <button
            onClick={() => { setActiveClinicId(null); setActiveClinicName(null); setActiveTab('org-admin'); }}
            className="mt-2 w-full text-[10px] font-bold text-violet-600 hover:text-violet-800 hover:bg-violet-100 rounded-lg py-1 transition-all"
          >
            ← Voltar para Organização
          </button>
        </div>
      )}

      <div className="p-4 mt-auto border-t border-slate-100 bg-slate-50/50 space-y-3">
        <div className="p-3 bg-white rounded-xl border border-slate-200 shadow-sm group">
          <div className="flex items-center justify-between">
            <button
              onClick={() => setActiveTab('profile')}
              className="flex items-center gap-2.5 min-w-0 flex-1 text-left hover:opacity-80 transition-opacity"
              title="Ver meu perfil"
            >
              <div className="w-8 h-8 rounded-lg bg-teal-800 flex items-center justify-center text-white font-bold text-xs shrink-0">
                {profile?.full_name?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || (userRole === 'medico' ? 'DR' : 'AD')}
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-xs font-bold text-slate-900 truncate">
                  {profile?.full_name || userRole.charAt(0).toUpperCase() + userRole.slice(1)}
                </span>
                <span className="text-[9px] font-medium text-teal-600 flex items-center gap-1">
                  <ShieldCheck className="w-2.5 h-2.5" />
                  Ver Perfil
                </span>
              </div>
            </button>
            <button
              onClick={() => signOut()}
              className="p-1.5 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-all"
              title="Sair do sistema"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
