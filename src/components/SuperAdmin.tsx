import React, { useState } from 'react';
import {
  useClinics, useOrganizations, useSuperAdminData,
  Clinic, Organization, ClinicUser, OrgUser,
} from '../hooks/useSupabase';
import {
  Building2, Plus, Search, ShieldCheck, Loader2, X, Network, User, Mail, Lock,
  ChevronDown, ChevronRight, Trash2, Users, Crown, Stethoscope, KeyRound,
  MoreHorizontal, UserPlus, Eye, EyeOff,
} from 'lucide-react';
import { cn } from '@/src/lib/utils';

// ─── tipos de modal ───────────────────────────────────────────────────────────
type ModalState =
  | { type: 'org' }
  | { type: 'clinic'; orgId: string | null }
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
    'super-admin': 'bg-rose-100 text-rose-700',
  };
  const roleLabels: Record<string, string> = {
    gestor: 'Gestor', medico: 'Médico', secretaria: 'Secretária',
    org_owner: 'Owner', org_admin: 'Admin', 'super-admin': 'Super',
  };
  return { cls: cn('text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full', map[role] || 'bg-slate-100 text-slate-500'), label: roleLabels[role] || role };
};

const initials = (name: string) => name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();

// ─── Avatar ───────────────────────────────────────────────────────────────────
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
  clinic, users, onAddUser, onDelete, onRemoveUser, showId = false,
}: {
  clinic: Clinic;
  users: ClinicUser[];
  onAddUser: () => void;
  onDelete: () => void;
  onRemoveUser: (userId: string) => void;
  showId?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const { label: planLabel } = { label: clinic.plan };

  return (
    <div className="rounded-2xl border border-slate-100 bg-white overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="w-8 h-8 rounded-xl bg-teal-50 flex items-center justify-center flex-shrink-0">
          <Building2 className="w-4 h-4 text-teal-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-slate-900 text-sm truncate">{clinic.name}</p>
          {showId && <p className="text-[10px] text-slate-400 font-mono truncate">{clinic.id}</p>}
        </div>
        <span className={planBadge(clinic.plan)}>{clinic.plan}</span>
        <div className="flex items-center gap-1">
          <button
            onClick={onAddUser}
            className="flex items-center gap-1 px-2.5 py-1.5 bg-teal-50 hover:bg-teal-100 text-teal-700 rounded-lg text-xs font-bold transition-colors"
          >
            + Usuário
          </button>
          <button
            onClick={() => setExpanded(v => !v)}
            className="flex items-center gap-1 px-2.5 py-1.5 bg-slate-50 hover:bg-slate-100 text-slate-600 rounded-lg text-xs font-bold transition-colors"
          >
            <span>{users.length}</span>
            {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </button>
          {confirmingDelete ? (
            <button
              onClick={() => { onDelete(); setConfirmingDelete(false); }}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-red-500 hover:bg-red-600 text-white rounded-lg text-xs font-bold transition-all"
              onBlur={() => setConfirmingDelete(false)}
              autoFocus
            >
              <Trash2 className="w-3 h-3" /> Excluir
            </button>
          ) : (
            <button
              onClick={() => setConfirmingDelete(true)}
              className="p-1.5 text-slate-300 hover:text-red-500 transition-colors rounded-lg hover:bg-red-50"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-slate-50 px-4 py-2 bg-slate-50/50">
          {users.length === 0 ? (
            <p className="text-xs text-slate-400 italic py-2 text-center">Nenhum usuário cadastrado</p>
          ) : (
            <div className="space-y-0.5">
              {users.map(u => (
                <UserRow key={u.id} name={u.full_name} email={u.email} role={u.role} onRemove={() => onRemoveUser(u.id)} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── OrgSection ───────────────────────────────────────────────────────────────
function OrgSection({
  org, orgClinics, clinicUsers, orgUsers,
  onAddClinic, onAddOrgUser, onAddClinicUser, onDeleteClinic, onRemoveClinicUser,
}: {
  org: Organization;
  orgClinics: Clinic[];
  clinicUsers: Record<string, ClinicUser[]>;
  orgUsers: OrgUser[];
  onAddClinic: () => void;
  onAddOrgUser: () => void;
  onAddClinicUser: (clinicId: string, clinicName: string) => void;
  onDeleteClinic: (clinic: Clinic) => void;
  onRemoveClinicUser: (userId: string, clinicId: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [showOrgUsers, setShowOrgUsers] = useState(false);
  const totalUsers = orgClinics.reduce((s, c) => s + (clinicUsers[c.id]?.length || 0), 0) + orgUsers.length;

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      {/* Org Header */}
      <div
        className="flex items-center gap-3 px-5 py-4 cursor-pointer hover:bg-slate-50 transition-colors select-none"
        onClick={() => setExpanded(v => !v)}
      >
        <div className="w-10 h-10 rounded-xl bg-violet-100 flex items-center justify-center flex-shrink-0">
          <Network className="w-5 h-5 text-violet-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-black text-slate-900">{org.name}</p>
          <p className="text-xs text-slate-400">
            {orgClinics.length} clínica{orgClinics.length !== 1 ? 's' : ''} · {totalUsers} usuário{totalUsers !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={planBadge(org.plan)}>{org.plan}</span>
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
          {expanded ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-slate-100">
          {/* Clinics */}
          <div className="p-4 space-y-2">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Clínicas</p>
            {orgClinics.length === 0 ? (
              <div className="text-center py-6 text-slate-400 text-sm">
                <Building2 className="w-6 h-6 mx-auto mb-1 opacity-30" />
                Nenhuma clínica vinculada
              </div>
            ) : (
              <div className="space-y-2">
                {orgClinics.map(clinic => (
                  <ClinicCard
                    key={clinic.id}
                    clinic={clinic}
                    users={clinicUsers[clinic.id] || []}
                    onAddUser={() => onAddClinicUser(clinic.id, clinic.name)}
                    onDelete={() => onDeleteClinic(clinic)}
                    onRemoveUser={(userId) => onRemoveClinicUser(userId, clinic.id)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Org Admins */}
          <div className="border-t border-slate-50 p-4">
            <button
              onClick={() => setShowOrgUsers(v => !v)}
              className="flex items-center justify-between w-full text-left"
            >
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                Admins da Organização ({orgUsers.length})
              </p>
              {showOrgUsers ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
            </button>
            {showOrgUsers && (
              <div className="mt-2 space-y-0.5">
                {orgUsers.length === 0 ? (
                  <p className="text-xs text-slate-400 italic py-2 text-center">Nenhum admin cadastrado</p>
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

// ─── AddUserModal ─────────────────────────────────────────────────────────────
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
    ? [{ v: 'org_admin', l: 'Admin da Org' }, { v: 'org_owner', l: 'Owner' }]
    : [{ v: 'gestor', l: 'Gestor' }, { v: 'medico', l: 'Médico' }, { v: 'secretaria', l: 'Secretária' }];

  const [form, setForm] = useState({ name: '', email: '', password: '', role: roles[0].v });
  const [saving, setSaving] = useState(false);
  const [showPass, setShowPass] = useState(false);

  const handle = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const ok = await onSubmit(form);
    setSaving(false);
    if (ok) onClose();
    else alert('Erro ao adicionar usuário. Email pode já estar em uso.');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between p-6 border-b border-slate-100">
          <div>
            <h3 className="text-base font-black text-slate-900">
              {isOrg ? 'Adicionar Admin' : 'Adicionar Usuário'}
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

// ─── AddClinicModal ───────────────────────────────────────────────────────────
function AddClinicModal({
  orgs, defaultOrgId, onSubmit, onClose,
}: {
  orgs: Organization[];
  defaultOrgId: string | null;
  onSubmit: (data: any) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState({
    name: '', plan: 'pro', organization_id: defaultOrgId,
    ownerName: '', ownerEmail: '', ownerPassword: '',
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-slate-100 sticky top-0 bg-white z-10">
          <h3 className="text-base font-black text-slate-900">Nova Clínica</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handle} className="p-6 space-y-4">
          <input required type="text" value={form.name} placeholder="Nome da clínica"
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 text-sm"
          />
          <div className="grid grid-cols-2 gap-3">
            <select value={form.plan} onChange={e => setForm(f => ({ ...f, plan: e.target.value }))}
              className="px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 bg-white text-sm">
              <option value="free">Free</option>
              <option value="pro">Pro</option>
              <option value="enterprise">Enterprise</option>
            </select>
            <select value={form.organization_id || ''} onChange={e => setForm(f => ({ ...f, organization_id: e.target.value || null }))}
              className="px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 bg-white text-sm">
              <option value="">Sem organização</option>
              {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
          <div className="border-t border-slate-100 pt-4 space-y-3">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Gestor (opcional)</p>
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
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-50 text-sm font-bold">
              Cancelar
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 py-2.5 bg-teal-600 text-white rounded-xl hover:bg-teal-700 text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-60">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              Criar Clínica
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── AddOrgModal ──────────────────────────────────────────────────────────────
function AddOrgModal({ onSubmit, onClose }: { onSubmit: (d: { name: string; plan: string }) => Promise<void>; onClose: () => void }) {
  const [form, setForm] = useState({ name: '', plan: 'pro' });
  const [saving, setSaving] = useState(false);

  const handle = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    await onSubmit(form);
    setSaving(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4">
        <div className="flex items-center justify-between p-6 border-b border-slate-100">
          <h3 className="text-base font-black text-slate-900">Nova Organização</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handle} className="p-6 space-y-4">
          <input required autoFocus type="text" value={form.name} placeholder="Nome da organização"
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 text-sm"
          />
          <select value={form.plan} onChange={e => setForm(f => ({ ...f, plan: e.target.value }))}
            className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none bg-white text-sm">
            <option value="free">Free</option>
            <option value="pro">Pro</option>
            <option value="enterprise">Enterprise</option>
          </select>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-50 text-sm font-bold">
              Cancelar
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 py-2.5 bg-violet-600 text-white rounded-xl hover:bg-violet-700 text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-60">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              Criar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function SuperAdmin() {
  const { data: clinics, loading: clinicsLoading, create: createClinic, deleteClinic } = useClinics();
  const { data: orgs, loading: orgsLoading, create: createOrg } = useOrganizations();
  const { clinicUsers, orgUsers, usersLoading, addClinicUser, addOrgUser, removeClinicUser, totalUsers, refetchUsers } = useSuperAdminData();

  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<ModalState>(null);

  const loading = clinicsLoading || orgsLoading || usersLoading;

  const q = search.toLowerCase();
  const filteredClinics = clinics.filter(c => c.name.toLowerCase().includes(q));
  const filteredOrgs = orgs.filter(o =>
    o.name.toLowerCase().includes(q) ||
    clinics.some(c => c.organization_id === o.id && c.name.toLowerCase().includes(q))
  );

  const clinicsInOrg = (orgId: string) => filteredClinics.filter(c => c.organization_id === orgId);
  const standaloneClinics = filteredClinics.filter(c => !c.organization_id);

  const handleDeleteClinic = async (clinic: Clinic) => {
    if (!confirm(`Excluir "${clinic.name}" e todos os seus dados? Esta ação não pode ser desfeita.`)) return;
    const ok = await deleteClinic(clinic.id);
    if (!ok) alert('Erro ao excluir clínica.');
  };

  const handleCreateClinic = async (data: any) => {
    const { error } = await createClinic(data);
    if (error) alert('Erro: ' + error.message);
  };

  const handleCreateOrg = async (data: { name: string; plan: string }) => {
    const { error } = await createOrg(data);
    if (error) alert('Erro: ' + error.message);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 text-teal-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900">Super Admin</h1>
          <p className="text-sm text-slate-500">Gestão completa de organizações, clínicas e usuários.</p>
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

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Organizações', value: orgs.length, icon: Network, color: 'bg-violet-50 text-violet-600' },
          { label: 'Clínicas', value: clinics.length, icon: Building2, color: 'bg-teal-50 text-teal-600' },
          { label: 'Usuários', value: totalUsers, icon: Users, color: 'bg-blue-50 text-blue-600' },
          { label: 'Planos Ativos', value: clinics.filter(c => c.plan !== 'free').length, icon: ShieldCheck, color: 'bg-amber-50 text-amber-600' },
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

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input type="text" placeholder="Buscar organização ou clínica..."
          value={search} onChange={e => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all"
        />
      </div>

      {/* Organizações */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-black text-slate-400 uppercase tracking-widest">Organizações ({filteredOrgs.length})</h2>
        </div>
        {filteredOrgs.length === 0 && (
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
            onDeleteClinic={handleDeleteClinic}
            onRemoveClinicUser={removeClinicUser}
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
                onDelete={() => handleDeleteClinic(clinic)}
                onRemoveUser={(userId) => removeClinicUser(userId, clinic.id)}
                showId
              />
            ))}
          </div>
        </div>
      )}

      {/* Modais */}
      {modal?.type === 'org' && (
        <AddOrgModal onSubmit={handleCreateOrg} onClose={() => setModal(null)} />
      )}

      {modal?.type === 'clinic' && (
        <AddClinicModal
          orgs={orgs}
          defaultOrgId={modal.orgId}
          onSubmit={handleCreateClinic}
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
