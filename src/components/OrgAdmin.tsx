import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import { Building2, Users, ArrowRight, LogIn, Loader2, X, Eye, EyeOff, Search, MoreVertical, UserPlus, Wifi, WifiOff, Settings, UserCheck, TrendingUp, UserCog, ChevronDown, Check, Trash2, MessageCircle, Globe, FileText, BarChart3, Search as SearchIcon, LayoutGrid, List as ListIcon, Stethoscope, Briefcase, AlertCircle, Plus, Building, Activity, ListTodo } from "lucide-react";
import { OrgTasks } from "./OrgTasks";
import { OrgMetrics } from "./OrgMetrics";
import { ClinicInfoModal } from "./ClinicInfoModal";
import { cn } from "@/src/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { matchesSearch } from "../lib/search";
import GoogleLogo from "../assets/logos/Logo Googleads.png";
import MetaLogo from "../assets/logos/Logo Metaads.png";
import WhatsappLogo from "../assets/logos/Logo Whatsapp.png";

type ChannelStatus = 'none' | 'inactive' | 'active';

interface Clinic {
  id: string;
  name: string;
  plan: string;
  logo_url: string | null;
  organization_id: string | null;
  whatsapp_status?: string | null;
  category?: string | null;
  features?: { feature_followup?: boolean; feature_ia?: boolean } | null;
  meta_status?: ChannelStatus;
  google_status?: ChannelStatus;
  site_status?: ChannelStatus;
  forms_status?: ChannelStatus;
  is_active?: boolean | null;
}

interface ClinicUser {
  id: string;
  full_name: string | null;
  email: string | null;
  role: string;
  created_at: string;
  is_pending?: boolean;
}

interface ClinicMember {
  id: string;
  clinic_id: string;
  org_user_id: string;
  function: string;
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
  { value: 'org_owner', label: 'Owner' },
  { value: 'org_admin', label: 'Admin' },
  { value: 'org_team', label: 'Team' },
];
const CLINIC_ROLES = ['gestor', 'medico_gestor', 'medico', 'secretaria', 'vendedor'];
const PLANS = ['free', 'pro', 'enterprise'];
const CLINIC_CATEGORIES = [
  { value: 'clinica', label: 'Clínica' },
  { value: 'outro', label: 'Outro' },
];

const CLINIC_FUNCTIONS: { value: string; label: string; Icon: React.ElementType; color: string }[] = [
  { value: 'gestor_trafego', label: 'Gestor de Tráfego', Icon: TrendingUp, color: 'text-teal-500' },
  { value: 'gestor_automacao', label: 'Gestor de Automação', Icon: Settings, color: 'text-amber-500' },
  { value: 'admin_responsavel', label: 'Admin Responsável', Icon: UserCog, color: 'text-violet-500' },
];

function roleLabel(role: string) {
  if (role === 'org_owner') return 'Owner';
  if (role === 'org_admin') return 'Admin';
  if (role === 'org_team') return 'Team';
  return role;
}

function roleBadgeClass(role: string) {
  if (role === 'org_owner') return 'bg-amber-100 text-amber-700';
  if (role === 'org_admin') return 'bg-violet-100 text-violet-700';
  return 'bg-blue-100 text-blue-700';
}

