import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import { Building2, Users, ArrowRight, LogIn, Loader2, X, Eye, EyeOff, Search, MoreVertical, UserPlus, Wifi, WifiOff } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

interface Clinic {
  id: string;
  name: string;
  plan: string;
  logo_url: string | null;
  organization_id: string | null;
  whatsapp_status?: string | null;
}

interface OrgUser {
  id: string;
  user_id: string;
  full_name: string | null;
  email: string | null;
  role: string;
  created_at: string;
}

interface OrgAdminProps {
  onEnterClinic: () => void;
}

const ORG_ROLES = [
  { value: 'org_admin', label: 'Usuário' },
  { value: 'org_owner', label: 'Owner' },
];
const CLINIC_ROLES = ['gestor', 'medico', 'secretaria'];
const PLANS = ['free', 'pro', 'enterprise'];

export function OrgAdmin({ onEnterClinic }: OrgAdminProps) {
  const { profile, activeClinicId, setActiveClinicId, setActiveClinicName } = useAuth();
  const [clinics, setClinics] = useState<Clinic[]>([]);
  const [orgUsers, setOrgUsers] = useState<OrgUser[]>([]);
  const [loadingClinics, setLoadingClinics] = useState(true);
  const [activeSubTab, setActiveSubTab] = useState<"clinics" | "users">("clinics");
  const [clinicSearch, setClinicSearch] = useState('');
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  // Modal: nova clínica
  const [showClinicModal, setShowClinicModal] = useState(false);
  const [clinicForm, setClinicForm] = useState({ name: '', plan: 'free', ownerName: '', ownerEmail: '', ownerPassword: '' });
  const [clinicSaving, setClinicSaving] = useState(false);
  const [clinicError, setClinicError] = useState('');

  // Modal: novo usuário org
  const [showUserModal, setShowUserModal] = useState(false);
  const [userForm, setUserForm] = useState({ name: '', email: '', password: '', role: 'org_admin' });
  const [userSaving, setUserSaving] = useState(false);
  const [userError, setUserError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Modal: novo usuário clínica
  const [clinicUserTarget, setClinicUserTarget] = useState<{ id: string; name: string } | null>(null);
  const [clinicUserForm, setClinicUserForm] = useState({ name: '', email: '', password: '', role: 'gestor' });
  const [clinicUserSaving, setClinicUserSaving] = useState(false);
  const [clinicUserError, setClinicUserError] = useState('');
  const [showClinicUserPassword, setShowClinicUserPassword] = useState(false);

  const fetchClinics = useCallback(async () => {
    if (!profile?.organization_id) return;
    setLoadingClinics(true);
    const { data } = await supabase
      .from("clinics")
      .select("id, name, plan, logo_url, organization_id, whatsapp_instances(status)")
      .eq("organization_id", profile.organization_id)
      .order("name");
    const mapped = (data || []).map((c: any) => ({
      ...c,
      whatsapp_status: c.whatsapp_instances?.[0]?.status ?? null,
    }));
    setClinics(mapped);
    setLoadingClinics(false);
  }, [profile?.organization_id]);

  const fetchOrgUsers = useCallback(async () => {
    if (!profile?.organization_id) return;
    const { data } = await supabase
      .from("org_users")
      .select("*")
      .eq("organization_id", profile.organization_id)
      .order("full_name");
    setOrgUsers(data || []);
  }, [profile?.organization_id]);

  useEffect(() => {
    fetchClinics();
    fetchOrgUsers();
  }, [fetchClinics, fetchOrgUsers]);

  const handleCreateClinic = async () => {
    if (!clinicForm.name.trim() || !clinicForm.ownerName.trim() || !clinicForm.ownerEmail.trim() || !clinicForm.ownerPassword.trim()) {
      setClinicError('Preencha todos os campos.');
      return;
    }
    setClinicSaving(true);
    setClinicError('');
    const { error } = await supabase.rpc('create_clinic_with_owner', {
      p_clinic_name: clinicForm.name.trim(),
      p_plan: clinicForm.plan,
      p_organization_id: profile?.organization_id || null,
      p_owner_name: clinicForm.ownerName.trim(),
      p_owner_email: clinicForm.ownerEmail.trim(),
      p_owner_password: clinicForm.ownerPassword,
    });
    setClinicSaving(false);
    if (error) { setClinicError(error.message); return; }
    setShowClinicModal(false);
    setClinicForm({ name: '', plan: 'free', ownerName: '', ownerEmail: '', ownerPassword: '' });
    fetchClinics();
  };

  const handleAddUser = async () => {
    if (!userForm.name.trim() || !userForm.email.trim() || !userForm.password.trim()) {
      setUserError('Preencha todos os campos.');
      return;
    }
    setUserSaving(true);
    setUserError('');
    const { error } = await supabase.rpc('add_user_to_org', {
      p_org_id: profile?.organization_id,
      p_full_name: userForm.name.trim(),
      p_email: userForm.email.trim(),
      p_password: userForm.password,
      p_role: userForm.role,
    });
    setUserSaving(false);
    if (error) { setUserError(error.message); return; }
    setShowUserModal(false);
    setUserForm({ name: '', email: '', password: '', role: 'usuario' });
    fetchOrgUsers();
  };

  const handleAddClinicUser = async () => {
    if (!clinicUserTarget) return;
    if (!clinicUserForm.name.trim() || !clinicUserForm.email.trim() || !clinicUserForm.password.trim()) {
      setClinicUserError('Preencha todos os campos.');
      return;
    }
    setClinicUserSaving(true);
    setClinicUserError('');
    const { error } = await supabase.rpc('add_user_to_clinic', {
      p_clinic_id: clinicUserTarget.id,
      p_full_name: clinicUserForm.name.trim(),
      p_email: clinicUserForm.email.trim(),
      p_password: clinicUserForm.password,
      p_role: clinicUserForm.role,
    });
    setClinicUserSaving(false);
    if (error) { setClinicUserError(error.message); return; }
    setClinicUserTarget(null);
    setClinicUserForm({ name: '', email: '', password: '', role: 'gestor' });
  };

  return (
    <div className="space-y-8 h-full flex flex-col font-sans">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-slate-900">
            Gestão <span className="text-violet-600">Organizacional</span>
          </h2>
          <p className="text-slate-500 font-medium text-base">
            {profile?.organization_name} — visão geral das clínicas
          </p>
        </div>
        {activeClinicId && (
          <div className="flex items-center gap-3 px-4 py-2 bg-violet-50 border border-violet-200 rounded-xl">
            <div className="w-2 h-2 bg-violet-500 rounded-full animate-pulse" />
            <span className="text-xs font-bold text-violet-700">
              Visualizando: {clinics.find(c => c.id === activeClinicId)?.name || "Clínica"}
            </span>
            <button
              onClick={() => setActiveClinicId(null)}
              className="text-xs text-violet-500 hover:text-violet-700 font-bold transition-colors"
            >
              Sair
            </button>
          </div>
        )}
      </div>

      {/* Sub-tabs + action button */}
      <div className="flex items-center justify-between">
        <div className="flex bg-white p-1 rounded-xl border border-slate-200 gap-1 w-fit">
          {[
            { id: "clinics", label: "Clínicas", icon: Building2 },
            { id: "users", label: "Usuários", icon: Users },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveSubTab(t.id as any)}
              className={cn(
                "flex items-center gap-2 px-5 py-2 text-xs font-bold rounded-lg transition-all",
                activeSubTab === t.id
                  ? "bg-violet-600 text-white shadow-sm"
                  : "text-slate-500 hover:text-slate-800 hover:bg-slate-50"
              )}
            >
              <t.icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          ))}
        </div>

        {activeSubTab === "clinics" && (
          <button
            onClick={() => setShowClinicModal(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-bold transition-colors shadow-sm"
          >
            + Clínica
          </button>
        )}
        {activeSubTab === "users" && (
          <button
            onClick={() => setShowUserModal(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-xl text-xs font-bold transition-colors shadow-sm"
          >
            + Usuário
          </button>
        )}
      </div>

      {/* Search bar */}
      {activeSubTab === "clinics" && (
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            placeholder="Buscar clínica..."
            value={clinicSearch}
            onChange={e => setClinicSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-200 focus:border-violet-300 transition-all"
          />
        </div>
      )}

      {/* Content */}
      {activeSubTab === "clinics" && (
        <div className="flex-1">
          {loadingClinics ? (
            <div className="flex items-center justify-center h-48">
              <Loader2 className="w-8 h-8 text-violet-500 animate-spin" />
            </div>
          ) : clinics.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-center">
              <Building2 className="w-12 h-12 text-slate-200 mb-3" />
              <p className="text-slate-500 font-medium text-sm">Nenhuma clínica vinculada a esta organização.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
              {clinics.filter(c => c.name.toLowerCase().includes(clinicSearch.toLowerCase())).map((clinic) => (
                <motion.div
                  key={clinic.id}
                  whileHover={{ y: -1 }}
                  className={cn(
                    "p-3 rounded-xl border shadow-sm transition-all relative",
                    activeClinicId === clinic.id
                      ? "bg-violet-50 border-violet-300 shadow-violet-100"
                      : "bg-white border-slate-200 hover:border-violet-200 hover:shadow-md"
                  )}
                >
                  {/* Header */}
                  <div className="flex items-center justify-between mb-2">
                    <div className="w-7 h-7 rounded-lg bg-violet-100 flex items-center justify-center">
                      <Building2 className="w-3.5 h-3.5 text-violet-600" />
                    </div>
                    <div className="flex items-center gap-1">
                      <span className={cn(
                        "text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-full",
                        clinic.plan === 'enterprise' ? "bg-amber-100 text-amber-700"
                          : clinic.plan === 'pro' ? "bg-violet-100 text-violet-700"
                          : "bg-slate-100 text-slate-500"
                      )}>
                        {clinic.plan}
                      </span>
                      {/* Menu 3 pontos */}
                      <div className="relative">
                        <button
                          onClick={e => { e.stopPropagation(); setOpenMenuId(openMenuId === clinic.id ? null : clinic.id); }}
                          className="w-6 h-6 flex items-center justify-center rounded-lg hover:bg-slate-100 transition-colors"
                        >
                          <MoreVertical className="w-3.5 h-3.5 text-slate-400" />
                        </button>
                        {openMenuId === clinic.id && (
                          <div className="absolute right-0 top-7 z-50 bg-white border border-slate-200 rounded-xl shadow-lg py-1 min-w-[140px]">
                            <button
                              onClick={e => { e.stopPropagation(); setClinicUserTarget({ id: clinic.id, name: clinic.name }); setOpenMenuId(null); }}
                              className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
                            >
                              <UserPlus className="w-3.5 h-3.5 text-teal-600" />
                              Adicionar Usuário
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <p className="text-xs font-bold text-slate-900 mb-2 truncate">{clinic.name}</p>

                  {/* Status WhatsApp */}
                  <div className={cn(
                    "flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[10px] font-bold mb-1.5 border",
                    clinic.whatsapp_status === 'connected'
                      ? "bg-emerald-50 text-emerald-700 border-emerald-100"
                      : "bg-slate-50 text-slate-400 border-slate-100"
                  )}>
                    {clinic.whatsapp_status === 'connected'
                      ? <><Wifi className="w-3 h-3" /> Conectado</>
                      : <><WifiOff className="w-3 h-3" /> Desconectado</>
                    }
                  </div>

                  <button
                    onClick={() => {
                      if (activeClinicId === clinic.id) {
                        setActiveClinicId(null);
                        setActiveClinicName(null);
                      } else {
                        setActiveClinicId(clinic.id);
                        setActiveClinicName(clinic.name);
                        onEnterClinic();
                      }
                    }}
                    className={cn(
                      "w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-[10px] font-bold transition-all",
                      activeClinicId === clinic.id
                        ? "bg-violet-600 text-white hover:bg-violet-700"
                        : "bg-slate-50 text-slate-600 hover:bg-violet-50 hover:text-violet-700 border border-slate-200"
                    )}
                  >
                    {activeClinicId === clinic.id ? (
                      <><LogIn className="w-3 h-3" /> Visualizando</>
                    ) : (
                      <><ArrowRight className="w-3 h-3" /> Entrar</>
                    )}
                  </button>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeSubTab === "users" && (
        <div className="flex-1">
          {orgUsers.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-center">
              <Users className="w-12 h-12 text-slate-200 mb-3" />
              <p className="text-slate-500 font-medium text-sm">Nenhum usuário na organização.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {orgUsers.map((u) => (
                <div key={u.id} className="flex items-center gap-4 p-4 bg-white rounded-xl border border-slate-200">
                  <div className="w-9 h-9 rounded-lg bg-violet-100 flex items-center justify-center text-violet-700 font-bold text-xs shrink-0">
                    {(u.full_name || u.email || '?').slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-slate-900 truncate">{u.full_name || '—'}</p>
                    <p className="text-xs text-slate-500 truncate">{u.email}</p>
                  </div>
                  <span className="text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 shrink-0">
                    {u.role === 'org_owner' || u.role === 'owner' ? 'Owner' : 'Usuário'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Modal: Nova Clínica */}
      <AnimatePresence>
        {showClinicModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md"
            >
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-base font-black text-slate-900">Nova Clínica</h3>
                <button onClick={() => { setShowClinicModal(false); setClinicError(''); }} className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors">
                  <X className="w-4 h-4 text-slate-500" />
                </button>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block mb-1">Nome da Clínica</label>
                  <input value={clinicForm.name} onChange={e => setClinicForm(f => ({ ...f, name: e.target.value }))}
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-teal-500" placeholder="Ex: Clínica Central" />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block mb-1">Plano</label>
                  <div className="flex gap-2">
                    {PLANS.map(p => (
                      <button key={p} onClick={() => setClinicForm(f => ({ ...f, plan: p }))}
                        className={cn("flex-1 py-2 rounded-xl text-xs font-bold capitalize transition-all border",
                          clinicForm.plan === p ? "bg-teal-600 text-white border-teal-600" : "bg-slate-50 text-slate-600 border-slate-200 hover:border-teal-300")}>
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="pt-1 border-t border-slate-100">
                  <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Gestor Responsável</p>
                  <div className="space-y-2">
                    <input value={clinicForm.ownerName} onChange={e => setClinicForm(f => ({ ...f, ownerName: e.target.value }))}
                      className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-teal-500" placeholder="Nome completo" />
                    <input value={clinicForm.ownerEmail} onChange={e => setClinicForm(f => ({ ...f, ownerEmail: e.target.value }))}
                      className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-teal-500" placeholder="Email" type="email" />
                    <div className="relative">
                      <input value={clinicForm.ownerPassword} onChange={e => setClinicForm(f => ({ ...f, ownerPassword: e.target.value }))}
                        type={showPassword ? 'text' : 'password'}
                        className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-teal-500 pr-10" placeholder="Senha" />
                      <button type="button" onClick={() => setShowPassword(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                </div>
                {clinicError && <p className="text-xs text-red-500 font-bold">{clinicError}</p>}
                <button onClick={handleCreateClinic} disabled={clinicSaving}
                  className="w-full py-3 bg-teal-600 hover:bg-teal-700 disabled:bg-slate-100 disabled:text-slate-400 text-white rounded-xl font-black text-sm transition-all flex items-center justify-center gap-2">
                  {clinicSaving ? <><Loader2 className="w-4 h-4 animate-spin" /> Criando...</> : 'Criar Clínica'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal: Novo Usuário Org */}
      <AnimatePresence>
        {showUserModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm"
            >
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-base font-black text-slate-900">Novo Usuário</h3>
                <button onClick={() => { setShowUserModal(false); setUserError(''); }} className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors">
                  <X className="w-4 h-4 text-slate-500" />
                </button>
              </div>

              <div className="space-y-3">
                <input value={userForm.name} onChange={e => setUserForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-violet-500" placeholder="Nome completo" />
                <input value={userForm.email} onChange={e => setUserForm(f => ({ ...f, email: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-violet-500" placeholder="Email" type="email" />
                <div className="relative">
                  <input value={userForm.password} onChange={e => setUserForm(f => ({ ...f, password: e.target.value }))}
                    type={showPassword ? 'text' : 'password'}
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-violet-500 pr-10" placeholder="Senha" />
                  <button type="button" onClick={() => setShowPassword(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block mb-1.5">Papel</label>
                  <div className="flex flex-wrap gap-2">
                    {ORG_ROLES.map(r => (
                      <button key={r.value} onClick={() => setUserForm(f => ({ ...f, role: r.value }))}
                        className={cn("px-3 py-1.5 rounded-lg text-xs font-bold transition-all border",
                          userForm.role === r.value ? "bg-violet-600 text-white border-violet-600" : "bg-slate-50 text-slate-600 border-slate-200 hover:border-violet-300")}>
                        {r.label}
                      </button>
                    ))}
                  </div>
                </div>
                {userError && <p className="text-xs text-red-500 font-bold">{userError}</p>}
                <button onClick={handleAddUser} disabled={userSaving}
                  className="w-full py-3 bg-violet-600 hover:bg-violet-700 disabled:bg-slate-100 disabled:text-slate-400 text-white rounded-xl font-black text-sm transition-all flex items-center justify-center gap-2">
                  {userSaving ? <><Loader2 className="w-4 h-4 animate-spin" /> Adicionando...</> : 'Adicionar Usuário'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal: Usuário da Clínica */}
      <AnimatePresence>
        {clinicUserTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm"
            >
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-base font-black text-slate-900">Novo Usuário</h3>
                <button onClick={() => { setClinicUserTarget(null); setClinicUserError(''); }} className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors">
                  <X className="w-4 h-4 text-slate-500" />
                </button>
              </div>
              <p className="text-xs text-slate-400 font-medium mb-4">{clinicUserTarget.name}</p>

              <div className="space-y-3">
                <input value={clinicUserForm.name} onChange={e => setClinicUserForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-teal-500" placeholder="Nome completo" />
                <input value={clinicUserForm.email} onChange={e => setClinicUserForm(f => ({ ...f, email: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-teal-500" placeholder="Email" type="email" />
                <div className="relative">
                  <input value={clinicUserForm.password} onChange={e => setClinicUserForm(f => ({ ...f, password: e.target.value }))}
                    type={showClinicUserPassword ? 'text' : 'password'}
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-teal-500 pr-10" placeholder="Senha" />
                  <button type="button" onClick={() => setShowClinicUserPassword(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                    {showClinicUserPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block mb-1.5">Papel</label>
                  <div className="flex gap-2">
                    {CLINIC_ROLES.map(r => (
                      <button key={r} onClick={() => setClinicUserForm(f => ({ ...f, role: r }))}
                        className={cn("flex-1 py-2 rounded-xl text-xs font-bold capitalize transition-all border",
                          clinicUserForm.role === r ? "bg-teal-600 text-white border-teal-600" : "bg-slate-50 text-slate-600 border-slate-200 hover:border-teal-300")}>
                        {r === 'medico' ? 'Médico' : r === 'secretaria' ? 'Secretária' : 'Gestor'}
                      </button>
                    ))}
                  </div>
                </div>
                {clinicUserError && <p className="text-xs text-red-500 font-bold">{clinicUserError}</p>}
                <button onClick={handleAddClinicUser} disabled={clinicUserSaving}
                  className="w-full py-3 bg-teal-600 hover:bg-teal-700 disabled:bg-slate-100 disabled:text-slate-400 text-white rounded-xl font-black text-sm transition-all flex items-center justify-center gap-2">
                  {clinicUserSaving ? <><Loader2 className="w-4 h-4 animate-spin" /> Adicionando...</> : 'Adicionar Usuário'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
