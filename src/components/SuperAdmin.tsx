import React, { useState } from 'react';
import { useClinics, useOrganizations, Clinic } from '../hooks/useSupabase';
import {
  Building2, Plus, Search, Activity, ShieldCheck,
  Edit2, Trash2, ChevronDown, ChevronRight, Loader2, X, Network,
} from 'lucide-react';
import { cn } from '@/src/lib/utils';

export default function SuperAdmin() {
  const { data: clinics, loading: clinicsLoading, create: createClinic } = useClinics();
  const { data: orgs, loading: orgsLoading, create: createOrg } = useOrganizations();

  const [searchTerm, setSearchTerm] = useState('');
  const [expandedOrgs, setExpandedOrgs] = useState<Set<string>>(new Set());

  // Modal: Nova Organização
  const [showOrgModal, setShowOrgModal] = useState(false);
  const [newOrg, setNewOrg] = useState({ name: '', plan: 'pro' });
  const [submittingOrg, setSubmittingOrg] = useState(false);

  // Modal: Nova Clínica
  const [showClinicModal, setShowClinicModal] = useState(false);
  const [newClinic, setNewClinic] = useState<Partial<Clinic>>({ name: '', plan: 'pro', organization_id: null });
  const [submittingClinic, setSubmittingClinic] = useState(false);

  const toggleOrg = (id: string) => {
    setExpandedOrgs(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const openClinicModal = (orgId: string | null = null) => {
    setNewClinic({ name: '', plan: 'pro', organization_id: orgId });
    setShowClinicModal(true);
  };

  const handleCreateOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newOrg.name.trim()) return;
    setSubmittingOrg(true);
    const { error } = await createOrg(newOrg);
    setSubmittingOrg(false);
    if (error) { alert('Erro: ' + error.message); return; }
    setShowOrgModal(false);
    setNewOrg({ name: '', plan: 'pro' });
  };

  const handleCreateClinic = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newClinic.name?.trim()) return;
    setSubmittingClinic(true);
    const { error } = await createClinic(newClinic);
    setSubmittingClinic(false);
    if (error) { alert('Erro: ' + error.message); return; }
    setShowClinicModal(false);
    setNewClinic({ name: '', plan: 'pro', organization_id: null });
  };

  const loading = clinicsLoading || orgsLoading;

  const clinicsInOrg = (orgId: string): Clinic[] =>
    clinics.filter((c: Clinic) => c.organization_id === orgId &&
      c.name.toLowerCase().includes(searchTerm.toLowerCase()));

  const clinicsSemOrg: Clinic[] = clinics.filter((c: Clinic) =>
    !c.organization_id &&
    c.name.toLowerCase().includes(searchTerm.toLowerCase()));

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
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Painel Super Admin</h1>
          <p className="text-sm text-slate-500">Gerencie organizações e clínicas do sistema.</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowOrgModal(true)}
            className="bg-violet-600 hover:bg-violet-700 text-white px-4 py-2 rounded-lg font-medium flex items-center gap-2 transition-colors shadow-sm"
          >
            <Plus className="w-4 h-4" />
            Nova Organização
          </button>
          <button
            onClick={() => openClinicModal(null)}
            className="bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-lg font-medium flex items-center gap-2 transition-colors shadow-sm"
          >
            <Plus className="w-4 h-4" />
            Nova Clínica
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white p-6 rounded-xl border border-slate-100 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-lg bg-violet-50 flex items-center justify-center">
            <Network className="w-6 h-6 text-violet-600" />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-500">Organizações</p>
            <p className="text-2xl font-bold text-slate-900">{orgs.length}</p>
          </div>
        </div>
        <div className="bg-white p-6 rounded-xl border border-slate-100 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-lg bg-teal-50 flex items-center justify-center">
            <Building2 className="w-6 h-6 text-teal-600" />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-500">Total de Clínicas</p>
            <p className="text-2xl font-bold text-slate-900">{clinics.length}</p>
          </div>
        </div>
        <div className="bg-white p-6 rounded-xl border border-slate-100 shadow-sm flex items-center gap-4">
          <div className="w-12 h-12 rounded-lg bg-orange-50 flex items-center justify-center">
            <ShieldCheck className="w-6 h-6 text-orange-600" />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-500">Contas Ativas</p>
            <p className="text-2xl font-bold text-slate-900">{clinics.filter(c => c.plan !== 'free').length}</p>
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          type="text"
          placeholder="Buscar clínica por nome..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-all"
        />
      </div>

      {/* Organizações */}
      <div className="space-y-4">
        <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wider">Organizações</h2>

        {orgs.length === 0 && (
          <div className="bg-white rounded-xl border border-slate-100 p-8 text-center">
            <Network className="w-10 h-10 text-slate-200 mx-auto mb-2" />
            <p className="text-slate-500 text-sm font-medium">Nenhuma organização cadastrada.</p>
          </div>
        )}

        {orgs.map(org => {
          const orgClinics = clinicsInOrg(org.id);
          const isExpanded = expandedOrgs.has(org.id);

          return (
            <div key={org.id} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div
                className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-slate-50 transition-colors"
                onClick={() => toggleOrg(org.id)}
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-violet-100 flex items-center justify-center">
                    <Network className="w-4 h-4 text-violet-600" />
                  </div>
                  <div>
                    <p className="font-bold text-slate-900 text-sm">{org.name}</p>
                    <p className="text-xs text-slate-400">{orgClinics.length} clínica{orgClinics.length !== 1 ? 's' : ''}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={cn(
                    "text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full",
                    org.plan === 'enterprise' ? "bg-amber-100 text-amber-700"
                      : org.plan === 'pro' ? "bg-violet-100 text-violet-700"
                      : "bg-slate-100 text-slate-500"
                  )}>
                    {org.plan}
                  </span>
                  <button
                    onClick={(e) => { e.stopPropagation(); openClinicModal(org.id); }}
                    className="flex items-center gap-1 px-3 py-1.5 bg-teal-50 hover:bg-teal-100 text-teal-700 rounded-lg text-xs font-bold transition-colors"
                  >
                    <Plus className="w-3 h-3" />
                    Clínica
                  </button>
                  {isExpanded
                    ? <ChevronDown className="w-4 h-4 text-slate-400" />
                    : <ChevronRight className="w-4 h-4 text-slate-400" />}
                </div>
              </div>

              {isExpanded && (
                <div className="border-t border-slate-100">
                  {orgClinics.length === 0 ? (
                    <p className="px-6 py-4 text-sm text-slate-400 italic">Nenhuma clínica nesta organização.</p>
                  ) : (
                    <table className="w-full text-left">
                      <tbody className="divide-y divide-slate-50">
                        {orgClinics.map((clinic: Clinic) => (
                          <ClinicRow key={clinic.id} clinic={clinic} />
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Clínicas sem organização */}
      {clinicsSemOrg.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wider">Clínicas sem organização</h2>
          <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-slate-50/50 text-slate-500 text-xs font-semibold uppercase tracking-wider">
                  <th className="px-6 py-3">Clínica</th>
                  <th className="px-6 py-3">Plano</th>
                  <th className="px-6 py-3">ID</th>
                  <th className="px-6 py-3">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {clinicsSemOrg.map((clinic: Clinic) => (
                  <ClinicRow key={clinic.id} clinic={clinic} showId />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal: Nova Organização */}
      {showOrgModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4">
            <div className="flex items-center justify-between p-6 border-b border-slate-100">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Nova Organização</h3>
                <p className="text-sm text-slate-500">Crie um grupo para gerenciar múltiplas clínicas.</p>
              </div>
              <button onClick={() => setShowOrgModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateOrg} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Nome da Organização</label>
                <input
                  type="text" required autoFocus
                  value={newOrg.name}
                  onChange={(e) => setNewOrg({ ...newOrg, name: e.target.value })}
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500"
                  placeholder="Ex: Med4grow"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Plano</label>
                <select
                  value={newOrg.plan}
                  onChange={(e) => setNewOrg({ ...newOrg, plan: e.target.value })}
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 bg-white"
                >
                  <option value="free">Free</option>
                  <option value="pro">Pro</option>
                  <option value="enterprise">Enterprise</option>
                </select>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowOrgModal(false)}
                  className="flex-1 px-4 py-2 border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50 transition-colors">
                  Cancelar
                </button>
                <button type="submit" disabled={submittingOrg}
                  className="flex-1 px-4 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors font-medium flex items-center justify-center gap-2 disabled:opacity-60">
                  {submittingOrg && <Loader2 className="w-4 h-4 animate-spin" />}
                  Criar Organização
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Nova Clínica */}
      {showClinicModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4">
            <div className="flex items-center justify-between p-6 border-b border-slate-100">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Nova Clínica</h3>
                <p className="text-sm text-slate-500">
                  {newClinic.organization_id
                    ? `Dentro de: ${orgs.find(o => o.id === newClinic.organization_id)?.name}`
                    : 'Sem organização vinculada'}
                </p>
              </div>
              <button onClick={() => setShowClinicModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateClinic} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Nome da Clínica</label>
                <input
                  type="text" required autoFocus
                  value={newClinic.name}
                  onChange={(e) => setNewClinic({ ...newClinic, name: e.target.value })}
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
                  placeholder="Ex: Clínica Saúde Total"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Plano</label>
                <select
                  value={newClinic.plan}
                  onChange={(e) => setNewClinic({ ...newClinic, plan: e.target.value as any })}
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 bg-white"
                >
                  <option value="free">Free</option>
                  <option value="pro">Pro</option>
                  <option value="enterprise">Enterprise</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Organização (opcional)</label>
                <select
                  value={newClinic.organization_id || ''}
                  onChange={(e) => setNewClinic({ ...newClinic, organization_id: e.target.value || null })}
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 bg-white"
                >
                  <option value="">Sem organização</option>
                  {orgs.map(o => (
                    <option key={o.id} value={o.id}>{o.name}</option>
                  ))}
                </select>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowClinicModal(false)}
                  className="flex-1 px-4 py-2 border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50 transition-colors">
                  Cancelar
                </button>
                <button type="submit" disabled={submittingClinic}
                  className="flex-1 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors font-medium flex items-center justify-center gap-2 disabled:opacity-60">
                  {submittingClinic && <Loader2 className="w-4 h-4 animate-spin" />}
                  Criar Clínica
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

const ClinicRow: React.FC<{ clinic: Clinic; showId?: boolean }> = ({ clinic, showId = false }) => {
  return (
    <tr className="hover:bg-slate-50 transition-colors group">
      <td className="px-6 py-3">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center">
            <Building2 className="w-3.5 h-3.5 text-slate-500" />
          </div>
          <span className="font-medium text-slate-900 text-sm">{clinic.name}</span>
        </div>
      </td>
      <td className="px-6 py-3">
        <span className={cn(
          "inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase",
          clinic.plan === 'enterprise' ? 'bg-purple-100 text-purple-700' :
          clinic.plan === 'pro' ? 'bg-teal-100 text-teal-700' :
          'bg-slate-100 text-slate-700'
        )}>
          {clinic.plan}
        </span>
      </td>
      {showId && (
        <td className="px-6 py-3 font-mono text-xs text-slate-400">{clinic.id}</td>
      )}
      <td className="px-6 py-3">
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button className="p-1.5 text-slate-400 hover:text-teal-600 transition-colors rounded">
            <Edit2 className="w-3.5 h-3.5" />
          </button>
          <button className="p-1.5 text-slate-400 hover:text-red-500 transition-colors rounded">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </td>
    </tr>
  );
}
