import React, { useState } from 'react';
import {
  useClinics, useOrganizations, useSuperAdminData, useGlobalSystemSettings,
  usePromptTemplates, PromptTemplate,
  Clinic, Organization, ClinicUser, OrgUser,
} from '../hooks/useSupabase';
import {
  Building2, Plus, Search, ShieldCheck, Loader2, X, Network, User, Mail, Lock,
  ChevronDown, ChevronRight, Trash2, Users, Edit3, Settings as SettingsIcon,
  Eye, EyeOff, Save, KeyRound, Power, Sparkles
} from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { useToast } from './ui/toast';
import { matchesSearch } from '../lib/search';

// ─── tipos de modal ───────────────────────────────────────────────────────────
type ModalState =
  | { type: 'org' }
  | { type: 'edit-org'; org: Organization }
  | { type: 'clinic'; orgId: string | null }
  | { type: 'edit-clinic'; clinic: Clinic }
  | { type: 'clinic-user'; clinicId: string; clinicName: string }
  | { type: 'org-user'; orgId: string; orgName: string }
  | null;

// ─── helpers ──────────────────────────────────────────────────────────────────
const planBadge = (plan: string) => cn(
  'text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full',
  plan === 'enterprise' ? 'bg-amber-100 text-amber-700' :
  plan === 'pro'        ? 'bg-violet-100 text-violet-700' :
                          'bg-slate-100 text-slate-500'
);

const roleBadge = (role: string) => {
  const map: Record<string, string> = {
    gestor:     'bg-teal-100 text-teal-700',
    medico:     'bg-blue-100 text-blue-700',
    secretaria: 'bg-pink-100 text-pink-700',
    org_owner:  'bg-amber-100 text-amber-700',
    org_admin:  'bg-violet-100 text-violet-700',
    org_team:   'bg-blue-100 text-blue-700',
    'super-admin': 'bg-rose-100 text-rose-700',
  };
  const roleLabels: Record<string, string> = {
    gestor: 'Gestor', medico: 'Médico', secretaria: 'Secretária',
    org_owner: 'Owner', org_admin: 'Admin', org_team: 'Equipe', 'super-admin': 'Super',
  };
  return { cls: cn('text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full', map[role] || 'bg-slate-100 text-slate-500'), label: roleLabels[role] || role };
};

const initials = (name: string) => name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();

function Avatar({ name, size = 'sm' }: { name: string; size?: 'sm' | 'md' }) {
  const colors = ['bg-teal-500', 'bg-violet-500', 'bg-amber-500', 'bg-blue-500', 'bg-pink-500', 'bg-emerald-500'];
  const color = colors[name.charCodeAt(0) % colors.length];
  const sz = size === 'sm' ? 'w-7 h-7 text-[10px]' : 'w-9 h-9 text-xs';
  return (
    <div className={cn('rounded-full flex items-center justify-center font-black text-white flex-shrink-0', color, sz)}>
      {initials(name)}
    </div>
  );
}

// ─── UserRow ──────────────────────────────────────────────────────────────────
function UserRow({ name, email, role, onRemove }: { name: string; email: string; role: string; onRemove?: () => void }) {
  const { cls, label } = roleBadge(role);
  const [confirming, setConfirming] = useState(false);

  const handleRemoveClick = () => {
    if (confirming) {
      onRemove?.();
      setConfirming(false);
    } else {
      setConfirming(true);
    }
  };

  return (
    <div
      className="flex items-center gap-3 py-2 px-3 rounded-xl hover:bg-slate-50 transition-colors group"
      onMouseLeave={() => setConfirming(false)}
    >
      <Avatar name={name} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-slate-800 truncate">{name}</p>
        <p className="text-xs text-slate-400 truncate">{email}</p>
      </div>
      <span className={cls}>{label}</span>
      {onRemove && (
        confirming ? (
          <button
            onClick={handleRemoveClick}
            className="flex items-center gap-1 px-2 py-1 bg-red-500 hover:bg-red-600 text-white rounded-lg text-xs font-bold transition-all"
          >
            <Trash2 className="w-3 h-3" /> Remover
          </button>
        ) : (
          <button
            onClick={handleRemoveClick}
            className="opacity-0 group-hover:opacity-100 p-1 text-slate-300 hover:text-red-500 transition-all rounded-lg hover:bg-red-50"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        )
      )}
    </div>
  );
}

