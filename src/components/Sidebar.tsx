import React from "react";
import {
  LayoutDashboard,
  Bot,
  CircleDollarSign,
  CalendarDays,
  ClipboardList,
  Users,
  Settings,
  Stethoscope,
  Activity,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/src/lib/utils";
import { motion } from "framer-motion";
import { useAuth, UserRole } from "../contexts/AuthContext";
import { ChevronDown } from "lucide-react";

// Logo removed for professional medicine icon

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

export function Sidebar({ activeTab, setActiveTab }: SidebarProps) {
  const { clinicName, userRole, setClinicName, setUserRole } = useAuth();

  const allNavItems = [
    { id: "dashboard", label: "Visão Geral", icon: LayoutDashboard, color: "text-emerald-600", roles: ['gestor', 'medico', 'secretaria'] },
    { id: "ai-secretary", label: "Assistente IA", icon: Bot, color: "text-teal-600", roles: ['gestor', 'secretaria'] },
    { id: "finance", label: "Financeiro", icon: CircleDollarSign, color: "text-emerald-700", roles: ['gestor'] },
    { id: "appointments", label: "Agendamentos", icon: CalendarDays, color: "text-teal-700", roles: ['gestor', 'medico', 'secretaria'] },
    { id: "medical-records", label: "Prontuários", icon: ClipboardList, color: "text-slate-700", roles: ['gestor', 'medico', 'secretaria'] },
    { id: "doctors", label: "Corpo Clínico", icon: Users, color: "text-emerald-800", roles: ['gestor'] },
    { id: "settings", label: "Configurações", icon: Settings, color: "text-slate-500", roles: ['gestor'] },
  ];

  const navItems = allNavItems.filter(item => item.roles.includes(userRole));

  return (
    <div className="w-72 bg-white flex flex-col h-full border-r border-slate-200 shadow-sm z-10 transition-all duration-200">
      <div className="p-8 pb-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-teal-600 flex items-center justify-center text-white shadow-lg shadow-teal-100">
            <Stethoscope className="w-7 h-7" />
          </div>
          <div className="flex flex-col">
            <span className="text-xl font-black text-slate-900 tracking-tight">{clinicName.split(' ')[0]}</span>
            <span className="text-[10px] font-bold text-teal-600 uppercase tracking-widest -mt-1">{clinicName.split(' ')[1] || 'Padrão'}</span>
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

      <div className="p-4 mt-auto border-t border-slate-100 bg-slate-50/50 space-y-3">
        {/* SaaS Quick Controls */}
        <div className="flex flex-col gap-2">
          <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider px-2">Demo SaaS Controls</label>
          <select 
            value={clinicName}
            onChange={(e) => setClinicName(e.target.value)}
            className="w-full bg-white border border-slate-200 text-xs px-2 py-1.5 rounded-lg font-medium text-slate-600 outline-none focus:ring-1 focus:ring-teal-500 transition-all"
          >
            <option value="Clínica Central">Clínica Central</option>
            <option value="Hospital Arca">Hospital Arca</option>
            <option value="Odonto Prime">Odonto Prime</option>
          </select>
          
          <div className="grid grid-cols-3 gap-1">
            {(['gestor', 'medico', 'secretaria'] as UserRole[]).map((r) => (
              <button
                key={r}
                onClick={() => {
                  setUserRole(r);
                  // Reset tab if current role doesn't have access
                  const hasAccess = allNavItems.find(i => i.id === activeTab)?.roles.includes(r);
                  if (!hasAccess) setActiveTab('dashboard');
                }}
                className={cn(
                  "text-[9px] py-1 px-1 rounded-md font-bold uppercase transition-all",
                  userRole === r 
                    ? "bg-teal-600 text-white shadow-sm" 
                    : "bg-white text-slate-400 border border-slate-200 hover:bg-slate-50"
                )}
              >
                {r.slice(0, 3)}
              </button>
            ))}
          </div>
        </div>

        <div className="p-3 bg-white rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-teal-800 flex items-center justify-center text-white font-bold text-xs shrink-0">
              {userRole === 'medico' ? 'DR' : userRole === 'gestor' ? 'AD' : 'SC'}
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-xs font-bold text-slate-900 truncate">
                {userRole.charAt(0).toUpperCase() + userRole.slice(1)}
              </span>
              <span className="text-[9px] font-medium text-teal-600 flex items-center gap-1">
                <ShieldCheck className="w-2.5 h-2.5" />
                Sessão Ativa
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