export function OrgAdmin({ onEnterClinic }: OrgAdminProps) {
  const { profile, userRole, activeClinicId, setActiveClinicId, setActiveClinicName } = useAuth();
  const [clinics, setClinics] = useState<Clinic[]>([]);
  const [clinicMembers, setClinicMembers] = useState<ClinicMember[]>([]);
  const [orgUsers, setOrgUsers] = useState<OrgUser[]>([]);
  const [loadingClinics, setLoadingClinics] = useState(true);
  const [activeSubTab, setActiveSubTab] = useState<"clinics" | "metrics" | "users" | "settings" | "tasks">(() => (localStorage.getItem('orgAdminTab') as any) || "clinics");
  const [orgSettings, setOrgSettings] = useState<{ google_ad_mcc_id: string; google_ad_mcc_token: string }>({ google_ad_mcc_id: '', google_ad_mcc_token: '' });
  const [orgSettingsSaving, setOrgSettingsSaving] = useState(false);
  const [orgSettingsSaved, setOrgSettingsSaved] = useState(false);
  const [tokenFocused, setTokenFocused] = useState(false);
  const [clinicSearch, setClinicSearch] = useState('');
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [menuDropUp, setMenuDropUp] = useState(false);

  // Permissions
  const canManageClinics = userRole === 'org_owner' || userRole === 'org_admin';
  const canManageOrgUsers = userRole === 'org_owner' || userRole === 'org_admin';
  const canManageSettings = userRole === 'org_owner' || userRole === 'org_admin';
  const canManageTasks = userRole === 'org_owner' || userRole === 'org_admin';
  const canAddClinicUsers = userRole === 'org_owner' || userRole === 'org_admin' || userRole === 'org_team';
  const canSetResponsaveis = userRole === 'org_owner' || userRole === 'org_admin';

  // Modal: nova clínica
  const [showClinicModal, setShowClinicModal] = useState(false);
  const [clinicForm, setClinicForm] = useState<{ name: string; plan: string; category: string; ownerName: string; ownerEmail: string; ownerPassword: string; feature_followup: boolean; feature_ia: boolean; meta_status: ChannelStatus; google_status: ChannelStatus; site_status: ChannelStatus; forms_status: ChannelStatus; trafficManagerId: string }>({ name: '', plan: 'free', category: '', ownerName: '', ownerEmail: '', ownerPassword: '', feature_followup: true, feature_ia: true, meta_status: 'none', google_status: 'none', site_status: 'none', forms_status: 'none', trafficManagerId: '' });
  const [categoryFilter, setCategoryFilter] = useState('');
  const [memberFilters, setMemberFilters] = useState<Record<string, string>>({});
  const [inactiveFilter, setInactiveFilter] = useState<string>(''); // '' | 'any' | 'meta' | 'google' | 'site' | 'forms' | 'whatsapp'
  const [statusFilter, setStatusFilter] = useState<'active' | 'disabled' | 'all'>('active');
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [clinicSaving, setClinicSaving] = useState(false);
  const [clinicError, setClinicError] = useState('');

  // Modal: novo usuário org
  const [showUserModal, setShowUserModal] = useState(false);
  const [userForm, setUserForm] = useState({ name: '', email: '', password: '', role: 'org_team' });
  const [userSaving, setUserSaving] = useState(false);
  const [userError, setUserError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Modal: novo usuário clínica
  const [clinicUserTarget, setClinicUserTarget] = useState<{ id: string; name: string } | null>(null);
  const [clinicUserForm, setClinicUserForm] = useState({ name: '', email: '', password: '', role: 'gestor' });
  const [clinicUserSaving, setClinicUserSaving] = useState(false);
  const [clinicUserError, setClinicUserError] = useState('');

  // Modal: usuários da clínica
  const [clinicUsersView, setClinicUsersView] = useState<{ id: string; name: string } | null>(null);
  const [clinicUsersData, setClinicUsersData] = useState<ClinicUser[]>([]);
  const [clinicUsersLoading, setClinicUsersLoading] = useState(false);

  // Modal: editar clínica
  const [editClinicTarget, setEditClinicTarget] = useState<Clinic | null>(null);

  // Modal: informações da clínica (dados do cliente + acessos)
  const [clinicInfoTarget, setClinicInfoTarget] = useState<Clinic | null>(null);

  // Investimento por clínica e canal (verba estipulada + investido do mês), para a coluna da lista
  const [investmentMap, setInvestmentMap] = useState<Record<string, { metaEst: number; metaInv: number; googleEst: number; googleInv: number }>>({});

  // Modal: responsáveis da clínica
  const [responsibleTarget, setResponsibleTarget] = useState<Clinic | null>(null);
  const [responsibleForm, setResponsibleForm] = useState<Record<string, string>>({});
  const [responsibleSaving, setResponsibleSaving] = useState(false);

  // Modal: confirmação de exclusão de clínica
  const [deleteClinicTarget, setDeleteClinicTarget] = useState<Clinic | null>(null);
  const [deleteConfirmName, setDeleteConfirmName] = useState('');
  const [deleteSaving, setDeleteSaving] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  useEffect(() => {
    if (!openDropdown && !openMenuId) return;
    const close = () => { setOpenDropdown(null); setOpenMenuId(null); };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [openDropdown, openMenuId]);

  const fetchClinics = useCallback(async () => {
    if (!profile?.organization_id) return;
    setLoadingClinics(true);
    const canSeeAll = userRole === 'org_owner' || userRole === 'org_admin';

    let clinicsData: any[] = [];

    if (canSeeAll) {
      const { data } = await supabase
        .from("clinics")
        .select("id, name, plan, logo_url, organization_id, category, features, meta_status, google_status, site_status, forms_status, is_active")
        .eq("organization_id", profile.organization_id)
        .order("name");
      clinicsData = data || [];
    } else if (profile.org_user_id) {
      // Buscar apenas clínicas atribuídas via org_clinic_assignments
      const { data: assignments } = await supabase
        .from("org_clinic_assignments")
        .select("clinic_id")
        .eq("org_user_id", profile.org_user_id);
      const assignedIds = (assignments || []).map((a: any) => a.clinic_id);
      if (assignedIds.length > 0) {
        const { data } = await supabase
          .from("clinics")
          .select("id, name, plan, logo_url, organization_id, category, features, meta_status, google_status, site_status, forms_status, is_active")
          .in("id", assignedIds)
          .order("name");
        clinicsData = data || [];
      }
    }

    const clinicIds = clinicsData.map((c: any) => c.id);
    const [{ data: waData }, { data: membersData }] = await Promise.all([
      supabase.from("whatsapp_instances").select("clinic_id, status"),
      clinicIds.length > 0
        ? supabase.from("org_clinic_assignments").select("*").in("clinic_id", clinicIds)
        : { data: [] as any[] },
    ]);
    const waMap = Object.fromEntries((waData || []).map(w => [w.clinic_id, w.status]));
    const mapped = clinicsData.map((c: any) => ({
      ...c,
      whatsapp_status: waMap[c.id] ?? null,
    }));
    setClinics(mapped);
    setClinicMembers(membersData || []);
    setLoadingClinics(false);

    // Investimento por clínica (só gestores da org têm permissão no RPC)
    if (canSeeAll) {
      const { data: invData } = await supabase.rpc('get_org_clinics_investment', { p_org_id: profile.organization_id });
      setInvestmentMap(Object.fromEntries(
        (invData || []).map((r: any) => [r.clinic_id, {
          metaEst: Number(r.meta_estimated) || 0,
          metaInv: Number(r.meta_invested) || 0,
          googleEst: Number(r.google_estimated) || 0,
          googleInv: Number(r.google_invested) || 0,
        }])
      ));
    } else {
      setInvestmentMap({});
    }
  }, [profile?.organization_id, profile?.org_user_id, userRole]);

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
    if (profile?.organization_id) {
      supabase.from('organizations').select('google_ad_mcc_id, google_ad_mcc_token').eq('id', profile.organization_id).single()
        .then(({ data }) => {
          if (data) setOrgSettings({ google_ad_mcc_id: data.google_ad_mcc_id || '', google_ad_mcc_token: data.google_ad_mcc_token || '' });
        });
    }
  }, [fetchClinics, fetchOrgUsers, profile?.organization_id]);

  const handleToggleClinicFeature = async (clinic: Clinic, feature: 'feature_followup' | 'feature_ia') => {
    const current = clinic.features ?? { feature_followup: true, feature_ia: true };
    const newFeatures = { ...current, [feature]: current[feature] === false ? true : false };
    await supabase.from('clinics').update({ features: newFeatures }).eq('id', clinic.id);
    setClinics(prev => prev.map(c => c.id === clinic.id ? { ...c, features: newFeatures } : c));
  };

  const handleToggleClinicActive = async (clinic: Clinic) => {
    const newValue = !(clinic.is_active ?? true);
    const { error } = await supabase.from('clinics').update({ is_active: newValue }).eq('id', clinic.id);
    if (!error) {
      setClinics(prev => prev.map(c => c.id === clinic.id ? { ...c, is_active: newValue } : c));
    }
    setOpenMenuId(null);
  };

  const handleDeleteClinic = async () => {
    if (!deleteClinicTarget) return;
    if (deleteConfirmName !== deleteClinicTarget.name) return;
    setDeleteSaving(true);
    setDeleteError('');
    const { error } = await supabase.rpc('delete_clinic_cascade', { p_clinic_id: deleteClinicTarget.id });
    setDeleteSaving(false);
    if (error) {
      setDeleteError(error.message);
      return;
    }
    setClinics(prev => prev.filter(c => c.id !== deleteClinicTarget.id));
    setDeleteClinicTarget(null);
    setDeleteConfirmName('');
  };

  const handleSaveOrgSettings = async () => {
    if (!profile?.organization_id) return;
    setOrgSettingsSaving(true);
    await supabase.from('organizations').update({
      google_ad_mcc_id: orgSettings.google_ad_mcc_id || null,
      google_ad_mcc_token: orgSettings.google_ad_mcc_token || null,
    }).eq('id', profile.organization_id);
    setOrgSettingsSaving(false);
    setOrgSettingsSaved(true);
    setTimeout(() => setOrgSettingsSaved(false), 2500);
  };

  const handleCreateClinic = async () => {
    if (!clinicForm.name.trim()) {
      setClinicError('Informe o nome da clínica.');
      return;
    }
    // Administrador é opcional: a clínica pode ser criada vazia e o admin adicionado
    // depois (menu "Usuários da Clínica"). Mas se o usuário começou a preencher os
    // dados do admin, exigimos e-mail + senha — a RPC só cria o login quando há e-mail,
    // e e-mail sem senha geraria um acesso quebrado.
    const wantsAdmin = !!(clinicForm.ownerName.trim() || clinicForm.ownerEmail.trim() || clinicForm.ownerPassword.trim());
    if (wantsAdmin && (!clinicForm.ownerEmail.trim() || !clinicForm.ownerPassword.trim())) {
      setClinicError('Para criar o administrador agora, informe e-mail e senha (ou deixe os três campos em branco).');
      return;
    }
    setClinicSaving(true);
    setClinicError('');
    const { data: newClinic, error } = await supabase.rpc('create_clinic_with_owner', {
      p_clinic_name: clinicForm.name.trim(),
      p_plan: clinicForm.plan,
      p_organization_id: profile?.organization_id || null,
      p_owner_name: clinicForm.ownerName.trim(),
      p_owner_email: clinicForm.ownerEmail.trim(),
      p_owner_password: clinicForm.ownerPassword,
    });
    if (!error) {
      if (clinicForm.category && newClinic) {
        await supabase.from('clinics').update({ category: clinicForm.category }).eq('id', newClinic);
      }
      if (clinicForm.trafficManagerId && newClinic) {
        await supabase.from('org_clinic_assignments').insert({
          clinic_id: newClinic,
          org_user_id: clinicForm.trafficManagerId,
          function: 'gestor_trafego'
        });
      }
    }
    setClinicSaving(false);
    if (error) { setClinicError(error.message); return; }
    setShowClinicModal(false);
    setClinicForm({ name: '', plan: 'free', category: '', ownerName: '', ownerEmail: '', ownerPassword: '', feature_followup: true, feature_ia: true, meta_status: 'none', google_status: 'none', site_status: 'none', forms_status: 'none', trafficManagerId: '' });
    fetchClinics();
  };

  const handleUpdateClinic = async () => {
    if (!editClinicTarget || !clinicForm.name.trim()) return;
    setClinicSaving(true);
    const { error } = await supabase
      .from('clinics')
      .update({
        name: clinicForm.name.trim(),
        plan: clinicForm.plan,
        category: clinicForm.category || 'clinica',
        // Preserva outras flags do JSONB (ex.: agenda_via_funil) — o form só controla os 2 toggles.
        features: { ...((editClinicTarget as any)?.features || {}), feature_followup: clinicForm.feature_followup, feature_ia: clinicForm.feature_ia },
        meta_status: clinicForm.meta_status,
        google_status: clinicForm.google_status,
        site_status: clinicForm.site_status,
        forms_status: clinicForm.forms_status,
      })
      .eq('id', editClinicTarget.id);

    if (!error) {
      // Remove any existing gestor_trafego assignment
      await supabase.from('org_clinic_assignments')
        .delete()
        .eq('clinic_id', editClinicTarget.id)
        .eq('function', 'gestor_trafego');

      // Add new one if selected
      if (clinicForm.trafficManagerId) {
        await supabase.from('org_clinic_assignments').insert({
          clinic_id: editClinicTarget.id,
          org_user_id: clinicForm.trafficManagerId,
          function: 'gestor_trafego'
        });
      }
    }

    setClinicSaving(false);
    if (error) { setClinicError(error.message); return; }
    setEditClinicTarget(null);
    setClinicForm({ name: '', plan: 'free', category: '', ownerName: '', ownerEmail: '', ownerPassword: '', feature_followup: true, feature_ia: true, meta_status: 'none', google_status: 'none', site_status: 'none', forms_status: 'none', trafficManagerId: '' });
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
    setUserForm({ name: '', email: '', password: '', role: 'org_team' });
    fetchOrgUsers();
  };

  const isMedicoRole = (role: string) => role === 'medico' || role === 'medico_gestor';

  // Médico criado/gerido pelo painel da Org precisa de uma linha em `doctors` para
  // aparecer no Corpo Clínico e ter agenda — mesmo antes de criar a senha. Espelha o
  // cadastro do Corpo Clínico (DoctorsManagement). user_id fica null até a ativação
  // (activate_pending_medico) linkar por nome; para usuário já ativo, vinculamos direto.
  const ensureDoctorRow = async (clinicId: string, fullName: string, userId: string | null) => {
    const name = fullName.trim();
    if (!name) return;
    const { data: existing } = await supabase
      .from('doctors')
      .select('id, user_id')
      .eq('clinic_id', clinicId)
      .ilike('name', name)
      .limit(1);
    const found = existing?.[0];
    if (found) {
      // Já existe (ex.: criado pelo Corpo Clínico) — só garante o vínculo se faltava.
      if (userId && !found.user_id) {
        await supabase.from('doctors').update({ user_id: userId }).eq('id', found.id);
      }
      return;
    }
    await supabase.from('doctors').insert({
      clinic_id: clinicId,
      name,
      user_id: userId,
      status: 'offline',
    });
  };

  const handleAddClinicUser = async () => {
    if (!clinicUserTarget) return;
    const name = clinicUserForm.name.trim();
    const email = clinicUserForm.email.trim().toLowerCase();
    if (!name || !email) {
      setClinicUserError('Preencha nome e e-mail.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setClinicUserError('E-mail inválido.');
      return;
    }
    setClinicUserSaving(true);
    setClinicUserError('');

    // Checa duplicidade em clinic_users e pending_clinic_users
    const [existingActive, existingPending] = await Promise.all([
      supabase.from('clinic_users').select('id').ilike('email', email).maybeSingle(),
      supabase.from('pending_clinic_users').select('id').ilike('email', email).maybeSingle(),
    ]);
    if (existingActive.data) {
      setClinicUserError('Já existe um usuário ativo com esse e-mail.');
      setClinicUserSaving(false);
      return;
    }
    if (existingPending.data) {
      setClinicUserError('Já existe um pré-cadastro com esse e-mail.');
      setClinicUserSaving(false);
      return;
    }

    // Pré-cadastro unificado: insere em pending_clinic_users
    // O próprio usuário criará a senha ao acessar a aba "Criar Conta" no login.
    const { error } = await supabase.from('pending_clinic_users').insert({
      clinic_id: clinicUserTarget.id,
      email,
      full_name: name,
      role: clinicUserForm.role,
    });

    if (error) { setClinicUserSaving(false); setClinicUserError(error.message); return; }

    // Médico já aparece no Corpo Clínico (e na agenda) mesmo antes de criar a senha.
    if (isMedicoRole(clinicUserForm.role)) {
      await ensureDoctorRow(clinicUserTarget.id, name, null);
    }

    setClinicUserSaving(false);
    setClinicUserTarget(null);
    setClinicUserForm({ name: '', email: '', password: '', role: 'gestor' });
    if (clinicUsersView?.id === clinicUserTarget?.id) fetchClinicUsers(clinicUserTarget.id);
  };

  const fetchClinicUsers = async (clinicId: string) => {
    setClinicUsersLoading(true);
    const [active, pending] = await Promise.all([
      supabase.from('clinic_users').select('id, full_name, email, role, created_at').eq('clinic_id', clinicId),
      supabase.from('pending_clinic_users').select('id, full_name, email, role, created_at').eq('clinic_id', clinicId),
    ]);
    const merged: ClinicUser[] = [
      ...(active.data || []).map(u => ({ ...u, is_pending: false })),
      ...(pending.data || []).map(u => ({ ...u, is_pending: true })),
    ].sort((a, b) => a.role.localeCompare(b.role));
    setClinicUsersData(merged);
    setClinicUsersLoading(false);
  };

  const handleChangeClinicUserRole = async (user: ClinicUser, newRole: string) => {
    const table = user.is_pending ? 'pending_clinic_users' : 'clinic_users';
    await supabase.from(table).update({ role: newRole }).eq('id', user.id);
    // Virou médico pelo painel → garante o registro no Corpo Clínico (agenda).
    // Ativo: id == user_id (auth). Pendente: vincula por nome na ativação.
    if (isMedicoRole(newRole) && clinicUsersView) {
      await ensureDoctorRow(clinicUsersView.id, user.full_name || '', user.is_pending ? null : user.id);
    }
    if (clinicUsersView) fetchClinicUsers(clinicUsersView.id);
  };

  const handleRemoveClinicUser = async (user: ClinicUser) => {
    const table = user.is_pending ? 'pending_clinic_users' : 'clinic_users';
    await supabase.from(table).delete().eq('id', user.id);
    if (clinicUsersView) fetchClinicUsers(clinicUsersView.id);
  };

  const handleSaveResponsaveis = async () => {
    if (!responsibleTarget) return;
    setResponsibleSaving(true);
    await supabase.from('org_clinic_assignments').delete().eq('clinic_id', responsibleTarget.id);
    const toInsert = CLINIC_FUNCTIONS
      .filter(f => responsibleForm[f.value])
      .map(f => ({ clinic_id: responsibleTarget.id, org_user_id: responsibleForm[f.value], function: f.value }));
    if (toInsert.length > 0) await supabase.from('org_clinic_assignments').insert(toInsert);
    setResponsibleSaving(false);
    setResponsibleTarget(null);
    fetchClinics();
  };

  // Tabs visible per role
  const visibleTabs = [
    { id: "clinics", label: "Clínicas", icon: Building2, show: true },
    { id: "metrics", label: "Métricas", icon: BarChart3, show: true },
    { id: "users", label: "Usuários", icon: Users, show: canManageOrgUsers },
    { id: "tasks", label: "Tarefas", icon: ListTodo, show: canManageTasks },
    { id: "settings", label: "Configurações", icon: Settings, show: canManageSettings },
  ].filter(t => t.show);

  return (
    <div className="space-y-8 h-full flex flex-col font-sans">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-slate-900">
            Gestão <span className="text-violet-600">Organizacional</span>
          </h2>
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
          {visibleTabs.map((t) => (
            <button
              key={t.id}
              onClick={() => { setActiveSubTab(t.id as any); localStorage.setItem('orgAdminTab', t.id); }}
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

        {activeSubTab === "clinics" && canManageClinics && (
          <button
            onClick={() => setShowClinicModal(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-bold transition-colors shadow-sm"
          >
            + Clínica
          </button>
        )}
        {activeSubTab === "users" && canManageOrgUsers && (
          <button
            onClick={() => setShowUserModal(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-xl text-xs font-bold transition-colors shadow-sm"
          >
            + Usuário
          </button>
        )}
      </div>

      {/* Filters */}
      {activeSubTab === "clinics" && (() => {
        const DropdownFilter = ({
          id, label, active, options, selected, onSelect,
        }: {
          id: string; label: string; active: boolean;
          options: { value: string; label: string; count?: number }[];
          selected: string; onSelect: (v: string) => void;
        }) => (
          <div className="relative">
            <button
              onClick={e => { e.stopPropagation(); setOpenDropdown(openDropdown === id ? null : id); }}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold border transition-all",
                active ? "bg-violet-600 text-white border-violet-600 shadow-sm" : "bg-white text-slate-600 border-slate-200 hover:border-violet-300"
              )}
            >
              {label}
              <ChevronDown className={cn("w-3 h-3 transition-transform", openDropdown === id && "rotate-180")} />
            </button>
            {openDropdown === id && (
              <div className="absolute left-0 top-full mt-1 z-50 bg-white border border-slate-200 rounded-xl shadow-lg py-1 min-w-[160px]">
                {options.map(opt => (
                  <button
                    key={opt.value}
                    onClick={e => { e.stopPropagation(); onSelect(opt.value); setOpenDropdown(null); }}
                    className="w-full flex items-center justify-between gap-3 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
                  >
                    <span>{opt.label}</span>
                    <div className="flex items-center gap-1.5">
                      {opt.count !== undefined && <span className="text-[9px] font-black text-slate-400">{opt.count}</span>}
                      {selected === opt.value && <Check className="w-3 h-3 text-violet-600 shrink-0" />}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        );

        // Filtros dinâmicos por função — aparece só se tiver ao menos 1 clínica com aquela função atribuída
        const activeFunctions = CLINIC_FUNCTIONS.filter(fn =>
          clinicMembers.some(m => m.function === fn.value)
        );

        return (
          <div className="flex flex-col gap-2">
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
            <div className="flex items-center gap-2 flex-wrap">
              <DropdownFilter
                id="tipo"
                label={categoryFilter ? (CLINIC_CATEGORIES.find(c => c.value === categoryFilter)?.label ?? 'Tipo') : 'Tipo'}
                active={categoryFilter !== ''}
                selected={categoryFilter}
                options={[
                  { value: '', label: 'Todas', count: clinics.length },
                  ...CLINIC_CATEGORIES.map(cat => ({ value: cat.value, label: cat.label, count: clinics.filter(c => c.category === cat.value).length })),
                ]}
                onSelect={v => setCategoryFilter(v)}
              />
              {(() => {
                const inactiveCounts = {
                  any:      clinics.filter(c => c.whatsapp_status !== 'connected' || c.meta_status === 'inactive' || c.google_status === 'inactive' || c.site_status === 'inactive' || c.forms_status === 'inactive').length,
                  whatsapp: clinics.filter(c => c.whatsapp_status !== 'connected').length,
                  meta:     clinics.filter(c => c.meta_status === 'inactive').length,
                  google:   clinics.filter(c => c.google_status === 'inactive').length,
                  site:     clinics.filter(c => c.site_status === 'inactive').length,
                  forms:    clinics.filter(c => c.forms_status === 'inactive').length,
                };
                const labels: Record<string, string> = { any: 'Qualquer inativo', whatsapp: 'WhatsApp inativo', meta: 'Meta inativo', google: 'Google inativo', site: 'Site inativo', forms: 'Forms inativo' };
                return (
                  <DropdownFilter
                    id="inativos"
                    label={inactiveFilter ? labels[inactiveFilter] : 'Inativos'}
                    active={inactiveFilter !== ''}
                    selected={inactiveFilter}
                    options={[
                      { value: '', label: 'Todos' },
                      { value: 'any',      label: 'Qualquer inativo', count: inactiveCounts.any },
                      { value: 'whatsapp', label: 'WhatsApp inativo', count: inactiveCounts.whatsapp },
                      { value: 'meta',     label: 'Meta inativo',     count: inactiveCounts.meta },
                      { value: 'google',   label: 'Google inativo',   count: inactiveCounts.google },
                      { value: 'site',     label: 'Site inativo',     count: inactiveCounts.site },
                      { value: 'forms',    label: 'Forms inativo',    count: inactiveCounts.forms },
                    ]}
                    onSelect={v => setInactiveFilter(v)}
                  />
                );
              })()}
              {(() => {
                const statusCounts = {
                  active:   clinics.filter(c => c.is_active !== false).length,
                  disabled: clinics.filter(c => c.is_active === false).length,
                  all:      clinics.length,
                };
                const statusLabels: Record<string, string> = { active: 'Ativos', disabled: 'Desativados', all: 'Todos' };
                return (
                  <DropdownFilter
                    id="status"
                    label={statusLabels[statusFilter]}
                    active={statusFilter !== 'active'}
                    selected={statusFilter}
                    options={[
                      { value: 'active',   label: 'Ativos',      count: statusCounts.active },
                      { value: 'disabled', label: 'Desativados', count: statusCounts.disabled },
                      { value: 'all',      label: 'Todos',       count: statusCounts.all },
                    ]}
                    onSelect={v => setStatusFilter((v as 'active' | 'disabled' | 'all') || 'active')}
                  />
                );
              })()}
              {activeFunctions.map(fn => {
                const usersWithFn = orgUsers.filter(u => clinicMembers.some(m => m.function === fn.value && m.org_user_id === u.id));
                const selectedId = memberFilters[fn.value] || '';
                const selectedUser = orgUsers.find(u => u.id === selectedId);
                return (
                  <DropdownFilter
                    key={fn.value}
                    id={fn.value}
                    label={selectedUser ? (selectedUser.full_name || selectedUser.email || fn.label).split(' ')[0] : fn.label}
                    active={!!selectedId}
                    selected={selectedId}
                    options={[
                      { value: '', label: 'Todos' },
                      ...usersWithFn.map(u => ({ value: u.id, label: u.full_name || u.email || u.id })),
                    ]}
                    onSelect={v => setMemberFilters(f => ({ ...f, [fn.value]: v }))}
                  />
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Clinics grid */}
      {activeSubTab === "clinics" && (
        <div className="flex-1 min-h-0 flex flex-col">
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
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm flex-1 min-h-0 flex flex-col">
              <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar rounded-2xl">
              <table className="w-full">
                <thead className="sticky top-0 z-20 bg-slate-50">
                  <tr className="text-left text-[10px] font-bold text-slate-400 uppercase tracking-widest border-b border-slate-100">
                    <th className="px-6 py-3">Cliente</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-6 py-3">Responsáveis</th>
                    <th className="px-6 py-3">Integrações</th>
                    <th className="px-6 py-3">Plano</th>
                    <th className="px-6 py-3">Investimento</th>
                    <th className="px-6 py-3 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {clinics.filter(c =>
                    matchesSearch(clinicSearch, { name: c.name }) &&
                    (categoryFilter === '' || c.category === categoryFilter) &&
                    Object.entries(memberFilters).every(([fn, uid]) =>
                      !uid || clinicMembers.some(m => m.clinic_id === c.id && m.function === fn && m.org_user_id === uid)
                    ) &&
                    (statusFilter === 'all' ||
                      (statusFilter === 'active'   && c.is_active !== false) ||
                      (statusFilter === 'disabled' && c.is_active === false)) &&
                    (inactiveFilter === '' ||
                      (inactiveFilter === 'any'      && (c.whatsapp_status !== 'connected' || c.meta_status === 'inactive' || c.google_status === 'inactive' || c.site_status === 'inactive' || c.forms_status === 'inactive')) ||
                      (inactiveFilter === 'whatsapp' && c.whatsapp_status !== 'connected') ||
                      (inactiveFilter === 'meta'     && c.meta_status === 'inactive') ||
                      (inactiveFilter === 'google'   && c.google_status === 'inactive') ||
                      (inactiveFilter === 'site'     && c.site_status === 'inactive') ||
                      (inactiveFilter === 'forms'    && c.forms_status === 'inactive'))
                  ).map((clinic) => {
                    const members = clinicMembers.filter(m => m.clinic_id === clinic.id);
                    const isOutro = clinic.category === 'outro';
                    const TypeIcon = isOutro ? Building : Stethoscope;
                    const channelsAll = [
                      { key: 'whatsapp', label: 'WhatsApp', img: WhatsappLogo, has: true,                                                       active: clinic.whatsapp_status === 'connected' },
                      { key: 'meta',     label: 'Meta',     img: MetaLogo,     has: !!clinic.meta_status   && clinic.meta_status   !== 'none', active: clinic.meta_status   === 'active' },
                      { key: 'google',   label: 'Google',   img: GoogleLogo,   has: !!clinic.google_status && clinic.google_status !== 'none', active: clinic.google_status === 'active' },
                      { key: 'site',     label: 'Site',     Icon: Globe,       iconCls: 'text-teal-600',   bgCls: 'bg-teal-50 border-teal-100',     has: !!clinic.site_status   && clinic.site_status   !== 'none', active: clinic.site_status   === 'active' },
                      { key: 'forms',    label: 'Forms',    Icon: FileText,    iconCls: 'text-indigo-600', bgCls: 'bg-indigo-50 border-indigo-100', has: !!clinic.forms_status  && clinic.forms_status  !== 'none', active: clinic.forms_status  === 'active' },
                    ];
                    const channelsList = channelsAll.filter(c => c.has);

                    const isDisabled = clinic.is_active === false;
                    return (
                      <tr key={clinic.id} className={cn(
                        "border-b border-slate-50 last:border-0 hover:bg-slate-50/50 transition-colors",
                        activeClinicId === clinic.id && "bg-violet-50/40",
                        isDisabled && "opacity-60"
                      )}>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className={cn(
                              "w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border shadow-sm",
                              isOutro
                                ? "bg-gradient-to-br from-white to-slate-50 border-slate-200"
                                : "bg-gradient-to-br from-white to-emerald-50/40 border-violet-100"
                            )}>
                              <TypeIcon className={cn("w-4 h-4", isOutro ? "text-slate-600" : "text-violet-600")} strokeWidth={2.5} />
                            </div>
                            <p className="text-sm font-bold text-slate-900">{clinic.name}</p>
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <button
                            type="button"
                            role="switch"
                            aria-checked={!isDisabled}
                            disabled={!canManageClinics}
                            onClick={e => { e.stopPropagation(); handleToggleClinicActive(clinic); }}
                            title={canManageClinics ? (isDisabled ? 'Ativar clínica' : 'Desativar clínica') : 'Apenas owners e admins podem alterar'}
                            className={cn(
                              "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
                              !isDisabled ? "bg-emerald-500" : "bg-slate-300",
                              canManageClinics ? "cursor-pointer hover:opacity-90" : "cursor-not-allowed opacity-60"
                            )}
                          >
                            <span
                              className={cn(
                                "inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform",
                                !isDisabled ? "translate-x-[18px]" : "translate-x-0.5"
                              )}
                            />
                          </button>
                        </td>
                        <td className="px-6 py-4">
                          {members.length > 0 ? (
                            <div className="flex flex-col gap-0.5">
                              {CLINIC_FUNCTIONS.map(fn => {
                                const m = members.find(m => m.function === fn.value);
                                if (!m) return null;
                                const u = orgUsers.find(u => u.id === m.org_user_id);
                                if (!u) return null;
                                return (
                                  <span key={fn.value} className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
                                    <fn.Icon className={cn("w-3 h-3 shrink-0", fn.color)} />
                                    <span className={cn("shrink-0 text-[10px] uppercase tracking-wider", fn.color)}>{fn.label}</span>
                                    <span className="text-slate-300">·</span>
                                    <span className="truncate text-slate-700">{u.full_name || u.email}</span>
                                  </span>
                                );
                              })}
                            </div>
                          ) : (
                            <span className="text-[11px] text-slate-300 italic">Sem responsáveis</span>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          {channelsList.length > 0 ? (
                            <div className="flex items-center gap-1.5">
                              {channelsList.map((ch: any) => (
                                <div
                                  key={ch.key}
                                  title={`${ch.label} ${ch.active ? 'ativo' : 'inativo'}`}
                                  className={cn(
                                    "relative w-8 h-8 rounded-lg border flex items-center justify-center bg-white",
                                    ch.active
                                      ? (ch.bgCls || "border-slate-200")
                                      : "border-slate-200 grayscale opacity-50"
                                  )}
                                >
                                  {ch.img ? (
                                    <img src={ch.img} alt={ch.label} className="w-5 h-5 object-contain" />
                                  ) : ch.Icon ? (
                                    <ch.Icon className={cn("w-3.5 h-3.5", ch.active ? ch.iconCls : "text-slate-400")} />
                                  ) : null}
                                  <span className={cn(
                                    "absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full border-2 border-white",
                                    ch.active ? "bg-emerald-500 shadow-sm shadow-emerald-200" : "bg-slate-300"
                                  )} />
                                </div>
                              ))}
                            </div>
                          ) : (
                            <span className="text-[11px] text-slate-300 italic">—</span>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <span className={cn(
                            "inline-flex items-center text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-md",
                            clinic.plan === 'enterprise' ? "bg-amber-100 text-amber-700"
                              : clinic.plan === 'pro' ? "bg-violet-100 text-violet-700"
                              : "bg-slate-100 text-slate-500"
                          )}>{clinic.plan}</span>
                        </td>
                        <td className="px-6 py-4">
                          {(() => {
                            const inv = investmentMap[clinic.id];
                            const fmt = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0, maximumFractionDigits: 0 });
                            // Mostra a barra do canal que EXISTE (ativo ou inativo). Se o canal não existe
                            // ('none'/nulo), nem aparece. Inativo é exibido esmaecido.
                            const channels = [
                              { key: 'meta',   label: 'Meta',   logo: MetaLogo,   base: 'from-blue-400 to-blue-600',      ring: 'border-blue-300',    status: clinic.meta_status,   est: inv?.metaEst || 0,   spent: inv?.metaInv || 0 },
                              { key: 'google', label: 'Google', logo: GoogleLogo, base: 'from-emerald-400 to-emerald-600', ring: 'border-emerald-300', status: clinic.google_status, est: inv?.googleEst || 0, spent: inv?.googleInv || 0 },
                            ].filter(c => c.status === 'active' || c.status === 'inactive');
                            if (channels.length === 0) {
                              return <span className="text-[11px] text-slate-300 italic">—</span>;
                            }
                            const Bar = ({ label, logo, est, spent, base, ringColor, active }: { label: string; logo: string; est: number; spent: number; base: string; ringColor: string; active: boolean }) => {
                              const pct = est > 0 ? Math.round((spent / est) * 100) : (spent > 0 ? 100 : 0);
                              const over = est > 0 && spent > est;
                              // Estourou a verba: barra cheia = total investido; fração dentro da verba na cor
                              // do canal, excesso em vermelho. Sem verba: cheio se gastou, vazio se R$ 0.
                              const inRatio = est > 0 ? (over ? (est / spent) * 100 : Math.min(100, pct)) : (spent > 0 ? 100 : 0);
                              const ring = over ? "border-rose-300" : ringColor;
                              return (
                                <div
                                  className={cn("flex items-center", !active && "opacity-45 grayscale")}
                                  title={`${label}${!active ? ' (inativo)' : ''}: ${est > 0 ? `${fmt(spent)} de ${fmt(est)} (${pct}%)${over ? ` — excesso de ${fmt(spent - est)}` : ''}` : `${fmt(spent)} investido (sem verba definida)`}`}
                                >
                                  {/* Badge com a logo do canal (no lugar do %) */}
                                  <div className={cn("relative z-[1] w-5 h-5 rounded-full bg-white border shadow-sm flex items-center justify-center shrink-0", ring)}>
                                    <img src={logo} alt={label} className="w-3 h-3 object-contain" />
                                  </div>
                                  {/* Barra de fundo claro com investido / configurado dentro */}
                                  <div className="relative flex-1 h-3.5 -ml-1.5 rounded-full bg-slate-100 border border-slate-200 overflow-hidden">
                                    {/* parte dentro da verba */}
                                    <div className={cn("absolute inset-y-0 left-0 bg-gradient-to-b transition-all", base)} style={{ width: `${inRatio}%` }} />
                                    {/* excesso acima da verba */}
                                    {over && (
                                      <div className="absolute inset-y-0 right-0 bg-gradient-to-b from-rose-400 to-rose-600 transition-all" style={{ left: `${inRatio}%` }} />
                                    )}
                                    <div className="absolute inset-0 flex items-center justify-center pl-1.5">
                                      <span className="text-[8px] font-black text-slate-800 leading-none [text-shadow:0_0_2px_rgba(255,255,255,0.95)]">
                                        {fmt(spent)} / {est > 0 ? fmt(est) : '—'}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              );
                            };
                            return (
                              <div className="w-40 space-y-1">
                                {channels.map(c => (
                                  <Bar key={c.key} label={c.label} logo={c.logo} est={c.est} spent={c.spent} base={c.base} ringColor={c.ring} active={c.status === 'active'} />
                                ))}
                              </div>
                            );
                          })()}
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center justify-end gap-2">
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
                                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all",
                                activeClinicId === clinic.id
                                  ? "bg-violet-600 text-white hover:bg-violet-700"
                                  : "bg-violet-500 text-white hover:bg-violet-600"
                              )}
                            >
                              {activeClinicId === clinic.id ? (<><LogIn className="w-3 h-3" /> Visualizando</>) : (<><ArrowRight className="w-3 h-3" /> Visualizar</>)}
                            </button>
                            {canManageClinics && (
                              <button
                                onClick={e => { e.stopPropagation(); setClinicInfoTarget(clinic); }}
                                title="Informações da Clínica"
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-slate-200 text-slate-600 bg-white hover:bg-slate-50 hover:border-slate-300 transition-all"
                              >
                                <FileText className="w-3 h-3 text-violet-500" /> Informações
                              </button>
                            )}
                            <div className="relative">
                              <button
                                onClick={e => {
                                  e.stopPropagation();
                                  if (openMenuId === clinic.id) {
                                    setOpenMenuId(null);
                                  } else {
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    const spaceBelow = window.innerHeight - rect.bottom;
                                    setMenuDropUp(spaceBelow < 220);
                                    setOpenMenuId(clinic.id);
                                  }
                                }}
                                className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-slate-100 transition-colors"
                              >
                                <MoreVertical className="w-3.5 h-3.5 text-slate-400" />
                              </button>
                              {openMenuId === clinic.id && (
                                <div className={cn(
                                  "absolute right-0 z-50 bg-white border border-slate-200 rounded-xl shadow-lg py-1 min-w-[180px]",
                                  menuDropUp ? "bottom-9" : "top-9"
                                )}>
                                  {canAddClinicUsers && (
                                    <button
                                      onClick={e => { e.stopPropagation(); setClinicUsersView({ id: clinic.id, name: clinic.name }); fetchClinicUsers(clinic.id); setOpenMenuId(null); }}
                                      className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
                                    >
                                      <Users className="w-3.5 h-3.5 text-teal-600" />
                                      Usuários da Clínica
                                    </button>
                                  )}
                                  {canSetResponsaveis && (
                                    <button
                                      onClick={e => {
                                        e.stopPropagation();
                                        setResponsibleTarget(clinic);
                                        const form: Record<string, string> = {};
                                        CLINIC_FUNCTIONS.forEach(f => {
                                          const m = clinicMembers.find(m => m.clinic_id === clinic.id && m.function === f.value);
                                          form[f.value] = m?.org_user_id || '';
                                        });
                                        setResponsibleForm(form);
                                        setOpenMenuId(null);
                                      }}
                                      className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
                                    >
                                      <UserCheck className="w-3.5 h-3.5 text-violet-600" />
                                      Definir Responsáveis
                                    </button>
                                  )}
                                  {canManageClinics && (
                                    <button
                                      onClick={e => {
                                        e.stopPropagation();
                                        setEditClinicTarget(clinic);
                                        const trafficMember = clinicMembers.find(m => m.clinic_id === clinic.id && m.function === 'gestor_trafego');
                                        setClinicForm({
                                          name: clinic.name,
                                          plan: clinic.plan,
                                          category: clinic.category || '',
                                          ownerName: '', ownerEmail: '', ownerPassword: '',
                                          feature_followup: clinic.features?.feature_followup !== false,
                                          feature_ia: clinic.features?.feature_ia !== false,
                                          meta_status: clinic.meta_status || 'none',
                                          google_status: clinic.google_status || 'none',
                                          site_status: clinic.site_status || 'none',
                                          forms_status: clinic.forms_status || 'none',
                                          trafficManagerId: trafficMember?.org_user_id || '',
                                        });
                                        setOpenMenuId(null);
                                      }}
                                      className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
                                    >
                                      <Settings className="w-3.5 h-3.5 text-blue-600" />
                                      Editar Clínica
                                    </button>
                                  )}
                                  {canManageClinics && (
                                    <>
                                      <div className="my-1 border-t border-slate-100" />
                                      <button
                                        onClick={e => {
                                          e.stopPropagation();
                                          setDeleteClinicTarget(clinic);
                                          setDeleteConfirmName('');
                                          setDeleteError('');
                                          setOpenMenuId(null);
                                        }}
                                        className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 transition-colors"
                                      >
                                        <Trash2 className="w-3.5 h-3.5 text-red-600" />
                                        Excluir Clínica
                                      </button>
                                    </>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Users tab */}
      {activeSubTab === "users" && (
        <div className="flex-1">
          {orgUsers.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-center">
              <Users className="w-12 h-12 text-slate-200 mb-3" />
              <p className="text-slate-500 font-medium text-sm">Nenhum usuário na organização.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {orgUsers.map((u) => {
                const isSelf = u.user_id === profile?.id;
                // org_owner: acesso total. org_admin: não toca no papel org_owner
                // (não cria/promove/exclui/edita owner) — só opera em linhas role <> 'org_owner'.
                const isActorOwner = userRole === 'org_owner';
                const targetIsOwner = u.role === 'org_owner';
                const canEditTarget = canManageOrgUsers && (isActorOwner || !targetIsOwner);
                // Só owner pode oferecer o papel Owner no seletor.
                const availableRoles = isActorOwner
                  ? ORG_ROLES
                  : ORG_ROLES.filter(r => r.value !== 'org_owner');
                return (
                <div key={u.id} className="flex items-center gap-4 p-4 bg-white rounded-xl border border-slate-200 hover:border-violet-200 transition-all">
                  <div className="w-9 h-9 rounded-lg bg-violet-100 flex items-center justify-center text-violet-700 font-bold text-xs shrink-0">
                    {(u.full_name || u.email || '?').slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-slate-900 truncate">{u.full_name || '—'}</p>
                    <p className="text-xs text-slate-500 truncate">{u.email}</p>
                  </div>

                  {/* Role selector */}
                  <div className="flex items-center gap-3 shrink-0">
                    {isSelf || !canEditTarget ? (
                      <span className={cn("text-[9px] font-bold uppercase tracking-widest px-3 py-1.5 rounded-lg border", roleBadgeClass(u.role))}>
                        {roleLabel(u.role)}
                      </span>
                    ) : (
                      <div className="relative group">
                        <select
                          value={u.role}
                          onChange={async (e) => {
                            const newRole = e.target.value;
                            await supabase.from('org_users').update({ role: newRole }).eq('id', u.id);
                            fetchOrgUsers();
                          }}
                          className={cn(
                            "text-[10px] font-bold uppercase tracking-wider pl-3 pr-8 py-1.5 rounded-lg border cursor-pointer appearance-none transition-all focus:outline-none focus:ring-2 focus:ring-violet-200 w-full min-w-[100px]",
                            u.role === 'org_owner' ? "bg-amber-50 text-amber-700 border-amber-200" :
                            u.role === 'org_admin' ? "bg-violet-50 text-violet-700 border-violet-200" :
                            "bg-blue-50 text-blue-700 border-blue-200"
                          )}
                        >
                          {availableRoles.map(r => (
                            <option key={r.value} value={r.value}>{r.label}</option>
                          ))}
                        </select>
                        <ChevronDown className="w-3.5 h-3.5 absolute right-2.5 top-1/2 -translate-y-1/2 text-current pointer-events-none opacity-50 group-hover:opacity-100 transition-opacity" />
                      </div>
                    )}

                    {/* Delete button — não pode deletar a si mesmo nem (admin) um owner */}
                    {!isSelf && canEditTarget && (
                      <button
                        onClick={async () => {
                          if (!confirm(`Remover ${u.full_name || u.email} da organização?`)) return;
                          await supabase.from('org_clinic_assignments').delete().eq('org_user_id', u.id);
                          await supabase.from('org_users').delete().eq('id', u.id);
                          fetchOrgUsers();
                          fetchClinics();
                        }}
                        className="p-2 text-slate-300 hover:text-rose-600 hover:bg-rose-50 rounded-xl border border-transparent hover:border-rose-100 transition-all shadow-sm hover:shadow-rose-100/50"
                        title="Remover usuário"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Settings Tab */}
      {activeSubTab === "settings" && (
        <div className="flex-1 max-w-xl space-y-6">
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-3">
              <div className="w-8 h-8 bg-amber-50 rounded-lg flex items-center justify-center">
                <Settings className="w-4 h-4 text-amber-600" />
              </div>
              <div>
                <p className="text-sm font-bold text-slate-800">Google Ads — MCC</p>
                <p className="text-xs text-slate-400">Credenciais da conta gerenciadora</p>
              </div>
            </div>
            <div className="p-6 space-y-5">
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">ID do MCC</label>
                <input
                  type="text"
                  value={orgSettings.google_ad_mcc_id}
                  onChange={e => setOrgSettings(s => ({ ...s, google_ad_mcc_id: e.target.value }))}
                  placeholder="Ex: 123-456-7890"
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm font-medium text-slate-700 placeholder:text-slate-400 focus:ring-2 focus:ring-amber-100 focus:border-amber-400 outline-none transition-all"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Token de Acesso MCC</label>
                {!tokenFocused && orgSettings.google_ad_mcc_token ? (
                  <div
                    onClick={() => setTokenFocused(true)}
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm font-medium text-slate-700 bg-white cursor-text tracking-widest"
                  >
                    {orgSettings.google_ad_mcc_token.slice(0, 3)}{'•'.repeat(Math.max(0, Math.min(orgSettings.google_ad_mcc_token.length - 3, 24)))}
                  </div>
                ) : (
                  <input
                    type="password"
                    autoFocus={tokenFocused}
                    value={orgSettings.google_ad_mcc_token}
                    onChange={e => setOrgSettings(s => ({ ...s, google_ad_mcc_token: e.target.value }))}
                    onBlur={() => setTokenFocused(false)}
                    placeholder="Token de desenvolvedor ou OAuth"
                    autoComplete="new-password"
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm font-medium text-slate-700 placeholder:text-slate-400 focus:ring-2 focus:ring-amber-100 focus:border-amber-400 outline-none transition-all"
                  />
                )}
              </div>
              <button
                onClick={handleSaveOrgSettings}
                disabled={orgSettingsSaving}
                className="flex items-center gap-2 px-5 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white text-sm font-bold rounded-xl transition-all shadow-sm"
              >
                {orgSettingsSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {orgSettingsSaved ? 'Salvo!' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {activeSubTab === "metrics" && <OrgMetrics />}

      {activeSubTab === "tasks" && profile?.organization_id && (
        <OrgTasks
          organizationId={profile.organization_id}
          orgUsers={orgUsers}
          clinics={clinics.map(c => ({ id: c.id, name: c.name }))}
          canManage={canManageTasks}
        />
      )}

      {/* Modal: Nova / Editar Clínica */}
      <AnimatePresence>
        {(showClinicModal || editClinicTarget) && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md"
            >
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-base font-black text-slate-900">{editClinicTarget ? 'Editar Clínica' : 'Nova Clínica'}</h3>
                <button onClick={() => { setShowClinicModal(false); setEditClinicTarget(null); setClinicError(''); }} className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors">
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
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block mb-1">Categoria</label>
                  <select
                    value={clinicForm.category}
                    onChange={e => setClinicForm(f => ({ ...f, category: e.target.value }))}
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white text-slate-700"
                  >
                    <option value="">Selecionar categoria...</option>
                    {CLINIC_CATEGORIES.map(cat => (
                      <option key={cat.value} value={cat.value}>{cat.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block mb-1">Gestor de Tráfego Responsável</label>
                  <select
                    value={clinicForm.trafficManagerId}
                    onChange={e => setClinicForm(f => ({ ...f, trafficManagerId: e.target.value }))}
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white text-slate-700"
                  >
                    <option value="">— Nenhum —</option>
                    {orgUsers.map(u => (
                      <option key={u.id} value={u.id}>{u.full_name || u.email}</option>
                    ))}
                  </select>
                </div>
                {editClinicTarget && (
                  <div className="pt-1 border-t border-slate-100">
                    <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Funcionalidades</p>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between py-2 px-3 rounded-xl bg-slate-50 border border-slate-100">
                        <div>
                          <p className="text-xs font-bold text-slate-700">Follow-up</p>
                          <p className="text-[10px] text-slate-400">Disparos automáticos de mensagens</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setClinicForm(f => ({ ...f, feature_followup: !f.feature_followup }))}
                          className={cn("w-10 h-5 rounded-full relative transition-all flex-shrink-0", clinicForm.feature_followup ? "bg-teal-600" : "bg-slate-300")}
                        >
                          <div className={cn("w-3.5 h-3.5 bg-white rounded-full absolute top-0.5 transition-all shadow-sm", clinicForm.feature_followup ? "right-0.5" : "left-0.5")} />
                        </button>
                      </div>
                      <div className="flex items-center justify-between py-2 px-3 rounded-xl bg-slate-50 border border-slate-100">
                        <div>
                          <p className="text-xs font-bold text-slate-700">Configurações IA</p>
                          <p className="text-[10px] text-slate-400">Agente IA e configurações avançadas</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setClinicForm(f => ({ ...f, feature_ia: !f.feature_ia }))}
                          className={cn("w-10 h-5 rounded-full relative transition-all flex-shrink-0", clinicForm.feature_ia ? "bg-violet-600" : "bg-slate-300")}
                        >
                          <div className={cn("w-3.5 h-3.5 bg-white rounded-full absolute top-0.5 transition-all shadow-sm", clinicForm.feature_ia ? "right-0.5" : "left-0.5")} />
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {editClinicTarget && (
                  <div className="pt-1 border-t border-slate-100">
                    <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Integrações</p>
                    <p className="text-[10px] text-slate-400 mb-3">Indique quais integrações este cliente possui e quais estão ativas no momento.</p>
                    <div className="space-y-2">
                      {([
                        { key: 'meta_status', label: 'Meta Ads', desc: 'Facebook / Instagram Ads' },
                        { key: 'google_status', label: 'Google Ads', desc: 'Campanhas no Google' },
                        { key: 'site_status', label: 'Site institucional', desc: 'Página/landing pública' },
                        { key: 'forms_status', label: 'Formulários', desc: 'Lead forms / captação' },
                      ] as const).map((ch) => {
                        const current = clinicForm[ch.key];
                        const options: { v: ChannelStatus; label: string; cls: string }[] = [
                          { v: 'none', label: 'Não tem', cls: 'bg-slate-200 text-slate-600' },
                          { v: 'inactive', label: 'Inativo', cls: 'bg-amber-500 text-white' },
                          { v: 'active', label: 'Ativo', cls: 'bg-emerald-600 text-white' },
                        ];
                        return (
                          <div key={ch.key} className="py-2 px-3 rounded-xl bg-slate-50 border border-slate-100">
                            <div className="flex items-center justify-between mb-1.5">
                              <div>
                                <p className="text-xs font-bold text-slate-700">{ch.label}</p>
                                <p className="text-[10px] text-slate-400">{ch.desc}</p>
                              </div>
                            </div>
                            <div className="grid grid-cols-3 gap-1.5">
                              {options.map((o) => (
                                <button
                                  key={o.v}
                                  type="button"
                                  onClick={() => setClinicForm(f => ({ ...f, [ch.key]: o.v }))}
                                  className={cn(
                                    "py-1.5 rounded-lg border text-[10px] font-bold uppercase tracking-wider transition-all",
                                    current === o.v ? o.cls + ' border-transparent shadow-sm' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'
                                  )}
                                >
                                  {o.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                {!editClinicTarget && (
                  <div className="pt-1 border-t border-slate-100">
                    <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-1 flex items-center gap-2">
                      Administrador da Clínica
                      <span className="text-[9px] font-bold normal-case tracking-normal px-1.5 py-0.5 rounded-md bg-teal-100 text-teal-700 border border-teal-200">Opcional</span>
                    </p>
                    <p className="text-[10px] text-slate-400 mb-2">Você pode criar a clínica sem administrador e adicioná-lo depois em "Usuários da Clínica".</p>
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
                )}
                {clinicError && <p className="text-xs text-red-500 font-bold">{clinicError}</p>}
                <button onClick={editClinicTarget ? handleUpdateClinic : handleCreateClinic} disabled={clinicSaving}
                  className="w-full py-3 bg-teal-600 hover:bg-teal-700 disabled:bg-slate-100 disabled:text-slate-400 text-white rounded-xl font-black text-sm transition-all flex items-center justify-center gap-2">
                  {clinicSaving ? <><Loader2 className="w-4 h-4 animate-spin" /> Salvando...</> : (editClinicTarget ? 'Salvar Alterações' : 'Criar Clínica')}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal: Confirmação de Exclusão de Clínica */}
      <AnimatePresence>
        {deleteClinicTarget && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md"
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className="w-9 h-9 rounded-xl bg-red-50 border border-red-100 flex items-center justify-center">
                    <Trash2 className="w-4 h-4 text-red-600" />
                  </div>
                  <h3 className="text-base font-black text-slate-900">Excluir clínica permanentemente?</h3>
                </div>
                <button
                  onClick={() => { setDeleteClinicTarget(null); setDeleteConfirmName(''); setDeleteError(''); }}
                  className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  <X className="w-4 h-4 text-slate-500" />
                </button>
              </div>

              <div className="rounded-xl bg-red-50 border border-red-100 p-3 mb-4">
                <p className="text-xs font-semibold text-red-700 leading-relaxed">
                  Esta ação é <strong>irreversível</strong>. Todos os dados associados à clínica
                  <strong> "{deleteClinicTarget.name}"</strong> serão apagados, incluindo pacientes, médicos,
                  agendamentos, tickets, integrações e usuários.
                </p>
                <p className="text-[11px] text-red-600 mt-2 italic">
                  Considere apenas desativar a clínica se quiser preservar o histórico.
                </p>
              </div>

              <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                Digite o nome da clínica para confirmar:
              </label>
              <input
                type="text"
                value={deleteConfirmName}
                onChange={e => setDeleteConfirmName(e.target.value)}
                placeholder={deleteClinicTarget.name}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-red-200 focus:border-red-300 transition-all"
                autoFocus
              />

              {deleteError && (
                <p className="text-xs text-red-600 mt-2 font-semibold">{deleteError}</p>
              )}

              <div className="flex items-center gap-2 mt-5">
                <button
                  onClick={() => { setDeleteClinicTarget(null); setDeleteConfirmName(''); setDeleteError(''); }}
                  disabled={deleteSaving}
                  className="flex-1 px-4 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleDeleteClinic}
                  disabled={deleteSaving || deleteConfirmName !== deleteClinicTarget.name}
                  className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {deleteSaving ? (
                    <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Excluindo...</>
                  ) : (
                    <><Trash2 className="w-3.5 h-3.5" /> Excluir definitivamente</>
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal: Novo Usuário Org */}
      <AnimatePresence>
        {showUserModal && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
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
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
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
                <p className="text-[11px] text-sky-800 bg-sky-50 border border-sky-100 rounded-lg px-3 py-2 leading-relaxed">
                  Após o pré-cadastro, o membro deve acessar a tela de login → aba <span className="font-bold">"Criar Conta"</span> → usar este e-mail e definir a própria senha.
                </p>
                <div>
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block mb-1.5">Papel</label>
                  <div className="flex gap-2">
                    {CLINIC_ROLES.map(r => (
                      <button key={r} onClick={() => setClinicUserForm(f => ({ ...f, role: r }))}
                        className={cn("flex-1 py-2 rounded-xl text-xs font-bold capitalize transition-all border",
                          clinicUserForm.role === r ? "bg-teal-600 text-white border-teal-600" : "bg-slate-50 text-slate-600 border-slate-200 hover:border-teal-300")}>
                        {r === 'medico' ? 'Médico' : r === 'medico_gestor' ? 'Médico Gestor' : r === 'secretaria' ? 'Secretária' : r === 'vendedor' ? 'Vendedor' : 'Gestor'}
                      </button>
                    ))}
                  </div>
                </div>
                {clinicUserError && <p className="text-xs text-red-500 font-bold">{clinicUserError}</p>}
                <button onClick={handleAddClinicUser} disabled={clinicUserSaving}
                  className="w-full py-3 bg-teal-600 hover:bg-teal-700 disabled:bg-slate-100 disabled:text-slate-400 text-white rounded-xl font-black text-sm transition-all flex items-center justify-center gap-2">
                  {clinicUserSaving ? <><Loader2 className="w-4 h-4 animate-spin" /> Pré-cadastrando...</> : 'Pré-cadastrar'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal: Usuários da Clínica */}
      <AnimatePresence>
        {clinicUsersView && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col max-h-[80vh]"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
                <div>
                  <h3 className="text-base font-black text-slate-900">Usuários</h3>
                  <p className="text-xs text-slate-400 font-medium">{clinicUsersView.name}</p>
                </div>
                <div className="flex items-center gap-2">
                  {canAddClinicUsers && (
                    <button
                      onClick={() => { setClinicUserTarget({ id: clinicUsersView.id, name: clinicUsersView.name }); }}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold rounded-lg transition-colors"
                    >
                      <UserPlus className="w-3.5 h-3.5" /> Adicionar
                    </button>
                  )}
                  <button onClick={() => setClinicUsersView(null)} className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors">
                    <X className="w-4 h-4 text-slate-500" />
                  </button>
                </div>
              </div>

              {/* List */}
              <div className="overflow-y-auto flex-1 p-4">
                {clinicUsersLoading ? (
                  <div className="flex justify-center py-10">
                    <Loader2 className="w-6 h-6 text-teal-500 animate-spin" />
                  </div>
                ) : clinicUsersData.length === 0 ? (
                  <div className="text-center py-10 text-slate-400">
                    <Users className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    <p className="text-sm font-medium">Nenhum usuário nesta clínica.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {clinicUsersData.map(u => (
                      <div key={`${u.is_pending ? 'p' : 'a'}-${u.id}`} className={cn(
                        "flex items-center gap-3 p-3 rounded-xl border",
                        u.is_pending
                          ? "bg-amber-50/60 border-amber-200"
                          : "bg-slate-50 border-slate-100"
                      )}>
                        <div className={cn(
                          "w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs shrink-0",
                          u.is_pending ? "bg-amber-100 text-amber-700" : "bg-teal-100 text-teal-700"
                        )}>
                          {(u.full_name || u.email || '?').slice(0, 2).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className="text-xs font-bold text-slate-900 truncate">{u.full_name || '—'}</p>
                            {u.is_pending && (
                              <span className="text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-200 text-amber-800 shrink-0">
                                Aguardando
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] text-slate-400 truncate">{u.email}</p>
                        </div>
                        {canAddClinicUsers ? (
                          <select
                            value={u.role}
                            onChange={e => handleChangeClinicUserRole(u, e.target.value)}
                            className="text-[10px] font-bold border border-slate-200 rounded-lg px-1.5 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-teal-300 shrink-0"
                          >
                            {CLINIC_ROLES.map(r => (
                              <option key={r} value={r}>
                                {r === 'medico' ? 'Médico' : r === 'medico_gestor' ? 'Médico Gestor' : r === 'secretaria' ? 'Secretária' : r === 'vendedor' ? 'Vendedor' : 'Gestor'}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-teal-100 text-teal-700 shrink-0">
                            {u.role === 'medico' ? 'Médico' : u.role === 'secretaria' ? 'Secretária' : 'Gestor'}
                          </span>
                        )}
                        {canManageClinics && (
                          <button
                            onClick={() => handleRemoveClinicUser(u)}
                            className="p-1.5 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors shrink-0"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal: Responsáveis da Clínica */}
      <AnimatePresence>
        {responsibleTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm"
            >
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-base font-black text-slate-900">Responsáveis</h3>
                <button onClick={() => setResponsibleTarget(null)} className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors">
                  <X className="w-4 h-4 text-slate-500" />
                </button>
              </div>
              <p className="text-xs text-slate-400 font-medium mb-5">{responsibleTarget.name}</p>

              <div className="space-y-4">
                {CLINIC_FUNCTIONS.map(fn => (
                  <div key={fn.value}>
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-1.5 mb-1.5">
                      <fn.Icon className={cn("w-3 h-3", fn.color)} />
                      {fn.label}
                    </label>
                    <select
                      value={responsibleForm[fn.value] || ''}
                      onChange={e => setResponsibleForm(f => ({ ...f, [fn.value]: e.target.value }))}
                      className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-violet-300 bg-white text-slate-700"
                    >
                      <option value="">— Nenhum —</option>
                      {orgUsers.map(u => (
                        <option key={u.id} value={u.id}>{u.full_name || u.email}</option>
                      ))}
                    </select>
                  </div>
                ))}

                <button onClick={handleSaveResponsaveis} disabled={responsibleSaving}
                  className="w-full py-3 bg-violet-600 hover:bg-violet-700 disabled:bg-slate-100 disabled:text-slate-400 text-white rounded-xl font-black text-sm transition-all flex items-center justify-center gap-2">
                  {responsibleSaving ? <><Loader2 className="w-4 h-4 animate-spin" /> Salvando...</> : 'Salvar'}
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {clinicInfoTarget && (
          <ClinicInfoModal
            clinic={{ id: clinicInfoTarget.id, name: clinicInfoTarget.name }}
            canEdit={canManageClinics}
            onClose={() => setClinicInfoTarget(null)}
            onSaved={fetchClinics}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