// ─── ClinicCard ───────────────────────────────────────────────────────────────
function ClinicCard({
  clinic, users, onAddUser, onEdit, onDelete, onRemoveUser, onToggleActive, showId = false,
}: {
  clinic: Clinic;
  users: ClinicUser[];
  onAddUser: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onRemoveUser: (userId: string) => void;
  onToggleActive: () => void;
  showId?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  return (
    <div className={cn(
      "rounded-2xl border border-slate-100 bg-white overflow-hidden transition-all",
      !clinic.is_active && "opacity-60 grayscale-[0.5]"
    )}>
      <div 
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-slate-50/50 transition-colors"
        onClick={() => setExpanded(v => !v)}
      >
        <div className={cn(
          "w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0",
          clinic.is_active ? "bg-teal-50" : "bg-slate-100"
        )}>
          <Building2 className={cn("w-4 h-4", clinic.is_active ? "text-teal-600" : "text-slate-400")} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-bold text-slate-900 text-sm truncate">{clinic.name}</p>
            {!clinic.is_active && <span className="px-1.5 py-0.5 bg-slate-200 text-slate-600 text-[8px] font-black uppercase rounded">Inativa</span>}
          </div>
          {showId && <p className="text-[10px] text-slate-400 font-mono truncate">{clinic.id}</p>}
        </div>
        <span className={planBadge(clinic.plan)}>{clinic.plan}</span>
        <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
          <button
            onClick={onToggleActive}
            className={cn(
              "p-1.5 transition-colors rounded-lg",
              clinic.is_active
                ? "text-green-500 hover:bg-green-50 hover:text-green-600"
                : "text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            )}
            title={clinic.is_active ? "Desativar Clínica" : "Ativar Clínica"}
          >
            <Power className="w-3.5 h-3.5" />
          </button>

          <div className="w-px h-4 bg-slate-200 mx-1"></div>

          <button
            onClick={onAddUser}
            className="flex items-center gap-1 px-2.5 py-1.5 bg-teal-50 hover:bg-teal-100 text-teal-700 rounded-lg text-xs font-bold transition-colors"
          >
            + Usuário
          </button>
          
          <div className="w-px h-4 bg-slate-200 mx-1"></div>

          <button
            onClick={onEdit}
            className="p-1.5 text-slate-400 hover:text-blue-600 transition-colors rounded-lg hover:bg-blue-50"
            title="Editar Clínica"
          >
            <Edit3 className="w-3.5 h-3.5" />
          </button>

          {confirmingDelete ? (
            <button
              onClick={() => { onDelete(); setConfirmingDelete(false); }}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-red-500 hover:bg-red-600 text-white rounded-lg text-xs font-bold transition-all"
              onBlur={() => setConfirmingDelete(false)}
              autoFocus
            >
              <Trash2 className="w-3 h-3" /> Confirmar Exclusão
            </button>
          ) : (
            <button
              onClick={() => setConfirmingDelete(true)}
              className="p-1.5 text-slate-400 hover:text-red-500 transition-colors rounded-lg hover:bg-red-50"
              title="Excluir Clínica"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="border-t border-slate-50 p-3 bg-slate-50/30">
        <button
          onClick={() => setExpanded(v => !v)}
          className="flex items-center justify-between w-full text-left"
        >
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
            Membros da Clínica ({users.length})
          </p>
          {expanded ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
        </button>
        {expanded && (
          <div className="mt-2 space-y-0.5">
            {users.length === 0 ? (
              <p className="text-xs text-slate-400 italic py-2 text-center">Nenhum membro cadastrado</p>
            ) : (
              users.map(u => (
                <UserRow key={u.id} name={u.full_name} email={u.email} role={u.role} onRemove={() => onRemoveUser(u.id)} />
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── OrgSection ───────────────────────────────────────────────────────────────
function OrgSection({
  org, orgClinics, clinicUsers, orgUsers,
  onAddClinic, onAddOrgUser, onAddClinicUser,
  onEditOrg, onEditClinic,
  onDeleteOrg, onDeleteClinic, onRemoveClinicUser,
  onToggleActive, onToggleClinicActive
}: {
  org: Organization;
  orgClinics: Clinic[];
  clinicUsers: Record<string, ClinicUser[]>;
  orgUsers: OrgUser[];
  onAddClinic: () => void;
  onAddOrgUser: () => void;
  onAddClinicUser: (clinicId: string, clinicName: string) => void;
  onEditOrg: () => void;
  onEditClinic: (clinic: Clinic) => void;
  onDeleteOrg: () => void;
  onDeleteClinic: (clinic: Clinic) => void;
  onRemoveClinicUser: (userId: string, clinicId: string) => void;
  onToggleActive: () => void;
  onToggleClinicActive: (clinic: Clinic) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showOrgUsers, setShowOrgUsers] = useState(false);
  const [showClinics, setShowClinics] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const totalUsers = orgClinics.reduce((s, c) => s + (clinicUsers[c.id]?.length || 0), 0) + orgUsers.length;

  return (
    <div className={cn(
      "bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden mb-4 transition-all",
      !org.is_active && "opacity-60 grayscale-[0.5]"
    )}>
      <div 
        className="bg-slate-50/50 px-6 py-4 border-b border-slate-100 flex items-center justify-between cursor-pointer hover:bg-slate-100/50 transition-colors"
        onClick={() => setExpanded(v => !v)}
      >
        <div className="flex items-center gap-4">
          <div className={cn(
            "w-10 h-10 rounded-xl flex items-center justify-center",
            org.is_active ? "bg-violet-100" : "bg-slate-200"
          )}>
            <Network className={cn("w-5 h-5", org.is_active ? "text-violet-600" : "text-slate-500")} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-black text-slate-900">{org.name}</h3>
              {!org.is_active && <span className="px-1.5 py-0.5 bg-slate-200 text-slate-600 text-[8px] font-black uppercase rounded">Inativa</span>}
            </div>
            <div className="flex items-center gap-3">
              <span className={cn("text-[10px] font-bold uppercase", org.plan === 'enterprise' ? 'text-amber-600' : 'text-violet-600')}>{org.plan} Plan</span>
              <span className="text-[10px] text-slate-400 font-bold uppercase">• {orgClinics.length} Clínicas</span>
              <span className="text-[10px] text-slate-400 font-bold uppercase">• {totalUsers} Membros Totais</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
          <button
            onClick={onToggleActive}
            className={cn(
              "p-1.5 transition-colors rounded-lg",
              org.is_active 
                ? "text-green-500 hover:bg-green-50 hover:text-green-600" 
                : "text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            )}
            title={org.is_active ? "Desativar Organização" : "Ativar Organização"}
          >
            <Power className="w-4 h-4" />
          </button>

          <div className="w-px h-5 bg-slate-200 mx-1"></div>

          <button
            onClick={e => { e.stopPropagation(); onAddOrgUser(); }}
            className="flex items-center gap-1 px-3 py-1.5 bg-violet-50 hover:bg-violet-100 text-violet-700 rounded-lg text-xs font-bold transition-colors"
          >
            + Usuário
          </button>
          <button
            onClick={e => { e.stopPropagation(); onAddClinic(); }}
            className="flex items-center gap-1 px-3 py-1.5 bg-teal-50 hover:bg-teal-100 text-teal-700 rounded-lg text-xs font-bold transition-colors"
          >
            + Clínica
          </button>
          
          <div className="w-px h-5 bg-slate-200 mx-1"></div>

          <button
            onClick={e => { e.stopPropagation(); onEditOrg(); }}
            className="p-1.5 text-slate-400 hover:text-blue-600 transition-colors rounded-lg hover:bg-blue-50"
            title="Editar Organização"
          >
            <Edit3 className="w-4 h-4" />
          </button>
          
          {confirmingDelete ? (
            <button
              onClick={e => { e.stopPropagation(); onDeleteOrg(); setConfirmingDelete(false); }}
              className="flex items-center gap-1 px-2 py-1 bg-red-500 hover:bg-red-600 text-white rounded-lg text-xs font-bold transition-all"
              onBlur={() => setConfirmingDelete(false)}
            >
              <Trash2 className="w-3 h-3" /> Excluir
            </button>
          ) : (
            <button
              onClick={e => { e.stopPropagation(); setConfirmingDelete(true); }}
              className="p-1.5 text-slate-400 hover:text-red-500 transition-colors rounded-lg hover:bg-red-50"
              title="Excluir Organização"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}

          <div className="ml-2 cursor-pointer" onClick={() => setExpanded(v => !v)}>
            {expanded ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
          </div>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-slate-100">
          {/* Clinics */}
          <div className="p-4 space-y-2">
            <button
              onClick={() => setShowClinics(v => !v)}
              className="flex items-center justify-between w-full text-left mb-1"
            >
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                Clínicas ({orgClinics.length})
              </p>
              {showClinics ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
            </button>
            {showClinics && (
              orgClinics.length === 0 ? (
                <div className="text-center py-6 text-slate-400 text-sm">
                  <Building2 className="w-6 h-6 mx-auto mb-1 opacity-30" />
                  Nenhuma clínica vinculada
                </div>
              ) : (
                <div className="space-y-2 mt-2">
                  {orgClinics.map(clinic => (
                    <ClinicCard
                      key={clinic.id}
                      clinic={clinic}
                      users={clinicUsers[clinic.id] || []}
                      onAddUser={() => onAddClinicUser(clinic.id, clinic.name)}
                      onEdit={() => onEditClinic(clinic)}
                      onDelete={() => onDeleteClinic(clinic)}
                      onRemoveUser={(userId) => onRemoveClinicUser(userId, clinic.id)}
                      onToggleActive={() => onToggleClinicActive(clinic)}
                    />
                  ))}
                </div>
              )
            )}
          </div>

          {/* Org Admins */}
          <div className="border-t border-slate-50 p-4">
            <button
              onClick={() => setShowOrgUsers(v => !v)}
              className="flex items-center justify-between w-full text-left"
            >
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                Membros da Organização ({orgUsers.length})
              </p>
              {showOrgUsers ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
            </button>
            {showOrgUsers && (
              <div className="mt-2 space-y-0.5">
                {orgUsers.length === 0 ? (
                  <p className="text-xs text-slate-400 italic py-2 text-center">Nenhum membro cadastrado</p>
                ) : (
                  orgUsers.map(u => (
                    <UserRow key={u.id} name={u.full_name} email={u.email} role={u.role} />
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Add/Edit User Modal ──────────────────────────────────────────────────────
function AddUserModal({
  type, targetName, onSubmit, onClose,
}: {
  type: 'clinic-user' | 'org-user';
  targetName: string;
  onSubmit: (data: { name: string; email: string; password: string; role: string }) => Promise<boolean>;
  onClose: () => void;
}) {
  const isOrg = type === 'org-user';
  const roles = isOrg
    ? [{ v: 'org_admin', l: 'Admin' }, { v: 'org_owner', l: 'Owner' }, { v: 'org_team', l: 'Equipe' }]
    : [{ v: 'gestor', l: 'Gestor' }, { v: 'medico', l: 'Médico' }, { v: 'secretaria', l: 'Secretária' }];

  const showToast = useToast();
  const [form, setForm] = useState({ name: '', email: '', password: '', role: roles[0].v });
  const [saving, setSaving] = useState(false);
  const [showPass, setShowPass] = useState(false);

  const handle = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const ok = await onSubmit(form);
    setSaving(false);
    if (ok) onClose();
    else showToast('Erro ao adicionar usuário. Email pode já estar em uso.', 'error');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between p-6 border-b border-slate-100">
          <div>
            <h3 className="text-base font-black text-slate-900">
              {isOrg ? 'Adicionar Membro' : 'Adicionar Usuário'}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {isOrg ? 'Organização: ' : 'Clínica: '}<span className="font-bold">{targetName}</span>
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={handle} className="p-6 space-y-4">
          <div className="relative">
            <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input required type="text" value={form.name} placeholder="Nome completo"
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 text-sm"
            />
          </div>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input required type="email" value={form.email} placeholder="Email"
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 text-sm"
            />
          </div>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input required type={showPass ? 'text' : 'password'} value={form.password} placeholder="Senha"
              onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
              className="w-full pl-10 pr-10 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 text-sm"
            />
            <button type="button" onClick={() => setShowPass(v => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-2">Função</label>
            <div className="flex gap-2 flex-wrap">
              {roles.map(r => (
                <button key={r.v} type="button"
                  onClick={() => setForm(f => ({ ...f, role: r.v }))}
                  className={cn('px-4 py-2 rounded-xl text-sm font-bold border transition-colors',
                    form.role === r.v
                      ? 'bg-teal-600 text-white border-teal-600'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-teal-300'
                  )}>
                  {r.l}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-50 text-sm font-bold transition-colors">
              Cancelar
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 py-2.5 bg-teal-600 text-white rounded-xl hover:bg-teal-700 text-sm font-bold transition-colors flex items-center justify-center gap-2 disabled:opacity-60">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              Adicionar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Add/Edit Clinic Modal ────────────────────────────────────────────────────
function EditClinicModal({
  orgs, defaultOrgId, clinic, onSubmit, onClose,
}: {
  orgs: Organization[];
  defaultOrgId: string | null;
  clinic?: Clinic; // If provided, we are editing
  onSubmit: (data: any) => Promise<void>;
  onClose: () => void;
}) {
  const isEditing = !!clinic;
  const [form, setForm] = useState({
    name: clinic?.name || '',
    plan: clinic?.plan || 'pro',
    organization_id: clinic?.organization_id || defaultOrgId || '',
    category: clinic?.category || 'clinica',
    ownerName: '', ownerEmail: '', ownerPassword: '', // Only for creation
    feature_followup: clinic?.features?.feature_followup !== false,
    feature_ia: clinic?.features?.feature_ia !== false,
  });
  const [saving, setSaving] = useState(false);
  const [showPass, setShowPass] = useState(false);

  const handle = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    await onSubmit({
      ...form,
      organization_id: form.organization_id === '' ? null : form.organization_id,
      features: { feature_followup: form.feature_followup, feature_ia: form.feature_ia },
    });
    setSaving(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto custom-scrollbar">
        <div className="flex items-center justify-between p-6 border-b border-slate-100 sticky top-0 bg-white z-10">
          <h3 className="text-base font-black text-slate-900">{isEditing ? 'Editar Clínica' : 'Nova Clínica'}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handle} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1.5">Nome da Clínica</label>
            <input required type="text" value={form.name} placeholder="Nome da clínica"
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1.5">Plano</label>
              <select value={form.plan} onChange={e => setForm(f => ({ ...f, plan: e.target.value as "enterprise" | "pro" | "free" }))}
                className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 bg-white text-sm">
                <option value="free">Free</option>
                <option value="pro">Pro</option>
                <option value="enterprise">Enterprise</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1.5">Organização</label>
              <select value={form.organization_id} onChange={e => setForm(f => ({ ...f, organization_id: e.target.value }))}
                className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 bg-white text-sm">
                <option value="">Independente</option>
                {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1.5">Categoria / Tipo</label>
            <select value={form.category || 'clinica'} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
              className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 bg-white text-sm">
              <option value="clinica">Clínica Médica (Padrão)</option>
              <option value="outro">Outro (Landing Page / Comercial)</option>
            </select>
            <p className="mt-1.5 text-[10px] text-slate-400 italic">
              "Outro" oculta funções médicas como prontuários e corpo clínico na barra lateral.
            </p>
          </div>
          
          {!isEditing && (
            <div className="border-t border-slate-100 pt-4 space-y-3">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Criar Usuário Inicial (opcional)</p>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input type="text" value={form.ownerName} placeholder="Nome"
                  onChange={e => setForm(f => ({ ...f, ownerName: e.target.value }))}
                  className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 text-sm"
                />
              </div>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input type="email" value={form.ownerEmail} placeholder="Email"
                  onChange={e => setForm(f => ({ ...f, ownerEmail: e.target.value }))}
                  className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 text-sm"
                />
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input type={showPass ? 'text' : 'password'} value={form.ownerPassword} placeholder="Senha"
                  onChange={e => setForm(f => ({ ...f, ownerPassword: e.target.value }))}
                  className="w-full pl-10 pr-10 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 text-sm"
                />
                <button type="button" onClick={() => setShowPass(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-2">Função</label>
                <div className="flex gap-2 flex-wrap">
                  {[
                    { v: 'gestor', l: 'Gestor' },
                    { v: 'medico', l: 'Médico' },
                    { v: 'secretaria', l: 'Secretária' }
                  ].map(r => (
                    <button key={r.v} type="button"
                      onClick={() => setForm(f => ({ ...f, ownerRole: r.v }))}
                      className={cn('px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors',
                        (form as any).ownerRole === r.v || (!(form as any).ownerRole && r.v === 'gestor')
                          ? 'bg-teal-600 text-white border-teal-600'
                          : 'bg-white text-slate-600 border-slate-200 hover:border-teal-300'
                      )}>
                      {r.l}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {isEditing && (
            <div className="border-t border-slate-100 pt-4 space-y-2">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Funcionalidades</p>
              <div className="flex items-center justify-between py-2 px-3 rounded-xl bg-slate-50 border border-slate-100">
                <div>
                  <p className="text-xs font-bold text-slate-700">Follow-up</p>
                  <p className="text-[10px] text-slate-400">Disparos automáticos de mensagens</p>
                </div>
                <button type="button"
                  onClick={() => setForm(f => ({ ...f, feature_followup: !f.feature_followup }))}
                  className={cn("w-10 h-5 rounded-full relative transition-all flex-shrink-0", form.feature_followup ? "bg-teal-600" : "bg-slate-300")}
                >
                  <div className={cn("w-3.5 h-3.5 bg-white rounded-full absolute top-0.5 transition-all shadow-sm", form.feature_followup ? "right-0.5" : "left-0.5")} />
                </button>
              </div>
              <div className="flex items-center justify-between py-2 px-3 rounded-xl bg-slate-50 border border-slate-100">
                <div>
                  <p className="text-xs font-bold text-slate-700">Configurações IA</p>
                  <p className="text-[10px] text-slate-400">Agente IA e configurações avançadas</p>
                </div>
                <button type="button"
                  onClick={() => setForm(f => ({ ...f, feature_ia: !f.feature_ia }))}
                  className={cn("w-10 h-5 rounded-full relative transition-all flex-shrink-0", form.feature_ia ? "bg-violet-600" : "bg-slate-300")}
                >
                  <div className={cn("w-3.5 h-3.5 bg-white rounded-full absolute top-0.5 transition-all shadow-sm", form.feature_ia ? "right-0.5" : "left-0.5")} />
                </button>
              </div>
            </div>
          )}

          <div className="flex gap-3 pt-4 border-t border-slate-100">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-50 text-sm font-bold">
              Cancelar
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 py-2.5 bg-teal-600 text-white rounded-xl hover:bg-teal-700 text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-60">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {isEditing ? 'Salvar Alterações' : 'Criar Clínica'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Add/Edit Org Modal ───────────────────────────────────────────────────────
function EditOrgModal({ 
  org, onSubmit, onClose 
}: { 
  org?: Organization; 
  onSubmit: (data: any) => Promise<void>; 
  onClose: () => void 
}) {
  const isEditing = !!org;
  const [form, setForm] = useState({ 
    name: org?.name || '', 
    plan: org?.plan || 'pro',
    ownerName: '', ownerEmail: '', ownerPassword: '' 
  });
  const [saving, setSaving] = useState(false);
  const [showPass, setShowPass] = useState(false);

  const handle = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    await onSubmit(form);
    setSaving(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between p-6 border-b border-slate-100">
          <h3 className="text-base font-black text-slate-900">{isEditing ? 'Editar Organização' : 'Nova Organização'}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handle} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1.5">Nome da Organização</label>
            <input required type="text" value={form.name} placeholder="Nome da organização"
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1.5">Plano</label>
            <select value={form.plan} onChange={e => setForm(f => ({ ...f, plan: e.target.value }))}
              className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 bg-white text-sm">
              <option value="free">Free</option>
              <option value="pro">Pro</option>
              <option value="enterprise">Enterprise</option>
            </select>
          </div>
          {!isEditing && (
            <div className="border-t border-slate-100 pt-4 space-y-3">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Criar Owner (opcional)</p>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input type="text" value={form.ownerName} placeholder="Nome"
                  onChange={e => setForm(f => ({ ...f, ownerName: e.target.value }))}
                  className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 text-sm"
                />
              </div>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input type="email" value={form.ownerEmail} placeholder="Email"
                  onChange={e => setForm(f => ({ ...f, ownerEmail: e.target.value }))}
                  className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 text-sm"
                />
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input type={showPass ? 'text' : 'password'} value={form.ownerPassword} placeholder="Senha"
                  onChange={e => setForm(f => ({ ...f, ownerPassword: e.target.value }))}
                  className="w-full pl-10 pr-10 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 text-sm"
                />
                <button type="button" onClick={() => setShowPass(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-2">Função</label>
                <div className="flex gap-2 flex-wrap">
                  {[
                    { v: 'org_owner', l: 'Owner' },
                    { v: 'org_admin', l: 'Admin' },
                    { v: 'org_team', l: 'Equipe' }
                  ].map(r => (
                    <button key={r.v} type="button"
                      onClick={() => setForm(f => ({ ...f, ownerRole: r.v }))}
                      className={cn('px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors',
                        (form as any).ownerRole === r.v || (!(form as any).ownerRole && r.v === 'org_owner')
                          ? 'bg-teal-600 text-white border-teal-600'
                          : 'bg-white text-slate-600 border-slate-200 hover:border-teal-300'
                      )}>
                      {r.l}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="flex gap-3 pt-4 border-t border-slate-100">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-50 text-sm font-bold">
              Cancelar
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 py-2.5 bg-teal-600 text-white rounded-xl hover:bg-teal-700 text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-60">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {isEditing ? 'Salvar Alterações' : 'Criar Organização'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Prompts Fixos (biblioteca de IA) ─────────────────────────────────────────
const FOCUS_OPTIONS = [
  { value: 'sdr', label: 'SDR' },
  { value: 'agendamento', label: 'Agendamento' },
  { value: 'suporte', label: 'Suporte' },
  { value: 'teste', label: 'Teste' },
  { value: 'clinica', label: 'Clínica' },
  { value: 'varejo', label: 'Varejo' },
];

const focusLabel = (focus: string) => FOCUS_OPTIONS.find(f => f.value === focus)?.label || focus;

const focusBadge = (focus: string) => {
  const map: Record<string, string> = {
    sdr: 'bg-blue-100 text-blue-700',
    agendamento: 'bg-teal-100 text-teal-700',
    suporte: 'bg-amber-100 text-amber-700',
    teste: 'bg-rose-100 text-rose-700',
    clinica: 'bg-violet-100 text-violet-700',
    varejo: 'bg-emerald-100 text-emerald-700',
  };
  return cn('text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full', map[focus] || 'bg-slate-100 text-slate-500');
};

function PromptTemplateModal({ template, onSubmit, onClose }: {
  template?: PromptTemplate;
  onSubmit: (data: { name: string; focus: string; content: string; is_active: boolean }) => Promise<boolean>;
  onClose: () => void;
}) {
  const isEditing = !!template;
  const presetFocus = template ? FOCUS_OPTIONS.some(f => f.value === template.focus) : true;
  const [form, setForm] = useState({
    name: template?.name || '',
    focus: template?.focus || 'clinica',
    content: template?.content || '',
    is_active: template?.is_active ?? true,
  });
  const [customFocus, setCustomFocus] = useState(!presetFocus);
  const [saving, setSaving] = useState(false);

  const handle = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const ok = await onSubmit({ ...form, focus: form.focus.trim() || 'clinica' });
    setSaving(false);
    if (ok) onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto custom-scrollbar">
        <div className="flex items-center justify-between p-6 border-b border-slate-100 sticky top-0 bg-white z-10">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-teal-50 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-teal-600" />
            </div>
            <h3 className="text-base font-black text-slate-900">{isEditing ? 'Editar Prompt Fixo' : 'Novo Prompt Fixo'}</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handle} className="p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1.5">Nome</label>
              <input required type="text" value={form.name} placeholder="Ex: SDR Consultivo"
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1.5">Tipo</label>
              {customFocus ? (
                <div className="flex gap-2">
                  <input type="text" value={form.focus} placeholder="tipo-personalizado"
                    onChange={e => setForm(f => ({ ...f, focus: e.target.value }))}
                    className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 text-sm"
                  />
                  <button type="button" onClick={() => { setCustomFocus(false); setForm(f => ({ ...f, focus: 'clinica' })); }}
                    className="px-3 text-xs font-bold text-slate-500 hover:text-slate-700 shrink-0">Lista</button>
                </div>
              ) : (
                <select value={form.focus}
                  onChange={e => { if (e.target.value === '__custom__') { setCustomFocus(true); setForm(f => ({ ...f, focus: '' })); } else setForm(f => ({ ...f, focus: e.target.value })); }}
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 bg-white text-sm">
                  {FOCUS_OPTIONS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                  <option value="__custom__">Outro (personalizado)…</option>
                </select>
              )}
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-600 mb-1.5">Conteúdo do Prompt (comportamento do agente)</label>
            <textarea required rows={12} value={form.content}
              onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
              placeholder="Descreva o papel e o comportamento do agente para este tipo de atendimento..."
              className="w-full p-4 font-mono text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 leading-relaxed resize-y"
            />
            <p className="mt-1.5 text-[10px] text-slate-400 italic">As Informações da Clínica de cada cliente serão combinadas com este conteúdo.</p>
          </div>

          <div className="flex items-center justify-between py-2 px-3 rounded-xl bg-slate-50 border border-slate-100">
            <div>
              <p className="text-xs font-bold text-slate-700">Ativo</p>
              <p className="text-[10px] text-slate-400">Aparece para as clínicas escolherem</p>
            </div>
            <button type="button" onClick={() => setForm(f => ({ ...f, is_active: !f.is_active }))}
              className={cn("w-10 h-5 rounded-full relative transition-all flex-shrink-0", form.is_active ? "bg-teal-600" : "bg-slate-300")}>
              <div className={cn("w-3.5 h-3.5 bg-white rounded-full absolute top-0.5 transition-all shadow-sm", form.is_active ? "right-0.5" : "left-0.5")} />
            </button>
          </div>

          <div className="flex gap-3 pt-4 border-t border-slate-100">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-50 text-sm font-bold">Cancelar</button>
            <button type="submit" disabled={saving}
              className="flex-1 py-2.5 bg-teal-600 text-white rounded-xl hover:bg-teal-700 text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-60">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {isEditing ? 'Salvar Alterações' : 'Criar Prompt'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function PromptTemplatesManager() {
  const showToast = useToast();
  const { templates, loading, create, update, remove } = usePromptTemplates();
  const [modal, setModal] = useState<{ type: 'new' } | { type: 'edit'; template: PromptTemplate } | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

  if (loading) {
    return <div className="flex items-center justify-center min-h-[300px]"><Loader2 className="w-8 h-8 text-teal-600 animate-spin" /></div>;
  }

  const handleCreate = async (data: any) => {
    const ok = await create(data);
    if (!ok) showToast('Erro ao criar prompt. Verifique se você é super-admin.', 'error');
    return ok;
  };
  const handleEdit = async (id: string, data: any) => {
    const ok = await update(id, data);
    if (!ok) showToast('Erro ao salvar prompt.', 'error');
    return ok;
  };
  const handleDelete = async (id: string) => {
    const ok = await remove(id);
    if (!ok) showToast('Erro ao excluir prompt.', 'error');
    setConfirmingDelete(null);
  };
  const handleToggleActive = async (t: PromptTemplate) => {
    const ok = await update(t.id, { is_active: !t.is_active });
    if (!ok) showToast('Erro ao alterar status.', 'error');
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-black text-slate-900 flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-teal-600" />
              Prompts Fixos (Biblioteca de IA)
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              Modelos de comportamento do agente por tipo de negócio. Cada clínica escolhe qual usar na aba Configurações IA; as informações da empresa do cliente são combinadas automaticamente.
            </p>
          </div>
          <button onClick={() => setModal({ type: 'new' })}
            className="shrink-0 inline-flex items-center gap-2 px-4 py-2.5 bg-teal-600 hover:bg-teal-700 text-white rounded-xl font-bold text-sm transition-colors shadow-sm">
            <Plus className="w-4 h-4" /> Novo Prompt Fixo
          </button>
        </div>

        {templates.length === 0 ? (
          <div className="text-center py-16 text-slate-400">
            <Sparkles className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">Nenhum prompt fixo cadastrado</p>
            <p className="text-sm mt-1">Clique em "Novo Prompt Fixo" para começar</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {templates.map(t => (
              <div key={t.id} className={cn("p-5 hover:bg-slate-50/50 transition-colors", !t.is_active && "opacity-60")}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={focusBadge(t.focus)}>{focusLabel(t.focus)}</span>
                      <p className="font-bold text-slate-900 text-sm truncate">{t.name}</p>
                      {!t.is_active && <span className="px-1.5 py-0.5 bg-slate-200 text-slate-600 text-[8px] font-black uppercase rounded">Inativo</span>}
                    </div>
                    <p className="text-xs text-slate-500 truncate">
                      {t.content?.trim() ? t.content.replace(/\s+/g, ' ').slice(0, 180) : <span className="italic text-slate-300">Sem conteúdo</span>}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => handleToggleActive(t)} title={t.is_active ? 'Desativar' : 'Ativar'}
                      className={cn("p-1.5 rounded-lg transition-colors", t.is_active ? "text-green-500 hover:bg-green-50" : "text-slate-400 hover:bg-slate-100")}>
                      <Power className="w-4 h-4" />
                    </button>
                    <button onClick={() => setModal({ type: 'edit', template: t })} title="Editar"
                      className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                      <Edit3 className="w-4 h-4" />
                    </button>
                    {confirmingDelete === t.id ? (
                      <button onClick={() => handleDelete(t.id)} onBlur={() => setConfirmingDelete(null)} autoFocus
                        className="flex items-center gap-1 px-2 py-1 bg-red-500 hover:bg-red-600 text-white rounded-lg text-xs font-bold">
                        <Trash2 className="w-3 h-3" /> Excluir
                      </button>
                    ) : (
                      <button onClick={() => setConfirmingDelete(t.id)} title="Excluir"
                        className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {modal?.type === 'new' && (
        <PromptTemplateModal onSubmit={handleCreate} onClose={() => setModal(null)} />
      )}
      {modal?.type === 'edit' && (
        <PromptTemplateModal template={modal.template}
          onSubmit={async (data) => handleEdit(modal.template.id, data)}
          onClose={() => setModal(null)} />
      )}
    </div>
  );
}

// ─── SystemSettingsTab (wrapper com sub-abas) ─────────────────────────────────
function SystemSettingsTab() {
  const [subTab, setSubTab] = useState<'prompts' | 'vars'>('prompts');
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl w-fit">
        {[
          { id: 'prompts', label: 'Prompts Fixos' },
          { id: 'vars', label: 'Variáveis de Sistema' },
        ].map(t => (
          <button key={t.id} onClick={() => setSubTab(t.id as any)}
            className={cn("px-4 py-2 rounded-lg text-sm font-bold transition-all",
              subTab === t.id ? "bg-white text-teal-700 shadow-sm" : "text-slate-500 hover:text-slate-700")}>
            {t.label}
          </button>
        ))}
      </div>
      {subTab === 'prompts' ? <PromptTemplatesManager /> : <SystemVariablesSection />}
    </div>
  );
}

// ─── SystemVariablesSection (chaves de sistema chave/valor) ────────────────────
function SystemVariablesSection() {
  const showToast = useToast();
  const { settings, loading, updateSetting } = useGlobalSystemSettings();
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [newKey, setNewKey] = useState('');

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <Loader2 className="w-8 h-8 text-teal-600 animate-spin" />
      </div>
    );
  }

  const handleSave = async (key: string) => {
    setSaving(true);
    const ok = await updateSetting(key, editValue);
    setSaving(false);
    if (ok) {
      setEditingKey(null);
      setNewKey('');
    } else {
      showToast('Erro ao salvar configuração.', 'error');
    }
  };

  const settingsList = Object.entries(settings).sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-100 bg-slate-50/50">
          <h2 className="text-lg font-black text-slate-900 flex items-center gap-2">
            <SettingsIcon className="w-5 h-5 text-slate-500" />
            Variáveis de Sistema
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            Estas chaves controlam configurações globais, integrações e templates que se aplicam a todas as clínicas e instâncias no n8n.
          </p>
        </div>
        
        <div className="divide-y divide-slate-100">
          {settingsList.map(([key, value]) => {
            const isEditing = editingKey === key;
            return (
              <div key={key} className="p-5 hover:bg-slate-50/50 transition-colors">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="font-mono text-xs font-bold text-slate-700 bg-slate-100 inline-flex px-2 py-1 rounded-md mb-2">
                      {key}
                    </p>
                    
                    {isEditing ? (
                      <div className="space-y-3 mt-2">
                        <textarea
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          className="w-full h-32 p-3 font-mono text-xs bg-slate-900 text-green-400 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 shadow-inner"
                          placeholder="Valor da variável..."
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleSave(key)}
                            disabled={saving}
                            className="flex items-center gap-1.5 px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-xs font-bold transition-colors shadow-sm disabled:opacity-50"
                          >
                            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                            Salvar
                          </button>
                          <button
                            onClick={() => setEditingKey(null)}
                            disabled={saving}
                            className="px-4 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-lg text-xs font-bold transition-colors"
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="relative group">
                        <pre className="font-mono text-xs text-slate-600 bg-slate-50 p-3 rounded-xl overflow-x-auto whitespace-pre-wrap border border-slate-100 max-h-40 custom-scrollbar">
                          {value || <span className="text-slate-400 italic">Vazio</span>}
                        </pre>
                      </div>
                    )}
                  </div>
                  
                  {!isEditing && (
                    <button
                      onClick={() => { setEditingKey(key); setEditValue(value); }}
                      className="p-2 text-slate-400 hover:text-teal-600 hover:bg-teal-50 rounded-lg transition-colors"
                      title="Editar"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Add New Key */}
      <div className="bg-slate-50 rounded-2xl border border-slate-200 border-dashed p-6 text-center">
        {editingKey === 'NEW' ? (
          <div className="max-w-xl mx-auto text-left space-y-4">
            <h3 className="font-bold text-slate-900">Adicionar Nova Variável</h3>
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1.5">Chave (Key)</label>
              <input type="text" value={newKey} onChange={e => setNewKey(e.target.value)}
                placeholder="ex: webhook_nova_url"
                className="w-full px-4 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500 font-mono text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-600 mb-1.5">Valor</label>
              <textarea value={editValue} onChange={e => setEditValue(e.target.value)}
                placeholder="Conteúdo..."
                className="w-full h-24 p-3 font-mono text-xs bg-slate-900 text-green-400 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => handleSave(newKey)}
                disabled={saving || !newKey.trim()}
                className="flex items-center gap-1.5 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-sm font-bold transition-colors shadow-sm disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                Adicionar
              </button>
              <button
                onClick={() => setEditingKey(null)}
                disabled={saving}
                className="px-4 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 rounded-lg text-sm font-bold transition-colors"
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => { setEditingKey('NEW'); setEditValue(''); setNewKey(''); }}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 shadow-sm hover:border-teal-300 hover:text-teal-600 text-slate-600 rounded-xl font-bold transition-all"
          >
            <Plus className="w-4 h-4" /> Nova Variável de Sistema
          </button>
        )}
      </div>
    </div>
  );
}


// ─── Main ─────────────────────────────────────────────────────────────────────
export default function SuperAdmin() {
  const showToast = useToast();
  const { data: clinics, loading: clinicsLoading, create: createClinic, update: updateClinic, deleteClinic } = useClinics();
  const { data: orgs, loading: orgsLoading, create: createOrg, update: updateOrg, remove: deleteOrg } = useOrganizations();
  const { clinicUsers, orgUsers, usersLoading, addClinicUser, addOrgUser, removeClinicUser, totalUsers, refetchUsers } = useSuperAdminData();

  const [activeTab, setActiveTab] = useState<'gestao' | 'settings'>('gestao');
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<ModalState>(null);

  const loading = clinicsLoading || orgsLoading || usersLoading;

  const q = search.toLowerCase();
  const filteredClinics = clinics.filter(c => matchesSearch(search, { name: c.name }));
  const filteredOrgs = orgs.filter(o =>
    matchesSearch(search, { name: o.name }) ||
    clinics.some(c => c.organization_id === o.id && matchesSearch(search, { name: c.name }))
  );

  const clinicsInOrg = (orgId: string) => filteredClinics.filter(c => c.organization_id === orgId);
  const standaloneClinics = filteredClinics.filter(c => !c.organization_id);

  // Handlers Clínicas
  const handleDeleteClinic = async (clinic: Clinic) => {
    // Delete validation already done in component
    const ok = await deleteClinic(clinic.id);
    if (!ok) showToast('Erro ao excluir clínica.', 'error');
  };

  const handleCreateClinic = async (data: any) => {
    const { error } = await createClinic(data);
    if (error) showToast('Erro: ' + error.message, 'error');
  };

  const handleEditClinic = async (data: any) => {
    const ok = await updateClinic(data.id, {
      name: data.name,
      plan: data.plan as 'free'|'pro'|'enterprise',
      organization_id: data.organization_id,
      category: data.category,
      features: data.features,
    } as any);
    if (!ok) showToast('Erro ao atualizar clínica.', 'error');
  };

  // Handlers Orgs
  const handleDeleteOrg = async (org: Organization) => {
    const clinicsCount = clinicsInOrg(org.id).length;
    const msg = clinicsCount > 0 
      ? `ATENÇÃO: Esta organização possui ${clinicsCount} clínica(s). Excluir a organização apagará TODAS as clínicas, usuários, leads e dados vinculados permanentemente. Tem certeza?`
      : 'Tem certeza que deseja excluir esta organização?';

    if (!confirm(msg)) return;

    const ok = await deleteOrg(org.id);
    if (!ok) showToast('Erro ao excluir organização.', 'error');
  };

  const handleToggleClinicActive = async (clinic: Clinic) => {
    const ok = await updateClinic(clinic.id, { is_active: !clinic.is_active });
    if (!ok) showToast('Erro ao alterar status da clínica.', 'error');
  };

  const handleToggleClinicFeature = async (clinic: Clinic, feature: 'feature_followup' | 'feature_ia') => {
    const current = clinic.features ?? { feature_followup: true, feature_ia: true };
    const newFeatures = { ...current, [feature]: current[feature] === false ? true : false };
    const ok = await updateClinic(clinic.id, { features: newFeatures } as any);
    if (!ok) showToast('Erro ao alterar funcionalidade.', 'error');
  };

  const handleToggleOrgActive = async (org: Organization) => {
    const ok = await updateOrg(org.id, { is_active: !org.is_active });
    if (!ok) showToast('Erro ao alterar status da organização.', 'error');
  };

  const handleCreateOrg = async (data: { name: string; plan: string }) => {
    const { error } = await createOrg(data);
    if (error) showToast('Erro: ' + error.message, 'error');
  };

  const handleEditOrg = async (data: { name: string; plan: string }) => {
    if (modal?.type === 'edit-org') {
      const ok = await updateOrg(modal.org.id, {
        name: data.name,
        plan: data.plan
      });
      if (!ok) showToast('Erro ao atualizar organização.', 'error');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 text-teal-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-20">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900">Super Admin</h1>
          <p className="text-sm text-slate-500">Gestão global de organizações, clínicas e variáveis de sistema.</p>
        </div>
        
        {/* Tabs */}
        <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
          <button
            onClick={() => setActiveTab('gestao')}
            className={cn(
              "px-4 py-2 rounded-lg text-sm font-bold transition-all",
              activeTab === 'gestao' ? "bg-white text-teal-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
            )}
          >
            Organizações e Clínicas
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            className={cn(
              "px-4 py-2 rounded-lg text-sm font-bold transition-all",
              activeTab === 'settings' ? "bg-white text-teal-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
            )}
          >
            System Settings
          </button>
        </div>
      </div>

      {activeTab === 'gestao' ? (
        <>
          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Organizações', value: orgs.length, icon: Network, color: 'bg-violet-50 text-violet-600' },
              { label: 'Clínicas', value: clinics.length, icon: Building2, color: 'bg-teal-50 text-teal-600' },
              { label: 'Usuários', value: totalUsers, icon: Users, color: 'bg-blue-50 text-blue-600' },
              { label: 'Planos Pagos', value: clinics.filter(c => c.plan !== 'free').length, icon: ShieldCheck, color: 'bg-amber-50 text-amber-600' },
            ].map(s => (
              <div key={s.label} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 flex items-center gap-3">
                <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0', s.color)}>
                  <s.icon className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-xl font-black text-slate-900">{s.value}</p>
                  <p className="text-xs text-slate-500 font-medium">{s.label}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            {/* Search */}
            <div className="relative max-w-md w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input type="text" placeholder="Buscar organização ou clínica..."
                value={search} onChange={e => setSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all"
              />
            </div>
            
            <div className="flex gap-2">
              <button onClick={() => setModal({ type: 'org' })}
                className="bg-violet-600 hover:bg-violet-700 text-white px-4 py-2 rounded-xl font-bold flex items-center gap-2 text-sm transition-colors shadow-sm">
                <Plus className="w-4 h-4" /> Nova Org
              </button>
              <button onClick={() => setModal({ type: 'clinic', orgId: null })}
                className="bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-xl font-bold flex items-center gap-2 text-sm transition-colors shadow-sm">
                <Plus className="w-4 h-4" /> Nova Clínica
              </button>
            </div>
          </div>

          {/* Organizações */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-black text-slate-400 uppercase tracking-widest">Organizações ({filteredOrgs.length})</h2>
            </div>
            {filteredOrgs.length === 0 && search && (
              <div className="bg-white rounded-2xl border border-slate-100 p-10 text-center">
                <Network className="w-8 h-8 text-slate-200 mx-auto mb-2" />
                <p className="text-slate-400 text-sm">Nenhuma organização encontrada.</p>
              </div>
            )}
            {filteredOrgs.map(org => (
              <OrgSection
                key={org.id}
                org={org}
                orgClinics={clinicsInOrg(org.id)}
                clinicUsers={clinicUsers}
                orgUsers={orgUsers[org.id] || []}
                onAddClinic={() => setModal({ type: 'clinic', orgId: org.id })}
                onAddOrgUser={() => setModal({ type: 'org-user', orgId: org.id, orgName: org.name })}
                onAddClinicUser={(clinicId, clinicName) => setModal({ type: 'clinic-user', clinicId, clinicName })}
                onEditOrg={() => setModal({ type: 'edit-org', org })}
                onEditClinic={(clinic) => setModal({ type: 'edit-clinic', clinic })}
                onDeleteOrg={() => handleDeleteOrg(org)}
                onDeleteClinic={handleDeleteClinic}
                onRemoveClinicUser={removeClinicUser}
                onToggleActive={() => handleToggleOrgActive(org)}
                onToggleClinicActive={handleToggleClinicActive}
              />
            ))}
          </div>

          {/* Clínicas Independentes */}
          {standaloneClinics.length > 0 && (
            <div className="space-y-4">
              <h2 className="text-xs font-black text-slate-400 uppercase tracking-widest">
                Clínicas Independentes ({standaloneClinics.length})
              </h2>
              <div className="space-y-2">
                {standaloneClinics.map(clinic => (
                  <ClinicCard
                    key={clinic.id}
                    clinic={clinic}
                    users={clinicUsers[clinic.id] || []}
                    onAddUser={() => setModal({ type: 'clinic-user', clinicId: clinic.id, clinicName: clinic.name })}
                    onEdit={() => setModal({ type: 'edit-clinic', clinic })}
                    onDelete={() => handleDeleteClinic(clinic)}
                    onRemoveUser={(userId) => removeClinicUser(userId, clinic.id)}
                    onToggleActive={() => handleToggleClinicActive(clinic)}
                    showId
                  />
                ))}
              </div>
            </div>
          )}
        </>
      ) : (
        <SystemSettingsTab />
      )}

      {/* Modais de Criação e Edição */}
      {modal?.type === 'org' && (
        <EditOrgModal onSubmit={handleCreateOrg} onClose={() => setModal(null)} />
      )}

      {modal?.type === 'edit-org' && (
        <EditOrgModal org={modal.org} onSubmit={handleEditOrg} onClose={() => setModal(null)} />
      )}

      {modal?.type === 'clinic' && (
        <EditClinicModal
          orgs={orgs}
          defaultOrgId={modal.orgId}
          onSubmit={handleCreateClinic}
          onClose={() => setModal(null)}
        />
      )}

      {modal?.type === 'edit-clinic' && (
        <EditClinicModal
          orgs={orgs}
          defaultOrgId={modal.clinic.organization_id}
          clinic={modal.clinic}
          onSubmit={async (data) => handleEditClinic({ id: modal.clinic.id, ...data })}
          onClose={() => setModal(null)}
        />
      )}

      {modal?.type === 'clinic-user' && (
        <AddUserModal
          type="clinic-user"
          targetName={modal.clinicName}
          onSubmit={async data => addClinicUser(modal.clinicId, data)}
          onClose={() => setModal(null)}
        />
      )}

      {modal?.type === 'org-user' && (
        <AddUserModal
          type="org-user"
          targetName={modal.orgName}
          onSubmit={async data => addOrgUser(modal.orgId, data)}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
